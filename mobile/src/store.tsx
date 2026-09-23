/**
 * Estado global de la app: sesión, conexión, alertas, chat y alertas críticas pendientes.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Vibration } from "react-native";
import { api } from "./api";
import { clearSession, deleteChat, initDb, kvGet, kvSet, listAlerts, listChat, markAlertAcked, saveAlert, saveChat } from "./db";
import { Realtime } from "./realtime";
import { initAudio, playOnce } from "./sounds";
import type { SensorMode } from "./sensor";
import { DEFAULT_SERVER_URL } from "./config";
import { isActive } from "./theme";
import type { Alert, ChatKind, ChatMsg, ConnStatus, LocalAlert, Session, Zone } from "./types";

export interface Settings {
  sensorEnabled: boolean;
  sensorMode: SensorMode;
}

interface Toast {
  id: number;
  title: string;
  body?: string;
  color?: string;
  alertId?: string;
}

interface Ctx {
  phase: "loading" | "auth" | "app";
  serverUrl: string;
  session: Session | null;
  status: ConnStatus;
  alerts: LocalAlert[];
  chat: ChatMsg[];
  critical: LocalAlert | null;
  toast: Toast | null;
  settings: Settings;
  authError: string | null;
  openAlertId: string | null;
  setServerUrl(url: string): Promise<void>;
  signIn(session: Session): Promise<void>;
  signOut(): Promise<void>;
  acknowledge(a: LocalAlert, checkin?: "checkin_ok" | "checkin_help"): Promise<void>;
  sendChat(kind: ChatKind, text: string, alertId?: string): Promise<void>;
  chatByTag(tag: string): Promise<ChatMsg[]>;
  updateZones(zones: { cve_mun: string; label: string }[]): Promise<Zone[]>;
  setSettings(s: Partial<Settings>): Promise<void>;
  showToast(t: Omit<Toast, "id">): void;
  dismissToast(): void;
  openAlert(id: string | null): void;
  sensorTrigger(d: { peak_g: number; sta_lta?: number; kind: "phone" | "simulated" }): Promise<{ ok: boolean; reason?: string }>;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp fuera de AppProvider");
  return c;
};

const FRESH_MS = 30 * 60_000; // una alerta crítica recuperada se muestra si tiene menos de 30 min

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Ctx["phase"]>("loading");
  const [serverUrl, setServerUrlState] = useState(DEFAULT_SERVER_URL);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<ConnStatus>("offline");
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [criticalQueue, setCriticalQueue] = useState<LocalAlert[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [settings, setSettingsState] = useState<Settings>({ sensorEnabled: false, sensorMode: "demo" });
  const [authError, setAuthError] = useState<string | null>(null);
  const [openAlertId, setOpenAlertId] = useState<string | null>(null);

  const serverRef = useRef(serverUrl);
  serverRef.current = serverUrl;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const toastSeq = useRef(0);

  const showToast = useCallback((t: Omit<Toast, "id">) => setToast({ ...t, id: ++toastSeq.current }), []);

  const upsertChat = useCallback((m: ChatMsg) => {
    setChat((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      const next = i >= 0 ? prev.map((x, j) => (j === i ? m : x)) : [...prev, m];
      next.sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at));
      return next.length > 600 ? next.slice(-600) : next;
    });
  }, []);

  const rt = useMemo(
    () =>
      new Realtime({
        onStatus: setStatus,
        onAlert: async (a: Alert, via) => {
          const local = await saveAlert(a, via);
          if (!local) return; // ya la teníamos
          rt.ack(a.id, "RECEIVED");
          setAlerts((prev) => [local, ...prev].sort((x, y) => y.seq - x.seq));
          const fresh = via === "vivo" || (isActive(a) && Date.now() - Date.parse(a.created_at) < FRESH_MS);
          if (!fresh) return;
          if (a.severity === "CRITICAL") {
            setCriticalQueue((q) => [...q, local]);
          } else {
            playOnce("chime", 2500);
            Vibration.vibrate(Platform.OS === "android" ? [0, 250, 120, 250] : 400);
            showToast({ title: a.title, body: a.body, alertId: a.id, color: a.drill ? "#7C3AED" : undefined });
          }
        },
        onSyncDone: (n) => {
          if (n > 0) showToast({ title: `Se recuperaron ${n} alertas`, body: "Llegaron mientras estabas sin conexión." });
        },
        onChat: (m) => {
          void saveChat(m);
          upsertChat(m);
        },
        onChatDeleted: (id) => {
          void deleteChat(id);
          setChat((prev) => prev.filter((m) => m.id !== id));
        },
        onZonesUpdated: async () => {
          const s = sessionRef.current;
          if (!s) return;
          const me = await api.me(serverRef.current, s.token).catch(() => null);
          if (me) {
            const next = { ...s, zones: me.zones };
            setSession(next);
            await kvSet("session", next);
          }
        },
        onUnauthorized: async () => {
          await clearSession();
          setSession(null);
          setAuthError("Tu sesión expiró. Vuelve a iniciar sesión.");
          setPhase("auth");
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Arranque: abrir SQLite, cargar lo guardado y reconectar si había sesión
  useEffect(() => {
    (async () => {
      await initDb();
      await initAudio();
      const [url, saved, s, localAlerts, localChat] = await Promise.all([
        kvGet("server_url", DEFAULT_SERVER_URL),
        kvGet<Session | null>("session", null),
        kvGet<Settings>("settings", { sensorEnabled: false, sensorMode: "demo" }),
        listAlerts(),
        listChat(),
      ]);
      setServerUrlState(url);
      setSettingsState(s);
      setAlerts(localAlerts);
      setChat(localChat);
      if (saved) {
        setSession(saved);
        setPhase("app");
        rt.connect(url, saved.token);
      } else {
        setPhase("auth");
      }
    })();
  }, [rt]);

  // Al volver a primer plano: si el socket se cayó, se reconecta y sincroniza
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      const s = sessionRef.current;
      if (st === "active" && s) {
        if (!rt.connected) rt.connect(serverRef.current, s.token);
        else void rt.syncAlerts();
      }
    });
    return () => sub.remove();
  }, [rt]);

  const value: Ctx = {
    phase,
    serverUrl,
    session,
    status,
    alerts,
    chat,
    critical: criticalQueue[0] ?? null,
    toast,
    settings,
    authError,
    openAlertId,

    async setServerUrl(url) {
      const clean = url.trim().replace(/\/$/, "");
      setServerUrlState(clean);
      await kvSet("server_url", clean);
    },

    async signIn(s) {
      await kvSet("session", s);
      setSession(s);
      setAuthError(null);
      setPhase("app");
      rt.connect(serverRef.current, s.token);
    },

    async signOut() {
      rt.disconnect();
      await clearSession();
      setSession(null);
      setPhase("auth");
    },

    async acknowledge(a, checkin) {
      Vibration.cancel();
      const at = await markAlertAcked(a.id);
      await rt.ack(a.id, "ACKNOWLEDGED");
      setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, acked_at: x.acked_at ?? at } : x)));
      setCriticalQueue((q) => q.filter((x) => x.id !== a.id));
      if (checkin) await value.sendChat(checkin, "", a.id);
    },

    async sendChat(kind, text, alertId) {
      const s = sessionRef.current;
      if (!s) return;
      const pending = await rt.sendChat({ kind, text, alert_id: alertId }, { id: s.user.id, name: s.user.name });
      await saveChat(pending);
      upsertChat(pending);
    },

    chatByTag: (tag) => rt.chatByTag(tag),

    async updateZones(zones) {
      const s = sessionRef.current;
      if (!s) return [];
      const res = await api.putZones(serverRef.current, s.token, zones);
      const next = { ...s, zones: res.zones };
      setSession(next);
      await kvSet("session", next);
      return res.zones;
    },

    async setSettings(partial) {
      const next = { ...settings, ...partial };
      setSettingsState(next);
      await kvSet("settings", next);
    },

    showToast,
    dismissToast: () => setToast(null),
    openAlert: setOpenAlertId,
    sensorTrigger: (d) => rt.sensorTrigger(d),
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
