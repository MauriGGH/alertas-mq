import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { C } from "../theme";
import type { ConnStatus } from "../types";

export function Button({ title, onPress, kind = "primary", disabled, style }: {
  title: string; onPress(): void; kind?: "primary" | "danger" | "ok" | "ghost"; disabled?: boolean; style?: ViewStyle;
}) {
  const bg = { primary: C.navy, danger: C.critical, ok: C.ok, ghost: "transparent" }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        kind === "ghost" && s.ghost,
        style,
      ]}
    >
      <Text style={[s.btnText, kind === "ghost" && { color: C.ink }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, color = C.navy }: { label: string; active?: boolean; onPress?(): void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: color, borderColor: color }]}>
      <Text style={[s.chipText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const STATUS = {
  online: { label: "En línea", color: C.ok },
  connecting: { label: "Reconectando…", color: C.watch },
  offline: { label: "Sin conexión", color: C.ink2 },
};

export function StatusPill({ status }: { status: ConnStatus }) {
  const st = STATUS[status];
  return (
    <View style={s.pill}>
      <View style={[s.dot, { backgroundColor: st.color }]} />
      <Text style={s.pillText}>{st.label}</Text>
    </View>
  );
}

/** Franja de peligro amarillo/negro, como la señalización de protección civil */
export function HazardStripe({ color = "#FFD400", height = 16 }: { color?: string; height?: number }) {
  return (
    <View style={{ height, overflow: "hidden", flexDirection: "row", backgroundColor: "#111" }}>
      {Array.from({ length: 40 }, (_, i) => (
        <View key={i} style={{ width: 14, height: height * 3, marginRight: 14, backgroundColor: color, transform: [{ rotate: "35deg" }], marginTop: -height }} />
      ))}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}

const s = StyleSheet.create({
  btn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 10, alignItems: "center" },
  ghost: { borderWidth: 1, borderColor: C.line },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, marginRight: 8 },
  chipText: { color: C.ink, fontSize: 14, fontWeight: "600" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pillText: { color: C.ink2, fontSize: 13, fontWeight: "600" },
  section: { fontSize: 13, fontWeight: "700", color: C.ink2, marginTop: 22, marginBottom: 8 },
});
