/**
 * Consumidor 4 — Detector sísmico comunitario (procesamiento de streaming con ventana)
 *
 * sensor.triggers  ->  ventana deslizante de N segundos  ->  ¿≥ minDevices dispositivos
 * distintos, cercanos entre sí, dispararon a la vez?  ->  alerta CRÍTICA en alerts.raw
 *
 * Un celular solo puede ser un golpe, una caída o alguien agitándolo; varios celulares
 * separados moviéndose al mismo tiempo es una señal mucho más fuerte de sismo.
 * La alerta generada entra al pipeline normal (normalizador -> dispatcher).
 */
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  ALL_ESTADOS, AlertEvent, SensorTrigger, Topics, alertPartitionKey, decode, type DetectorConfig,
} from "@alertas/shared";
import { kafka, publish, toDeadLetter } from "../kafka.js";
import { metrics } from "../metrics.js";
import { activity } from "../activity.js";

export const detectorConfig: DetectorConfig = {
  enabled: true,
  minDevices: 3,
  windowSec: 10,
  clusterRadiusKm: 50,
  alertRadiusKm: 150,
  cooldownSec: 60,
  scope: "radio",
};

const window: SensorTrigger[] = [];
const detections: { at: string; devices: number; lat: number; lon: number; alert_id: string }[] = [];
let lastDetectionMs = 0;

export function detectorState() {
  return { config: detectorConfig, window: window.slice(-50), detections: detections.slice(-20) };
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function evaluate(trigger: SensorTrigger, log: FastifyBaseLogger): { alert: AlertEvent; devices: number } | null {
  const now = Date.parse(trigger.received_at);

  // 1. Ventana deslizante: descartar lo que ya salió de la ventana
  while (window.length && now - Date.parse(window[0]!.received_at) > detectorConfig.windowSec * 1000) window.shift();
  window.push(trigger);

  if (!detectorConfig.enabled) return null;

  // 2. Grupo espacial: disparos cercanos a este, uno por dispositivo (el más reciente)
  const byDevice = new Map<string, SensorTrigger>();
  for (const t of window) {
    if (distanceKm(t, trigger) <= detectorConfig.clusterRadiusKm) byDevice.set(t.device_id, t);
  }
  const group = [...byDevice.values()];
  activity(
    "sensor.trigger",
    `📳 Sensor ${trigger.kind === "simulated" ? "simulado" : "real"} ${trigger.device_id.slice(0, 8)}: ${trigger.peak_g.toFixed(2)} g → grupo ${group.length}/${detectorConfig.minDevices}`,
    { lat: trigger.lat, lon: trigger.lon, peak_g: trigger.peak_g, group: group.length, kind: trigger.kind },
  );
  log.info(
    { device: trigger.device_id.slice(0, 8), peak_g: trigger.peak_g, grupo: group.length, necesarios: detectorConfig.minDevices },
    "Disparo de sensor",
  );

  // 3. ¿Suficientes dispositivos y fuera del periodo de enfriamiento?
  if (group.length < detectorConfig.minDevices) return null;
  if (now - lastDetectionMs < detectorConfig.cooldownSec * 1000) return null;
  lastDetectionMs = now;

  const lat = group.reduce((s, t) => s + t.lat, 0) / group.length;
  const lon = group.reduce((s, t) => s + t.lon, 0) / group.length;
  const peak = Math.max(...group.map((t) => t.peak_g));
  const simulated = group.every((t) => t.kind === "simulated");
  const nacional = detectorConfig.scope === "nacional";

  const alert: AlertEvent = {
    v: 1,
    id: randomUUID(),
    type: "EARTHQUAKE",
    severity: "CRITICAL",
    source: "CROWDSENSE",
    title: "ALERTA SÍSMICA — Movimiento detectado por la red de sensores",
    body:
      `${group.length} dispositivos detectaron movimiento fuerte al mismo tiempo (pico ${peak.toFixed(2)} g). ` +
      "Detección comunitaria no confirmada: aléjese de ventanas y diríjase a una zona segura.",
    geo: nacional ? undefined : { lat, lon, radius_km: detectorConfig.alertRadiusKm },
    targets: { estados: nacional ? ALL_ESTADOS : [], municipios: [] },
    tags: ["#RedSísmica"],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    drill: simulated,
  };
  return { alert, devices: group.length };
}

export async function startSeismicDetector(log: FastifyBaseLogger) {
  const consumer = kafka.consumer({ groupId: "seismic-detector" });
  await consumer.connect();
  await consumer.subscribe({ topic: Topics.SENSOR_TRIGGERS, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const res = decode(SensorTrigger, message.value);
      if (!res.ok) {
        await toDeadLetter(Topics.SENSOR_TRIGGERS, res.raw, res.error);
        return;
      }
      const detection = evaluate(res.value, log);
      if (!detection) return;
      const { alert, devices } = detection;

      await publish(Topics.ALERTS_RAW, AlertEvent, alert, alertPartitionKey(alert));
      metrics.seismicDetections++;
      detections.push({
        at: alert.created_at, devices, lat: alert.geo?.lat ?? 0, lon: alert.geo?.lon ?? 0, alert_id: alert.id,
      });
      log.warn({ alert_id: alert.id, scope: detectorConfig.scope }, "🚨 SISMO DETECTADO por la red de sensores");
      activity("seismic.detection", `🚨 Sismo detectado por ${devices} dispositivos`, { alert_id: alert.id, devices }, "warn");
    },
  });

  return consumer;
}
