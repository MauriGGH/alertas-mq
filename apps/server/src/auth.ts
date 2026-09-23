import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SessionResponse } from "@alertas/shared";
import { pool } from "./db.js";
import { config } from "./config.js";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface TokenPayload {
  sub: string; // user id
  did: string; // device id
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "No autorizado" });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.headers["x-admin-token"] !== config.adminToken) {
    return reply.code(401).send({ error: "Token de administrador inválido" });
  }
}

export async function loadZones(userId: string) {
  const { rows } = await pool.query<{ cve_mun: string; label: string; nombre: string; hashtag: string }>(
    `SELECT z.cve_mun, z.label, m.nombre, m.hashtag
       FROM user_zones z JOIN municipios m USING (cve_mun)
      WHERE z.user_id = $1 ORDER BY z.label`,
    [userId],
  );
  return rows;
}

export async function buildSession(app: FastifyInstance, userId: string, deviceId: string): Promise<SessionResponse> {
  const { rows } = await pool.query<SessionResponse["user"]>(
    "SELECT id, name, email, cve_mun FROM users WHERE id = $1",
    [userId],
  );
  const user = rows[0];
  if (!user) throw new Error("Usuario no encontrado");
  const token = app.jwt.sign({ sub: userId, did: deviceId }, { expiresIn: "30d" });
  return { token, device_id: deviceId, user, zones: await loadZones(userId) };
}
