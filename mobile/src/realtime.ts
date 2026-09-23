/**
 * Conexión en tiempo real con el servidor (Socket.IO por el túnel de Cloudflare).
 * - Recibe alertas en vivo y, al (re)conectar, pide lo que se perdió con su cursor.
 * - Envía confirmaciones, mensajes de chat y disparos del sensor.
 * - Lo que no se puede enviar se guarda en la bandeja de salida y se reintenta.
 */
import { io, type Socket } from "socket.io-client";
import * as Crypto from "expo-crypto";
import { kvGet, kvSet, maxChatSeq, outboxAdd, outboxList, outboxRemove } from "./db";
import type { Alert, ChatKind, ChatMsg, ConnStatus } from "./types";

export interface RealtimeHandlers {
  onStatus(s: ConnStatus): void;
  onAlert(a: Alert, via: "vivo" | "sync"): Promise<void>;
  onSyncDone(recovered: number): void;
  onChat(m: ChatMsg): void;
  onChatDeleted(id: string): void;
  onZonesUpdated(): void;
  onUnauthorized(): void;
}

const EV = {
  ALERT: "alert", SYNC: "sync", ACK: "alert:ack", ZONES_UPDATED: "zones:updated", SENSOR: "sensor:trigger",
  CHAT_SEND: "chat:send", CHAT_MESSAGE: "chat:message", CHAT_HISTORY: "chat:history", CHAT_DELETED: "chat:deleted",
} as const;

type AckRes = { ok: boolean; reason?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Realtime {
  private socket?: Socket;
  private flushing = false;

  constructor(private h: RealtimeHandlers) {}

  get connected() {
    return !!this.socket?.connected;
  }

  connect(url: string, token: string) {
    this.disconnect();
    this.h.onStatus("connecting");
    const s = io(url.replace(/\/$/, ""), {
      auth: { token },
      transports: ["websocket"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    this.socket = s;

    s.on("connect", async () => {
      this.h.onStatus("online");
      await this.syncAlerts().catch(() => {});
      await this.catchUpChat().catch(() => {});
      await this.flushOutbox().catch(() => {});
    });
    s.on("disconnect", () => this.h.onStatus(s.active ? "connecting" : "offline"));
    s.io.on("reconnect_attempt", () => this.h.onStatus("connecting"));
    s.on("connect_error", (err) => {
      if (err.message === "unauthorized") {
        this.h.onUnauthorized();
        this.disconnect();
      } else {
        this.h.onStatus("connecting");
      }
    });
    s.on(EV.ALERT, (a: Alert) => void this.h.onAlert(a, "vivo"));
    s.on(EV.CHAT_MESSAGE, (m: ChatMsg) => this.h.onChat(m));
    s.on(EV.CHAT_DELETED, ({ id }: { id: string }) => this.h.onChatDeleted(id));
    s.on(EV.ZONES_UPDATED, () => {
      this.h.onZonesUpdated();
      void this.syncAlerts();
    });
  }

  disconnect() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.h.onStatus("offline");
  }

  /** Pide al servidor las alertas posteriores a nuestro cursor, página por página */
  async syncAlerts() {
    const s = this.socket;
    if (!s?.connected) return;
    let cursor = await kvGet<number>("cursor", 0);
    let recovered = 0;
    for (let page = 0; page < 20; page++) {
      const res: { alerts: Alert[]; cursor: number; has_more: boolean } | { error: string } =
        await s.timeout(15000).emitWithAck(EV.SYNC, { since: cursor });
      if ("error" in res) break;
      for (const a of res.alerts) await this.h.onAlert(a, "sync");
      recovered += res.alerts.length;
      cursor = res.cursor;
      await kvSet("cursor", cursor);
      if (!res.has_more) break;
    }
    this.h.onSyncDone(recovered);
  }

  /** Mensajes del chat que llegaron mientras estábamos desconectados */
  private async catchUpChat() {
    const s = this.socket;
    if (!s?.connected) return;
    let after = await maxChatSeq();
    for (let page = 0; page < 10; page++) {
      const req = after > 0 ? { after, limit: 200 } : { limit: 80 };
      const res: { messages: ChatMsg[] } | { error: string } = await s.timeout(15000).emitWithAck(EV.CHAT_HISTORY, req);
      if ("error" in res) return;
      res.messages.forEach((m) => this.h.onChat(m));
      if (after === 0 || res.messages.length < 200) return;
      after = res.messages[res.messages.length - 1]!.seq ?? after;
    }
  }

  /** Historial filtrado por hashtag (para la pestaña de chat) */
  async chatByTag(tag: string): Promise<ChatMsg[]> {
    const s = this.socket;
    if (!s?.connected) return [];
    const res: { messages: ChatMsg[] } | { error: string } = await s.timeout(15000).emitWithAck(EV.CHAT_HISTORY, { tag, limit: 100 });
    return "error" in res ? [] : res.messages;
  }

  async flushOutbox() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const item of await outboxList()) {
        const s = this.socket;
        if (!s?.connected) return;
        let res: AckRes;
        try {
          res = await s.timeout(10000).emitWithAck(item.event, item.payload);
        } catch {
          return; // sin respuesta: se reintenta en la próxima conexión
        }
        if (res.ok || res.reason === "invalid") await outboxRemove(item.id);
        else if (res.reason === "rate_limited") {
          await sleep(1000);
          const retry: AckRes = await s.timeout(10000).emitWithAck(item.event, item.payload).catch(() => ({ ok: false }));
          if (retry.ok) await outboxRemove(item.id);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Confirmación de alerta: se guarda en la bandeja y se envía en cuanto haya conexión */
  async ack(alertId: string, kind: "RECEIVED" | "ACKNOWLEDGED") {
    await outboxAdd({ id: `ack:${kind}:${alertId}`, event: EV.ACK, payload: { alert_id: alertId, kind } });
    void this.flushOutbox();
  }

  /** Mensaje o check-in. Devuelve el mensaje provisional para mostrarlo al instante */
  async sendChat(input: { kind: ChatKind; text: string; alert_id?: string }, me: { id: string; name: string }): Promise<ChatMsg> {
    const clientId = Crypto.randomUUID();
    const pending: ChatMsg = {
      id: clientId, user_id: me.id, user_name: me.name, kind: input.kind,
      text: input.text || (input.kind === "checkin_ok" ? "Estoy bien" : input.kind === "checkin_help" ? "Necesito ayuda" : ""),
      tags: [], alert_id: input.alert_id, created_at: new Date().toISOString(), pending: true,
    };
    await outboxAdd({ id: `chat:${clientId}`, event: EV.CHAT_SEND, payload: { client_id: clientId, ...input } });
    void this.flushOutbox();
    return pending;
  }

  /** Disparo del sensor sísmico (no se encola: pasado el momento ya no sirve) */
  async sensorTrigger(data: { peak_g: number; sta_lta?: number; kind: "phone" | "simulated" }): Promise<AckRes> {
    const s = this.socket;
    if (!s?.connected) return { ok: false, reason: "sin_conexion" };
    return s.timeout(5000).emitWithAck(EV.SENSOR, data).catch(() => ({ ok: false, reason: "timeout" }));
  }
}
