/**
 * Gateway WebSocket (Socket.IO)
 *
 * Espacio "/" (dispositivos):
 *  - Autentica con el JWT en el handshake.
 *  - Une cada socket a las salas de sus zonas ("mun:06007") y a "user:<id>".
 *  - sync           -> alertas pendientes desde el cursor del dispositivo
 *  - alert:ack      -> RECEIVED / ACKNOWLEDGED            -> device.acks
 *  - sensor:trigger -> movimiento brusco del acelerómetro -> sensor.triggers
 *  - chat:send      -> mensaje o check-in                 -> chat.global
 *  - chat:history   -> historial del chat global
 *
 * Espacio "/admin" (panel): actividad y métricas en vivo, protegido con ADMIN_TOKEN.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Server, type Namespace } from "socket.io";
import {
  ChatMessage, ChatSendInput, DeviceAck, SensorTrigger, SensorTriggerInput, SocketEvents, Topics, extractHashtags,
  type AckRequest, type AlertEvent, type ChatHistoryRequest, type ChatHistoryResponse, type StoredChat,
  type SyncRequest, type SyncResponse,
} from "@alertas/shared";
import { pool } from "./db.js";
import { publish } from "./kafka.js";
import { loadZones, type TokenPayload } from "./auth.js";
import { metrics } from "./metrics.js";
import { config } from "./config.js";
import { activity, recentActivity, setActivitySink } from "./activity.js";

export interface SocketData {
  userId: string;
  deviceId: string;
  name: string;
  platform: string;
  zones: string[];
  connectedAt: string;
  /** Municipio de registro: ubicación por defecto de los sensores y hashtags de los check-ins */
  home: { cve_mun: string | null; lat: number | null; lon: number | null; mun_tag: string | null; ent_tag: string | null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IO = Server<any, any, any, SocketData>;
let io: IO | undefined;
let adminNs: Namespace | undefined;

export function getIO(): IO {
  if (!io) throw new Error("Gateway no inicializado");
  return io;
}

export function getAdminNs(): Namespace | undefined {
  return adminNs;
}

const SYNC_PAGE = 200;
const SENSOR_MIN_INTERVAL_MS = 5_000;
const CHAT_MIN_INTERVAL_MS = 800;
const lastSensorTrigger = new Map<string, number>();
const lastChat = new Map<string, number>();

export async function syncAlerts(zones: string[], since: number): Promise<SyncResponse> {
  // Primera sincronización (since = 0): solo lo de los últimos 7 días
  const { rows } = await pool.query<{ seq: number; payload: AlertEvent }>(
    `SELECT a.seq, a.payload
       FROM alerts a
      WHERE a.seq > $1
        AND ($1 > 0 OR a.stored_at > now() - interval '7 days')
        AND EXISTS (SELECT 1 FROM alert_targets t
                     WHERE t.alert_seq = a.seq AND t.cve_mun = ANY($2::bpchar[]))
      ORDER BY a.seq
      LIMIT $3`,
    [since, zones, SYNC_PAGE + 1],
  );
  const page = rows.slice(0, SYNC_PAGE);
  return {
    alerts: page.map((r) => ({ ...r.payload, seq: r.seq })),
    cursor: page.at(-1)?.seq ?? since,
    has_more: rows.length > SYNC_PAGE,
  };
}

interface ChatRow {
  seq: number; id: string; user_id: string; user_name: string; kind: StoredChat["kind"];
  text: string; tags: string[]; alert_id: string | null; cve_mun: string | null; created_at: Date;
}

export function chatRowToMessage(r: ChatRow): StoredChat {
  return {
    v: 1, seq: r.seq, id: r.id, user_id: r.user_id, user_name: r.user_name, kind: r.kind, text: r.text,
    tags: r.tags, alert_id: r.alert_id ?? undefined, cve_mun: r.cve_mun ?? undefined, created_at: r.created_at.toISOString(),
  };
}

export async function chatHistory(req: ChatHistoryRequest): Promise<ChatHistoryResponse> {
  const limit = Math.min(Math.max(Number(req.limit) || 50, 1), 200);
  const tag = typeof req.tag === "string" && req.tag.startsWith("#") ? req.tag : null;
  const select = `SELECT c.seq, c.id, c.user_id, u.name AS user_name, c.kind, c.text, c.tags, c.alert_id, c.cve_mun, c.created_at
                    FROM chat_messages c JOIN users u ON u.id = c.user_id`;
  if (req.after !== undefined) {
    const { rows } = await pool.query<ChatRow>(
      `${select} WHERE c.seq > $1 AND ($2::text IS NULL OR $2 = ANY(c.tags)) ORDER BY c.seq ASC LIMIT $3`,
      [Number(req.after) || 0, tag, limit],
    );
    return { messages: rows.map(chatRowToMessage) };
  }
  const { rows } = await pool.query<ChatRow>(
    `${select} WHERE ($1::bigint IS NULL OR c.seq < $1) AND ($2::text IS NULL OR $2 = ANY(c.tags)) ORDER BY c.seq DESC LIMIT $3`,
    [req.before ?? null, tag, limit],
  );
  return { messages: rows.reverse().map(chatRowToMessage) };
}

export function startGateway(app: FastifyInstance): IO {
  io = new Server(app.server, {
    cors: { origin: "*" },
    pingInterval: 25_000, // < 100 s de inactividad que tolera Cloudflare
    pingTimeout: 20_000,
  });

  // ---- Panel admin -----------------------------------------------------------
  adminNs = io.of("/admin");
  adminNs.use((socket, next) =>
    socket.handshake.auth?.token === config.adminToken ? next() : next(new Error("unauthorized")),
  );
  adminNs.on("connection", (socket) => socket.emit("activity:backlog", recentActivity().slice(-200)));
  setActivitySink((a) => adminNs?.emit("activity", a));

  // ---- Dispositivos ------------------------------------------------------------
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string") throw new Error("sin token");
      const payload = app.jwt.verify<TokenPayload>(token);
      const zones = (await loadZones(payload.sub)).map((z) => z.cve_mun);
      const { rows } = await pool.query<{
        name: string; platform: string | null; cve_mun: string | null; lat: number | null; lon: number | null;
        mun_tag: string | null; ent_tag: string | null;
      }>(
        `SELECT u.name, d.platform, u.cve_mun, m.lat, m.lon, m.hashtag AS mun_tag, e.hashtag AS ent_tag
           FROM users u
           LEFT JOIN municipios m ON m.cve_mun = u.cve_mun
           LEFT JOIN estados e ON e.cve_ent = m.cve_ent
           LEFT JOIN devices d ON d.id = $2
          WHERE u.id = $1`,
        [payload.sub, payload.did],
      );
      const r = rows[0];
      if (!r) throw new Error("usuario inexistente");
      socket.data = {
        userId: payload.sub,
        deviceId: payload.did,
        name: r.name,
        platform: r.platform ?? "sim",
        zones,
        connectedAt: new Date().toISOString(),
        home: { cve_mun: r.cve_mun, lat: r.lat, lon: r.lon, mun_tag: r.mun_tag, ent_tag: r.ent_tag },
      };
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { userId, deviceId, zones, name, platform } = socket.data;
    socket.join([`user:${userId}`, ...zones.map((z) => `mun:${z}`)]);
    metrics.connections++;
    // Los simulados pueden ser miles: solo se registran en la bitácora los reales
    if (platform !== "sim") activity("device.connected", `${name} se conectó (${platform})`, { deviceId, zones });
    pool.query("UPDATE devices SET last_seen = now() WHERE id = $1", [deviceId]).catch(() => {});

    socket.on(SocketEvents.SYNC, async (req: SyncRequest, cb?: (res: SyncResponse | { error: string }) => void) => {
      if (typeof cb !== "function") return;
      metrics.syncRequests++;
      try {
        cb(await syncAlerts(socket.data.zones, Math.max(0, Number(req?.since) || 0)));
      } catch (err) {
        app.log.error({ err }, "Error en sync");
        cb({ error: "sync_failed" });
      }
    });

    socket.on(SocketEvents.ACK, async (req: AckRequest, cb?: (res: { ok: boolean }) => void) => {
      try {
        const ack = DeviceAck.parse({
          v: 1, alert_id: req?.alert_id, device_id: deviceId, kind: req?.kind, at: new Date().toISOString(),
        });
        await publish(Topics.DEVICE_ACKS, DeviceAck, ack, deviceId);
        cb?.({ ok: true });
      } catch {
        cb?.({ ok: false });
      }
    });

    // Red sísmica: el celular reporta movimiento brusco
    socket.on(SocketEvents.SENSOR_TRIGGER, async (req: unknown, cb?: (res: { ok: boolean; reason?: string }) => void) => {
      const now = Date.now();
      if (now - (lastSensorTrigger.get(deviceId) ?? 0) < SENSOR_MIN_INTERVAL_MS) {
        metrics.sensorRateLimited++;
        return cb?.({ ok: false, reason: "rate_limited" });
      }
      const input = SensorTriggerInput.safeParse(req);
      if (!input.success) return cb?.({ ok: false, reason: "invalid" });

      // GPS redondeado a ~1 km por privacidad; si no hay, la cabecera de su municipio
      const { home } = socket.data;
      const lat = input.data.lat !== undefined ? Math.round(input.data.lat * 100) / 100 : home.lat;
      const lon = input.data.lon !== undefined ? Math.round(input.data.lon * 100) / 100 : home.lon;
      if (lat === null || lon === null) return cb?.({ ok: false, reason: "sin_ubicacion" });

      lastSensorTrigger.set(deviceId, now);
      try {
        await publish(Topics.SENSOR_TRIGGERS, SensorTrigger, {
          v: 1, id: randomUUID(), device_id: deviceId, user_id: userId, cve_mun: home.cve_mun, lat, lon,
          peak_g: input.data.peak_g, sta_lta: input.data.sta_lta, kind: input.data.kind,
          received_at: new Date(now).toISOString(),
        }, "seismic");
        metrics.sensorTriggers++;
        cb?.({ ok: true });
      } catch {
        cb?.({ ok: false, reason: "error" });
      }
    });

    // Chat global y check-ins
    socket.on(SocketEvents.CHAT_SEND, async (req: unknown, cb?: (res: { ok: boolean; id?: string; reason?: string }) => void) => {
      const now = Date.now();
      if (now - (lastChat.get(deviceId) ?? 0) < CHAT_MIN_INTERVAL_MS) return cb?.({ ok: false, reason: "rate_limited" });
      const input = ChatSendInput.safeParse(req);
      if (!input.success) return cb?.({ ok: false, reason: "invalid" });
      lastChat.set(deviceId, now);

      const { home } = socket.data;
      const tags = new Set(extractHashtags(input.data.text));
      // Los check-ins llevan siempre el municipio y el estado para poder filtrarlos
      if (input.data.kind !== "message") {
        if (home.mun_tag) tags.add(home.mun_tag);
        if (home.ent_tag) tags.add(home.ent_tag);
      }
      const defaultText = input.data.kind === "checkin_ok" ? "Estoy bien" : input.data.kind === "checkin_help" ? "Necesito ayuda" : "";
      try {
        const msg = ChatMessage.parse({
          v: 1,
          id: input.data.client_id ?? randomUUID(),
          user_id: userId,
          user_name: socket.data.name,
          kind: input.data.kind,
          text: input.data.text || defaultText,
          tags: [...tags],
          alert_id: input.data.alert_id,
          cve_mun: home.cve_mun ?? undefined,
          created_at: new Date(now).toISOString(),
        });
        await publish(Topics.CHAT, ChatMessage, msg, userId);
        cb?.({ ok: true, id: msg.id });
      } catch {
        cb?.({ ok: false, reason: "error" });
      }
    });

    socket.on(SocketEvents.CHAT_HISTORY, async (req: ChatHistoryRequest, cb?: (res: ChatHistoryResponse | { error: string }) => void) => {
      if (typeof cb !== "function") return;
      try {
        cb(await chatHistory(req ?? {}));
      } catch (err) {
        app.log.error({ err }, "Error en historial de chat");
        cb({ error: "history_failed" });
      }
    });

    socket.on("disconnect", () => {
      if (platform !== "sim") activity("device.disconnected", `${name} se desconectó`, { deviceId });
      pool.query("UPDATE devices SET last_seen = now() WHERE id = $1", [deviceId]).catch(() => {});
    });
  });

  return io;
}

/** Cuando un usuario cambia sus zonas, sus sockets abiertos cambian de sala al instante */
export function refreshUserRooms(userId: string, zones: string[]): void {
  if (!io) return;
  const socketIds = io.sockets.adapter.rooms.get(`user:${userId}`);
  socketIds?.forEach((id) => {
    const socket = io!.sockets.sockets.get(id);
    if (!socket) return;
    for (const room of [...socket.rooms]) if (room.startsWith("mun:")) socket.leave(room);
    socket.join(zones.map((z) => `mun:${z}`));
    socket.data.zones = zones;
    socket.emit(SocketEvents.ZONES_UPDATED, { zones });
  });
}

/** Dispositivos conectados ahora mismo (para el panel) */
export function connectedDevices() {
  if (!io) return [];
  return [...io.sockets.sockets.values()].map((s) => ({
    socketId: s.id,
    userId: s.data.userId,
    deviceId: s.data.deviceId,
    name: s.data.name,
    platform: s.data.platform,
    zones: s.data.zones,
    home: s.data.home.cve_mun,
    connectedAt: s.data.connectedAt,
    transport: s.conn.transport.name,
  }));
}
