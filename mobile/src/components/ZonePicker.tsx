import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../api";
import { C } from "../theme";
import type { Estado, Municipio } from "../types";
import { PickerModal } from "./PickerModal";

/** Selector en dos pasos: estado y luego municipio */
export function ZonePicker({ serverUrl, value, onChange }: {
  serverUrl: string;
  value: { estado?: Estado; municipio?: Municipio };
  onChange(v: { estado?: Estado; municipio?: Municipio }): void;
}) {
  const [estados, setEstados] = useState<Estado[]>([]);
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [open, setOpen] = useState<"estado" | "municipio" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.estados(serverUrl).then(setEstados).catch((e: Error) => setError(e.message));
  }, [serverUrl]);

  useEffect(() => {
    if (!value.estado) return setMunicipios([]);
    setMunicipios([]);
    api.municipios(serverUrl, value.estado.cve_ent).then(setMunicipios).catch((e: Error) => setError(e.message));
  }, [serverUrl, value.estado]);

  return (
    <View style={{ gap: 10 }}>
      <Field label="Estado" text={value.estado?.nombre ?? "Elige tu estado"} onPress={() => setOpen("estado")} />
      <Field
        label="Municipio"
        text={value.municipio?.nombre ?? (value.estado ? "Elige tu municipio" : "Primero elige el estado")}
        onPress={() => value.estado && setOpen("municipio")}
        disabled={!value.estado}
      />
      {error && <Text style={s.error}>{error}</Text>}
      <PickerModal
        visible={open === "estado"}
        title="Estado"
        loading={!estados.length}
        items={estados.map((e) => ({ key: e.cve_ent, label: e.nombre }))}
        onClose={() => setOpen(null)}
        onPick={(i) => {
          onChange({ estado: estados.find((e) => e.cve_ent === i.key) });
          setOpen("municipio");
        }}
      />
      <PickerModal
        visible={open === "municipio"}
        title={`Municipios de ${value.estado?.nombre ?? ""}`}
        loading={!municipios.length}
        items={municipios.map((m) => ({ key: m.cve_mun, label: m.nombre }))}
        onClose={() => setOpen(null)}
        onPick={(i) => {
          onChange({ estado: value.estado, municipio: municipios.find((m) => m.cve_mun === i.key) });
          setOpen(null);
        }}
      />
    </View>
  );
}

function Field({ label, text, onPress, disabled }: { label: string; text: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.field, disabled && { opacity: 0.5 }]}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{text}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  field: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, backgroundColor: C.card },
  label: { fontSize: 12, color: C.ink2, fontWeight: "600" },
  value: { fontSize: 16, color: C.ink, marginTop: 2 },
  error: { color: C.critical },
});
