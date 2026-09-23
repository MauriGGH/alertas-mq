/**
 * Dispositivo simulado en terminal. Hace lo mismo que hará la app:
 *  - se registra o inicia sesión,
 *  - se conecta por WebSocket,
 *  - sincroniza lo pendiente con su cursor y recibe alertas en vivo,
 *  - guarda todo en un archivo local (equivale al SQLite del celular),
 *  - confirma cada alerta (RECEIVED) y las críticas con "Enterado" (ACKNOWLEDGED).
 *
 *   npm run client -- --email ana@demo.mx --name Ana --mun 06007
 *   npm run client -- --email beto@demo.mx --name Beto --mun 19039 --url https://api.tudominio.com
 */
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { SocketEvents, type SessionResponse, type StoredAlert, type SyncResponse } from "@alertas/shared";

const { values: args } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string", default: "Usuario demo" },
    mun: { type: "string", default: "06007" },
    password: { type: "string", default: "demo1234" },
    url: { type: "string", default: "http://localhost:3000" },
    reset: { type: "boolean", default: false },
  },
});

if (!args.email) {
  console.error("Uso: npm run client -- --email ana@demo.mx [--name Ana] [--mun 06007] [--url https://api.tudominio.com] [--reset]");
  process.exit(1);
}

const URL = args.url!.replace(/\/$/, "");
const DIR = ".clientes";
const FILE = `${DIR}/${args.email}.json`;

interface LocalState {
  token?: string;
  device_id?: string;
  cursor: number;
  alerts: Record<string, { seq: number; severity: string; title: string; received_at: string; via: string }>;
}

mkdirSync(DIR, { recursive: true });
if (args.reset && existsSync(FILE)) rmSync(FILE);
const state: LocalState = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { cursor: 0, alerts: {} };
const save = () => writeFileSync(FILE, JSON.stringify(state, null, 2));

const C = { red: "\x1b[41m\x1b[97m", yellow: "\x1b[33m", cyan: "\x1b[36m", green: "\x1b[32m", gray: "\x1b[90m", reset: "\x1b[0m", bold: "\x1b[1m" };
const color: Record<string, string> = { INFO: C.cyan, WATCH: C.yellow, WARNING: C.yellow + C.bold, CRITICAL: C.red };
const log = (msg: string) => console.log(`${C.gray}${new Date().toLocaleTimeString()}${C.reset} ${msg}`);

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function ensureSession(): Promise<void> {
  const login = await post<SessionResponse>("/auth/login", {
    email: args.email, password: args.password, platform: "sim", device_id: state.device_id,
  });
  let session: SessionResponse;
  if (login.status === 200) {
    session = login.data;
  } else {
    const reg = await post<SessionResponse & { error?: string; issues?: string[] }>("/auth/register", {
      name: args.name, email: args.email, password: args.password, cve_mun: args.mun, platform: "sim", is_simulated: true,
    });
    if (reg.status !== 201) {
      console.error("❌ No se pudo registrar:", reg.data.error, reg.data.issues ?? "");
      process.exit(1);
    }
    session = reg.data;
    log(`${C.green}Registrado como ${session.user.name}${C.reset}`);
  }
  state.token = session.token;
  state.device_id = session.device_id;
  save();
  log(`Sesión: ${session.user.email} | zonas: ${session.zones.map((z) => `${z.nombre} ${z.hashtag}`).join(", ")}`);
}

function handleAlert(socket: Socket, alert: StoredAlert, via: "vivo" | "sync") {
  if (state.alerts[alert.id]) return; // ya la tenía: deduplicación local
  state.alerts[alert.id] = {
    seq: alert.seq, severity: alert.severity, title: alert.title, received_at: new Date().toISOString(), via,
  };
  save();
  socket.emit(SocketEvents.ACK, { alert_id: alert.id, kind: "RECEIVED" });

  const lat = Date.now() - Date.parse(alert.created_at);
  const drill = (alert as { drill?: boolean }).drill ? `${C.bold}[SIMULACRO] ${C.reset}` : "";
  if (drill) console.log(`${drill}${C.gray}tipo ${alert.type}: la app reproduciría el sonido de este escenario${C.reset}`);
  if (alert.severity === "CRITICAL") {
    process.stdout.write("\x07\x07\x07");
    console.log(`\n${C.red}  🚨🚨  ${alert.title}  🚨🚨  ${C.reset}`);
    console.log(`${C.red}  ${alert.body}  ${C.reset}\n`);
    // Simula que el usuario pulsa "Enterado" a los 2 s
    setTimeout(() => {
      socket.emit(SocketEvents.ACK, { alert_id: alert.id, kind: "ACKNOWLEDGED" });
      log(`${C.green}✔ "Enterado" enviado${C.reset}`);
    }, 2000);
  } else {
    log(`${color[alert.severity] ?? ""}[${alert.severity}] ${alert.title}${C.reset}`);
  }
  log(`${C.gray}   #${alert.seq} vía ${via} · ${alert.tags.join(" ")} · ${via === "vivo" ? `${lat} ms` : "recuperada"}${C.reset}`);
}

async function sync(socket: Socket) {
  let more = true;
  let total = 0;
  while (more) {
    const res: SyncResponse | { error: string } = await socket.timeout(10_000).emitWithAck(SocketEvents.SYNC, { since: state.cursor });
    if ("error" in res) {
      log(`❌ sync: ${res.error}`);
      return;
    }
    res.alerts.forEach((a) => handleAlert(socket, a, "sync"));
    total += res.alerts.length;
    state.cursor = res.cursor;
    more = res.has_more;
    save();
  }
  log(`${C.gray}Sincronizado (cursor ${state.cursor}, ${total} recuperadas, ${Object.keys(state.alerts).length} guardadas en total)${C.reset}`);
}

await ensureSession();

const socket = io(URL, {
  auth: (cb) => cb({ token: state.token }),
  transports: ["websocket"],
  reconnectionDelayMax: 5000,
});

socket.on("connect", () => {
  log(`${C.green}● Conectado a ${URL}${C.reset}`);
  sync(socket).catch((e) => log(`❌ sync: ${e.message}`));
});
socket.on("disconnect", (reason) => log(`${C.yellow}○ Desconectado (${reason}), reintentando...${C.reset}`));
socket.on("connect_error", async (err) => {
  if (err.message === "unauthorized") {
    log("Token vencido o inválido, iniciando sesión otra vez...");
    state.token = undefined;
    await ensureSession();
    socket.connect();
  } else {
    log(`${C.yellow}No se pudo conectar: ${err.message}${C.reset}`);
  }
});
socket.on(SocketEvents.ALERT, (alert: StoredAlert) => handleAlert(socket, alert, "vivo"));
socket.on(SocketEvents.ZONES_UPDATED, ({ zones }: { zones: string[] }) => log(`Zonas actualizadas: ${zones.join(", ")}`));

function quit() {
  log("Saliendo (las alertas quedan guardadas en " + FILE + ")");
  socket.close();
  process.exit(0);
}
process.on("SIGINT", quit);

// Teclas: [s] simula que el acelerómetro detectó una sacudida, [q] sale
async function simulateShake() {
  const peak_g = 0.3 + Math.random() * 0.7;
  const res: { ok: boolean; reason?: string } = await socket
    .timeout(5000)
    .emitWithAck(SocketEvents.SENSOR_TRIGGER, { peak_g, kind: "simulated" })
    .catch(() => ({ ok: false, reason: "timeout" }));
  log(res.ok ? `${C.yellow}📳 Sacudida enviada (${peak_g.toFixed(2)} g)${C.reset}` : `Sacudida rechazada: ${res.reason}`);
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (key) => {
    const k = key.toString();
    if (k === "s" || k === "S") void simulateShake();
    if (k === "q" || k === "\u0003") quit();
  });
  log(`${C.gray}Teclas: [s] simular sacudida del sensor · [q] salir${C.reset}`);
}
