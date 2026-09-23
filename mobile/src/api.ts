import type { Estado, Municipio, Session, Zone } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(base: string, path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(base.replace(/\/$/, "") + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("No se pudo contactar al servidor. Revisa tu conexión y la dirección del servidor.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
  if (!res.ok) throw new ApiError(data.issues?.join("\n") ?? data.error ?? `Error ${res.status}`, res.status);
  return data as T;
}

export const api = {
  register: (base: string, body: { name: string; email: string; password: string; cve_mun: string; platform: string }) =>
    request<Session>(base, "/auth/register", { method: "POST", body }),
  login: (base: string, body: { email: string; password: string; platform: string; device_id?: string }) =>
    request<Session>(base, "/auth/login", { method: "POST", body }),
  me: (base: string, token: string) => request<Session>(base, "/me", { token }),
  putZones: (base: string, token: string, zones: { cve_mun: string; label: string }[]) =>
    request<{ zones: Zone[] }>(base, "/me/zones", { method: "PUT", token, body: { zones } }),
  estados: (base: string) => request<Estado[]>(base, "/catalog/estados"),
  municipios: (base: string, estado: string) => request<Municipio[]>(base, `/catalog/municipios?estado=${estado}`),
};
