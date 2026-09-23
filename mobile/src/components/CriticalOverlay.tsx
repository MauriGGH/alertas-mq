/**
 * Alerta crítica: pantalla completa, sirena en bucle según el tipo y vibración
 * hasta que la persona confirma. Para simulacros se usa violeta y se dice claramente.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../store";
import { playLoop, soundFor, stopLoop } from "../sounds";
import { C, TYPE_ICON, TYPE_LABEL, clock } from "../theme";
import { HazardStripe } from "./ui";

export function CriticalOverlay() {
  const { critical, acknowledge } = useApp();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!critical) return;
    playLoop(soundFor(critical));
    Vibration.vibrate([0, 900, 400, 900, 400, 900], true);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
      stopLoop();
      Vibration.cancel();
    };
  }, [critical, pulse]);

  if (!critical) return null;
  const drill = !!critical.drill;
  const bg = drill ? C.drill : C.critical;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[s.root, { backgroundColor: bg }]}>
        <HazardStripe color={drill ? "#E9D5FF" : "#FFD400"} />
        <SafeAreaView style={s.safe} edges={["left", "right"]}>
          {drill && <Text style={s.drill}>SIMULACRO · ESCENARIO FICTICIO</Text>}
          <Animated.Text style={[s.icon, { transform: [{ scale }] }]}>{TYPE_ICON[critical.type] ?? "⚠️"}</Animated.Text>
          <Text style={s.kind}>{TYPE_LABEL[critical.type] ?? "Emergencia"}</Text>
          <Text style={s.title}>{critical.title}</Text>
          <Text style={s.body}>{critical.body}</Text>
          <Text style={s.meta}>Emitida a las {clock(critical.created_at)} · {critical.tags.slice(0, 3).join(" ")}</Text>

          <View style={s.actions}>
            <Pressable style={({ pressed }) => [s.main, pressed && { opacity: 0.85 }]} onPress={() => acknowledge(critical)}>
              <Text style={[s.mainText, { color: bg }]}>Enterado</Text>
            </Pressable>
            <View style={s.row}>
              <Pressable style={[s.sec, { borderColor: "#fff" }]} onPress={() => acknowledge(critical, "checkin_ok")}>
                <Text style={s.secText}>Estoy bien</Text>
              </Pressable>
              <Pressable style={[s.sec, { backgroundColor: "#111", borderColor: "#111" }]} onPress={() => acknowledge(critical, "checkin_help")}>
                <Text style={s.secText}>Necesito ayuda</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
        <HazardStripe color={drill ? "#E9D5FF" : "#FFD400"} />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 40, paddingBottom: 24 },
  safe: { flex: 1, paddingHorizontal: 24, justifyContent: "center" },
  drill: { color: "#fff", fontWeight: "900", fontSize: 14, textAlign: "center", marginBottom: 8, letterSpacing: 1 },
  icon: { fontSize: 88, textAlign: "center" },
  kind: { color: "#fff", fontSize: 18, fontWeight: "700", textAlign: "center", marginTop: 6, opacity: 0.9 },
  title: { color: "#fff", fontSize: 30, fontWeight: "900", textAlign: "center", marginTop: 12, lineHeight: 36 },
  body: { color: "#fff", fontSize: 18, textAlign: "center", marginTop: 14, lineHeight: 26 },
  meta: { color: "#fff", opacity: 0.8, fontSize: 13, textAlign: "center", marginTop: 14 },
  actions: { marginTop: 34, gap: 12 },
  main: { backgroundColor: "#fff", borderRadius: 14, paddingVertical: 20, alignItems: "center" },
  mainText: { fontSize: 22, fontWeight: "900" },
  row: { flexDirection: "row", gap: 12 },
  sec: { flex: 1, borderWidth: 2, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  secText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
