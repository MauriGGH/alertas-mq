import React, { useMemo, useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../store";
import { C, TYPE_LABEL } from "../theme";
import { AlertCard } from "../components/AlertCard";
import { Chip } from "../components/ui";
import type { AlertType } from "../types";

type Filter = "todas" | "criticas" | "simulacros" | AlertType;

/** Todas las alertas recibidas; se guardan en el teléfono y no se borran */
export function HistoryScreen() {
  const { alerts, openAlert } = useApp();
  const [filter, setFilter] = useState<Filter>("todas");
  const types = useMemo(() => [...new Set(alerts.map((a) => a.type))], [alerts]);
  const list = alerts.filter((a) =>
    filter === "todas" ? true : filter === "criticas" ? a.severity === "CRITICAL" && !a.drill : filter === "simulacros" ? a.drill : a.type === filter,
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={{ paddingHorizontal: 16 }}>
        <Chip label={`Todas (${alerts.length})`} active={filter === "todas"} onPress={() => setFilter("todas")} />
        <Chip label="Críticas" active={filter === "criticas"} onPress={() => setFilter("criticas")} color={C.critical} />
        <Chip label="Simulacros" active={filter === "simulacros"} onPress={() => setFilter("simulacros")} color={C.drill} />
        {types.map((t) => <Chip key={t} label={TYPE_LABEL[t] ?? t} active={filter === t} onPress={() => setFilter(t)} />)}
      </ScrollView>
      <FlatList
        contentContainerStyle={s.content}
        data={list}
        keyExtractor={(a) => a.id}
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={<Text style={s.empty}>Aún no has recibido alertas con este filtro.</Text>}
        renderItem={({ item }) => <AlertCard alert={item} compact onPress={() => openAlert(item.id)} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexGrow: 0, paddingVertical: 12 },
  content: { paddingHorizontal: 16, paddingBottom: 30 },
  empty: { color: C.ink2, textAlign: "center", marginTop: 40 },
});
