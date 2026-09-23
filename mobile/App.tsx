import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AppProvider, useApp } from "./src/store";
import { useSeismicSensor } from "./src/sensor";
import { C } from "./src/theme";
import { StatusPill } from "./src/components/ui";
import { CriticalOverlay } from "./src/components/CriticalOverlay";
import { Toast } from "./src/components/Toast";
import { AuthScreen } from "./src/screens/AuthScreen";
import { AlertsScreen } from "./src/screens/AlertsScreen";
import { HistoryScreen } from "./src/screens/HistoryScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { AlertDetail } from "./src/screens/AlertDetail";

type Tab = "alertas" | "historial" | "chat" | "perfil";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "alertas", label: "Alertas", icon: "⚠️" },
  { key: "historial", label: "Historial", icon: "🗂️" },
  { key: "chat", label: "Chat", icon: "💬" },
  { key: "perfil", label: "Perfil", icon: "👤" },
];

function Main() {
  const { phase, status, settings, sensorTrigger, showToast, chat, session } = useApp();
  const [tab, setTab] = useState<Tab>("alertas");
  const [seenChat, setSeenChat] = useState(0);

  // El sensor corre en toda la app (no solo en Perfil) mientras esté activado
  const sensor = useSeismicSensor(phase === "app" && settings.sensorEnabled, settings.sensorMode, async (d) => {
    const r = await sensorTrigger({ ...d, kind: "phone" });
    if (r.ok) showToast({ title: "📳 Movimiento fuerte detectado", body: `Se avisó al servidor (${d.peak_g} g).`, color: C.warning });
  });

  if (phase === "loading") {
    return <View style={s.center}><ActivityIndicator size="large" color={C.navy} /></View>;
  }
  if (phase === "auth") return <AuthScreen />;

  const unread = tab === "chat" ? 0 : Math.max(0, chat.length - seenChat);
  const zone = session?.zones[0];

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.top}>
        <Text style={s.brand}>Red de Alertas</Text>
        <Text style={s.zone} numberOfLines={1}>{zone ? zone.hashtag : ""}</Text>
        <StatusPill status={status} />
      </View>
      <View style={{ flex: 1 }}>
        {tab === "alertas" && <AlertsScreen />}
        {tab === "historial" && <HistoryScreen />}
        {tab === "chat" && <ChatScreen />}
        {tab === "perfil" && <ProfileScreen sensor={sensor} />}
      </View>
      <SafeAreaView edges={["bottom"]} style={s.tabbar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={s.tab} onPress={() => { setTab(t.key); if (t.key === "chat") setSeenChat(chat.length); }} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Text style={s.tabIcon}>{t.icon}</Text>
            <Text style={[s.tabLabel, tab === t.key && s.tabActive]}>{t.label}{t.key === "chat" && unread > 0 ? ` (${unread})` : ""}</Text>
            {tab === t.key && <View style={s.tabBar} />}
          </Pressable>
        ))}
      </SafeAreaView>
      <AlertDetail />
      <Toast />
      <CriticalOverlay />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppProvider>
        <Main />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  brand: { fontSize: 18, fontWeight: "900", color: C.ink },
  zone: { flex: 1, color: C.info, fontWeight: "700" },
  tabbar: { flexDirection: "row", backgroundColor: C.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  tab: { flex: 1, alignItems: "center", paddingTop: 8, paddingBottom: 6 },
  tabIcon: { fontSize: 20 },
  tabLabel: { fontSize: 12, color: C.ink2, fontWeight: "600", marginTop: 2 },
  tabActive: { color: C.ink, fontWeight: "900" },
  tabBar: { position: "absolute", top: 0, left: "25%", height: 3, width: "50%", backgroundColor: C.warning, borderRadius: 2 },
});
