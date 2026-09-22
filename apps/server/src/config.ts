import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// El .env vive en la raíz del monorepo
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://alertas:alertas@localhost:5432/alertas",
};
