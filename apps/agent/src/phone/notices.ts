import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HERMES_HOME } from "../home.js";

/**
 * Avisos del agente al teléfono (Hermes habla primero): tareas programadas,
 * el brief de la mañana, lo que el agente decida avisar.
 *
 * Tres reglas (docs/vision.md de hermes-phone, P8):
 * - PRESUPUESTO DIARIO. El dueño fija cuántos avisos al día (default 3). El
 *   que se pasa se DESCARTA con motivo, no se encola para mañana: un aviso
 *   viejo no sirve y acumularlos es justo el patrón que Hermes no quiere.
 * - NADA SE PIERDE POR ESTAR DESCONECTADO. Sin teléfono el aviso queda en
 *   cola y sale al próximo `hello`; el teléfono lo confirma con `ack` y lo
 *   deduplica por id, así un reenvío (ack perdido) no se ve dos veces.
 * - CADUCAN. Lo que lleva más de 24 h sin entregarse se marca vencido.
 *
 * Lógica pura sobre una lista (testeable); solo el store toca disco.
 */

export type NoticeSource = "scheduled" | "brief" | "agent" | "growth";
export type NoticeStatus = "queued" | "sent" | "acked" | "dropped" | "expired";

export interface PhoneNotice {
  id: string;
  title: string;
  body: string;
  source: NoticeSource;
  /** Id de lo que lo originó (tarea programada…), para auditar. */
  ref?: string;
  created_at: string;
  status: NoticeStatus;
  sent_at?: string;
  acked_at?: string;
  /** Por qué se descartó o venció. */
  reason?: string;
  /** Iniciativa del compañero: tipo, porqué visible, respuestas y ventana (el teléfono la retiene si hay un veto). */
  extra?: NoticeExtra;
}

export interface NoticeExtra {
  kind: "checkin";
  why: string;
  replies: string[];
  /** Hasta cuándo vale mostrarlo (ISO). */
  not_after: string;
}

export interface NoticeInput {
  title: string;
  body: string;
  source: NoticeSource;
  ref?: string;
  extra?: NoticeExtra;
}

export const NOTICE_TTL_MS = 24 * 60 * 60_000;
/** Historial que se conserva (para /phone/notices y auditar el presupuesto). */
const KEEP_MS = 7 * 24 * 60 * 60_000;
export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 4000;

/** Día calendario de un instante en la zona del dueño ("2026-10-14"). */
export function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/** Cuántos avisos del día de `nowIso` cuentan contra el presupuesto (todo lo que no se descartó). */
export function usedToday(notices: readonly PhoneNotice[], nowIso: string, tz: string): number {
  const today = dayKey(nowIso, tz);
  return notices.filter((n) => n.status !== "dropped" && dayKey(n.created_at, tz) === today).length;
}

/**
 * Recorta un cuerpo largo en un salto de línea (o espacio) y lo dice. Cortar a
 * ciegas partía una palabra y no avisaba que faltaba el final.
 */
export function clipBody(body: string, max = NOTICE_BODY_MAX): string {
  const text = body.trim();
  if (text.length <= max) return text;
  const mark = "\n\n_(recortado)_";
  const room = text.slice(0, max - mark.length);
  const cut = Math.max(room.lastIndexOf("\n"), room.lastIndexOf(" "));
  return `${(cut > room.length / 2 ? room.slice(0, cut) : room).trimEnd()}${mark}`;
}

/** Admite un aviso nuevo: en cola si cabe en el presupuesto, descartado con motivo si no. */
export function admitNotice(
  notices: readonly PhoneNotice[],
  input: NoticeInput,
  o: { id: string; nowIso: string; tz: string; budget: number },
): { notices: PhoneNotice[]; notice: PhoneNotice } {
  const base = {
    id: o.id,
    title: input.title.trim().slice(0, NOTICE_TITLE_MAX) || "Hermes",
    body: clipBody(input.body),
    source: input.source,
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.extra ? { extra: input.extra } : {}),
    created_at: o.nowIso,
  };
  const over = usedToday(notices, o.nowIso, o.tz) >= o.budget;
  const notice: PhoneNotice = over
    ? { ...base, status: "dropped", reason: `presupuesto diario (${o.budget}) agotado` }
    : { ...base, status: "queued" };
  return { notices: [...notices, notice], notice };
}

/** Vence lo no entregado con más de `ttlMs` y olvida lo de hace más de una semana. */
export function sweepNotices(notices: readonly PhoneNotice[], nowIso: string, ttlMs = NOTICE_TTL_MS): PhoneNotice[] {
  const now = Date.parse(nowIso);
  return notices
    .filter((n) => now - Date.parse(n.created_at) <= KEEP_MS)
    .map((n) =>
      (n.status === "queued" || n.status === "sent") && now - Date.parse(n.created_at) > ttlMs
        ? { ...n, status: "expired" as const, reason: "más de 24 h sin llegar al teléfono" }
        : n,
    );
}

/** Lo que hay que mandar al teléfono: en cola o enviado sin confirmar, del más viejo al más nuevo. */
export function deliverable(notices: readonly PhoneNotice[]): PhoneNotice[] {
  return notices
    .filter((n) => n.status === "queued" || n.status === "sent")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function markSent(notices: readonly PhoneNotice[], ids: readonly string[], nowIso: string): PhoneNotice[] {
  const set = new Set(ids);
  return notices.map((n) => (set.has(n.id) && n.status === "queued" ? { ...n, status: "sent" as const, sent_at: nowIso } : n));
}

/** El teléfono lo mostró. Idempotente: un ack repetido o de un id desconocido no cambia nada. */
export function markAcked(notices: readonly PhoneNotice[], id: string, nowIso: string): PhoneNotice[] {
  return notices.map((n) =>
    n.id === id && (n.status === "queued" || n.status === "sent") ? { ...n, status: "acked" as const, acked_at: nowIso } : n,
  );
}

/** Valida lo leído del disco: una fila rota se descarta, no tumba la cola. */
export function parseNotices(raw: unknown): PhoneNotice[] {
  const list = Array.isArray((raw as { notices?: unknown })?.notices) ? (raw as { notices: unknown[] }).notices : [];
  const statuses: NoticeStatus[] = ["queued", "sent", "acked", "dropped", "expired"];
  const sources: NoticeSource[] = ["scheduled", "brief", "agent", "growth"];
  const out: PhoneNotice[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (typeof x.id !== "string" || typeof x.created_at !== "string" || Number.isNaN(Date.parse(x.created_at))) continue;
    if (!statuses.includes(x.status as NoticeStatus)) continue;
    out.push({
      id: x.id,
      title: typeof x.title === "string" ? x.title : "Hermes",
      body: typeof x.body === "string" ? x.body : "",
      source: sources.includes(x.source as NoticeSource) ? (x.source as NoticeSource) : "agent",
      ...(typeof x.ref === "string" ? { ref: x.ref } : {}),
      created_at: x.created_at,
      status: x.status as NoticeStatus,
      ...(typeof x.sent_at === "string" ? { sent_at: x.sent_at } : {}),
      ...(typeof x.acked_at === "string" ? { acked_at: x.acked_at } : {}),
      ...(typeof x.reason === "string" ? { reason: x.reason } : {}),
      ...(parseExtra(x.extra) ? { extra: parseExtra(x.extra) } : {}),
    });
  }
  return out;
}

function parseExtra(raw: unknown): NoticeExtra | undefined {
  const e = (raw ?? null) as Record<string, unknown> | null;
  if (!e || e.kind !== "checkin" || typeof e.why !== "string" || typeof e.not_after !== "string") return undefined;
  const replies = Array.isArray(e.replies) ? e.replies.filter((r): r is string => typeof r === "string").slice(0, 3) : [];
  return { kind: "checkin", why: e.why, replies, not_after: e.not_after };
}

export interface NoticeStore {
  load(): Promise<PhoneNotice[]>;
  save(notices: PhoneNotice[]): Promise<void>;
}

export const NOTICES_PATH = join(HERMES_HOME, "phone", "notices.json");

/** Store en disco (tmp + rename): la cola sobrevive a un reinicio del agente. */
export function fileNoticeStore(path = NOTICES_PATH): NoticeStore {
  return {
    async load() {
      try {
        return parseNotices(JSON.parse(await readFile(path, "utf8")));
      } catch {
        return [];
      }
    },
    async save(notices) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ notices }, null, 2) + "\n");
      await rename(tmp, path);
    },
  };
}

export function memNoticeStore(initial: PhoneNotice[] = []): NoticeStore & { data: PhoneNotice[] } {
  const s = {
    data: initial,
    async load() {
      return s.data;
    },
    async save(n: PhoneNotice[]) {
      s.data = n;
    },
  };
  return s;
}
