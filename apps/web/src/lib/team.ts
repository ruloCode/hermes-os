// "TU EQUIPO" (/equipo): los agentes de Hermes vistos como personajes, igual que
// la pestaña Equipo de Hermes Phone. Este módulo es el PUERTO de
// `hermes-phone/core/.../Team.kt` (lógica pura, con sus mismos contratos en
// `team.test.ts`): si cambias una regla aquí, cámbiala también allá.
//
// Un miembro sale de datos REALES del agente — sesiones vivas (`/office/state`),
// tareas programadas (`/scheduled`), máquinas (`/machines`), permisos pendientes
// (`/office/approvals`) y agentes en la nube (`/cloud/agents`) —; si una fuente
// no responde, sus miembros no aparecen.
//
// Sin imports a propósito: el test corre con el runner nativo de Node
// (`--experimental-strip-types`), sin bundler ni alias.

// ── Formas y colores del personaje ───────────────────────────────────────

/** Las 8 formas, en el MISMO orden que el enum del teléfono (el hash elige por índice). */
export const SHAPES = ["blob", "drop", "cloud", "flower", "pill", "squircle", "triangle", "spark"] as const;
export type Shape = (typeof SHAPES)[number];

/** Cuántos colores tiene la paleta de personajes (la paleta vive en el avatar: es ilustración). */
export const COLORS = 10;

export interface Look {
  shape: Shape;
  color: number;
}

/** Hermes, el jefe: blob índigo (color 0). Siempre el mismo. */
export const HERMES_LOOK: Look = { shape: "blob", color: 0 };

/**
 * Forma y color estables para un agente: el mismo id da siempre el mismo
 * personaje, y el MISMO que en el teléfono (FNV-1a sobre unidades UTF-16, como
 * `Char.code` en Kotlin). El color 0 (índigo) queda para Hermes.
 */
export function lookFor(id: string): Look {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul((h ^ id.charCodeAt(i)) >>> 0, 0x01000193) >>> 0;
  const shape = SHAPES[h % SHAPES.length];
  const color = 1 + (Math.floor(h / SHAPES.length) % (COLORS - 1));
  return { shape, color };
}

// ── Lo que llega del agente ──────────────────────────────────────────────

export interface Worker {
  id: string;
  source: string;
  name: string;
  status: string;
  machine: string;
  toolName: string | null;
  toolTarget: string | null;
  lines: string[];
  lastText: string | null;
  toolCalls: number;
  startedAt: number | null;
  lastEventAt: number | null;
  finishedAt: number | null;
}

export interface Scheduled {
  id: string;
  title: string;
  prompt: string;
  cron: string;
  tz: string;
  enabled: boolean;
  whenText: string | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastOutput: string | null;
  /** Máquina donde se creó la tarea (`MACHINE_NAME` de su agente); null = no lo dice. */
  machine: string | null;
}

export interface Run {
  id: string;
  startedAt: number | null;
  status: string;
  output: string | null;
}

export interface Machine {
  name: string;
  online: boolean;
  self: boolean;
  canRun: boolean;
  baseUrl: string | null;
}

export interface Approval {
  id: string;
  workerId: string | null;
  tool: string;
  summary: string;
  detail: string;
  since: number | null;
}

export interface CloudAgent {
  id: string;
  name: string;
  description: string | null;
  model: string | null;
  /** running · idle · terminated · none (sin conversación aún) · rescheduling */
  status: string;
  preview: string | null;
  updatedAt: number | null;
  costUsd: number;
  nextRunAt: number | null;
}

export interface ChatLine {
  id: string;
  fromAgent: boolean;
  text: string;
  at: number;
}

export interface CloudChat {
  sessionId: string | null;
  status: string;
  messages: ChatLine[];
  steps: string[];
  costUsd: number;
}

export interface Sources {
  workers?: Worker[] | null;
  scheduled?: Scheduled[] | null;
  machines?: Machine[] | null;
  approvals?: Approval[] | null;
  cloud?: CloudAgent[] | null;
  /** `watched` de `/office/approvals`: si nadie mira, los permisos se niegan solos. */
  watched?: boolean;
}

type J = Record<string, unknown>;

const obj = (v: unknown): J | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Texto no vacío (como `str` del teléfono: un número también es texto; vacío = null). */
function str(o: J | null, k: string): string | null {
  const v = o?.[k];
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;
  return s && s.trim() ? s : null;
}

function bool(o: J | null, k: string): boolean | null {
  const v = o?.[k];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function num(o: J | null, k: string): number | null {
  const v = o?.[k];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Instante en ms; null si falta o no se entiende. */
function instant(o: J | null, k: string): number | null {
  const s = str(o, k);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function parseWorkers(json: unknown): Worker[] {
  return arr(obj(json)?.workers).flatMap((e): Worker[] => {
    const o = obj(e);
    const id = str(o, "id");
    if (!o || !id) return [];
    const task = obj(o.task);
    const tool = obj(o.tool);
    return [
      {
        id,
        source: str(o, "source") ?? "other",
        name: str(task, "name") ?? str(o, "name") ?? "Agente",
        status: str(o, "status") ?? "working",
        machine: str(o, "machine") ?? "",
        toolName: str(tool, "name"),
        toolTarget: str(tool, "target"),
        lines: arr(o.lines).filter((l): l is string => typeof l === "string"),
        lastText: str(o, "lastText"),
        toolCalls: num(o, "toolCalls") ?? 0,
        startedAt: instant(o, "startedAt"),
        lastEventAt: instant(o, "lastEventAt"),
        finishedAt: instant(o, "finishedAt"),
      },
    ];
  });
}

export function parseScheduled(json: unknown): Scheduled[] {
  return arr(json).flatMap((e): Scheduled[] => {
    const o = obj(e);
    const id = str(o, "id");
    if (!o || !id) return [];
    return [
      {
        id,
        title: str(o, "title") ?? "Tarea",
        prompt: str(o, "prompt") ?? "",
        cron: str(o, "cron") ?? "",
        tz: str(o, "tz") ?? "America/Bogota",
        enabled: bool(o, "enabled") ?? true,
        whenText: str(o, "when"),
        nextRunAt: instant(o, "next_run_at"),
        lastRunAt: instant(o, "last_run_at"),
        lastStatus: str(o, "last_status"),
        lastOutput: str(o, "last_output"),
        machine: str(o, "machine"),
      },
    ];
  });
}

export function parseRuns(json: unknown): Run[] {
  return arr(json).flatMap((e): Run[] => {
    const o = obj(e);
    const id = str(o, "id");
    if (!o || !id) return [];
    return [{ id, startedAt: instant(o, "started_at"), status: str(o, "status") ?? "", output: str(o, "output") }];
  });
}

export function parseMachines(json: unknown): Machine[] {
  return arr(obj(json)?.machines).flatMap((e): Machine[] => {
    const o = obj(e);
    const name = str(o, "machine");
    if (!o || !name) return [];
    return [
      {
        name,
        online: bool(o, "online") ?? false,
        self: bool(o, "self") ?? false,
        canRun: bool(obj(o.capabilities), "runs") ?? false,
        baseUrl: str(o, "baseUrl"),
      },
    ];
  });
}

export function parseApprovals(json: unknown): { approvals: Approval[]; watched: boolean } {
  const o = obj(json);
  if (!o) return { approvals: [], watched: false };
  const approvals = arr(o.approvals).flatMap((e): Approval[] => {
    const a = obj(e);
    const id = str(a, "id");
    if (!a || !id) return [];
    return [
      {
        id,
        workerId: str(a, "workerId"),
        tool: str(a, "tool") ?? "",
        summary: str(a, "summary") ?? str(a, "tool") ?? "Una acción",
        detail: str(a, "detail") ?? "",
        since: instant(a, "since"),
      },
    ];
  });
  return { approvals, watched: bool(o, "watched") ?? false };
}

export function parseCloudAgents(json: unknown): CloudAgent[] {
  return arr(obj(json)?.agents).flatMap((e): CloudAgent[] => {
    const o = obj(e);
    const id = str(o, "id");
    if (!o || !id) return [];
    return [
      {
        id,
        name: str(o, "name") ?? "Agente",
        description: str(o, "description"),
        model: str(o, "model"),
        status: str(o, "status") ?? "none",
        preview: str(o, "preview"),
        updatedAt: instant(o, "updated_at"),
        costUsd: num(o, "cost_usd") ?? 0,
        nextRunAt: instant(o, "next_run_at"),
      },
    ];
  });
}

export function parseCloudChat(json: unknown): CloudChat {
  const o = obj(json);
  if (!o) return { sessionId: null, status: "none", messages: [], steps: [], costUsd: 0 };
  const messages = arr(o.messages).flatMap((e): ChatLine[] => {
    const m = obj(e);
    const id = str(m, "id");
    const text = str(m, "text");
    if (!m || !id || !text) return [];
    return [{ id, fromAgent: str(m, "role") === "agent", text, at: instant(m, "at") ?? 0 }];
  });
  const steps = arr(o.steps).flatMap((e) => {
    const t = str(obj(e), "text");
    return t ? [t] : [];
  });
  return { sessionId: str(o, "session_id"), status: str(o, "status") ?? "none", messages, steps, costUsd: num(o, "cost_usd") ?? 0 };
}

// ── El equipo ────────────────────────────────────────────────────────────

/** El orden de la lista es el de este arreglo: lo que te necesita, primero. */
export const STATUSES = ["NEEDS_YOU", "WORKING", "PROBLEM", "DONE", "ASLEEP", "PAUSED"] as const;
export type Status = (typeof STATUSES)[number];

export type Kind = "HERMES" | "LIVE" | "SCHEDULED" | "CLOUD";

export interface Member {
  id: string;
  name: string;
  kind: Kind;
  /** Dónde vive, en palabras ("Mac mini", "MacBook", "Nube"). Vacío = no se sabe. */
  where: string;
  status: Status;
  /** Lo que se lee bajo el nombre. */
  line: string;
  /** La hora que va a la derecha ("10:18", "Ayer"…); vacía = ninguna. */
  time: string;
  look: Look;
  workerId?: string;
  taskId?: string;
  approvalId?: string;
  cloudId?: string;
  /** Para ordenar dentro de un mismo estado (más reciente / más próximo primero). */
  sortKey: number;
}

/** El estado en palabras (cabecera del detalle, lectores de pantalla). */
export function statusWord(s: Status): string {
  switch (s) {
    case "NEEDS_YOU":
      return "te necesita";
    case "WORKING":
      return "trabajando";
    case "PROBLEM":
      return "con un problema";
    case "DONE":
      return "terminó";
    case "ASLEEP":
      return "dormido";
    case "PAUSED":
      return "en pausa";
  }
}

/**
 * Nombre de la máquina en palabras. El centro (la que está siempre prendida) es
 * la Mac mini, aunque su MACHINE_NAME diga otra cosa.
 *
 * `hub` = nombre del centro. `undefined` = la que contesta (`self`) ES el centro
 * (el caso del teléfono, que siempre le habla al centro). `null` = la que
 * contesta dijo en `/health` que NO es el centro y no se supo cuál es: entonces
 * una máquina ajena se nombra tal cual, sin adivinar si es la Mac mini.
 */
export function machineLabel(name: string, machines: Machine[] | null | undefined, hub?: string | null): string {
  const self = machines?.find((m) => m.self) ?? null;
  const hubName = hub === undefined ? (self?.name ?? null) : hub;
  let n = name;
  if (!n) {
    if (machines?.length === 1 && machines[0].self) n = machines[0].name;
    else return "";
  }
  if (hubName && n === hubName) return "Mac mini";
  if (/mini/i.test(n)) return "Mac mini";
  // Solo se le pone nombre de MacBook a una máquina que sabemos que no es el centro.
  const notHub = hubName !== null || n === self?.name;
  if (/macbook/i.test(n) && notHub) return "MacBook";
  return n;
}

/** La tool del momento en palabras: "Leyendo Team.kt", "Corriendo pnpm test". */
export function toolLine(name: string | null | undefined, target?: string | null): string | null {
  if (!name) return null;
  const trimmed = target?.trim();
  const t = trimmed ? trimmed.slice(trimmed.lastIndexOf("/") + 1).slice(0, 60) : null;
  let verb: string;
  if (name === "Read") verb = "Leyendo";
  else if (name === "Bash") verb = "Corriendo";
  else if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") verb = "Editando";
  else if (name === "Grep" || name === "Glob") verb = "Buscando";
  else if (name === "WebFetch") verb = "Leyendo la web";
  else if (name === "WebSearch") verb = "Buscando en la web";
  else if (name === "Task" || name === "Agent") verb = "Delegando";
  else if (name.startsWith("mcp__")) verb = "Usando " + name.slice(5).split("__")[0];
  else verb = `Usando ${name}`;
  return t && !verb.startsWith("Usando ") && verb !== "Buscando en la web" ? `${verb} ${t}` : verb;
}

export const ZONE = "America/Bogota";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

const formatters = new Map<string, Intl.DateTimeFormat>();

/** La fecha y hora de pared en `zone`, con un número de día comparable. */
function wall(ms: number, zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(ms)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const utcDay = Date.UTC(p.year, p.month - 1, p.day);
  return {
    day: p.day,
    month: p.month,
    hour: p.hour % 24,
    minute: p.minute,
    dayNumber: Math.round(utcDay / 86_400_000),
    weekday: new Date(utcDay).getUTCDay(),
  };
}

const hhmm = (w: { hour: number; minute: number }) => `${w.hour}:${String(w.minute).padStart(2, "0")}`;

/** Hora relativa: hoy "10:18", ayer "Ayer", esta semana "Martes", antes "12 oct". */
export function timeLabel(at: number | null | undefined, now: number, zone: string = ZONE): string {
  if (at == null) return "";
  const d = wall(at, zone);
  const days = wall(now, zone).dayNumber - d.dayNumber;
  if (days === 0) return hhmm(d);
  if (days === 1) return "Ayer";
  if (days >= 2 && days <= 6) {
    const w = WEEKDAYS[d.weekday];
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return `${d.day} ${MONTHS[d.month - 1]}`;
}

/** "Duerme hasta el lunes a las 8:00" desde el próximo turno real. */
export function sleepLine(next: number | null | undefined, now: number, zone: string = ZONE): string | null {
  if (next == null) return null;
  const d = wall(next, zone);
  const days = d.dayNumber - wall(now, zone).dayNumber;
  const hour = hhmm(d);
  if (days === 0) return `Despierta hoy a las ${hour}`;
  if (days === 1) return `Despierta mañana a las ${hour}`;
  return `Duerme hasta el ${WEEKDAYS[d.weekday]} a las ${hour}`;
}

/** Primera línea con texto de un markdown (sin `*`, `#`, `-` de adorno), hasta 140. */
function firstLine(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim().replace(/^[*#\s-]+|[*#\s-]+$/g, "");
    if (l.trim()) return l.slice(0, 140);
  }
  return null;
}

const lastLine = (lines: string[]): string | null => {
  const l = lines.at(-1)?.trim();
  return l ? l : null;
};

export interface BuildOptions {
  /** Personajes elegidos a mano por id de miembro (`task:<id>`, `cloud:<id>`…). */
  looks?: Record<string, Look>;
  now: number;
  zone?: string;
  /** Nombre del centro (ver [machineLabel]); undefined = el que contesta. */
  hub?: string | null;
}

/**
 * Reduce las fuentes a la lista del equipo, ya ordenada. Una corrida viva de
 * una tarea programada se funde con su tarea (no aparece dos veces).
 */
export function build(src: Sources, opts: BuildOptions): Member[] {
  const { looks = {}, now, zone = ZONE, hub } = opts;
  const out: Member[] = [];
  const approvalByWorker = new Map<string | null, Approval>();
  for (const a of src.approvals ?? []) if (!approvalByWorker.has(a.workerId)) approvalByWorker.set(a.workerId, a);
  const usedWorkers = new Set<string>();
  const ctx = { src, looks, now, zone, hub };

  for (const t of src.scheduled ?? []) {
    const live = src.workers?.find(
      (w) => w.source === "scheduled" && w.name.toLowerCase() === t.title.toLowerCase() && w.finishedAt == null,
    );
    if (live) {
      usedWorkers.add(live.id);
      const m = liveMember(live, approvalByWorker.get(live.id) ?? null, ctx);
      out.push({ ...m, id: `task:${t.id}`, name: t.title, kind: "SCHEDULED", taskId: t.id, look: looks[`task:${t.id}`] ?? lookFor(t.id) });
    } else {
      out.push(scheduledMember(t, ctx));
    }
  }
  for (const w of src.workers ?? []) {
    if (!usedWorkers.has(w.id)) out.push(liveMember(w, approvalByWorker.get(w.id) ?? null, ctx));
  }
  for (const a of src.cloud ?? []) out.push(cloudMember(a, ctx));

  const rank = (s: Status) => STATUSES.indexOf(s);
  const key = (m: Member) => (m.status === "ASLEEP" ? -m.sortKey : m.sortKey);
  return out.sort((a, b) => rank(a.status) - rank(b.status) || key(b) - key(a));
}

interface Ctx {
  src: Sources;
  looks: Record<string, Look>;
  now: number;
  zone: string;
  hub: string | null | undefined;
}

function cloudMember(a: CloudAgent, { looks, now, zone }: Ctx): Member {
  const status: Status =
    a.status === "running" || a.status === "rescheduling"
      ? "WORKING"
      : a.status === "none"
        ? "ASLEEP"
        : a.preview != null
          ? "DONE"
          : "ASLEEP";
  const line =
    status === "WORKING"
      ? "Trabajando en la nube…"
      : status === "DONE"
        ? (a.preview ?? "Terminó")
        : (sleepLine(a.nextRunAt, now, zone) ?? "Escríbele para empezar");
  return {
    id: `cloud:${a.id}`,
    name: a.name,
    kind: "CLOUD",
    where: "Nube",
    status,
    line,
    time: timeLabel(a.updatedAt, now, zone),
    look: looks[`cloud:${a.id}`] ?? lookFor(a.id),
    cloudId: a.id,
    sortKey: a.updatedAt ?? a.nextRunAt ?? 0,
  };
}

function scheduledMember(t: Scheduled, { src, looks, now, zone, hub }: Ctx): Member {
  const failed = t.lastStatus != null && t.lastStatus !== "ok" && t.lastStatus !== "running";
  const status: Status = !t.enabled ? "PAUSED" : failed ? "PROBLEM" : "ASLEEP";
  const why = firstLine(t.lastOutput);
  const line =
    status === "PAUSED"
      ? "En pausa"
      : status === "PROBLEM"
        ? "La última corrida falló" + (why ? `: ${why}` : "")
        : (sleepLine(t.nextRunAt, now, zone) ?? t.whenText ?? "Programada");
  return {
    id: `task:${t.id}`,
    name: t.title,
    kind: "SCHEDULED",
    where: machineLabel(t.machine ?? "", src.machines, hub),
    status,
    line,
    time: timeLabel(t.lastRunAt, now, zone),
    look: looks[`task:${t.id}`] ?? lookFor(t.id),
    taskId: t.id,
    sortKey: t.nextRunAt ?? t.lastRunAt ?? 0,
  };
}

function liveMember(w: Worker, approval: Approval | null, { src, looks, now, zone, hub }: Ctx): Member {
  const status: Status =
    approval != null || w.status === "needs_you"
      ? "NEEDS_YOU"
      : w.status === "blocked" || w.status === "error"
        ? "PROBLEM"
        : w.status === "done"
          ? "DONE"
          : "WORKING";
  const line =
    status === "NEEDS_YOU"
      ? approval
        ? `¿Puedo? ${approval.summary}`
        : "Te está esperando"
      : status === "PROBLEM"
        ? (lastLine(w.lines) ?? "Algo salió mal")
        : status === "DONE"
          ? (firstLine(w.lastText) ?? "Terminó")
          : (toolLine(w.toolName, w.toolTarget) ?? lastLine(w.lines) ?? "Pensando…");
  const at = w.finishedAt ?? w.lastEventAt ?? w.startedAt;
  return {
    id: `run:${w.id}`,
    name: w.name,
    kind: "LIVE",
    where: machineLabel(w.machine, src.machines, hub),
    status,
    line,
    time: timeLabel(at, now, zone),
    look: looks[`run:${w.id}`] ?? lookFor(w.id),
    workerId: w.id,
    approvalId: approval?.id,
    sortKey: at ?? 0,
  };
}

/** El resumen de la cabecera: "1 trabajando · 1 te necesita · 3 en espera". */
export function headline(members: Member[]): string {
  const count = (...s: Status[]) => members.filter((m) => s.includes(m.status)).length;
  const parts: string[] = [];
  const working = count("WORKING");
  const needs = count("NEEDS_YOU");
  const problem = count("PROBLEM");
  const waiting = count("ASLEEP", "PAUSED", "DONE");
  if (working > 0) parts.push(`${working} trabajando`);
  if (needs > 0) parts.push(`${needs} te necesita${needs > 1 ? "n" : ""}`);
  if (problem > 0) parts.push(`${problem} con problema${problem > 1 ? "s" : ""}`);
  if (waiting > 0) parts.push(`${waiting} en espera`);
  return parts.length ? parts.join(" · ") : "Nadie trabajando ahora";
}

/**
 * Por qué faltan los agentes de la nube (la Mac contestó, `/cloud/agents` no).
 * 404 = la Mac corre un Hermes sin agentes en la nube; lo demás = no contestó.
 */
export function cloudIssue(httpStatus: number | null): string {
  return httpStatus === 404
    ? "Tus agentes en la nube no aparecen: el Hermes de tu Mac todavía no los trae. Actualízalo y vuelven."
    : "Tus agentes en la nube no respondieron. Vuelvo a intentar en unos segundos.";
}
