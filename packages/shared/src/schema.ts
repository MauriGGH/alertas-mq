import { z } from "zod";

/**
 * Contrato de mensajes compartido por productores y consumidores
 * (servidor, panel, simulador y app). Todo lo que viaja por Kafka o
 * WebSocket se valida contra estos esquemas.
 */
export const SCHEMA_VERSION = 1 as const;

const cveEnt = z.string().regex(/^\d{2}$/, "Clave de estado INEGI de 2 dígitos");
const cveMun = z.string().regex(/^\d{5}$/, "Clave de municipio INEGI de 5 dígitos");
const hashtag = z.string().regex(/^#[\p{L}\p{N}_]+$/u, "Hashtag inválido");
const isoDate = z.string().datetime({ offset: true });

export const AlertType = z.enum([
  "EARTHQUAKE", "TSUNAMI", "HURRICANE", "STORM", "FLOOD",
  "VOLCANO", "WILDFIRE", "HEAT", "OTHER",
]);
export type AlertType = z.infer<typeof AlertType>;

/** INFO < WATCH (vigilancia) < WARNING (alerta) < CRITICAL (inminente: sirena + pantalla completa) */
export const Severity = z.enum(["INFO", "WATCH", "WARNING", "CRITICAL"]);
export type Severity = z.infer<typeof Severity>;

export const AlertSource = z.enum(["USGS", "NHC", "GDACS", "SMN", "MANUAL", "SIMULATOR"]);

export const GeoArea = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius_km: z.number().positive().max(5000),
});

/** Evento de alerta tal como lo publica un productor */
export const AlertEvent = z.object({
  v: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  external_id: z.string().optional(),
  type: AlertType,
  severity: Severity,
  title: z.string().min(1).max(120),
  body: z.string().max(2000),
  source: AlertSource,
  geo: GeoArea.optional(),
  targets: z.object({
    estados: z.array(cveEnt).default([]),
    municipios: z.array(cveMun).default([]),
  }),
  tags: z.array(hashtag).default([]),
  created_at: isoDate,
  expires_at: isoDate.optional(),
});
export type AlertEvent = z.infer<typeof AlertEvent>;

/** Alerta ya persistida: el servidor le asigna un número de secuencia global */
export const StoredAlert = AlertEvent.extend({ seq: z.number().int().positive() });
export type StoredAlert = z.infer<typeof StoredAlert>;

/** "Estoy bien" / "Necesito ayuda", opcionalmente ligado a una alerta */
export const CheckinEvent = z.object({
  v: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  status: z.enum(["OK", "HELP"]),
  alert_id: z.string().uuid().optional(),
  cve_mun: cveMun,
  text: z.string().max(500).optional(),
  tags: z.array(hashtag).default([]),
  created_at: isoDate,
});
export type CheckinEvent = z.infer<typeof CheckinEvent>;

export const ChatMessage = z.object({
  v: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  user_name: z.string().max(60),
  kind: z.enum(["message", "checkin_ok", "checkin_help"]),
  text: z.string().max(1000),
  tags: z.array(hashtag).default([]),
  alert_id: z.string().uuid().optional(),
  cve_mun: cveMun.optional(),
  created_at: isoDate,
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Confirmaciones del dispositivo: RECEIVED (llegó) y ACKNOWLEDGED (usuario pulsó "Enterado") */
export const DeviceAck = z.object({
  v: z.literal(SCHEMA_VERSION),
  alert_id: z.string().uuid(),
  device_id: z.string().uuid(),
  kind: z.enum(["RECEIVED", "ACKNOWLEDGED"]),
  at: isoDate,
});
export type DeviceAck = z.infer<typeof DeviceAck>;

/** Extrae hashtags de un texto libre: "Todo bien en #Manzanillo" -> ["#Manzanillo"] */
export function extractHashtags(text: string): string[] {
  return [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) ?? [])];
}
