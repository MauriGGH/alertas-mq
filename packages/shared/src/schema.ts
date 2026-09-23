import { z } from "zod";

/**
 * Contrato de mensajes compartido por productores y consumidores
 * (servidor, panel, simulador y app). Todo lo que viaja por Kafka o
 * WebSocket se valida contra estos esquemas.
 */
export const SCHEMA_VERSION = 1 as const;

export const CveEnt = z.string().regex(/^\d{2}$/, "Clave de estado INEGI de 2 dígitos");
export const CveMun = z.string().regex(/^\d{5}$/, "Clave de municipio INEGI de 5 dígitos");
export const Hashtag = z.string().regex(/^#[\p{L}\p{N}_]+$/u, "Hashtag inválido");
const isoDate = z.string().datetime({ offset: true });

export const AlertType = z.enum([
  "EARTHQUAKE", "TSUNAMI", "HURRICANE", "STORM", "FLOOD",
  "VOLCANO", "WILDFIRE", "HEAT", "OTHER",
  // Escenarios ficticios para simulacros y demostración
  "ZOMBIE", "ALIEN",
]);
export type AlertType = z.infer<typeof AlertType>;

/** INFO < WATCH (vigilancia) < WARNING (alerta) < CRITICAL (inminente: sirena + pantalla completa) */
export const Severity = z.enum(["INFO", "WATCH", "WARNING", "CRITICAL"]);
export type Severity = z.infer<typeof Severity>;

/** CROWDSENSE = detectada por la red de sensores de los celulares */
export const AlertSource = z.enum(["USGS", "NHC", "GDACS", "SMN", "MANUAL", "SIMULATOR", "CROWDSENSE"]);

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
    estados: z.array(CveEnt).default([]),
    municipios: z.array(CveMun).default([]),
  }),
  tags: z.array(Hashtag).default([]),
  created_at: isoDate,
  expires_at: isoDate.optional(),
  /** true = simulacro o escenario ficticio: la app lo marca claramente como SIMULACRO */
  drill: z.boolean().default(false),
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
  cve_mun: CveMun,
  text: z.string().max(500).optional(),
  tags: z.array(Hashtag).default([]),
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
  tags: z.array(Hashtag).default([]),
  alert_id: z.string().uuid().optional(),
  cve_mun: CveMun.optional(),
  created_at: isoDate,
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const StoredChat = ChatMessage.extend({ seq: z.number().int().positive() });
export type StoredChat = z.infer<typeof StoredChat>;

/** Lo que manda la app al escribir en el chat o al pulsar "Estoy bien" / "Necesito ayuda" */
export const ChatSendInput = z.object({
  /** id generado por la app: si reintenta el envío tras perder conexión no se duplica */
  client_id: z.string().uuid().optional(),
  kind: z.enum(["message", "checkin_ok", "checkin_help"]).default("message"),
  text: z.string().trim().max(500).default(""),
  alert_id: z.string().uuid().optional(),
}).refine((v) => v.kind !== "message" || v.text.length > 0, { message: "El mensaje está vacío" });
export type ChatSendInput = z.input<typeof ChatSendInput>;

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

/** Alerta tras el normalizador: ya persistida y con los municipios destino resueltos */
export const NormalizedAlert = StoredAlert.extend({
  resolved_municipios: z.array(CveMun),
});
export type NormalizedAlert = z.infer<typeof NormalizedAlert>;

// ---------------------------------------------------------------------------
// Entradas de la API REST
// ---------------------------------------------------------------------------
export const Platform = z.enum(["android", "ios", "web", "sim"]);

export const RegisterInput = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6).max(100),
  cve_mun: CveMun,
  platform: Platform,
  is_simulated: z.boolean().optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  platform: Platform,
  device_id: z.string().uuid().optional(),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ZonesInput = z.object({
  zones: z
    .array(z.object({ cve_mun: CveMun, label: z.string().trim().min(1).max(30) }))
    .min(1)
    .max(10),
});
export type ZonesInput = z.infer<typeof ZonesInput>;

/** Alerta creada a mano desde el panel o la terminal (el servidor completa id, fechas y origen) */
export const ManualAlertInput = z
  .object({
    type: AlertType,
    severity: Severity,
    title: z.string().min(1).max(120),
    body: z.string().max(2000).default(""),
    geo: GeoArea.optional(),
    targets: z
      .object({
        estados: z.array(CveEnt).default([]),
        municipios: z.array(CveMun).default([]),
      })
      .default({}),
    tags: z.array(Hashtag).default([]),
    expires_in_min: z.number().int().positive().max(10080).optional(),
    drill: z.boolean().optional(),
  })
  .refine((v) => v.geo || v.targets.estados.length > 0 || v.targets.municipios.length > 0, {
    message: "Indica un área (geo) o destinos (estados/municipios)",
  });
export type ManualAlertInput = z.input<typeof ManualAlertInput>;

// ---------------------------------------------------------------------------
// Red sísmica comunitaria (sensores de los celulares)
// ---------------------------------------------------------------------------

/** Lo que manda la app cuando su acelerómetro/giroscopio detecta movimiento brusco */
export const SensorTriggerInput = z.object({
  /** Aceleración pico sin gravedad, en g (1 g = 9.81 m/s²) */
  peak_g: z.number().positive().max(20),
  /** Relación STA/LTA del detector local (opcional) */
  sta_lta: z.number().positive().max(10_000).optional(),
  /** Ubicación GPS opcional; si no llega se usa la cabecera de su municipio */
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  kind: z.enum(["phone", "simulated"]).default("phone"),
});
export type SensorTriggerInput = z.input<typeof SensorTriggerInput>;

/** Evento publicado en sensor.triggers */
export const SensorTrigger = z.object({
  v: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  device_id: z.string().uuid(),
  user_id: z.string().uuid(),
  cve_mun: CveMun.nullable(),
  lat: z.number(),
  lon: z.number(),
  peak_g: z.number(),
  sta_lta: z.number().optional(),
  kind: z.enum(["phone", "simulated"]),
  /** Hora del servidor al recibirlo: los relojes de los celulares no son confiables */
  received_at: isoDate,
});
export type SensorTrigger = z.infer<typeof SensorTrigger>;

/** Parámetros del detector (se ajustan en vivo desde el panel) */
export const DetectorConfig = z.object({
  enabled: z.boolean(),
  /** Dispositivos distintos necesarios para declarar sismo */
  minDevices: z.number().int().min(1).max(50),
  /** Ventana de tiempo en la que deben coincidir (s) */
  windowSec: z.number().min(2).max(120),
  /** Distancia máxima entre dispositivos del mismo grupo (km) */
  clusterRadiusKm: z.number().min(0.1).max(3000),
  /** Radio de la alerta alrededor del centro del grupo (km) */
  alertRadiusKm: z.number().min(5).max(3000),
  /** Tiempo mínimo entre dos detecciones (s) */
  cooldownSec: z.number().min(0).max(3600),
  /** "radio" = solo zona cercana; "nacional" = todo el país (modo demostración) */
  scope: z.enum(["radio", "nacional"]),
});
export type DetectorConfig = z.infer<typeof DetectorConfig>;

export const ALL_ESTADOS = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, "0"));
