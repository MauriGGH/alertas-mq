import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useApp } from "../store";
import { C, clock } from "../theme";
import { Chip } from "../components/ui";
import type { ChatMsg } from "../types";

/** Chat global: mensajes y check-ins de todos, filtrables por hashtag (#Manzanillo, #Colima…) */
export function ChatScreen() {
  const { chat, sendChat, chatByTag, session, status } = useApp();
  const [text, setText] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [remote, setRemote] = useState<ChatMsg[]>([]);
  const list = useRef<FlatList<ChatMsg>>(null);
  const myTags = useMemo(() => [...new Set(session?.zones.map((z) => z.hashtag) ?? [])], [session]);

  useEffect(() => {
    if (tag) chatByTag(tag).then(setRemote).catch(() => setRemote([]));
  }, [tag, chatByTag]);

  const data = useMemo(() => {
    if (!tag) return chat;
    const byId = new Map<string, ChatMsg>();
    [...remote, ...chat.filter((m) => m.tags.includes(tag))].forEach((m) => byId.set(m.id, m));
    return [...byId.values()].sort((a, b) => (a.seq ?? 1e15) - (b.seq ?? 1e15));
  }, [chat, remote, tag]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    await sendChat("message", t);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={{ paddingHorizontal: 12 }}>
        <Chip label="Todo" active={!tag} onPress={() => setTag(null)} />
        {myTags.map((t) => <Chip key={t} label={t} active={tag === t} onPress={() => setTag(t)} color={C.info} />)}
        {tag && !myTags.includes(tag) && <Chip label={tag} active onPress={() => setTag(null)} color={C.info} />}
      </ScrollView>
      <FlatList
        ref={list}
        data={data}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={s.empty}>Nadie ha escrito todavía. Usa #TuMunicipio para que te encuentren.</Text>}
        renderItem={({ item }) => <Bubble m={item} mine={item.user_id === session?.user.id} onTag={setTag} />}
      />
      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder={status === "online" ? "Escribe… usa #Manzanillo" : "Sin conexión: se enviará al reconectar"}
          placeholderTextColor={C.ink2}
          multiline
          maxLength={500}
        />
        <Pressable style={[s.send, !text.trim() && { opacity: 0.4 }]} onPress={send} disabled={!text.trim()}>
          <Text style={s.sendText}>Enviar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m, mine, onTag }: { m: ChatMsg; mine: boolean; onTag(t: string): void }) {
  const isOk = m.kind === "checkin_ok";
  const isHelp = m.kind === "checkin_help";
  const bg = isOk ? "#E3F5EA" : isHelp ? "#FDE4E1" : mine ? "#DCE9FB" : C.card;
  const parts = m.text.split(/(#[\p{L}\p{N}_]+)/u);
  return (
    <View style={[s.bubble, { backgroundColor: bg, alignSelf: mine ? "flex-end" : "flex-start" }]}>
      <Text style={s.who}>{m.user_name}{m.pending ? "  · enviando…" : ""}</Text>
      <Text style={[s.text, isHelp && { color: C.critical, fontWeight: "800" }, isOk && { color: C.ok, fontWeight: "700" }]}>
        {isOk ? "✅ " : isHelp ? "🆘 " : ""}
        {parts.map((p, i) => p.startsWith("#") ? <Text key={i} style={s.tag} onPress={() => onTag(p)}>{p}</Text> : p)}
      </Text>
      {m.tags.filter((t) => !m.text.includes(t)).length > 0 && (
        <Text style={s.meta}>
          {m.tags.filter((t) => !m.text.includes(t)).map((t) => <Text key={t} style={s.tag} onPress={() => onTag(t)}>{t} </Text>)}
        </Text>
      )}
      <Text style={s.time}>{clock(m.created_at)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexGrow: 0, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  empty: { color: C.ink2, textAlign: "center", marginTop: 40, paddingHorizontal: 30 },
  bubble: { maxWidth: "85%", borderRadius: 14, padding: 10, marginBottom: 8 },
  who: { fontSize: 12, fontWeight: "700", color: C.ink2, marginBottom: 2 },
  text: { fontSize: 16, color: C.ink, lineHeight: 22 },
  tag: { color: C.info, fontWeight: "700" },
  meta: { marginTop: 3, fontSize: 13 },
  time: { fontSize: 11, color: C.ink2, marginTop: 4, alignSelf: "flex-end" },
  composer: { flexDirection: "row", padding: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.card },
  input: { flex: 1, maxHeight: 110, borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 16, color: C.ink },
  send: { backgroundColor: C.navy, borderRadius: 20, paddingHorizontal: 16, justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "800" },
});
