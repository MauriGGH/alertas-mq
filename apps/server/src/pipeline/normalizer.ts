/**
 * Consumidor 1 — Normalizador
 * alerts.raw  ->  (validar, resolver municipios, etiquetar, persistir)  ->  alerts.normalized (+ alerts.critical)
 *
 * PostgreSQL asigna el `seq` global. Si una alerta llega dos veces (mismo id, o mismo
 * source+external_id desde una API), el INSERT no hace nada y no se vuelve a publicar.
 */
import type { FastifyBaseLogger } from "fastify";
import { AlertEvent, NormalizedAlert, StoredAlert, Topics, alertPartitionKey, decode } from "@alertas/shared";
import { kafka, publish, toDeadLetter } from "../kafka.js";
import { pool, tx } from "../db.js";
import { metrics } from "../metrics.js";
import { activity } from "../activity.js";

/** Municipios afectados: explícitos + todos los de los estados indicados + los que caen dentro del radio */
export async function resolveMunicipios(alert: AlertEvent): Promise<string[]> {
  const result = new Set(alert.targets.municipios);

  if (alert.targets.estados.length > 0) {
    const { rows } = await pool.query<{ cve_mun: string }>(
      "SELECT cve_mun FROM municipios WHERE cve_ent = ANY($1::bpchar[])",
      [alert.targets.estados],
    );
    rows.forEach((r) => result.add(r.cve_mun));
  }

  if (alert.geo) {
    // Distancia haversine (km) desde el centro de la alerta a la cabecera de cada municipio
    const { rows } = await pool.query<{ cve_mun: string }>(
      `SELECT cve_mun FROM municipios
        WHERE lat IS NOT NULL
          AND 2 * 6371 * asin(sqrt(
                power(sin(radians(lat - $1) / 2), 2) +
                cos(radians($1)) * cos(radians(lat)) * power(sin(radians(lon - $2) / 2), 2)
              )) <= $3`,
      [alert.geo.lat, alert.geo.lon, alert.geo.radius_km],
    );
    rows.forEach((r) => result.add(r.cve_mun));
  }

  return [...result].sort();
}

/** Añade hashtags de estado (y de municipio si son pocos) para poder filtrar en la app y el chat */
export async function buildTags(alert: AlertEvent, municipios: string[]): Promise<string[]> {
  const tags = new Set(alert.tags);
  if (municipios.length > 0) {
    const { rows } = await pool.query<{ mh: string; eh: string }>(
      `SELECT m.hashtag AS mh, e.hashtag AS eh
         FROM municipios m JOIN estados e USING (cve_ent)
        WHERE m.cve_mun = ANY($1::bpchar[])`,
      [municipios],
    );
    rows.forEach((r) => tags.add(r.eh));
    if (rows.length <= 10) rows.forEach((r) => tags.add(r.mh));
  }
  return [...tags];
}

export async function persist(alert: AlertEvent, municipios: string[]): Promise<StoredAlert | null> {
  return tx(async (c) => {
    const r = await c.query<{ seq: number }>(
      `INSERT INTO alerts (id, external_id, type, severity, title, body, source,
                           lat, lon, radius_km, tags, payload, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT DO NOTHING
       RETURNING seq`,
      [
        alert.id, alert.external_id ?? null, alert.type, alert.severity, alert.title, alert.body, alert.source,
        alert.geo?.lat ?? null, alert.geo?.lon ?? null, alert.geo?.radius_km ?? null,
        alert.tags, JSON.stringify(alert), alert.created_at, alert.expires_at ?? null,
      ],
    );
    const seq = r.rows[0]?.seq;
    if (seq === undefined) return null; // duplicada

    if (municipios.length > 0) {
      await c.query(
        "INSERT INTO alert_targets (alert_seq, cve_mun) SELECT $1, unnest($2::bpchar[])",
        [seq, municipios],
      );
    }
    return { ...alert, seq };
  });
}

export async function startNormalizer(log: FastifyBaseLogger) {
  const consumer = kafka.consumer({ groupId: "normalizer" });
  await consumer.connect();
  await consumer.subscribe({ topic: Topics.ALERTS_RAW, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message, partition }) => {
      const res = decode(AlertEvent, message.value);
      if (!res.ok) {
        metrics.alertsInvalid++;
        log.warn({ error: res.error }, "Alerta inválida -> dead.letter");
        activity("alert.invalid", `Alerta inválida enviada a dead.letter: ${res.error.slice(0, 120)}`, undefined, "warn");
        await toDeadLetter(Topics.ALERTS_RAW, res.raw, res.error);
        return;
      }

      // Si algo aquí falla (p. ej. Postgres caído) se lanza el error y kafkajs reintenta
      // el mismo mensaje: no se avanza el offset, así que no se pierde.
      const municipios = await resolveMunicipios(res.value);
      const alert = { ...res.value, tags: await buildTags(res.value, municipios) };
      const stored = await persist(alert, municipios);

      if (!stored) {
        metrics.alertsDuplicated++;
        log.info({ id: alert.id }, "Alerta duplicada, se ignora");
        activity("alert.duplicate", `Duplicada, se ignora: ${alert.title}`, { id: alert.id, source: alert.source });
        return;
      }

      const normalized: NormalizedAlert = { ...stored, resolved_municipios: municipios };
      const key = municipios[0]?.slice(0, 2) ?? alertPartitionKey(alert);
      await publish(Topics.ALERTS_NORMALIZED, NormalizedAlert, normalized, key);
      if (alert.severity === "CRITICAL") {
        await publish(Topics.ALERTS_CRITICAL, NormalizedAlert, normalized, key);
      }

      metrics.alertsNormalized++;
      log.info(
        { seq: stored.seq, partition, type: alert.type, severity: alert.severity, municipios: municipios.length },
        `Alerta normalizada: ${alert.title}`,
      );
      activity(
        "alert.normalized",
        `#${stored.seq} ${alert.severity} ${alert.title} → ${municipios.length} municipios`,
        { seq: stored.seq, type: alert.type, severity: alert.severity, source: alert.source, municipios: municipios.length },
        municipios.length === 0 ? "warn" : "info",
      );
      if (municipios.length === 0) log.warn({ seq: stored.seq }, "La alerta no afecta a ningún municipio del catálogo");
    },
  });

  return consumer;
}
