/**
 * Productor manual desde la terminal (mientras llega el panel gráfico).
 *   npm run alert -- huracan-colima
 *   npm run alert            -> lista los escenarios
 */
import { ALL_ESTADOS, type ManualAlertInput } from "@alertas/shared";
import { env } from "../env.js";

const presets: Record<string, { desc: string; alert: ManualAlertInput }> = {
  "huracan-colima": {
    desc: "Huracán frente a Manzanillo, radio 90 km (costa de Colima)",
    alert: {
      type: "HURRICANE", severity: "WARNING",
      title: "Huracán categoría 2 frente a la costa de Colima",
      body: "Vientos de 165 km/h y oleaje de 4 a 6 m. Evite la zona de playa y siga indicaciones de Protección Civil.",
      geo: { lat: 18.7, lon: -104.6, radius_km: 90 },
      expires_in_min: 1440,
    },
  },
  "sismo-colima": {
    desc: "Sismo inminente en Colima (CRÍTICA: sirena + pantalla completa)",
    alert: {
      type: "EARTHQUAKE", severity: "CRITICAL",
      title: "ALERTA SÍSMICA — Sismo en curso",
      body: "Sismo magnitud 7.1 detectado. Aléjese de ventanas y diríjase a zona segura. NO use elevadores.",
      geo: { lat: 19.1, lon: -103.9, radius_km: 60 },
      expires_in_min: 30,
    },
  },
  "tsunami-pacifico": {
    desc: "Tsunami en costa del Pacífico: Manzanillo, Armería, Tecomán y Acapulco (CRÍTICA)",
    alert: {
      type: "TSUNAMI", severity: "CRITICAL",
      title: "ALERTA DE TSUNAMI — Evacúe la costa",
      body: "Se esperan olas de más de 2 m en los próximos 20 minutos. Diríjase a zonas altas de inmediato.",
      targets: { municipios: ["06007", "06001", "06009", "12001"] },
      expires_in_min: 180,
    },
  },
  "tormenta-monterrey": {
    desc: "Tormenta severa solo en Monterrey",
    alert: {
      type: "STORM", severity: "WARNING",
      title: "Tormenta severa en Monterrey",
      body: "Lluvias intensas y granizo. Evite cruzar arroyos y calles inundadas.",
      targets: { municipios: ["19039"] },
      expires_in_min: 360,
    },
  },
  zombies: {
    desc: "SIMULACRO ficticio: brote zombie en Colima (sonido propio)",
    alert: {
      type: "ZOMBIE", severity: "CRITICAL", drill: true,
      title: "🧟 SIMULACRO: Brote zombie reportado en Colima",
      body: "Escenario ficticio de práctica. Refúgiese en interiores, asegure puertas y ventanas y espere indicaciones. Repetimos: es un simulacro.",
      targets: { estados: ["06"] },
      tags: ["#Simulacro", "#Zombies"],
      expires_in_min: 60,
    },
  },
  aliens: {
    desc: "SIMULACRO ficticio: invasión alienígena a nivel nacional (sonido propio)",
    alert: {
      type: "ALIEN", severity: "CRITICAL", drill: true,
      title: "👽 SIMULACRO: Naves no identificadas sobre territorio nacional",
      body: "Escenario ficticio de práctica. Mantenga la calma, permanezca en casa y siga los canales oficiales. Repetimos: es un simulacro.",
      targets: { estados: ALL_ESTADOS },
      tags: ["#Simulacro", "#Invasión"],
      expires_in_min: 60,
    },
  },
  "aviso-colima": {
    desc: "Aviso informativo a todo el estado de Colima",
    alert: {
      type: "OTHER", severity: "INFO",
      title: "Simulacro estatal a las 11:00",
      body: "Recuerde participar en el simulacro. Esta es una alerta de prueba.",
      targets: { estados: ["06"] },
      expires_in_min: 120,
    },
  },
};

const name = process.argv[2];
const url = (process.argv[3] ?? "http://localhost:3000").replace(/\/$/, "");

if (!name || !presets[name]) {
  console.log("Uso: npm run alert -- <escenario> [url]\n");
  for (const [key, p] of Object.entries(presets)) console.log(`  ${key.padEnd(20)} ${p.desc}`);
  process.exit(name ? 1 : 0);
}

if (!env.ADMIN_TOKEN) {
  console.error("❌ Falta ADMIN_TOKEN en .env");
  process.exit(1);
}

const res = await fetch(`${url}/admin/alerts`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-token": env.ADMIN_TOKEN },
  body: JSON.stringify(presets[name]!.alert),
});
const body = await res.json();
if (res.ok) console.log(`✅ Alerta "${name}" publicada en Kafka (id ${body.id})`);
else {
  console.error(`❌ ${res.status}`, body);
  process.exit(1);
}
