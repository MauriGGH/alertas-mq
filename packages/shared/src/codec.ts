import type { z } from "zod";

/**
 * Serialización del patrón productor/consumidor:
 * el productor valida y serializa a JSON; el consumidor deserializa y valida.
 */
export function encode<S extends z.ZodTypeAny>(schema: S, value: z.input<S>): Buffer {
  return Buffer.from(JSON.stringify(schema.parse(value)), "utf8");
}

export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; raw: string };

export function decode<S extends z.ZodTypeAny>(
  schema: S,
  data: Buffer | string | null | undefined,
): DecodeResult<z.output<S>> {
  const raw = data == null ? "" : data.toString();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "JSON inválido", raw };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), raw };
}

/** Clave de partición: por estado, para conservar el orden de eventos de una misma región */
export function alertPartitionKey(a: { targets: { estados: string[]; municipios: string[] } }): string {
  return a.targets.estados[0] ?? a.targets.municipios[0]?.slice(0, 2) ?? "00";
}
