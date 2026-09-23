/**
 * Detector sísmico local con acelerómetro + giroscopio.
 *
 * - Se quita la gravedad con un filtro pasa-bajas y se mide la aceleración "lineal".
 * - STA/LTA: promedio de corto plazo (0.5 s) contra largo plazo (10 s). Un sismo hace
 *   que el corto plazo crezca mucho respecto al ruido de fondo.
 * - El giroscopio sirve para descartar que alguien esté girando el teléfono en la mano.
 *
 * Modo "demo": basta agitar el teléfono con fuerza.
 * Modo "real": el teléfono debe estar quieto sobre una mesa y moverse sin rotar.
 */
import { useEffect, useRef, useState } from "react";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

export type SensorMode = "demo" | "real";

const PROFILES = {
  demo: { minSta: 0.35, minRatio: 2.0, maxRot: Infinity, maxLtaBefore: Infinity },
  real: { minSta: 0.035, minRatio: 4.0, maxRot: 0.6, maxLtaBefore: 0.03 },
};

export interface SensorLive {
  available: boolean | null;
  sta: number;
  lta: number;
  ratio: number;
  rot: number;
  lastTrigger: number | null;
}

const RATE_MS = 20; // 50 Hz
const COOLDOWN_MS = 6000;
const WARMUP_MS = 3000;

export function useSeismicSensor(
  enabled: boolean,
  mode: SensorMode,
  onTrigger: (d: { peak_g: number; sta_lta: number }) => void,
): SensorLive {
  const [live, setLive] = useState<SensorLive>({ available: null, sta: 0, lta: 0, ratio: 0, rot: 0, lastTrigger: null });
  const cb = useRef(onTrigger);
  cb.current = onTrigger;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const g = { x: 0, y: 0, z: 0, init: false };
    const st = { sta: 0, lta: 0, rot: 0, peak: 0, lastTrigger: 0, startedAt: Date.now(), lastUi: 0 };
    const p = PROFILES[mode];
    const aSta = 1 - Math.exp(-(RATE_MS / 1000) / 0.5);
    const aLta = 1 - Math.exp(-(RATE_MS / 1000) / 10);
    const aRot = 1 - Math.exp(-(50 / 1000) / 0.3);
    let subA: { remove(): void } | undefined;
    let subG: { remove(): void } | undefined;

    (async () => {
      const ok = await Accelerometer.isAvailableAsync().catch(() => false);
      if (cancelled) return;
      if (!ok) return setLive((l) => ({ ...l, available: false }));
      setLive((l) => ({ ...l, available: true }));
      await activateKeepAwakeAsync("sensor").catch(() => {});

      Accelerometer.setUpdateInterval(RATE_MS);
      Gyroscope.setUpdateInterval(50);
      subG = Gyroscope.addListener(({ x, y, z }) => {
        st.rot += aRot * (Math.sqrt(x * x + y * y + z * z) - st.rot);
      });
      subA = Accelerometer.addListener(({ x, y, z }) => {
        if (!g.init) Object.assign(g, { x, y, z, init: true });
        g.x = 0.9 * g.x + 0.1 * x; g.y = 0.9 * g.y + 0.1 * y; g.z = 0.9 * g.z + 0.1 * z;
        const mag = Math.hypot(x - g.x, y - g.y, z - g.z);
        const ltaBefore = st.lta;
        st.sta += aSta * (mag - st.sta);
        st.lta += aLta * (mag - st.lta);
        st.peak = Math.max(st.peak * 0.98, mag);
        const now = Date.now();
        const ratio = st.sta / Math.max(st.lta, 0.005);

        if (
          now - st.startedAt > WARMUP_MS &&
          now - st.lastTrigger > COOLDOWN_MS &&
          st.sta >= p.minSta &&
          ratio >= p.minRatio &&
          st.rot <= p.maxRot &&
          ltaBefore <= p.maxLtaBefore
        ) {
          st.lastTrigger = now;
          cb.current({ peak_g: Math.min(Math.round(st.peak * 100) / 100, 20), sta_lta: Math.round(ratio * 10) / 10 });
        }
        if (now - st.lastUi > 200) {
          st.lastUi = now;
          setLive({ available: true, sta: st.sta, lta: st.lta, ratio, rot: st.rot, lastTrigger: st.lastTrigger || null });
        }
      });
    })();

    return () => {
      cancelled = true;
      subA?.remove();
      subG?.remove();
      deactivateKeepAwake("sensor").catch(() => {});
    };
  }, [enabled, mode]);

  return live;
}
