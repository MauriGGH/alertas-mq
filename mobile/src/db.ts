/**
 * Almacenamiento local (SQLite). Nada de lo recibido se borra:
 * las alertas y el chat quedan en el teléfono aunque se pierda la conexión o se cierre la app.
 */
import * as SQLite from "expo-sqlite";
import type { Alert, ChatMsg, LocalAlert } from "./types";

let db: SQLite.SQLiteDatabase;

export async function initDb(): Promise<void> {
  db = await SQLite.openDatabaseAsync("alertas.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL,
      via TEXT NOT NULL,
      acked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_seq ON alerts (seq DESC);
    CREATE TABLE IF NOT EXISTS chat (
      id TEXT PRIMARY KEY NOT NULL,
      seq INTEGER,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_seq ON chat (seq);
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

// ---- clave/valor (sesión, cursores, ajustes) ----
export async function kvGet<T>(k: string, fallback: T): Promise<T> {
  const row = await db.getFirstAsync<{ v: string }>("SELECT v FROM kv WHERE k = ?", [k]);
  return row ? (JSON.parse(row.v) as T) : fallback;
}
export async function kvSet(k: string, v: unknown): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", [k, JSON.stringify(v)]);
}

// ---- alertas ----
/** Devuelve true si la alerta es nueva (no la teníamos) */
export async function saveAlert(a: Alert, via: LocalAlert["via"]): Promise<LocalAlert | null> {
  const local: LocalAlert = { ...a, received_at: new Date().toISOString(), via, acked_at: null };
  const r = await db.runAsync(
    "INSERT OR IGNORE INTO alerts (id, seq, payload, received_at, via) VALUES (?, ?, ?, ?, ?)",
    [a.id, a.seq, JSON.stringify(a), local.received_at, via],
  );
  return r.changes > 0 ? local : null;
}

export async function listAlerts(limit = 1000): Promise<LocalAlert[]> {
  const rows = await db.getAllAsync<{ payload: string; received_at: string; via: LocalAlert["via"]; acked_at: string | null }>(
    "SELECT payload, received_at, via, acked_at FROM alerts ORDER BY seq DESC LIMIT ?",
    [limit],
  );
  return rows.map((r) => ({ ...(JSON.parse(r.payload) as Alert), received_at: r.received_at, via: r.via, acked_at: r.acked_at }));
}

export async function markAlertAcked(id: string): Promise<string> {
  const at = new Date().toISOString();
  await db.runAsync("UPDATE alerts SET acked_at = COALESCE(acked_at, ?) WHERE id = ?", [at, id]);
  return at;
}

// ---- chat ----
export async function saveChat(m: ChatMsg): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO chat (id, seq, payload, created_at) VALUES (?, ?, ?, ?)", [
    m.id, m.seq ?? null, JSON.stringify(m), m.created_at,
  ]);
}

export async function listChat(limit = 400): Promise<ChatMsg[]> {
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM (
       SELECT payload, seq, created_at FROM chat ORDER BY COALESCE(seq, 9007199254740991) DESC, created_at DESC LIMIT ?
     ) ORDER BY COALESCE(seq, 9007199254740991) ASC, created_at ASC`,
    [limit],
  );
  return rows.map((r) => JSON.parse(r.payload) as ChatMsg);
}

export async function deleteChat(id: string): Promise<void> {
  await db.runAsync("DELETE FROM chat WHERE id = ?", [id]);
}

export async function maxChatSeq(): Promise<number> {
  const row = await db.getFirstAsync<{ m: number | null }>("SELECT MAX(seq) AS m FROM chat");
  return row?.m ?? 0;
}

// ---- bandeja de salida: lo que no se pudo enviar se reintenta al reconectar ----
export interface OutboxItem { id: string; event: string; payload: unknown }

export async function outboxAdd(item: OutboxItem): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO outbox (id, event, payload, created_at) VALUES (?, ?, ?, ?)", [
    item.id, item.event, JSON.stringify(item.payload), new Date().toISOString(),
  ]);
}
export async function outboxList(): Promise<OutboxItem[]> {
  const rows = await db.getAllAsync<{ id: string; event: string; payload: string }>(
    "SELECT id, event, payload FROM outbox ORDER BY created_at ASC",
  );
  return rows.map((r) => ({ id: r.id, event: r.event, payload: JSON.parse(r.payload) }));
}
export async function outboxRemove(id: string): Promise<void> {
  await db.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
}

/** Cerrar sesión: borra la sesión y la bandeja de salida, pero conserva el historial de alertas */
export async function clearSession(): Promise<void> {
  await db.execAsync("DELETE FROM kv WHERE k IN ('session', 'cursor', 'chat_cursor'); DELETE FROM outbox;");
}
