/**
 * Bitácora de actividad para el panel: en lugar de leer logs en la terminal,
 * cada evento relevante del sistema se guarda aquí y se transmite en vivo al panel.
 */
export type ActivityType =
  | "alert.published" | "alert.normalized" | "alert.dispatched" | "alert.duplicate" | "alert.invalid"
  | "ack" | "device.connected" | "device.disconnected"
  | "sensor.trigger" | "seismic.detection"
  | "chat.message" | "chat.deleted" | "admin" | "error";

export interface Activity {
  id: number;
  at: string;
  type: ActivityType;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
}

const MAX = 500;
const buffer: Activity[] = [];
let counter = 0;
let sink: ((a: Activity) => void) | undefined;

export function setActivitySink(fn: (a: Activity) => void) {
  sink = fn;
}

export function activity(
  type: ActivityType,
  message: string,
  data?: Record<string, unknown>,
  level: Activity["level"] = "info",
) {
  const a: Activity = { id: ++counter, at: new Date().toISOString(), type, level, message, data };
  buffer.push(a);
  if (buffer.length > MAX) buffer.shift();
  sink?.(a);
}

export function recentActivity(): Activity[] {
  return buffer;
}
