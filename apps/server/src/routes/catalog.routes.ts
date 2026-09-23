import type { FastifyInstance } from "fastify";
import { CveEnt } from "@alertas/shared";
import { pool } from "../db.js";

export function registerCatalogRoutes(app: FastifyInstance) {
  app.get("/catalog/estados", async () => {
    const { rows } = await pool.query("SELECT cve_ent, nombre, hashtag FROM estados ORDER BY cve_ent");
    return rows;
  });

  app.get<{ Querystring: { estado?: string } }>("/catalog/municipios", async (req) => {
    const estado = CveEnt.parse(req.query.estado);
    const { rows } = await pool.query(
      "SELECT cve_mun, cve_ent, nombre, hashtag, lat, lon FROM municipios WHERE cve_ent = $1 ORDER BY nombre",
      [estado],
    );
    return rows;
  });
}
