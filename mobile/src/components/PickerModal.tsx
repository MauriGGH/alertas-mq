import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { C } from "../theme";

export interface PickerItem { key: string; label: string }

/** Lista con búsqueda para elegir estado o municipio */
export function PickerModal({ visible, title, items, onPick, onClose, loading }: {
  visible: boolean; title: string; items: PickerItem[]; onPick(i: PickerItem): void; onClose(): void; loading?: boolean;
}) {
  const [q, setQ] = useState("");
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = useMemo(() => (q ? items.filter((i) => norm(i.label).includes(norm(q))) : items), [q, items]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.root}>
        <View style={s.head}>
          <Text style={s.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={s.close}>Cerrar</Text></Pressable>
        </View>
        <TextInput style={s.search} placeholder="Buscar" value={q} onChangeText={setQ} autoCorrect={false} placeholderTextColor={C.ink2} />
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.key}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={s.empty}>{loading ? "Cargando…" : "Sin resultados"}</Text>}
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [s.item, pressed && { backgroundColor: C.bg }]} onPress={() => { setQ(""); onPick(item); }}>
              <Text style={s.itemText}>{item.label}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.card },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  title: { fontSize: 20, fontWeight: "800", color: C.ink },
  close: { color: C.info, fontSize: 16, fontWeight: "600" },
  search: { marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, color: C.ink },
  item: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  itemText: { fontSize: 16, color: C.ink },
  empty: { textAlign: "center", color: C.ink2, marginTop: 30 },
});
