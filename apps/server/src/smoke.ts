/**
 * Prueba de humo del patrón productor/consumidor:
 *  1. El productor serializa 5 alertas en JSON y las publica en alerts.raw (clave = estado).
 *  2. Un consumidor con grupo nuevo las lee, las deserializa, las valida y mide la latencia.
 */
import { Kafka, logLevel, Partitioners } from "kafkajs";
import { randomUUID } from "node:crypto";
import { AlertEvent, Topics, encode, decode, alertPartitionKey } from "@alertas/shared";
import { config } from "./config.js";

const RUN = randomUUID().slice(0, 8);
const N = 5;
const kafka = new Kafka({ clientId: `smoke-${RUN}`, brokers: config.kafkaBrokers, logLevel: logLevel.WARN });

const samples: AlertEvent[] = Array.from({ length: N }, (_, i) => ({
  v: 1,
  id: randomUUID(),
  type: i % 2 ? "EARTHQUAKE" : "HURRICANE",
  severity: i === N - 1 ? "CRITICAL" : "WARNING",
  title: `[SMOKE ${RUN}] Alerta de prueba ${i + 1}`,
  body: "Mensaje generado por la prueba de humo de la Fase 1",
  source: "SIMULATOR",
  geo: { lat: 19.05, lon: -104.31, radius_km: 150 },
  targets: { estados: ["06"], municipios: ["06007", "06009"] },
  tags: ["#Colima", "#Manzanillo"],
  created_at: new Date().toISOString(),
}));

async function main() {
  // --- Productor ---
  const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  await producer.send({
    topic: Topics.ALERTS_RAW,
    messages: samples.map((a) => ({ key: alertPartitionKey(a), value: encode(AlertEvent, a) })),
  });
  await producer.disconnect();
  console.log(`✔ Productor: ${N} alertas publicadas en ${Topics.ALERTS_RAW}`);

  // --- Consumidor ---
  const wanted = new Set(samples.map((s) => s.id));
  const consumer = kafka.consumer({ groupId: `smoke-${RUN}` });
  await consumer.connect();
  await consumer.subscribe({ topic: Topics.ALERTS_RAW, fromBeginning: true });

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: faltaron ${wanted.size} mensajes`)), 30_000);
    consumer.run({
      eachMessage: async ({ partition, message }) => {
        const res = decode(AlertEvent, message.value);
        if (!res.ok) return; // mensajes de otras corridas / inválidos
        if (!wanted.delete(res.value.id)) return;
        const ms = Date.now() - Date.parse(res.value.created_at);
        console.log(`✔ Consumidor: [p${partition}] ${res.value.severity.padEnd(8)} ${res.value.title}  (${ms} ms)`);
        if (wanted.size === 0) {
          clearTimeout(timer);
          resolve();
        }
      },
    });
  });

  try {
    await done;
    console.log("\n✅ Fase 1 OK: productor → Kafka → consumidor funcionando");
  } finally {
    await consumer.disconnect();
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
