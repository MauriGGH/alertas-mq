/**
 * Fase 1: servidor mínimo con /health.
 * Sirve para comprobar Kafka, Postgres y el túnel de Cloudflare de punta a punta.
 */
import Fastify from "fastify";
import { Kafka, logLevel } from "kafkajs";
import pg from "pg";
import { Topics } from "@alertas/shared";
import { config } from "./config.js";

const app = Fastify({ logger: { level: "info" } });
const kafka = new Kafka({ clientId: "alertas-server", brokers: config.kafkaBrokers, logLevel: logLevel.WARN });
const admin = kafka.admin();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

let adminConnected = false;
async function ensureAdmin() {
  if (!adminConnected) {
    await admin.connect();
    adminConnected = true;
  }
}

app.get("/health", async (_req, reply) => {
  const expected = Object.values(Topics);
  const result = {
    ok: false,
    kafka: false,
    postgres: false,
    missingTopics: [] as string[],
    estados: 0,
    time: new Date().toISOString(),
  };

  try {
    await ensureAdmin();
    const topics = await admin.listTopics();
    result.missingTopics = expected.filter((t) => !topics.includes(t));
    result.kafka = true;
  } catch (err) {
    adminConnected = false;
    app.log.error({ err }, "Kafka no disponible");
  }

  try {
    const { rows } = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM estados");
    result.estados = Number(rows[0]?.n ?? 0);
    result.postgres = true;
  } catch (err) {
    app.log.error({ err }, "Postgres no disponible");
  }

  result.ok = result.kafka && result.postgres && result.missingTopics.length === 0;
  return reply.code(result.ok ? 200 : 503).send(result);
});

app.get("/", async () => ({ service: "alertas-mq", phase: 1, health: "/health" }));

const shutdown = async () => {
  app.log.info("Cerrando...");
  await app.close();
  await admin.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });
