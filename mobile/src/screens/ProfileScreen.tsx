import React, { useState } from "react";
import { Alert as RNAlert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useApp } from "../store";
import { C } from "../theme";
import { Button, Chip, SectionTitle } from "../components/ui";
import { ZonePicker } from "../components/ZonePicker";
import { playOnce, type SoundKey } from "../sounds";
import type { SensorLive } from "../sensor";
import type { Estado, Municipio } from "../types";

const LABELS = ["Casa", "Trabajo", "Escuela", "Familia"];
const SOUNDS: { key: SoundKey; label: string }[] = [
  { key: "siren", label: "Sismo" }, { key: "tsunami", label: "Tsunami" }, { key: "alarm", label: "Emergencia" },
  { key: "chime", label: "Aviso" }, { key: "zombie", label: "Zombies" }, { key: "alien", label: "Alienígenas" },
];

export function ProfileScreen({ sensor }: { sensor: SensorLive }) {
  const { session, serverUrl, updateZones, settings, setSettings, signOut, sensorTrigger, showToast, alerts } = useApp();
  const [adding, setAdding] = useState(false);
  const [zone, setZone] = useState<{ estado?: Estado; municipio?: Municipio }>({});
  const [label, setLabel] = useState("Trabajo");
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const zones = session.zones;

  async function saveZones(next: { cve_mun: string; label: string }[]) {
    setBusy(true);
    try {
      await updateZones(next);
      showToast({ title: "Zonas actualizadas", body: "Ya recibes las alertas de estas zonas.", color: C.ok });
    } catch (e) {
      showToast({ title: "No se guardaron las zonas", body: (e as Error).message, color: C.critical });
    } finally {
      setBusy(false);
    }
  }

  const level = Math.min(sensor.sta / (settings.sensorMode === "demo" ? 0.35 : 0.035), 1);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.name}>{session.user.name}</Text>
      <Text style={s.sub}>{session.user.email} · {alerts.length} alertas guardadas en este teléfono</Text>

      <SectionTitle>Mis zonas</SectionTitle>
      {zones.map((z) => (
        <View key={z.cve_mun} style={s.zone}>
          <View style={{ flex: 1 }}>
            <Text style={s.zoneName}>{z.label}: {z.nombre}</Text>
            <Text style={s.zoneTag}>{z.hashtag}</Text>
          </View>
          {zones.length > 1 && (
            <Button title="Quitar" kind="ghost" disabled={busy} onPress={() => saveZones(zones.filter((x) => x.cve_mun !== z.cve_mun))} style={{ paddingVertical: 8 }} />
          )}
        </View>
      ))}
      {adding ? (
        <View style={s.box}>
          <ZonePicker serverUrl={serverUrl} value={zone} onChange={setZone} />
          <View style={s.row}>{LABELS.map((l) => <Chip key={l} label={l} active={label === l} onPress={() => setLabel(l)} />)}</View>
          <View style={s.row}>
            <Button title="Cancelar" kind="ghost" onPress={() => setAdding(false)} style={{ flex: 1 }} />
            <Button title="Agregar zona" disabled={!zone.municipio || busy} style={{ flex: 1 }} onPress={async () => {
              await saveZones([...zones.map((z) => ({ cve_mun: z.cve_mun, label: z.label })), { cve_mun: zone.municipio!.cve_mun, label }]);
              setAdding(false); setZone({});
            }} />
          </View>
        </View>
      ) : (
        zones.length < 10 && <Button title="Agregar otra zona" kind="ghost" onPress={() => setAdding(true)} />
      )}

      <SectionTitle>Sensor sísmico</SectionTitle>
      <View style={s.box}>
        <View style={s.switchRow}>
          <Text style={s.label}>Usar este teléfono como sensor</Text>
          <Switch value={settings.sensorEnabled} onValueChange={(v) => setSettings({ sensorEnabled: v })} />
        </View>
        <Text style={s.hint}>
          Si varios teléfonos cercanos detectan movimiento fuerte al mismo tiempo, el servidor emite una alerta de sismo. La pantalla se mantiene encendida mientras el sensor está activo.
        </Text>
        <View style={s.row}>
          <Chip label="Demostración: agitar" active={settings.sensorMode === "demo"} onPress={() => setSettings({ sensorMode: "demo" })} />
          <Chip label="Realista: sobre la mesa" active={settings.sensorMode === "real"} onPress={() => setSettings({ sensorMode: "real" })} />
        </View>
        {settings.sensorEnabled && (
          <>
            {sensor.available === false && <Text style={[s.hint, { color: C.critical }]}>Este dispositivo no tiene acelerómetro.</Text>}
            <View style={s.meter}><View style={[s.meterFill, { width: `${level * 100}%`, backgroundColor: level >= 1 ? C.critical : C.warning }]} /></View>
            <Text style={s.hint}>
              Movimiento {sensor.sta.toFixed(3)} g · relación {sensor.ratio.toFixed(1)} · giro {sensor.rot.toFixed(2)} rad/s
              {sensor.lastTrigger ? ` · último disparo ${new Date(sensor.lastTrigger).toLocaleTimeString("es-MX")}` : ""}
            </Text>
          </>
        )}
        <Button title="Enviar disparo de prueba" kind="ghost" onPress={async () => {
          const r = await sensorTrigger({ peak_g: 0.5, kind: "simulated" });
          showToast({ title: r.ok ? "Disparo de prueba enviado" : "No se envió el disparo", body: r.ok ? "Si otros teléfonos cercanos también disparan, llegará la alerta." : r.reason, color: r.ok ? C.warning : C.critical });
        }} />
      </View>

      <SectionTitle>Sonidos de alerta</SectionTitle>
      <View style={[s.row, { flexWrap: "wrap", rowGap: 8 }]}>
        {SOUNDS.map((x) => <Chip key={x.key} label={`▶ ${x.label}`} onPress={() => playOnce(x.key, 4000)} />)}
      </View>

      <SectionTitle>Conexión</SectionTitle>
      <Text style={s.hint}>Servidor: {serverUrl}</Text>
      <Button title="Cerrar sesión" kind="ghost" style={{ marginTop: 12 }} onPress={() =>
        RNAlert.alert("Cerrar sesión", "Dejarás de recibir alertas en este teléfono hasta que vuelvas a entrar. Tu historial se conserva.", [
          { text: "Cancelar", style: "cancel" },
          { text: "Cerrar sesión", style: "destructive", onPress: signOut },
        ])
      } />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  name: { fontSize: 26, fontWeight: "900", color: C.ink },
  sub: { color: C.ink2, marginTop: 2 },
  zone: { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 10, padding: 12, marginBottom: 8 },
  zoneName: { fontSize: 16, fontWeight: "700", color: C.ink },
  zoneTag: { color: C.info, marginTop: 2 },
  box: { backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 12 },
  row: { flexDirection: "row", gap: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 16, fontWeight: "700", color: C.ink, flex: 1 },
  hint: { color: C.ink2, fontSize: 14, lineHeight: 20 },
  meter: { height: 12, borderRadius: 6, backgroundColor: C.bg, overflow: "hidden" },
  meterFill: { height: 12 },
});
