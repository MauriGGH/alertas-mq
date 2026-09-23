import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api";
import { useApp } from "../store";
import { C } from "../theme";
import { Button, HazardStripe } from "../components/ui";
import { ZonePicker } from "../components/ZonePicker";
import type { Estado, Municipio } from "../types";

export function AuthScreen() {
  const { serverUrl, setServerUrl, signIn, authError } = useApp();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [zone, setZone] = useState<{ estado?: Estado; municipio?: Municipio }>({});
  const [server, setServer] = useState(serverUrl);
  const [editServer, setEditServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(authError);
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

  async function submit() {
    setError(null);
    if (mode === "register" && !zone.municipio) return setError("Elige tu estado y municipio para recibir las alertas de tu zona.");
    setBusy(true);
    try {
      const session =
        mode === "register"
          ? await api.register(serverUrl, { name: name.trim(), email: email.trim(), password, cve_mun: zone.municipio!.cve_mun, platform })
          : await api.login(serverUrl, { email: email.trim(), password, platform });
      await signIn(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <HazardStripe height={10} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.brand}>Red de Alertas</Text>
          <Text style={s.lead}>
            Recibe avisos de sismos, huracanes y otras emergencias de tu municipio, y avisa a los demás que estás bien.
          </Text>

          <View style={s.tabs}>
            <Button title="Crear cuenta" kind={mode === "register" ? "primary" : "ghost"} onPress={() => setMode("register")} style={{ flex: 1 }} />
            <Button title="Ya tengo cuenta" kind={mode === "login" ? "primary" : "ghost"} onPress={() => setMode("login")} style={{ flex: 1 }} />
          </View>

          {mode === "register" && (
            <TextInput style={s.input} placeholder="Tu nombre" value={name} onChangeText={setName} placeholderTextColor={C.ink2} />
          )}
          <TextInput style={s.input} placeholder="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={C.ink2} />
          <TextInput style={s.input} placeholder="Contraseña (mínimo 6)" value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={C.ink2} />
          {mode === "register" && (
            <>
              <Text style={s.hint}>¿Dónde vives? Solo recibirás las alertas que afectan a tu municipio.</Text>
              <ZonePicker serverUrl={serverUrl} value={zone} onChange={setZone} />
            </>
          )}

          {error && <Text style={s.error}>{error}</Text>}
          <Button title={busy ? "Conectando…" : mode === "register" ? "Crear cuenta" : "Entrar"} onPress={submit} disabled={busy} style={{ marginTop: 18 }} />

          <View style={s.server}>
            <Text style={s.hint}>Servidor: {serverUrl}</Text>
            {editServer ? (
              <>
                <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} placeholder="https://api.tudominio.com" placeholderTextColor={C.ink2} />
                <Button title="Guardar servidor" kind="ghost" onPress={async () => { await setServerUrl(server); setEditServer(false); }} />
              </>
            ) : (
              <Button title="Cambiar servidor" kind="ghost" onPress={() => setEditServer(true)} />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 22, gap: 10 },
  brand: { fontSize: 34, fontWeight: "900", color: C.ink, marginTop: 16 },
  lead: { fontSize: 16, color: C.ink2, lineHeight: 23, marginBottom: 10 },
  tabs: { flexDirection: "row", gap: 10, marginBottom: 6 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 13, fontSize: 16, color: C.ink },
  hint: { color: C.ink2, fontSize: 14, marginTop: 6 },
  error: { color: C.critical, fontSize: 15, marginTop: 6 },
  server: { marginTop: 26, gap: 8 },
});
