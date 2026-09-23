import type { AlertType, Severity } from "./types";

export const C = {
  bg: "#EEF1F5",
  card: "#FFFFFF",
  ink: "#121B26",
  ink2: "#5B6B7D",
  line: "#D7DEE7",
  navy: "#0E1A28",
  info: "#1F7AE0",
  watch: "#B38600",
  warning: "#E8700A",
  critical: "#D92D20",
  drill: "#7C3AED",
  ok: "#1E9E5A",
};

export const SEV_COLOR: Record<Severity, string> = {
  INFO: C.info, WATCH: C.watch, WARNING: C.warning, CRITICAL: C.critical,
};

export const SEV_LABEL: Record<Severity, string> = {
  INFO: "Informativa", WATCH: "Vigilancia", WARNING: "Alerta", CRITICAL: "Crítica",
};

export const TYPE_LABEL: Record<AlertType, string> = {
  EARTHQUAKE: "Sismo", TSUNAMI: "Tsunami", HURRICANE: "Huracán", STORM: "Tormenta", FLOOD: "Inundación",
  VOLCANO: "Volcán", WILDFIRE: "Incendio forestal", HEAT: "Onda de calor", OTHER: "Aviso",
  ZOMBIE: "Brote zombie", ALIEN: "Invasión alienígena",
};

export const TYPE_ICON: Record<AlertType, string> = {
  EARTHQUAKE: "〰️", TSUNAMI: "🌊", HURRICANE: "🌀", STORM: "⛈️", FLOOD: "💧", VOLCANO: "🌋",
  WILDFIRE: "🔥", HEAT: "🌡️", OTHER: "📢", ZOMBIE: "🧟", ALIEN: "👽",
};

export function alertColor(a: { severity: Severity; drill?: boolean }) {
  return a.drill ? C.drill : SEV_COLOR[a.severity];
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

export function isActive(a: { expires_at?: string }): boolean {
  return !a.expires_at || Date.parse(a.expires_at) > Date.now();
}
