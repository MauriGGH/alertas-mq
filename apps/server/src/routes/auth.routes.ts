import type { FastifyInstance } from "fastify";
import { LoginInput, RegisterInput, ZonesInput } from "@alertas/shared";
import { pool, tx } from "../db.js";
import { buildSession, hashPassword, loadZones, requireAuth, verifyPassword } from "../auth.js";
import { refreshUserRooms } from "../gateway.js";

export function registerAuthRoutes(app: FastifyInstance) {
  // Registro: crea usuario, su zona principal ("Casa") y el dispositivo
  app.post("/auth/register", async (req, reply) => {
    const input = RegisterInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);

    const ids = await tx(async (c) => {
      const u = await c.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, cve_mun, is_simulated)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.name, input.email, passwordHash, input.cve_mun, input.is_simulated ?? false],
      );
      const userId = u.rows[0]!.id;
      await c.query("INSERT INTO user_zones (user_id, cve_mun, label) VALUES ($1, $2, 'Casa')", [userId, input.cve_mun]);
      const d = await c.query<{ id: string }>(
        "INSERT INTO devices (user_id, platform, last_seen) VALUES ($1, $2, now()) RETURNING id",
        [userId, input.platform],
      );
      return { userId, deviceId: d.rows[0]!.id };
    });

    return reply.code(201).send(await buildSession(app, ids.userId, ids.deviceId));
  });

  // Login: reutiliza el dispositivo si se manda su id; si no, registra uno nuevo
  app.post("/auth/login", async (req, reply) => {
    const input = LoginInput.parse(req.body);
    const { rows } = await pool.query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [input.email],
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      return reply.code(401).send({ error: "Correo o contraseña incorrectos" });
    }

    let deviceId: string | undefined;
    if (input.device_id) {
      const d = await pool.query<{ id: string }>(
        "UPDATE devices SET last_seen = now() WHERE id = $1 AND user_id = $2 RETURNING id",
        [input.device_id, user.id],
      );
      deviceId = d.rows[0]?.id;
    }
    if (!deviceId) {
      const d = await pool.query<{ id: string }>(
        "INSERT INTO devices (user_id, platform, last_seen) VALUES ($1, $2, now()) RETURNING id",
        [user.id, input.platform],
      );
      deviceId = d.rows[0]!.id;
    }
    return buildSession(app, user.id, deviceId);
  });

  app.get("/me", { preHandler: requireAuth }, async (req) => {
    return buildSession(app, req.user.sub, req.user.did);
  });

  // Reemplaza las zonas suscritas (casa, trabajo, familia...) y actualiza las salas en vivo
  app.put("/me/zones", { preHandler: requireAuth }, async (req) => {
    const input = ZonesInput.parse(req.body);
    const userId = req.user.sub;
    await tx(async (c) => {
      await c.query("DELETE FROM user_zones WHERE user_id = $1", [userId]);
      for (const z of input.zones) {
        await c.query(
          "INSERT INTO user_zones (user_id, cve_mun, label) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [userId, z.cve_mun, z.label],
        );
      }
    });
    const zones = await loadZones(userId);
    refreshUserRooms(userId, zones.map((z) => z.cve_mun));
    return { zones };
  });
}
