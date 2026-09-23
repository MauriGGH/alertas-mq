// Copia ligera de los tipos de packages/shared (la app vive fuera del monorepo del servidor)
export type Severity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";
export type AlertType =
  | "EARTHQUAKE" | "TSUNAMI" | "HURRICANE" | "STORM" | "FLOOD" | "VOLCANO"
  | "WILDFIRE" | "HEAT" | "OTHER" | "ZOMBIE" | "ALIEN";

export interface Alert {
  v: 1;
  id: string;
  seq: number;
  type: AlertType;
  severity: Severity;
  title: string;
  body: string;
  source: string;
  geo?: { lat: number; lon: number; radius_km: number };
  targets: { estados: string[]; municipios: string[] };
  tags: string[];
  created_at: string;
  expires_at?: string;
  drill?: boolean;
}

/** Alerta guardada en el teléfono */
export interface LocalAlert extends Alert {
  received_at: string;
  via: "vivo" | "sync";
  acked_at: string | null;
}

export type ChatKind = "message" | "checkin_ok" | "checkin_help";

export interface ChatMsg {
  seq?: number;
  id: string;
  user_id: string;
  user_name: string;
  kind: ChatKind;
  text: string;
  tags: string[];
  alert_id?: string;
  cve_mun?: string;
  created_at: string;
  /** true mientras está en la bandeja de salida sin confirmar por el servidor */
  pending?: boolean;
}

export interface Zone {
  cve_mun: string;
  label: string;
  nombre: string;
  hashtag: string;
}

export interface Session {
  token: string;
  device_id: string;
  user: { id: string; name: string; email: string; cve_mun: string | null };
  zones: Zone[];
}

export interface Estado { cve_ent: string; nombre: string; hashtag: string }
export interface Municipio { cve_mun: string; cve_ent: string; nombre: string; hashtag: string; lat: number | null; lon: number | null }

export type ConnStatus = "offline" | "connecting" | "online";
