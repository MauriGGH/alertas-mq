/**
 * Consumidor 3 — Registro de confirmaciones
 * device.acks  ->  alert_acks + devices.last_seq_ack
 * Permite saber en el panel quién recibió y quién confirmó cada alerta.
 */
import type { FastifyBaseLogger } from "fastify";
import { DeviceAck, Topics, decode } from "@alertas/shared";
import { kafka, toDeadLetter } from "../kafka.js";
import { pool } from "../db.js";
import { metrics } from "../metrics.js";
import { activity } from "../activity.js";

export async function startAckWriter(log: FastifyBaseLogger) {
  const consumer = kafka.consumer({ groupId: "acks-writer" });
  await consumer.connect();
  await consumer.subscribe({ topic: Topics.DEVICE_ACKS, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const res = decode(DeviceAck, message.value);
      if (!res.ok) {
        await toDeadLetter(Topics.DEVICE_ACKS, res.raw, res.error);
        return;
      }
      const ack = res.value;
      try {
        await pool.query(
          `INSERT INTO alert_acks (alert_id, device_id, received_at, acked_at)
           VALUES ($1, $2,
                   CASE WHEN $3 = 'RECEIVED' THEN $4::timestamptz END,
                   CASE WHEN $3 = 'ACKNOWLEDGED' THEN $4::timestamptz END)
           ON CONFLICT (alert_id, device_id) DO UPDATE SET
             received_at = COALESCE(alert_acks.received_at, EXCLUDED.received_at, EXCLUDED.acked_at),
             acked_at    = COALESCE(alert_acks.acked_at, EXCLUDED.acked_at)`,
          [ack.alert_id, ack.device_id, ack.kind, ack.at],
        );
        await pool.query(
          `UPDATE devices
              SET last_seq_ack = GREATEST(last_seq_ack, COALESCE((SELECT seq FROM alerts WHERE id = $1), 0))
            WHERE id = $2`,
          [ack.alert_id, ack.device_id],
        );
        if (ack.kind === "RECEIVED") metrics.acksReceived++;
        else {
          metrics.acksAcknowledged++;
          activity("ack", `Dispositivo ${ack.device_id.slice(0, 8)} confirmó "Enterado"`, { alert_id: ack.alert_id });
        }
      } catch (err) {
        // Alerta o dispositivo inexistente: no tiene caso reintentar
        if ((err as { code?: string }).code === "23503") {
          await toDeadLetter(Topics.DEVICE_ACKS, JSON.stringify(ack), "alerta o dispositivo inexistente");
          return;
        }
        log.error({ err }, "Error guardando ACK");
        throw err;
      }
    },
  });

  return consumer;
}
