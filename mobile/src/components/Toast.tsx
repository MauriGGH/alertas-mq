import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../store";
import { C } from "../theme";

/** Aviso que baja desde arriba para alertas no críticas y mensajes del sistema */
export function Toast() {
  const { toast, dismissToast, openAlert } = useApp();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-160)).current;

  useEffect(() => {
    if (!toast) return;
    Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(y, { toValue: -160, duration: 250, useNativeDriver: true }).start(() => dismissToast());
    }, 6000);
    return () => clearTimeout(t);
  }, [toast, y, dismissToast]);

  if (!toast) return null;
  return (
    <Animated.View style={[s.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]}>
      <Pressable
        style={[s.box, { borderLeftColor: toast.color ?? C.warning }]}
        onPress={() => {
          if (toast.alertId) openAlert(toast.alertId);
          dismissToast();
        }}
      >
        <Text style={s.title} numberOfLines={2}>{toast.title}</Text>
        {!!toast.body && <Text style={s.body} numberOfLines={2}>{toast.body}</Text>}
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 100 },
  box: {
    backgroundColor: C.navy, borderRadius: 12, padding: 14, borderLeftWidth: 6,
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  title: { color: "#fff", fontWeight: "800", fontSize: 16 },
  body: { color: "#C9D4E0", fontSize: 14, marginTop: 3 },
});
