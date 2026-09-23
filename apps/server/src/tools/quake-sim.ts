/**
 * Simula un sismo detectado por varios celulares a la vez, sin tener los celulares.
 *   npm run quake -- --devices 3 --mun 06002
 *   npm run quake -- --devices 2 --mun 06007 --spread 3 --url https://api.tudominio.com
 *
 * Crea (o reutiliza) N usuarios simulados en el municipio, cada uno manda un disparo
 * de sensor con --spread segundos de separación, y se queda escuchando unos segundos
 * para mostrar la alerta que genera el detector.
 */
import { parseArgs } from "node:util";
import { io, type Socket } from "socket.io-client";
import { SocketEvents, type SessionResponse, type StoredAlert } from "@alertas/shared";

const { values: a } = parseArgs({
  options: {
    devices: { type: "string", default: "3" },
    mun: { type: "string", default: "06002" },
    spread: { type: "string", default: "1" },
    url: { type: "string", default: "http://localhost:3000" },
  },
});

const URL = a.url!.replace(/\/$/, "");
const N = Number(a.devices);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function session(i: number): Promise<SessionResponse> {
  const email = `sensor-${a.mun}-${i}@sim.mx`;
  const body = { email, password: "sim12345", platform: "sim" };
  let res = await fetch(`${URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 200) {
    res = await fetch(`${URL}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, name: `Sensor ${i}`, cve_mun: a.mun, is_simulated: true }),
    });
  }
  if (!res.ok) throw new Error(`No se pudo crear el sensor ${i}: ${JSON.stringify(await res.json())}`);
  return (await res.json()) as SessionResponse;
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

const sockets: Socket[] = [];
let received = 0;
console.log(`Simulando ${N} celulares en el municipio ${a.mun}...`);

for (let i = 1; i <= N; i++) {
  const sess = await session(i);
  const s = await connect(sess.token);
  s.on(SocketEvents.ALERT, (alert: StoredAlert) => {
    if (alert.source !== "CROWDSENSE") return;
    received++;
    if (received === 1) console.log(`\n🚨 El detector generó la alerta: "${alert.title}"\n   ${alert.body}\n`);
  });
  sockets.push(s);
}

for (let i = 0; i < sockets.length; i++) {
  const peak_g = 0.4 + Math.random() * 0.8;
  const res = await sockets[i]!.timeout(5000).emitWithAck(SocketEvents.SENSOR_TRIGGER, { peak_g, kind: "simulated" });
  console.log(`📳 Sensor ${i + 1}: sacudida de ${peak_g.toFixed(2)} g -> ${res.ok ? "enviada" : `rechazada (${res.reason})`}`);
  if (i < sockets.length - 1) await sleep(Number(a.spread) * 1000);
}

await sleep(4000);
console.log(received > 0 ? `✅ ${received} de ${N} sensores recibieron la alerta` : "ℹ️  No se generó alerta (¿menos dispositivos que minDevices, cooldown activo o ventana demasiado corta?)");
sockets.forEach((s) => s.close());
process.exit(0);
