/**
 * Consumidor 2 — Dispatcher
 * alerts.normalized  ->  WebSocket a las salas "mun:<cve_mun>" de los municipios afectados
 *
 * Socket.IO entrega una sola copia por socket aunque esté en varias salas destino.
 * Si un dispositivo está desconectado no pasa nada: al reconectar pide `sync`.
 */
import { hostname } from "node:os";
import type { FastifyBaseLogger } from "fastify";
import { NormalizedAlert, SocketEvents, Topics, decode } from "@alertas/shared";
import { kafka, toDeadLetter } from "../kafka.js";
import { getIO } from "../gateway.js";
import { metrics } from "../metrics.js";
import { activity } from "../activity.js";

export async function startDispatcher(log: FastifyBaseLogger) {
  const consumer = kafka.consumer({ groupId: `dispatcher-${hostname()}` });
  await consumer.connect();
  await consumer.subscribe({ topic: Topics.ALERTS_NORMALIZED, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const res = decode(NormalizedAlert, message.value);
      if (!res.ok) {
        await toDeadLetter(Topics.ALERTS_NORMALIZED, res.raw, res.error);
        return;
      }
      const { resolved_municipios, ...alert } = res.value;
      if (resolved_municipios.length === 0) return;

      const io = getIO();
      const rooms = resolved_municipios.map((m) => `mun:${m}`);

      // Cuántos dispositivos distintos la reciben (unión de sockets de las salas)
      const recipients = new Set<string>();
      for (const room of rooms) io.sockets.adapter.rooms.get(room)?.forEach((id) => recipients.add(id));

      io.to(rooms).emit(SocketEvents.ALERT, alert);

      metrics.alertsDispatched++;
      metrics.deliveries += recipients.size;
      metrics.lastPipelineLatencyMs = Date.now() - Date.parse(alert.created_at);
      activity(
        "alert.dispatched",
        `#${alert.seq} entregada a ${recipients.size} dispositivos (${metrics.lastPipelineLatencyMs} ms)`,
        { seq: alert.seq, recipients: recipients.size, latencyMs: metrics.lastPipelineLatencyMs },
      );
      log.info(
        { seq: alert.seq, recipients: recipients.size, latencyMs: metrics.lastPipelineLatencyMs },
        "Alerta enviada a dispositivos",
      );
    },
  });

  return consumer;
}
