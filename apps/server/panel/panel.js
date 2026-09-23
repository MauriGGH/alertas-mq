/* Centro de mando — panel del servidor (sin compilación, JS del navegador) */
"use strict";

// ---------------------------------------------------------------- utilidades
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hhmmss = (iso) => new Date(iso).toLocaleTimeString("es-MX", { hour12: false });
const SEV_LABEL = { INFO: "Informativa", WATCH: "Vigilancia", WARNING: "Alerta", CRITICAL: "Crítica" };
const SEV_COLOR = { INFO: "#3b9eff", WATCH: "#f2c230", WARNING: "#ff8a1f", CRITICAL: "#ff3b3b" };
const TYPE_LABEL = {
  EARTHQUAKE: "Sismo", TSUNAMI: "Tsunami", HURRICANE: "Huracán", STORM: "Tormenta", FLOOD: "Inundación",
  VOLCANO: "Volcán", WILDFIRE: "Incendio", HEAT: "Calor", ZOMBIE: "Zombies", ALIEN: "Alienígenas", OTHER: "Otro",
};

let token = localStorage.getItem("adminToken") || "";

async function api(method, path, body) {
  const headers = { "x-admin-token": token };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) askToken();
  if (!res.ok) throw new Error(data.issues ? data.issues.join("; ") : data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), isError ? 7000 : 4000);
}

// ---------------------------------------------------------------- pestañas
$$(".rail button").forEach((b) =>
  b.addEventListener("click", () => {
    $$(".rail button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    const tab = b.dataset.tab;
    if (tab === "control") setTimeout(() => maps.control.invalidateSize(), 50);
    if (tab === "emitir") setTimeout(() => maps.emit.invalidateSize(), 50);
    if (tab === "dispositivos") loadDevices();
    if (tab === "historial") loadHistory();
    if (tab === "chat") loadChat();
    if (tab === "sismica") loadDetector();
  }),
);

// ---------------------------------------------------------------- token
function askToken() {
  const dlg = $("#token-dlg");
  if (!dlg.open) dlg.showModal();
}
$("#token-form").addEventListener("submit", () => {
  token = $("#token-input").value.trim();
  localStorage.setItem("adminToken", token);
  connectSocket();
  loadAll();
});

// ---------------------------------------------------------------- sismograma
const seismo = { rate: [], spikes: [], max: 5 };
const canvas = $("#seismo");
function drawSeismo() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const N = 180, step = w / (N - 1), mid = h / 2;
  // cuadrícula tenue: una línea por cada 10 s
  ctx.strokeStyle = "#1a2a40"; ctx.lineWidth = 1;
  for (let i = 0; i < N; i += 10) { const x = w - i * step; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  // disparos de sensores: marcas rojas verticales
  ctx.strokeStyle = "#ff3b3b"; ctx.lineWidth = 2;
  seismo.spikes.forEach((n, i) => {
    if (!n) return;
    const x = w - (seismo.spikes.length - 1 - i) * step;
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, h - 4); ctx.stroke();
  });
  // traza: entregas por segundo, oscilando alrededor de la línea media como un sismógrafo
  const peak = Math.max(seismo.max, ...seismo.rate);
  ctx.strokeStyle = "#e4ecf5"; ctx.lineWidth = 1.4; ctx.beginPath();
  seismo.rate.forEach((v, i) => {
    const x = w - (seismo.rate.length - 1 - i) * step;
    const amp = (v / peak) * (mid - 4) * (i % 2 ? 1 : -1);
    i ? ctx.lineTo(x, mid + amp) : ctx.moveTo(x, mid + amp);
  });
  ctx.stroke();
}
let prev = null;
function onMetrics(m) {
  if (prev) {
    const dt = Math.max((Date.parse(m.at) - Date.parse(prev.at)) / 1000, 0.5);
    const rate = Math.round((m.deliveries - prev.deliveries) / dt);
    seismo.rate.push(rate); seismo.spikes.push(m.sensorTriggers - prev.sensorTriggers);
    if (seismo.rate.length > 180) { seismo.rate.shift(); seismo.spikes.shift(); }
    $("#r-rate").textContent = rate;
    drawSeismo();
  }
  prev = m;
  $("#r-online").textContent = m.connectedNow;
  $("#r-lat").textContent = m.lastPipelineLatencyMs == null ? "–" : m.lastPipelineLatencyMs + " ms";
  $("#s-real").textContent = m.connectedReal;
  $("#s-sim").textContent = m.connectedNow - m.connectedReal;
  $("#s-alerts").textContent = m.alertsNormalized;
  $("#s-deliv").textContent = m.deliveries.toLocaleString("es-MX");
  $("#s-acks").textContent = m.acksAcknowledged;
  $("#s-sensor").textContent = m.sensorTriggers;
}
window.addEventListener("resize", drawSeismo);

// ---------------------------------------------------------------- mapas
const tiles = () =>
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: "abcd", maxZoom: 18,
  });
const maps = {
  control: L.map("map-control", { zoomControl: true }).setView([22.5, -101.5], 5),
  emit: L.map("map-emit").setView([19.1, -104.0], 8),
};
tiles().addTo(maps.control);
tiles().addTo(maps.emit);
const alertLayer = L.layerGroup().addTo(maps.control);

function drawAlertOnMap(a) {
  const color = a.drill ? "#a78bfa" : SEV_COLOR[a.severity];
  if (!a.geo) {
    a.points.forEach(([lat, lon]) =>
      L.circleMarker([lat, lon], { radius: 4, color, weight: 1, fillOpacity: 0.7 }).bindPopup(`<b>${esc(a.title)}</b>`).addTo(alertLayer));
    return;
  }
  L.circle([a.geo.lat, a.geo.lon], { radius: a.geo.radius_km * 1000, color, weight: 1.5, fillOpacity: 0.12 })
    .bindPopup(`<b>${esc(a.title)}</b><br>${esc(SEV_LABEL[a.severity])} · radio ${a.geo.radius_km} km`)
    .addTo(alertLayer);
}

// selección de centro y radio al emitir
let emitCenter = L.latLng(18.7, -104.6);
const emitCircle = L.circle(emitCenter, { radius: 80000, color: "#ff8a1f", weight: 2, fillOpacity: 0.15 }).addTo(maps.emit);
const emitMarker = L.circleMarker(emitCenter, { radius: 5, color: "#ff8a1f", fillOpacity: 1 }).addTo(maps.emit);
maps.emit.on("click", (e) => {
  emitCenter = e.latlng;
  emitCircle.setLatLng(e.latlng); emitMarker.setLatLng(e.latlng);
  $('input[name="scope"][value="radio"]').checked = true;
  updateScope();
});
const radiusInput = $('input[name="radius"]');
radiusInput.addEventListener("input", () => {
  $("#radius-out").textContent = radiusInput.value + " km";
  emitCircle.setRadius(radiusInput.value * 1000);
});

// ---------------------------------------------------------------- catálogo
let estados = [];
const selectedMun = new Map(); // cve_mun -> nombre
async function loadCatalog() {
  estados = await fetch("/catalog/estados").then((r) => r.json());
  $("#estado-checks").innerHTML = estados
    .map((e) => `<label><input type="checkbox" value="${e.cve_ent}" /> ${esc(e.nombre)}</label>`).join("");
  const opts = estados.map((e) => `<option value="${e.cve_ent}">${esc(e.nombre)}</option>`).join("");
  $("#mun-estado").innerHTML = opts; $("#sim-estado").innerHTML = opts;
  $("#mun-estado").value = "06"; $("#sim-estado").value = "06";
  await Promise.all([loadMunChecks(), loadSimMun()]);
}
let munCache = {};
async function municipiosDe(cve) {
  if (!munCache[cve]) munCache[cve] = await fetch("/catalog/municipios?estado=" + cve).then((r) => r.json());
  return munCache[cve];
}
async function loadMunChecks() {
  const list = await municipiosDe($("#mun-estado").value);
  const q = $("#mun-search").value.trim().toLowerCase();
  $("#mun-checks").innerHTML = list
    .filter((m) => !q || m.nombre.toLowerCase().includes(q))
    .map((m) => `<label><input type="checkbox" value="${m.cve_mun}" data-name="${esc(m.nombre)}" ${selectedMun.has(m.cve_mun) ? "checked" : ""}/> ${esc(m.nombre)}</label>`)
    .join("") || '<p class="empty">Sin coincidencias</p>';
}
$("#mun-estado").addEventListener("change", loadMunChecks);
$("#mun-search").addEventListener("input", loadMunChecks);
$("#mun-checks").addEventListener("change", (e) => {
  const c = e.target;
  if (c.checked) selectedMun.set(c.value, c.dataset.name); else selectedMun.delete(c.value);
  $("#mun-count").textContent = selectedMun.size
    ? `${selectedMun.size} seleccionados: ${[...selectedMun.values()].slice(0, 6).join(", ")}${selectedMun.size > 6 ? "…" : ""}`
    : "0 municipios seleccionados";
});
async function loadSimMun() {
  const list = await municipiosDe($("#sim-estado").value);
  $("#sim-mun").innerHTML = list.map((m) => `<option value="${m.cve_mun}">${esc(m.nombre)}</option>`).join("");
}
$("#sim-estado").addEventListener("change", loadSimMun);

// ---------------------------------------------------------------- emitir alerta
function updateScope() {
  const scope = $('input[name="scope"]:checked').value;
  $$("[data-scope]").forEach((d) => (d.hidden = d.dataset.scope !== scope));
  emitCircle.setStyle({ opacity: scope === "radio" ? 1 : 0.15, fillOpacity: scope === "radio" ? 0.15 : 0.03 });
}
$$('input[name="scope"]').forEach((r) => r.addEventListener("change", updateScope));

const ALL = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, "0"));
const PRESETS = [
  { name: "Sismo en Colima", sev: "CRITICAL", a: { type: "EARTHQUAKE", severity: "CRITICAL", title: "ALERTA SÍSMICA — Sismo en curso", body: "Sismo magnitud 7.1 detectado. Aléjese de ventanas y diríjase a zona segura. No use elevadores.", geo: { lat: 19.1, lon: -103.9, radius_km: 60 }, expires_in_min: 30 } },
  { name: "Tsunami Pacífico", sev: "CRITICAL", a: { type: "TSUNAMI", severity: "CRITICAL", title: "ALERTA DE TSUNAMI — Evacúe la costa", body: "Se esperan olas de más de 2 m en los próximos 20 minutos. Diríjase a zonas altas de inmediato.", targets: { municipios: ["06007", "06001", "06009", "12001"] }, expires_in_min: 180 } },
  { name: "Huracán en la costa", sev: "WARNING", a: { type: "HURRICANE", severity: "WARNING", title: "Huracán categoría 2 frente a la costa de Colima", body: "Vientos de 165 km/h y oleaje de 4 a 6 m. Evite la playa y siga indicaciones de Protección Civil.", geo: { lat: 18.7, lon: -104.6, radius_km: 90 }, expires_in_min: 1440 } },
  { name: "Tormenta Monterrey", sev: "WARNING", a: { type: "STORM", severity: "WARNING", title: "Tormenta severa en Monterrey", body: "Lluvias intensas y granizo. No cruce arroyos ni calles inundadas.", targets: { municipios: ["19039"] }, expires_in_min: 360 } },
  { name: "Aviso a Colima", sev: "INFO", a: { type: "OTHER", severity: "INFO", title: "Simulacro estatal a las 11:00", body: "Participe en el simulacro. Esta es una alerta de prueba.", targets: { estados: ["06"] }, expires_in_min: 120 } },
  { name: "Brote zombie", sev: "DRILL", a: { type: "ZOMBIE", severity: "CRITICAL", drill: true, title: "🧟 SIMULACRO: Brote zombie reportado en Colima", body: "Escenario ficticio de práctica. Refúgiese en interiores, asegure puertas y ventanas y espere indicaciones.", targets: { estados: ["06"] }, tags: ["#Simulacro", "#Zombies"], expires_in_min: 60 } },
  { name: "Invasión alienígena", sev: "DRILL", a: { type: "ALIEN", severity: "CRITICAL", drill: true, title: "👽 SIMULACRO: Naves no identificadas sobre territorio nacional", body: "Escenario ficticio de práctica. Mantenga la calma, permanezca en casa y siga los canales oficiales.", targets: { estados: ALL }, tags: ["#Simulacro", "#Invasión"], expires_in_min: 60 } },
];
const SEV_VAR = { INFO: "var(--info)", WATCH: "var(--watch)", WARNING: "var(--warning)", CRITICAL: "var(--critical)", DRILL: "var(--drill)" };
$("#presets").innerHTML = PRESETS.map((p, i) =>
  `<button type="button" data-i="${i}" style="--sev:${SEV_VAR[p.sev]}"><b>${esc(p.name)}</b><small>${p.sev === "DRILL" ? "Simulacro ficticio" : SEV_LABEL[p.sev]}</small></button>`).join("");
$("#presets").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const p = PRESETS[+b.dataset.i];
  if (p.a.severity === "CRITICAL" && !(await confirmCritical(p.a))) return;
  sendAlert(p.a);
});

function confirmCritical(a) {
  return new Promise((resolve) => {
    const dlg = $("#confirm-dlg");
    $("#confirm-title").textContent = a.drill ? "Emitir simulacro crítico" : "Emitir alerta crítica";
    $("#confirm-text").textContent = `"${a.title}" hará sonar la sirena y ocupará la pantalla completa en todos los celulares del área.`;
    dlg.returnValue = "";
    dlg.showModal();
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
  });
}

async function sendAlert(a) {
  try {
    await api("POST", "/admin/alerts", a);
    toast(`Alerta emitida: ${a.title}`);
  } catch (err) {
    toast(`No se emitió la alerta: ${err.message}`, true);
  }
}

$("#alert-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const scope = $('input[name="scope"]:checked').value;
  const a = {
    type: f.type.value, severity: f.severity.value, title: f.title.value.trim(), body: f.body.value.trim(),
    drill: f.drill.checked, expires_in_min: +f.expires.value,
  };
  if (scope === "radio") a.geo = { lat: +emitCenter.lat.toFixed(4), lon: +emitCenter.lng.toFixed(4), radius_km: +radiusInput.value };
  if (scope === "estado") {
    a.targets = { estados: $$("#estado-checks input:checked").map((c) => c.value) };
    if (!a.targets.estados.length) return toast("Elige al menos un estado", true);
  }
  if (scope === "municipios") {
    a.targets = { municipios: [...selectedMun.keys()] };
    if (!a.targets.municipios.length) return toast("Elige al menos un municipio", true);
  }
  if (a.drill) a.tags = ["#Simulacro"];
  if (a.severity === "CRITICAL" && !(await confirmCritical(a))) return;
  sendAlert(a);
});

// ---------------------------------------------------------------- bitácora y feed
const LOG_MAX = 500;
const logs = [];
let paused = false;
function logLi(a) {
  return `<li class="${a.level}"><time>${hhmmss(a.at)}</time><span>${esc(a.message)}</span><span class="hint">${esc(a.type)}</span></li>`;
}
function renderLogs() {
  const t = $("#log-type").value, lv = $("#log-level").value, q = $("#log-q").value.toLowerCase();
  const rows = logs.filter((a) => (!t || a.type.startsWith(t)) && (!lv || a.level === lv) && (!q || a.message.toLowerCase().includes(q)));
  $("#log-list").innerHTML = rows.slice(-300).reverse().map(logLi).join("") || '<li class="empty">Aún no hay eventos con ese filtro.</li>';
}
["#log-type", "#log-level", "#log-q"].forEach((s) => $(s).addEventListener("input", renderLogs));
$("#log-pause").addEventListener("click", (e) => {
  paused = !paused; e.target.textContent = paused ? "Reanudar" : "Pausar";
  if (!paused) renderLogs();
});
function renderFeed() {
  $("#feed-control").innerHTML = logs.slice(-25).reverse().map(logLi).join("") || '<li class="empty">Cuando pase algo en el sistema aparecerá aquí.</li>';
}
function onActivity(a) {
  logs.push(a);
  if (logs.length > LOG_MAX) logs.shift();
  renderFeed();
  if (!paused) renderLogs();
  if (a.type === "alert.normalized" || a.type === "seismic.detection") refreshMapSoon();
  if (a.type.startsWith("sensor.") || a.type.startsWith("seismic.")) loadDetectorLists();
  if (a.type === "chat.message" && $("#tab-chat").classList.contains("active")) loadChat();
  if (a.type.startsWith("device.") && $("#tab-dispositivos").classList.contains("active")) loadDevices();
}

// ---------------------------------------------------------------- historial y mapa
let mapTimer;
function refreshMapSoon() { clearTimeout(mapTimer); mapTimer = setTimeout(loadHistory, 600); }
async function loadHistory() {
  try {
    const rows = await api("GET", "/admin/alerts?limit=60");
    $("#hist-body").innerHTML = rows.map((r) => `<tr>
      <td>${r.seq}</td>
      <td><span class="sev ${r.drill ? "DRILL" : r.severity}">${r.drill ? "Simulacro" : SEV_LABEL[r.severity]}</span></td>
      <td>${esc(r.title)}</td><td>${esc(r.source)}</td><td>${r.municipios}</td>
      <td>${r.received}</td><td>${r.acknowledged}</td><td>${r.ok}</td><td>${r.help ? `<b style="color:var(--critical)">${r.help}</b>` : 0}</td>
      <td>${new Date(r.created_at).toLocaleString("es-MX", { hour12: false })}</td></tr>`).join("")
      || '<tr><td colspan="10" class="empty">Todavía no se ha emitido ninguna alerta. Usa "Emitir alerta".</td></tr>';
    // alertas vigentes con área en el mapa principal
    alertLayer.clearLayers();
    const now = Date.now();
    const vigentes = rows.filter((r) => !r.expires_at || Date.parse(r.expires_at) > now).map((r) => r.id);
    if (vigentes.length) {
      const geo = await api("GET", "/admin/alerts/geo");
      geo.filter((g) => vigentes.includes(g.id)).forEach(drawAlertOnMap);
    }
  } catch (err) { toast(err.message, true); }
}
$("#hist-refresh").addEventListener("click", loadHistory);

// ---------------------------------------------------------------- dispositivos
async function loadDevices() {
  try {
    const d = await api("GET", "/admin/devices");
    const hide = $("#dev-hide-sim").checked;
    const list = d.connected.filter((x) => !hide || x.platform !== "sim");
    $("#dev-totals").textContent = `${d.registered.reales} usuarios reales y ${d.registered.simulados} simulados registrados`;
    $("#dev-body").innerHTML = list.map((x) => `<tr>
      <td>${esc(x.name)}</td><td>${esc(x.platform)}</td><td>${x.zones.map(esc).join(", ")}</td>
      <td>${hhmmss(x.connectedAt)}</td><td>${esc(x.transport)}</td>
      <td><button class="small" data-sid="${esc(x.socketId)}">Desconectar</button></td></tr>`).join("")
      || '<tr><td colspan="6" class="empty">No hay celulares conectados. Abre la app en un teléfono e inicia sesión.</td></tr>';
  } catch (err) { toast(err.message, true); }
}
$("#dev-hide-sim").addEventListener("change", loadDevices);
$("#dev-body").addEventListener("click", async (e) => {
  const sid = e.target.dataset.sid; if (!sid) return;
  try { await api("POST", `/admin/devices/${encodeURIComponent(sid)}/disconnect`); toast("Dispositivo desconectado"); loadDevices(); }
  catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- chat
async function loadChat() {
  const tag = $("#chat-tag").value.trim();
  try {
    const d = await api("GET", "/admin/chat?limit=150" + (tag ? "&tag=" + encodeURIComponent(tag.startsWith("#") ? tag : "#" + tag) : ""));
    $("#chat-list").innerHTML = d.messages.slice().reverse().map((m) => {
      const cls = m.kind === "checkin_ok" ? "ok" : m.kind === "checkin_help" ? "help" : "";
      const icon = m.kind === "checkin_ok" ? "✅ " : m.kind === "checkin_help" ? "🆘 " : "";
      return `<li><time>${hhmmss(m.created_at)}</time>
        <span><span class="who">${esc(m.user_name)}</span><span class="${cls}">${icon}${esc(m.text)}</span><br>${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
        <button class="small" data-del="${m.id}">Eliminar</button></li>`;
    }).join("") || '<li class="empty">Nadie ha escrito todavía.</li>';
  } catch (err) { toast(err.message, true); }
}
$("#chat-refresh").addEventListener("click", loadChat);
$("#chat-list").addEventListener("click", async (e) => {
  const id = e.target.dataset.del; if (!id) return;
  try { await api("DELETE", "/admin/chat/" + id); toast("Mensaje eliminado"); loadChat(); } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- red sísmica
async function loadDetector() {
  try {
    const d = await api("GET", "/admin/detector");
    const f = $("#det-form");
    for (const [k, v] of Object.entries(d.config)) {
      const el = f.elements[k]; if (!el) continue;
      if (el.type === "checkbox") el.checked = v; else el.value = v;
    }
    renderDetectorLists(d);
  } catch (err) { toast(err.message, true); }
}
async function loadDetectorLists() {
  if (!$("#tab-sismica").classList.contains("active")) return;
  try { renderDetectorLists(await api("GET", "/admin/detector")); } catch { /* ignorar */ }
}
function renderDetectorLists(d) {
  $("#det-window").innerHTML = d.window.slice().reverse().map((t) =>
    `<li><time>${hhmmss(t.received_at)}</time><span>${t.kind === "simulated" ? "Simulado" : "Celular real"} ${esc(t.device_id.slice(0, 8))} · ${t.peak_g.toFixed(2)} g</span><span class="hint">${t.cve_mun ?? ""}</span></li>`).join("")
    || '<li class="empty">Sin disparos recientes.</li>';
  $("#det-list").innerHTML = d.detections.slice().reverse().map((x) =>
    `<li class="warn"><time>${hhmmss(x.at)}</time><span>Sismo declarado con ${x.devices} celulares</span><span class="hint">${x.lat.toFixed(2)}, ${x.lon.toFixed(2)}</span></li>`).join("")
    || '<li class="empty">Aún no hay detecciones.</li>';
}
$("#det-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    enabled: f.enabled.checked, minDevices: +f.minDevices.value, windowSec: +f.windowSec.value,
    clusterRadiusKm: +f.clusterRadiusKm.value, alertRadiusKm: +f.alertRadiusKm.value,
    cooldownSec: +f.cooldownSec.value, scope: f.scope.value,
  };
  try { renderDetectorLists(await api("PUT", "/admin/detector", body)); toast("Ajustes del detector guardados"); }
  catch (err) { toast(err.message, true); }
});
$("#sim-go").addEventListener("click", async () => {
  try {
    await api("POST", "/admin/detector/simulate", { devices: +$("#sim-n").value, cve_mun: $("#sim-mun").value });
    toast("Sacudida simulada enviada");
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- conexión en vivo
let socket;
function connectSocket() {
  socket?.close();
  socket = io("/admin", { auth: { token }, transports: ["websocket"] });
  socket.on("connect", () => { $("#conn-status").textContent = "Conectado al servidor"; $("#conn-status").className = "conn on"; });
  socket.on("disconnect", () => { $("#conn-status").textContent = "Sin conexión con el servidor"; $("#conn-status").className = "conn off"; });
  socket.on("connect_error", (err) => { if (err.message === "unauthorized") askToken(); });
  socket.on("metrics", onMetrics);
  socket.on("activity", onActivity);
  socket.on("activity:backlog", (list) => { logs.length = 0; list.forEach((a) => logs.push(a)); renderFeed(); renderLogs(); });
}

function loadAll() {
  loadCatalog().catch((err) => toast("No se pudo cargar el catálogo: " + err.message, true));
  loadHistory();
}

drawSeismo();
updateScope();
if (!token) askToken(); else { connectSocket(); loadAll(); }
