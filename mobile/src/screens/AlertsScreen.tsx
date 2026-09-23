import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useApp } from "../store";
import { C, isActive } from "../theme";
import { AlertCard } from "../components/AlertCard";
import { Button } from "../components/ui";

/** Inicio: alertas vigentes para mis zonas y acceso rápido a "Estoy bien" */
export function AlertsScreen() {
  const { alerts, openAlert, sendChat, showToast, session } = useApp();
  const active = alerts.filter(isActive);
  const zones = session?.zones.map((z) => z.nombre).join(", ");

  return (
    <FlatList
      contentContainerStyle={s.content}
      data={active}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={
        <View style={s.header}>
          <Text style={s.h1}>{active.length ? `${active.length} ${active.length === 1 ? "alerta vigente" : "alertas vigentes"}` : "Todo en calma"}</Text>
          <Text style={s.sub}>Zonas: {zones}</Text>
          <View style={s.quick}>
            <Button title="Estoy bien" kind="ok" style={{ flex: 1 }} onPress={async () => {
              await sendChat("checkin_ok", "", active[0]?.id);
              showToast({ title: "Avisaste que estás bien", body: "Tu mensaje aparece en el chat global.", color: C.ok });
            }} />
            <Button title="Necesito ayuda" kind="danger" style={{ flex: 1 }} onPress={async () => {
              await sendChat("checkin_help", "", active[0]?.id);
              showToast({ title: "Pediste ayuda", body: "Tu mensaje aparece en el chat global con tu municipio.", color: C.critical });
            }} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={s.empty}>
          No hay alertas para tus zonas. Cuando se emita una, sonará y aparecerá aquí. Puedes revisar las anteriores en Historial.
        </Text>
      }
      renderItem={({ item }) => <AlertCard alert={item} onPress={() => openAlert(item.id)} />}
    />
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 30 },
  header: { marginBottom: 14 },
  h1: { fontSize: 28, fontWeight: "900", color: C.ink },
  sub: { color: C.ink2, fontSize: 14, marginTop: 2 },
  quick: { flexDirection: "row", gap: 10, marginTop: 14 },
  empty: { color: C.ink2, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 30, paddingHorizontal: 20 },
});
