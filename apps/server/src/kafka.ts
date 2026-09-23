import { Kafka, logLevel, Partitioners } from "kafkajs";
import type { z } from "zod";
import { encode, Topics, type TopicName } from "@alertas/shared";
import { config } from "./config.js";

export const kafka = new Kafka({
  clientId: "alertas-server",
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN,
  retry: { retries: 8 },
});

export const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
  allowAutoTopicCreation: false,
});

/** Productor genérico: valida contra el esquema, serializa a JSON y publica */
export async function publish<S extends z.ZodTypeAny>(
  topic: TopicName,
  schema: S,
  value: z.input<S>,
  key?: string,
): Promise<void> {
  await producer.send({ topic, messages: [{ key, value: encode(schema, value) }] });
}

/** Mensajes que no pasan validación: se apartan para revisarlos sin detener el consumidor */
export async function toDeadLetter(source: string, raw: string, error: string): Promise<void> {
  await producer.send({
    topic: Topics.DEAD_LETTER,
    messages: [{ key: source, value: JSON.stringify({ source, error, raw, at: new Date().toISOString() }) }],
  });
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Misma definición que infra/kafka/create-topics.sh; el servidor crea los que falten al arrancar */
export const TOPIC_SPECS: { topic: TopicName; partitions: number; retentionMs: number }[] = [
  { topic: Topics.ALERTS_RAW, partitions: 6, retentionMs: 7 * DAY },
  { topic: Topics.ALERTS_NORMALIZED, partitions: 6, retentionMs: 30 * DAY },
  { topic: Topics.ALERTS_CRITICAL, partitions: 3, retentionMs: 30 * DAY },
  { topic: Topics.CHECKINS, partitions: 6, retentionMs: 30 * DAY },
  { topic: Topics.CHAT, partitions: 3, retentionMs: 7 * DAY },
  { topic: Topics.DEVICE_ACKS, partitions: 6, retentionMs: 7 * DAY },
  { topic: Topics.SENSOR_TRIGGERS, partitions: 1, retentionMs: 1 * DAY },
  { topic: Topics.SIM_FLOOD, partitions: 12, retentionMs: 1 * HOUR },
  { topic: Topics.DEAD_LETTER, partitions: 1, retentionMs: 7 * DAY },
];

export async function ensureTopics(log: (msg: string) => void): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = await admin.listTopics();
    const missing = TOPIC_SPECS.filter((s) => !existing.includes(s.topic));
    if (missing.length === 0) return;
    await admin.createTopics({
      waitForLeaders: true,
      topics: missing.map((s) => ({
        topic: s.topic,
        numPartitions: s.partitions,
        replicationFactor: 1,
        configEntries: [{ name: "retention.ms", value: String(s.retentionMs) }],
      })),
    });
    log(`Topics creados: ${missing.map((s) => s.topic).join(", ")}`);
  } finally {
    await admin.disconnect();
  }
}
