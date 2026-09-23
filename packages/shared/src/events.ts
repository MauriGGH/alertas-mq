import type { StoredAlert, StoredChat } from "./schema.js";

/** Eventos de Socket.IO entre servidor y dispositivos */
export const SocketEvents = {
  /** servidor -> cliente: alerta nueva en vivo */
  ALERT: "alert",
  /** cliente -> servidor (con ack): pedir alertas desde un cursor */
  SYNC: "sync",
  /** cliente -> servidor: confirmación RECEIVED / ACKNOWLEDGED */
  ACK: "alert:ack",
  /** servidor -> cliente: las zonas del usuario cambiaron */
  ZONES_UPDATED: "zones:updated",
  /** cliente -> servidor (con ack): el sensor del celular detectó movimiento brusco */
  SENSOR_TRIGGER: "sensor:trigger",
  /** cliente -> servidor (con ack): enviar mensaje o check-in al chat global */
  CHAT_SEND: "chat:send",
  /** servidor -> todos: mensaje nuevo en el chat global */
  CHAT_MESSAGE: "chat:message",
  /** cliente -> servidor (con ack): historial del chat (before / after / tag) */
  CHAT_HISTORY: "chat:history",
  /** servidor -> todos: un moderador borró un mensaje */
  CHAT_DELETED: "chat:deleted",
} as const;

export interface SyncRequest {
  /** Cursor: el último seq devuelto por un sync anterior (0 la primera vez) */
  since: number;
}

export interface SyncResponse {
  alerts: StoredAlert[];
  cursor: number;
  has_more: boolean;
}

export interface AckRequest {
  alert_id: string;
  kind: "RECEIVED" | "ACKNOWLEDGED";
}

export interface SessionResponse {
  token: string;
  device_id: string;
  user: { id: string; name: string; email: string; cve_mun: string | null };
  zones: { cve_mun: string; label: string; nombre: string; hashtag: string }[];
}

export interface ChatHistoryRequest {
  /** mensajes anteriores a este seq (paginación hacia atrás) */
  before?: number;
  /** mensajes posteriores a este seq (ponerse al día tras reconectar) */
  after?: number;
  /** solo mensajes con este hashtag, p. ej. "#Manzanillo" */
  tag?: string;
  limit?: number;
}

export interface ChatHistoryResponse {
  messages: StoredChat[];
}
