import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../store";
import { C, SEV_LABEL, TYPE_ICON, TYPE_LABEL, alertColor, clock, isActive } from "../theme";
import { Button } from "../components/ui";

const SOURCE: Record<string, string> = {
  MANUAL: "Centro de mando", CROWDSENSE: "Red de sensores de celulares", USGS: "USGS", NHC: "Centro Nacional de Huracanes",
  GDACS: "GDACS", SMN: "Servicio Meteorológico Nacional", SIMULATOR: "Simulador",
};

export function AlertDetail() {
  const { openAlertId, openAlert, alerts, chat, acknowledge, showToast } = useApp();
  const a = alerts.find((x) => x.id === openAlertId);
  if (!a) return null;
  const color = alertColor(a);
  const checkins = chat.filter((m) => m.alert_id === a.id && m.kind !== "message");
  const ok = checkins.filter((m) => m.kind === "checkin_ok").length;
  const help = checkins.filter((m) => m.kind === "checkin_help");

  return (
    <Modal visible animationType="slide" onRequestClose={() => openAlert(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={[s.band, { backgroundColor: color }]}>
          <Pressable onPress={() => openAlert(null)} hitSlop={14}><Text style={s.back}>‹ Volver</Text></Pressable>
          <Text style={s.kind}>{TYPE_ICON[a.type]} {TYPE_LABEL[a.type]} · {a.drill ? "Simulacro" : SEV_LABEL[a.severity]}</Text>
          <Text style={s.title}>{a.title}</Text>
        </View>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.body}>{a.body}</Text>
          <View style={s.meta}>
            <Row k="Emitida" v={`${new Date(a.created_at).toLocaleDateString("es-MX")} ${clock(a.created_at)}`} />
            {a.expires_at && <Row k={isActive(a) ? "Vigente hasta" : "Terminó"} v={`${new Date(a.expires_at).toLocaleDateString("es-MX")} ${clock(a.expires_at)}`} />}
            <Row k="Origen" v={SOURCE[a.source] ?? a.source} />
            {a.geo && <Row k="Área" v={`${a.geo.radius_km} km alrededor de ${a.geo.lat.toFixed(2)}, ${a.geo.lon.toFixed(2)}`} />}
            <Row k="Recibida" v={`${clock(a.received_at)} ${a.via === "sync" ? "(recuperada al reconectar)" : "(en vivo)"}`} />
            {a.acked_at && <Row k="Confirmaste" v={clock(a.acked_at)} />}
            <Row k="Etiquetas" v={a.tags.join("  ")} />
          </View>

          <Text style={s.h2}>¿Cómo estás?</Text>
          <View style={s.row}>
            <Button title="Estoy bien" kind="ok" style={{ flex: 1 }} onPress={async () => {
              await acknowledge(a, "checkin_ok");
              showToast({ title: "Avisaste que estás bien", color: C.ok });
            }} />
            <Button title="Necesito ayuda" kind="danger" style={{ flex: 1 }} onPress={async () => {
              await acknowledge(a, "checkin_help");
              showToast({ title: "Pediste ayuda", body: "Tu mensaje aparece en el chat global.", color: C.critical });
            }} />
          </View>
          <Text style={s.stat}>{ok} personas avisaron que están bien · {help.length} pidieron ayuda</Text>
          {help.slice(-5).map((m) => <Text key={m.id} style={s.help}>🆘 {m.user_name} {m.tags.slice(0, 1).join("")}</Text>)}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  band: { padding: 18, paddingTop: 10 },
  back: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 10 },
  kind: { color: "#fff", fontWeight: "700", opacity: 0.95 },
  title: { color: "#fff", fontSize: 24, fontWeight: "900", marginTop: 6, lineHeight: 30 },
  content: { padding: 18, paddingBottom: 40 },
  body: { fontSize: 17, lineHeight: 25, color: C.ink },
  meta: { backgroundColor: C.card, borderRadius: 12, padding: 12, marginTop: 16 },
  metaRow: { flexDirection: "row", paddingVertical: 6, gap: 10 },
  k: { width: 110, color: C.ink2, fontSize: 14 },
  v: { flex: 1, color: C.ink, fontSize: 14 },
  h2: { fontSize: 18, fontWeight: "800", color: C.ink, marginTop: 22, marginBottom: 10 },
  row: { flexDirection: "row", gap: 10 },
  stat: { color: C.ink2, marginTop: 12 },
  help: { color: C.critical, marginTop: 6, fontWeight: "600" },
});
