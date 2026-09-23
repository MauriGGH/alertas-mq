/**
 * Servidor de alertas — Fase 2
 * REST (registro, login, catálogo, admin) + WebSocket + 3 consumidores Kafka.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import fastifyJwt from "@fastify/jwt";
import type { Consumer } from "kafkajs";
import { Topics, ZodError } from "@alertas/shared";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { ensureTopics, kafka, producer } from "./kafka.js";
import { startGateway, getIO, getAdminNs } from "./gateway.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerCatalogRoutes } from "./routes/catalog.routes.js";
import { registerAdminRoutes, metricsSnapshot } from "./routes/admin.routes.js";
import { startNormalizer } from "./pipeline/normalizer.js";
import { startDispatcher } from "./pipeline/dispatcher.js";
import { startAckWriter } from "./pipeline/acks.js";
import { startSeismicDetector } from "./pipeline/seismic-detector.js";
import { startChatWriter } from "./pipeline/chat.js";

const app = Fastify({
  logger: {
    level: "info",
    transport: process.stdout.isTTY
      ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
  },
});

await app.register(cors, { origin: true });
await app.register(fastifyJwt, { secret: config.jwtSecret });
// Panel gráfico del servidor en /panel/
await app.register(fastifyStatic, {
  root: fileURLToPath(new URL("../panel/", import.meta.url)),
  prefix: "/panel/",
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: "Datos inválidos",
      issues: err.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`),
    });
  }
  const code = (err as { code?: string }).code;
  if (code === "23505") return reply.code(409).send({ error: "Ya existe un registro con esos datos (¿correo repetido?)" });
  if (code === "23503") return reply.code(400).send({ error: "Referencia inválida (¿municipio inexistente?)" });
  const e = err as { statusCode?: number; message?: string };
  app.log.error(err);
  return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "Error interno" });
});

// ---- Rutas -----------------------------------------------------------------
const admin = kafka.admin();
let adminConnected = false;

app.get("/", async (_req, reply) => reply.redirect("/panel/"));

app.get("/health", async (_req, reply) => {
  const result = { ok: false, kafka: false, postgres: false, missingTopics: [] as string[], time: new Date().toISOString() };
  try {
    if (!adminConnected) {
      await admin.connect();
      adminConnected = true;
    }
    const topics = await admin.listTopics();
    result.missingTopics = Object.values(Topics).filter((t) => !topics.includes(t));
    result.kafka = true;
  } catch {
    adminConnected = false;
  }
  try {
    await pool.query("SELECT 1");
    result.postgres = true;
  } catch {
    /* sin conexión */
  }
  result.ok = result.kafka && result.postgres && result.missingTopics.length === 0;
  return reply.code(result.ok ? 200 : 503).send(result);
});

app.get("/metrics", async () => metricsSnapshot());

registerAuthRoutes(app);
registerCatalogRoutes(app);
registerAdminRoutes(app);

// ---- Arranque ----------------------------------------------------------------
await migrate((msg) => app.log.info(msg));
await ensureTopics((msg) => app.log.info(msg));
await producer.connect();
await app.ready();
startGateway(app);

const consumers: Consumer[] = [
  await startNormalizer(app.log),
  await startDispatcher(app.log),
  await startAckWriter(app.log),
  await startSeismicDetector(app.log),
  await startChatWriter(app.log),
];

// Métricas al panel cada segundo
const metricsTimer = setInterval(() => getAdminNs()?.emit("metrics", metricsSnapshot()), 1000);

await app.listen({ host: "0.0.0.0", port: config.port });
app.log.info(`Servidor listo en http://localhost:${config.port}  |  público: ${config.publicUrl}`);

const shutdown = async () => {
  app.log.info("Cerrando...");
  clearInterval(metricsTimer);
  getIO().close();
  await Promise.allSettled(consumers.map((c) => c.disconnect()));
  await Promise.allSettled([producer.disconnect(), adminConnected ? admin.disconnect() : Promise.resolve()]);
  await app.close();
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
