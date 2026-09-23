import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C, SEV_LABEL, TYPE_ICON, TYPE_LABEL, alertColor, isActive, timeAgo } from "../theme";
import type { LocalAlert } from "../types";

export function AlertCard({ alert, onPress, compact }: { alert: LocalAlert; onPress(): void; compact?: boolean }) {
  const color = alertColor(alert);
  const active = isActive(alert);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, { borderLeftColor: color, opacity: pressed ? 0.8 : active ? 1 : 0.7 }]}>
      <View style={s.head}>
        <Text style={s.icon}>{TYPE_ICON[alert.type] ?? "📢"}</Text>
        <View style={[s.badge, { backgroundColor: color }]}>
          <Text style={s.badgeText}>{alert.drill ? "Simulacro" : SEV_LABEL[alert.severity]}</Text>
        </View>
        <Text style={s.type}>{TYPE_LABEL[alert.type] ?? alert.type}</Text>
        <Text style={s.time}>{timeAgo(alert.created_at)}</Text>
      </View>
      <Text style={s.title} numberOfLines={compact ? 2 : 3}>{alert.title}</Text>
      {!compact && !!alert.body && <Text style={s.body} numberOfLines={3}>{alert.body}</Text>}
      <View style={s.foot}>
        <Text style={s.tags} numberOfLines={1}>{alert.tags.slice(0, 4).join("  ")}</Text>
        {!active && <Text style={s.expired}>Terminada</Text>}
        {alert.via === "sync" && <Text style={s.expired}>Recuperada</Text>}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { fontSize: 18 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  type: { color: C.ink2, fontSize: 13, fontWeight: "600", flex: 1 },
  time: { color: C.ink2, fontSize: 12 },
  title: { fontSize: 17, fontWeight: "800", color: C.ink, marginTop: 8, lineHeight: 22 },
  body: { fontSize: 15, color: C.ink, marginTop: 4, lineHeight: 21 },
  foot: { flexDirection: "row", marginTop: 8, gap: 10, alignItems: "center" },
  tags: { color: C.info, fontSize: 13, flex: 1 },
  expired: { color: C.ink2, fontSize: 12, fontWeight: "600" },
});
