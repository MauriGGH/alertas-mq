import { env } from "./env.js";

function required(name: string): string {
  const value = env[name];
  if (!value) {
    console.error(`❌ Falta la variable ${name} en .env (revisa .env.example)`);
    process.exit(1);
  }
  return value;
}

const port = Number(env.PORT ?? 3000);

export const config = {
  port,
  kafkaBrokers: (env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  databaseUrl: env.DATABASE_URL ?? "postgres://alertas:alertas@localhost:5432/alertas",
  jwtSecret: required("JWT_SECRET"),
  adminToken: required("ADMIN_TOKEN"),
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${port}`,
};
