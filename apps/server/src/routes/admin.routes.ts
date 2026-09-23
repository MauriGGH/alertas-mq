import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AlertEvent, CveMun, DetectorConfig, ManualAlertInput, SensorTrigger, SocketEvents, Topics, alertPartitionKey,
} from "@alertas/shared";
import { publish } from "../kafka.js";
import { requireAdmin } from "../auth.js";
import { pool } from "../db.js";
import { detectorConfig, detectorState } from "../pipeline/seismic-detector.js";
import { chatHistory, connectedDevices, getIO } from "../gateway.js";
import { activity, recentActivity } from "../activity.js";
import { metrics } from "../metrics.js";

export function registerAdminRoutes(app: FastifyInstance) {
  app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    /**
     * Productor manual: el panel publica una alerta en alerts.raw.
     * Responde 202 porque la alerta se procesa de forma asíncrona en el pipeline.
     */
    admin.post("/admin/alerts", async (req, reply) => {
      const input = ManualAlertInput.parse(req.body);
      const now = new Date();
      const alert: AlertEvent = {
        v: 1,
        id: randomUUID(),
        type: input.type,
        severity: input.severity,
        title: input.title,
        body: input.body,
        source: "MANUAL",
        geo: input.geo,
        targets: input.targets,
        tags: input.tags,
        created_at: now.toISOString(),
        expires_at: input.expires_in_min
          ? new Date(now.getTime() + input.expires_in_min * 60_000).toISOString()
          : undefined,
        drill: input.drill ?? false,
      };
      await publish(Topics.ALERTS_RAW, AlertEvent, alert, alertPartitionKey(alert));
      activity("alert.published", `Alerta manual publicada en alerts.raw: ${alert.title}`, { id: alert.id, severity: alert.severity });
      return reply.code(202).send({ accepted: true, id: alert.id });
    });

    // Historial de alertas con estadísticas de entrega y check-ins
    admin.get<{ Querystring: { limit?: string } }>("/admin/alerts", async (req) => {
      const limit = Math.min(Number(req.query.limit) || 30, 200);
      const { rows } = await pool.query(
        `SELECT a.seq, a.id, a.type, a.severity, a.title, a.source, a.created_at, a.expires_at,
                COALESCE((a.payload->>'drill')::boolean, false) AS drill,
                (SELECT count(*) FROM alert_targets t WHERE t.alert_seq = a.seq) AS municipios,
                (SELECT count(*) FROM alert_acks k WHERE k.alert_id = a.id AND k.received_at IS NOT NULL) AS received,
                (SELECT count(*) FROM alert_acks k WHERE k.alert_id = a.id AND k.acked_at IS NOT NULL) AS acknowledged,
                (SELECT count(*) FROM chat_messages c WHERE c.alert_id = a.id AND c.kind = 'checkin_ok') AS ok,
                (SELECT count(*) FROM chat_messages c WHERE c.alert_id = a.id AND c.kind = 'checkin_help') AS help
           FROM alerts a ORDER BY a.seq DESC LIMIT $1`,
        [limit],
      );
      return rows;
    });

    // Áreas de las alertas recientes para el mapa: círculo si tiene radio, puntos si fue por municipios
    admin.get("/admin/alerts/geo", async () => {
      const { rows } = await pool.query<{
        id: string; title: string; severity: string; drill: boolean;
        lat: number | null; lon: number | null; radius_km: number | null; points: [number, number][] | null;
      }>(
        `SELECT a.id, a.title, a.severity, COALESCE((a.payload->>'drill')::boolean, false) AS drill,
                a.lat, a.lon, a.radius_km,
                CASE WHEN a.lat IS NULL THEN (
                  SELECT json_agg(json_build_array(m.lat, m.lon))
                    FROM (SELECT m.lat, m.lon FROM alert_targets t JOIN municipios m ON m.cve_mun = t.cve_mun
                           WHERE t.alert_seq = a.seq AND m.lat IS NOT NULL LIMIT 300) m
                ) END AS points
           FROM alerts a ORDER BY a.seq DESC LIMIT 60`,
      );
      return rows.map((r) => ({
        id: r.id, title: r.title, severity: r.severity, drill: r.drill,
        geo: r.lat !== null && r.lon !== null && r.radius_km !== null ? { lat: r.lat, lon: r.lon, radius_km: r.radius_km } : undefined,
        points: r.points ?? [],
      }));
    });

    // Dispositivos conectados + totales registrados
    admin.get("/admin/devices", async () => {
      const { rows } = await pool.query<{ reales: number; simulados: number }>(
        `SELECT count(*) FILTER (WHERE NOT is_simulated) AS reales, count(*) FILTER (WHERE is_simulated) AS simulados FROM users`,
      );
      return { connected: connectedDevices(), registered: rows[0] };
    });

    admin.post<{ Params: { socketId: string } }>("/admin/devices/:socketId/disconnect", async (req, reply) => {
      const socket = getIO().sockets.sockets.get(req.params.socketId);
      if (!socket) return reply.code(404).send({ error: "Ese dispositivo ya no está conectado" });
      activity("admin", `Desconexión forzada de ${socket.data.name}`);
      socket.disconnect(true);
      return { ok: true };
    });

    // Chat: ver y moderar
    admin.get<{ Querystring: { tag?: string; limit?: string } }>("/admin/chat", async (req) =>
      chatHistory({ tag: req.query.tag, limit: Number(req.query.limit) || 100 }),
    );

    admin.delete<{ Params: { id: string } }>("/admin/chat/:id", async (req, reply) => {
      const id = z.string().uuid().parse(req.params.id);
      const r = await pool.query("DELETE FROM chat_messages WHERE id = $1", [id]);
      if (!r.rowCount) return reply.code(404).send({ error: "Ese mensaje no existe" });
      getIO().emit(SocketEvents.CHAT_DELETED, { id });
      activity("chat.deleted", `Mensaje ${id.slice(0, 8)} eliminado por moderación`);
      return { ok: true };
    });

    // Bitácora y métricas
    admin.get("/admin/activity", async () => recentActivity());
    admin.get("/admin/metrics", async () => metricsSnapshot());

    // Detector sísmico: estado, configuración en vivo y simulación
    admin.get("/admin/detector", async () => detectorState());

    admin.put("/admin/detector", async (req) => {
      Object.assign(detectorConfig, DetectorConfig.partial().parse(req.body));
      activity("admin", `Detector sísmico ajustado: ${JSON.stringify(detectorConfig)}`);
      return detectorState();
    });

    admin.post("/admin/detector/simulate", async (req, reply) => {
      const input = z.object({ devices: z.number().int().min(1).max(50), cve_mun: CveMun, spreadMs: z.number().int().min(0).max(5000).default(400) }).parse(req.body);
      const { rows } = await pool.query<{ lat: number; lon: number }>(
        "SELECT lat, lon FROM municipios WHERE cve_mun = $1 AND lat IS NOT NULL",
        [input.cve_mun],
      );
      const center = rows[0];
      if (!center) return reply.code(400).send({ error: "Ese municipio no tiene coordenadas" });
      activity("admin", `Simulación: ${input.devices} sensores virtuales en ${input.cve_mun}`);
      for (let i = 0; i < input.devices; i++) {
        setTimeout(() => {
          publish(Topics.SENSOR_TRIGGERS, SensorTrigger, {
            v: 1, id: randomUUID(), device_id: randomUUID(), user_id: randomUUID(), cve_mun: input.cve_mun,
            lat: center.lat + (Math.random() - 0.5) * 0.05, lon: center.lon + (Math.random() - 0.5) * 0.05,
            peak_g: 0.3 + Math.random() * 0.9, kind: "simulated", received_at: new Date().toISOString(),
          }, "seismic").catch((err) => req.log.error({ err }, "Error simulando sensor"));
        }, i * input.spreadMs);
      }
      return reply.code(202).send({ accepted: true });
    });
  });
}

export function metricsSnapshot() {
  let connectedNow = 0;
  let connectedReal = 0;
  try {
    const io = getIO();
    connectedNow = io.sockets.sockets.size; // solo dispositivos, no cuenta el panel
    for (const s of io.sockets.sockets.values()) if (s.data.platform !== "sim") connectedReal++;
  } catch {
    /* gateway aún no iniciado */
  }
  return {
    ...metrics,
    connectedNow,
    connectedReal,
    uptimeSec: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    at: new Date().toISOString(),
  };
}
