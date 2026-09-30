// Aprobaciones de la Oficina: un agente que va a hacer algo con efectos (un
// comando que no es de solo lectura) levanta la mano y espera a que el humano
// decida. Puro: qué pide permiso, cómo se describe y qué mensaje recibe el
// modelo. El agente (office/approvals.ts) guarda las solicitudes vivas y la
// web las pinta.
//
// Regla: solo se pregunta cuando alguien está mirando la Oficina. Sin nadie,
// cada ruta se comporta como siempre (el SDK decide con el guardrail; claude -p
// niega lo que pediría permiso), así una tarea por voz a las 3 a. m. no se
// queda colgada esperando a un humano que no está.

// ── Modos de permisos (los mismos de Claude Code) ────────────────────────
// Verificado contra el CLI 2.1.285 en -p con el puente de aprobaciones:
// - auto: el clasificador del CLI decide; lo riesgoso lo NIEGA solo (no
//   pregunta). Solo con Sonnet/Opus: con Haiku el CLI arranca en "default".
// - acceptEdits: edita sin preguntar; los comandos que no están permitidos
//   en settings preguntan.
// - plan: solo lee; al terminar llama ExitPlanMode, que SÍ pregunta → el
//   agente levanta la mano con su plan. Aprobado, sigue en el mismo run.
// - manual: pregunta cada edición y cada comando no permitido.

export type OfficeMode = "auto" | "acceptEdits" | "plan" | "manual";

export const OFFICE_MODES: ReadonlyArray<{ value: OfficeMode; label: string; hint: string }> = [
  { value: "auto", label: "Auto", hint: "Claude decide qué es seguro; lo riesgoso lo niega solo" },
  { value: "acceptEdits", label: "Editar", hint: "Edita sin preguntar; los comandos te piden permiso" },
  { value: "plan", label: "Plan", hint: "Solo lee y te propone un plan; al aprobarlo lo ejecuta" },
  { value: "manual", label: "Preguntar", hint: "Te pide permiso para cada edición y cada comando" },
];

export const DEFAULT_OFFICE_MODE: OfficeMode = "auto";

export function isOfficeMode(v: unknown): v is OfficeMode {
  return typeof v === "string" && OFFICE_MODES.some((m) => m.value === v);
}

export function officeModeLabel(mode: OfficeMode): string {
  return OFFICE_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** Siguiente modo, como Shift+Tab en Claude Code. */
export function nextOfficeMode(mode: OfficeMode): OfficeMode {
  const i = OFFICE_MODES.findIndex((m) => m.value === mode);
  return OFFICE_MODES[(i + 1) % OFFICE_MODES.length].value;
}

/**
 * El modo que REPORTA el CLI (init o cambio de estado) → el de la oficina.
 * "default" es el nombre viejo de "manual". bypassPermissions/dontAsk no se
 * ofrecen en la oficina: se devuelven como undefined (no se inventa etiqueta).
 */
export function officeModeFromCli(mode: unknown): OfficeMode | undefined {
  if (mode === "default") return "manual";
  return isOfficeMode(mode) ? mode : undefined;
}

/** El agente en modo plan presenta su plan con esta tool: aprobarla = ejecutarlo. */
export const PLAN_TOOL = "ExitPlanMode";

/** Tiempo máximo que un agente espera tu decisión antes de negarse solo. */
export const APPROVAL_TIMEOUT_MS = 10 * 60_000;

export interface OfficeApproval {
  id: string;
  /** Nombre de la tool tal cual ("Bash", "Edit", "mcp__linear__save_issue"). */
  tool: string;
  /** Una línea: "git commit -m \"arregla el login\"". */
  summary: string;
  /** El dato completo que se aprueba (comando entero, ruta), recortado a DETAIL_MAX. */
  detail: string;
  since: string;
  expiresAt: string;
}

export type ApprovalDecision =
  | {
      behavior: "allow";
      updatedInput: Record<string, unknown>;
      /** Cambiar el modo de la sesión al aprobar (el plan aprobado sigue en Auto). */
      updatedPermissions?: Array<{ type: "setMode"; mode: OfficeMode; destination: "session" }>;
    }
  | { behavior: "deny"; message: string };

/** Cómo se cerró la solicitud: lo que ve el humano en la laptop del personaje. */
export type ApprovalOutcome = "allowed" | "denied" | "plan-changes" | "timeout" | "gone";

const DETAIL_MAX = 600;
/** Un plan se lee entero en el panel: cabe mucho más que un comando. */
const PLAN_MAX = 8000;
const SUMMARY_MAX = 90;

// Comandos que solo leen. Todo lo que no se reconoce PIDE permiso: equivocarse
// preguntando de más es barato; equivocarse dejando pasar algo no.
const READ_ONLY = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "pwd", "echo", "printf", "which", "file",
  "stat", "du", "df", "date", "tree", "sort", "uniq", "cut", "jq", "basename", "dirname",
  "realpath", "true", "cd", "type",
]);
// Fuera a propósito: `env` (con argumentos EJECUTA otro comando), `awk` (tiene
// system()), `xargs` (ejecuta lo que le llegue).
const GIT_READ_ONLY = new Set([
  "status", "log", "diff", "show", "rev-parse", "ls-files", "blame", "shortlog", "describe",
]);
const VERSION_FLAGS = /^(-v|--version|-V)$/;

/** Parte un comando en sus segmentos (&&, ||, ;, |). No es un parser de shell: ante la duda, pide permiso. */
function segments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function segmentReadOnly(seg: string): boolean {
  const words = seg.split(/\s+/);
  // Variables de entorno al frente (FOO=1 cmd) no cambian qué hace el comando.
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  const [cmd, sub, ...rest] = words;
  if (!cmd) return true;
  if (cmd === "git") {
    if (sub === "branch") return rest.every((a) => !/^-[dDmMcC]/.test(a)) && rest.every((a) => a.startsWith("-"));
    if (sub === "remote") return rest.every((a) => a === "-v");
    return !!sub && GIT_READ_ONLY.has(sub);
  }
  if (cmd === "sed") return !words.some((a) => a === "-i" || a.startsWith("-i") || a === "--in-place");
  if (cmd === "find") return !words.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fls)/.test(a));
  if (sub && VERSION_FLAGS.test(sub) && rest.length === 0) return true;
  return READ_ONLY.has(cmd);
}

/**
 * ¿Este comando de Bash solo lee? Redirigir a un archivo (`>` o `>>`, salvo a
 * /dev/null o entre descriptores) ya es escribir, aunque el comando lea.
 */
export function isReadOnlyBash(command: string): boolean {
  const c = command.trim();
  if (!c) return true;
  // Sustituciones de comando: lo que corre adentro no se ve desde aquí.
  if (/\$\(|`/.test(c)) return false;
  const redirects = c.replace(/\d?>&\d/g, "").replace(/\d?>>?\s*\/dev\/null/g, "");
  if (/>/.test(redirects)) return false;
  return segments(c).every(segmentReadOnly);
}

/**
 * ¿Hay que preguntarle al humano? Bash de solo lectura pasa; cualquier otra
 * tool que llegue aquí (Bash con efectos, ediciones en modo "default", MCPs sin
 * permiso) pregunta.
 */
export function needsApproval(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "Bash") return !isReadOnlyBash(String(input.command ?? ""));
  return true;
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Qué se muestra en la tarjeta: la acción exacta, no una paráfrasis del modelo. */
export function describeApproval(tool: string, input: Record<string, unknown>): { summary: string; detail: string } {
  if (tool === PLAN_TOOL) {
    const plan = String(input.plan ?? "").trim();
    // Título del plan: el primer encabezado o la primera línea con texto, sin "Plan:" de relleno.
    const first = plan.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
    const title = first.replace(/^plan\s*[:·-]?\s*/i, "") || "sin título";
    return {
      summary: clip(`Plan: ${title}`, SUMMARY_MAX),
      detail: plan.length > PLAN_MAX ? `${plan.slice(0, PLAN_MAX - 1)}…` : plan || "(el agente no escribió el plan)",
    };
  }
  let detail: string;
  if (tool === "Bash") detail = String(input.command ?? "");
  else if (typeof input.file_path === "string") detail = `${tool} ${input.file_path}`;
  else if (typeof input.notebook_path === "string") detail = `${tool} ${input.notebook_path}`;
  else if (typeof input.url === "string") detail = `${tool} ${input.url}`;
  else {
    const short = tool.replace(/^mcp__.+?__/, "");
    const json = JSON.stringify(input);
    detail = json && json !== "{}" ? `${short} ${json}` : short;
  }
  const raw = detail.trim() || tool;
  return { summary: clip(raw, SUMMARY_MAX), detail: raw.length > DETAIL_MAX ? `${raw.slice(0, DETAIL_MAX - 1)}…` : raw };
}

/**
 * Lo que recibe el MODELO cuando no se aprueba: le dice por qué, para que cambie de plan en vez de reintentar igual. */
export function denialMessage(outcome: Exclude<ApprovalOutcome, "allowed">, note?: string): string {
  const extra = note?.trim() ? ` Indicación del humano: ${note.trim()}` : "";
  switch (outcome) {
    case "denied":
      return `El humano NEGÓ esta acción desde la Oficina. No la repitas igual: explica qué ibas a hacer o sigue por otro camino.${extra}`;
    case "plan-changes":
      return `El humano NO aprobó el plan todavía: sigue en modo plan, ajústalo y vuelve a presentarlo.${extra}`;
    case "timeout":
      return `Nadie respondió en ${Math.round(APPROVAL_TIMEOUT_MS / 60_000)} minutos, así que la acción se negó sola. No la reintentes: deja listo lo demás y di qué quedó pendiente de aprobar.`;
    case "gone":
      return "La solicitud de permiso se cerró (el agente o el run se reinició). No se ejecutó.";
  }
}

/** Un plan terminado sin nadie en la Oficina (la consola en modo plan): se presenta y el run termina ahí. */
export const PLAN_PRESENTED =
  "Tu plan quedó presentado y el humano lo revisará. No lo ejecutes: termina aquí con un resumen corto del plan.";

/** Sin nadie mirando la Oficina: el run de claude -p se niega como antes, pero diciendo por qué. */
export const NOBODY_WATCHING =
  "Esta acción necesita permiso y nadie está en la Oficina para darlo. No se ejecutó: deja el resto listo y di qué comando quedó pendiente.";
