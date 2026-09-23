/**
 * Consumidor 5 — Chat global
 * chat.global -> Postgres (chat_messages) -> difusión a todos los dispositivos conectados
 */
import type { FastifyBaseLogger } from "fastify";
import { ChatMessage, SocketEvents, Topics, decode, type StoredChat } from "@alertas/shared";
import { kafka, toDeadLetter } from "../kafka.js";
import { pool } from "../db.js";
import { getIO } from "../gateway.js";
import { metrics } from "../metrics.js";
import { activity } from "../activity.js";

export async function startChatWriter(log: FastifyBaseLogger) {
  const consumer = kafka.consumer({ groupId: "chat-writer" });
  await consumer.connect();
  await consumer.subscribe({ topic: Topics.CHAT, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const res = decode(ChatMessage, message.value);
      if (!res.ok) {
        await toDeadLetter(Topics.CHAT, res.raw, res.error);
        return;
      }
      const msg = res.value;
      let seq: number | undefined;
      try {
        const r = await pool.query<{ seq: number }>(
          `INSERT INTO chat_messages (id, user_id, kind, text, tags, alert_id, cve_mun, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING seq`,
          [msg.id, msg.user_id, msg.kind, msg.text, msg.tags, msg.alert_id ?? null, msg.cve_mun ?? null, msg.created_at],
        );
        seq = r.rows[0]?.seq;
      } catch (err) {
        if ((err as { code?: string }).code === "23503") {
          await toDeadLetter(Topics.CHAT, JSON.stringify(msg), "usuario o alerta inexistente");
          return;
        }
        log.error({ err }, "Error guardando mensaje de chat");
        throw err;
      }
      if (seq === undefined) return; // reintento de la app: ya estaba guardado

      const stored: StoredChat = { ...msg, seq };
      getIO().emit(SocketEvents.CHAT_MESSAGE, stored);
      metrics.chatMessages++;
      const label = msg.kind === "checkin_ok" ? "✅ Estoy bien" : msg.kind === "checkin_help" ? "🆘 Necesita ayuda" : "💬";
      activity(
        "chat.message",
        `${label} ${msg.user_name}: ${msg.text.slice(0, 80)}`,
        { seq, kind: msg.kind, tags: msg.tags, alert_id: msg.alert_id },
        msg.kind === "checkin_help" ? "warn" : "info",
      );
    },
  });

  return consumer;
}
