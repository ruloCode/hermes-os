// Traza del loop de un agente (Oficina en tarima): cada evento del loop tal
// como pasó — qué lee, qué tool llama, qué le devuelve, dónde se equivoca y
// cómo se corrige. Puro: el agente lo alimenta con los mensajes del Agent SDK o
// con el stream-json crudo de `claude -p` (tienen la MISMA forma: system/init,
// assistant con bloques, user con tool_result, result) y los tests con trazas
// sintéticas. La UI usa el mismo reductor en vivo y en la repetición.
//
// Regla: nada se inventa. Lo que el modelo no expone (el razonamiento oculto,
// el prompt base de Claude Code) se dice que no existe; un campo recortado lo
// dice con su tamaño original.

import type { RunTokenUsage } from "./types.js";
import { outputFailed, toolAction } from "./office-actions.js";
import { parseModelUsage, tokensFromApiUsage, totalTokens, type SpendModel } from "./office-spend.js";

export type TraceKind =
  | "init"
  | "thinking"
  | "text"
  | "tool_use"
  | "tool_result"
  | "permission"
  | "guardrail"
  | "error"
  | "result"
  | "usage";

/** Quién decidió un permiso (o lo negó). */
export type TraceDecider = "human" | "guardrail" | "auto-mode" | "settings" | "timeout" | "nobody" | "chrome" | "mode";

export interface TraceInit {
  source: "sdk" | "cli";
  model?: string;
  permissionMode?: string;
  cwd?: string;
  version?: string;
  outputStyle?: string;
  apiKeySource?: string;
  tools: string[];
  mcpServers: { name: string; status: string; source?: string }[];
  skills: string[];
  slashCommands: string[];
  plugins: { name: string; path?: string }[];
}

export interface TraceEvent {
  seq: number;
  /** Epoch ms en que el agente lo recibió. */
  t: number;
  /** Vuelta del loop: una llamada al modelo (un message.id del asistente). 0 = antes de la primera. */
  turn: number;
  kind: TraceKind;
  /** Nombre real de la tool (`mcp__hermes__search_knowledge`, `Bash`…). */
  tool?: string;
  /** id del tool_use (empareja tool_use ↔ tool_result ↔ permiso). */
  id?: string;
  /** tool_use: el input en JSON. */
  input?: string;
  /** tool_result: lo que la tool le devolvió al modelo. */
  output?: string;
  /** text, thinking, error, permiso (motivo o nota), result (texto final). */
  text?: string;
  /** Campos recortados al tope (TRACE_FIELD_MAX) con su tamaño original. */
  cut?: { input?: number; output?: number; text?: number };
  isError?: boolean;
  durationMs?: number;
  /** Tokens de ESA vuelta (en el primer evento de la vuelta) o del run entero (result). */
  tokens?: RunTokenUsage;
  decision?: "asked" | "allowed" | "denied";
  by?: TraceDecider;
  init?: TraceInit;
  costUsd?: number;
  numTurns?: number;
  models?: SpendModel[];
}

/** Tope por campo: ~20 KB. Lo que pase se corta y queda marcado con su tamaño. */
export const TRACE_FIELD_MAX = 20_000;

export function capField(s: string, max = TRACE_FIELD_MAX): { value: string; cut?: number } {
  return s.length > max ? { value: s.slice(0, max), cut: s.length } : { value: s };
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** El contenido de un tool_result: string o bloques (texto e imágenes). */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return str(content);
  return content
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      if (o.type === "text" && typeof o.text === "string") return o.text;
      if (o.type === "image") return "[imagen]";
      return str(o);
    })
    .join("\n");
}

// "…denied by the Claude Code auto mode classifier. Reason: [Data Exfiltration]…"
const AUTO_DENIED = /denied by the Claude Code auto mode classifier\.?(?:\s*Reason:\s*\[([^\]]+)\])?/i;
// Reglas deny de --settings (claude-settings.json) o del usuario.
const SETTINGS_DENIED = /Permission to use .+ has been denied|matches a deny rule|denied by (?:your )?(?:permission )?settings/i;

/** Si un tool_result es una negación que no vino de Hermes (modo Auto o reglas del CLI), quién la negó. */
export function deniedBy(output: string): { by: TraceDecider; reason: string } | null {
  const auto = AUTO_DENIED.exec(output);
  if (auto) return { by: "auto-mode", reason: auto[1] ? `El modo Auto lo negó: ${auto[1]}` : "El modo Auto lo negó" };
  if (SETTINGS_DENIED.test(output)) return { by: "settings", reason: "Una regla deny del CLI lo negó" };
  return null;
}

/**
 * Convierte mensajes crudos en eventos de traza. Una instancia por run. Sin IO:
 * quien la usa decide dónde se guarda y a quién se publica.
 */
export class TraceRecorder {
  private seq = 0;
  private turn = 0;
  private readonly seenMessages = new Set<string>();
  private readonly uses = new Map<string, { t: number; tool: string }>();
  readonly source: "sdk" | "cli";

  constructor(source: "sdk" | "cli", startSeq = 0) {
    this.source = source;
    this.seq = startSeq;
  }

  get currentTurn(): number {
    return this.turn;
  }

  private make(kind: TraceKind, now: number, extra: Partial<TraceEvent> = {}): TraceEvent {
    this.seq += 1;
    return { seq: this.seq, t: now, turn: this.turn, kind, ...extra };
  }

  private withText(ev: TraceEvent, field: "input" | "output" | "text", value: string): TraceEvent {
    const c = capField(value);
    ev[field] = c.value;
    if (c.cut) ev.cut = { ...ev.cut, [field]: c.cut };
    return ev;
  }

  /** Un mensaje del SDK o una línea del stream-json del CLI (ya parseada). */
  ingest(raw: unknown, now = Date.now()): TraceEvent[] {
    const m = (raw ?? {}) as Record<string, any>;
    const out: TraceEvent[] = [];
    if (m.type === "system") {
      if (m.subtype === "init") {
        const init: TraceInit = {
          source: this.source,
          model: typeof m.model === "string" ? m.model : undefined,
          permissionMode: typeof m.permissionMode === "string" ? m.permissionMode : undefined,
          cwd: typeof m.cwd === "string" ? m.cwd : undefined,
          version: typeof m.claude_code_version === "string" ? m.claude_code_version : undefined,
          outputStyle: typeof m.output_style === "string" ? m.output_style : undefined,
          apiKeySource: typeof m.apiKeySource === "string" ? m.apiKeySource : undefined,
          tools: Array.isArray(m.tools) ? m.tools.filter((x: unknown) => typeof x === "string") : [],
          mcpServers: Array.isArray(m.mcp_servers)
            ? m.mcp_servers.map((s: any) => ({ name: String(s?.name ?? ""), status: String(s?.status ?? ""), ...(s?.source ? { source: String(s.source) } : {}) }))
            : [],
          skills: Array.isArray(m.skills) ? m.skills.filter((x: unknown) => typeof x === "string") : [],
          slashCommands: Array.isArray(m.slash_commands) ? m.slash_commands.filter((x: unknown) => typeof x === "string") : [],
          plugins: Array.isArray(m.plugins) ? m.plugins.map((p: any) => ({ name: String(p?.name ?? ""), ...(p?.path ? { path: String(p.path) } : {}) })) : [],
        };
        out.push(this.make("init", now, { init }));
      } else if (m.subtype === "status" && typeof m.permissionMode === "string") {
        // El modo cambió (un plan aprobado pasa a auto): es un permiso que se movió, no texto del modelo.
        out.push(this.make("permission", now, { by: "mode", decision: "allowed", text: `La sesión pasó al modo ${m.permissionMode}` }));
      }
      return out;
    }

    if (m.type === "assistant") {
      const msg = (m.message ?? {}) as Record<string, any>;
      const id = typeof msg.id === "string" ? msg.id : undefined;
      let tokens: RunTokenUsage | undefined;
      if (!id || !this.seenMessages.has(id)) {
        if (id) this.seenMessages.add(id);
        this.turn += 1;
        tokens = tokensFromApiUsage(msg.usage) ?? undefined;
      }
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const block of content) {
        const b = (block ?? {}) as Record<string, any>;
        let ev: TraceEvent | null = null;
        if (b.type === "text" && typeof b.text === "string" && b.text) {
          ev = this.withText(this.make("text", now), "text", b.text);
        } else if (b.type === "thinking") {
          // Con razonamiento resumido u oculto el bloque llega vacío: se dice, no se rellena.
          ev = this.withText(this.make("thinking", now), "text", typeof b.thinking === "string" ? b.thinking : "");
        } else if (b.type === "redacted_thinking") {
          ev = this.make("thinking", now, { text: "" });
        } else if (b.type === "tool_use") {
          const tool = String(b.name ?? "tool");
          const useId = typeof b.id === "string" ? b.id : undefined;
          ev = this.withText(this.make("tool_use", now, { tool, id: useId }), "input", str(b.input ?? {}));
          if (useId) this.uses.set(useId, { t: now, tool });
        }
        if (!ev) continue;
        if (tokens) {
          ev.tokens = tokens;
          tokens = undefined;
        }
        out.push(ev);
      }
      // Una vuelta sin bloques útiles igual cuenta sus tokens (p. ej. solo razonamiento vacío).
      if (tokens) out.push(this.make("usage", now, { tokens }));
      return out;
    }

    if (m.type === "user") {
      const content = Array.isArray(m.message?.content) ? m.message.content : [];
      for (const block of content) {
        const b = (block ?? {}) as Record<string, any>;
        if (b.type !== "tool_result") continue;
        const useId = typeof b.tool_use_id === "string" ? b.tool_use_id : undefined;
        const use = useId ? this.uses.get(useId) : undefined;
        const output = toolResultText(b.content);
        const denied = deniedBy(output);
        if (denied) {
          out.push(this.make("permission", now, { tool: use?.tool, id: useId, decision: "denied", by: denied.by, text: denied.reason }));
        }
        const ev = this.withText(
          this.make("tool_result", now, {
            tool: use?.tool,
            id: useId,
            isError: b.is_error === true || !!denied,
            durationMs: use ? Math.max(0, now - use.t) : undefined,
          }),
          "output",
          output,
        );
        out.push(ev);
      }
      return out;
    }

    if (m.type === "result") {
      const isError = m.is_error === true || (typeof m.subtype === "string" && m.subtype !== "success");
      const ev = this.make("result", now, {
        isError,
        durationMs: typeof m.duration_ms === "number" ? m.duration_ms : undefined,
        numTurns: typeof m.num_turns === "number" ? m.num_turns : undefined,
        costUsd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : undefined,
        tokens: tokensFromApiUsage(m.usage) ?? undefined,
      });
      const text = typeof m.result === "string" ? m.result : isError ? `Terminó con error (${String(m.subtype ?? "error")})` : "";
      if (text) this.withText(ev, "text", text);
      out.push(ev);
      const models = parseModelUsage(m.modelUsage);
      if (models.length) out.push(this.make("usage", now, { models }));
      return out;
    }
    return out;
  }

  /** Un permiso que pasó por Hermes (aprobación de la Oficina, Chrome CDP…). */
  permission(p: { tool?: string; decision: "asked" | "allowed" | "denied"; by: TraceDecider; text?: string; input?: string }, now = Date.now()): TraceEvent {
    const ev = this.make("permission", now, { tool: p.tool, decision: p.decision, by: p.by });
    if (p.text) this.withText(ev, "text", p.text);
    if (p.input) this.withText(ev, "input", p.input);
    return ev;
  }

  /** El guardrail de Hermes (guardrails.ts) negó una tool antes de ejecutarla. */
  guardrail(tool: string, reason: string, input?: string, now = Date.now()): TraceEvent {
    const ev = this.make("guardrail", now, { tool, decision: "denied", by: "guardrail", isError: true });
    this.withText(ev, "text", reason);
    if (input) this.withText(ev, "input", input);
    return ev;
  }

  /** Un fallo del loop (excepción del SDK, el proceso del CLI murió, stderr). */
  error(text: string, now = Date.now()): TraceEvent {
    return this.withText(this.make("error", now, { isError: true }), "text", text);
  }
}

// ── Reductor: pasos, errores y correcciones ─────────────────────────────

export interface TraceStep {
  /** Número de paso (1 = la primera tool del run). */
  n: number;
  useSeq: number;
  resultSeq?: number;
  tool: string;
  input: Record<string, unknown>;
  goal: string;
  turn: number;
  durationMs?: number;
  /** undefined = sigue corriendo. */
  ok?: boolean;
  denied?: TraceDecider;
}

export interface TraceError {
  /** Evento a señalar (el resultado fallido, el permiso negado o el error del loop). */
  seq: number;
  /** Paso de la tool que falló (si fue una tool). */
  step?: number;
  tool?: string;
  text: string;
  /** Paso que lo corrigió: el primero que funciona después, con el mismo objetivo (o, si no, la misma tool). */
  fixedBy?: { step: number; seq: number };
}

export interface ReducedTrace {
  events: TraceEvent[];
  steps: TraceStep[];
  errors: TraceError[];
  turns: number;
  toolCalls: number;
  /** Pasos en curso (tool_use sin resultado). */
  inFlight: TraceStep[];
  /** Uso por tool: los pasos donde aparece. */
  byTool: Record<string, number[]>;
  tokens: RunTokenUsage | null;
  costUsd?: number;
  durationMs: number;
  done: boolean;
  isError: boolean;
  init?: TraceInit;
}

function parseInput(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * El "objetivo" de un paso, para saber si un paso posterior es el mismo intento
 * corregido: el archivo para las tools de archivo, el patrón para buscar y las
 * dos primeras palabras del comando para Bash ("pnpm test", "git status").
 */
export function stepGoal(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");
  if (tool === "Bash") {
    // El primer comando que no sea un `cd`: "cd repo; CI=1 pnpm test --x" → "pnpm test".
    const segs = s("command").split(/&&|\|\||;|\|/).map((x) => x.trim()).filter(Boolean);
    const seg = segs.find((x) => !/^cd(\s|$)/.test(x)) ?? segs[0] ?? "";
    const words = seg.split(/\s+/).filter((w) => w && !/^[A-Z_][A-Z0-9_]*=/.test(w));
    return `bash:${words.slice(0, 2).join(" ")}`;
  }
  const file = s("file_path") || s("notebook_path");
  if (file) return `file:${file}`;
  if (s("pattern")) return `pattern:${s("pattern")}`;
  if (s("url")) return `url:${s("url")}`;
  if (s("query")) return `query:${s("query")}`;
  return `tool:${tool}`;
}

function tokensSum(a: RunTokenUsage | null, b: RunTokenUsage): RunTokenUsage {
  if (!a) return { ...b };
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export function reduceTrace(input: readonly TraceEvent[]): ReducedTrace {
  const events = [...input].sort((a, b) => a.seq - b.seq);
  const steps: TraceStep[] = [];
  const byUseId = new Map<string, TraceStep>();
  const errors: TraceError[] = [];
  const byTool: Record<string, number[]> = {};
  let turns = 0;
  let tokens: RunTokenUsage | null = null;
  let resultTokens: RunTokenUsage | null = null;
  let costUsd: number | undefined;
  let done = false;
  let isError = false;
  let init: TraceInit | undefined;
  const deniedIds = new Map<string, TraceDecider>();

  for (const ev of events) {
    turns = Math.max(turns, ev.turn);
    if (ev.kind === "init" && ev.init && !init) init = ev.init;
    if (ev.tokens && ev.kind !== "result") tokens = tokensSum(tokens, ev.tokens);
    if (ev.kind === "tool_use") {
      const inp = parseInput(ev.input);
      const step: TraceStep = { n: steps.length + 1, useSeq: ev.seq, tool: ev.tool ?? "tool", input: inp, goal: stepGoal(ev.tool ?? "tool", inp), turn: ev.turn };
      steps.push(step);
      if (ev.id) byUseId.set(ev.id, step);
      (byTool[step.tool] ??= []).push(step.n);
    } else if (ev.kind === "permission" && ev.decision === "denied") {
      if (ev.id) deniedIds.set(ev.id, ev.by ?? "human");
      // Un permiso negado sin tool_use emparejado (p. ej. Chrome caído) igual es un error del paso en curso.
    } else if (ev.kind === "guardrail") {
      // El guardrail niega ANTES de ejecutar: el tool_result que sigue trae is_error. Se marca el último paso de esa tool sin resultado.
      const step = [...steps].reverse().find((s) => s.tool === ev.tool && s.resultSeq === undefined);
      if (step) step.denied = "guardrail";
    } else if (ev.kind === "tool_result") {
      const step = ev.id ? byUseId.get(ev.id) : undefined;
      const out = ev.output ?? "";
      const testFailed = !!step && toolAction(step.tool, step.input) === "test" && outputFailed(out);
      const failed = ev.isError === true || testFailed;
      if (step) {
        step.resultSeq = ev.seq;
        step.durationMs = ev.durationMs;
        step.ok = !failed;
        const d = ev.id ? deniedIds.get(ev.id) : undefined;
        if (d) step.denied = d;
      }
      if (failed) {
        errors.push({
          seq: ev.seq,
          step: step?.n,
          tool: step?.tool ?? ev.tool,
          text: errorLine(out) || "La tool devolvió un error",
        });
      }
    } else if (ev.kind === "error" && ev.isError !== false) {
      errors.push({ seq: ev.seq, text: firstLine(ev.text ?? "") || "Error del loop" });
    } else if (ev.kind === "result") {
      done = true;
      isError = ev.isError === true;
      if (ev.tokens) resultTokens = ev.tokens;
      if (typeof ev.costUsd === "number") costUsd = ev.costUsd;
    }
  }

  // Correcciones: el primer paso posterior que funciona con la misma tool y el mismo
  // objetivo; si no hay, con el mismo objetivo; si no, con la misma tool (y en Bash,
  // el mismo programa). Un Edit que falló lo corrige el Edit que funcionó, no el Read de en medio.
  for (const err of errors) {
    if (!err.step) continue;
    const failed = steps[err.step - 1];
    const later = steps.slice(err.step).filter((s) => s.ok === true);
    const program = (g: string) => g.replace(/^bash:/, "").split(" ")[0];
    // Un paso NEGADO (guardrail, regla deny, modo Auto, el humano) obliga a reformular: la
    // corrección es el siguiente intento que funciona con la misma tool, aunque cambie el comando.
    const fix =
      (failed.denied ? later.find((s) => s.tool === failed.tool) : undefined) ??
      later.find((s) => s.tool === failed.tool && s.goal === failed.goal) ??
      later.find((s) => s.goal === failed.goal) ??
      later.find((s) => s.tool === failed.tool && (failed.tool !== "Bash" || program(s.goal) === program(failed.goal)));
    if (fix) err.fixedBy = { step: fix.n, seq: fix.resultSeq ?? fix.useSeq };
  }

  const first = events[0]?.t ?? 0;
  const last = events[events.length - 1]?.t ?? first;
  const resultEv = events.find((e) => e.kind === "result");
  return {
    events,
    steps,
    errors,
    turns,
    toolCalls: steps.length,
    inFlight: steps.filter((s) => s.ok === undefined),
    byTool,
    tokens: resultTokens ?? tokens,
    costUsd,
    durationMs: resultEv?.durationMs ?? Math.max(0, last - first),
    done,
    isError,
    init,
  };
}

/** La línea que dice qué falló (fail, error, ✖, not ok, Exit code…), o la primera con texto. */
function errorLine(s: string): string {
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit =
    lines.find((l) => /^not ok\b|✖|✗/.test(l)) ??
    lines.find((l) => /\bfail(ed|ing|ure)?\b/i.test(l) && !/^#\s*fail\s+0\b|failureType/i.test(l)) ??
    lines.find((l) => /\b(error|exit code|denied|cannot|no such)\b/i.test(l) && !/^error:\s*\|-?$/i.test(l));
  return (hit ?? lines[0] ?? "").replace(/<\/?tool_use_error>/g, "").slice(0, 200);
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.trim().slice(0, 200);
}

const ORDINAL = ["", "1.º", "2.º", "3.º", "4.º", "5.º", "6.º", "7.º", "8.º", "9.º", "10.º"];
const ord = (n: number) => ORDINAL[n] ?? `${n}.º`;

function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * El resumen al cerrar, solo con datos de la traza:
 * "4 vueltas · 11 tools · 2 errores, el 2.º corregido en el paso 7 · 38 s · 12k tokens".
 */
export function traceSummary(r: ReducedTrace): string {
  const parts: string[] = [];
  parts.push(`${r.turns} ${r.turns === 1 ? "vuelta" : "vueltas"}`);
  parts.push(`${r.toolCalls} ${r.toolCalls === 1 ? "tool" : "tools"}`);
  const n = r.errors.length;
  if (n === 0) parts.push("sin errores");
  else {
    const fixed = r.errors.map((e, i) => ({ i: i + 1, e })).filter((x) => x.e.fixedBy);
    let s = `${n} ${n === 1 ? "error" : "errores"}`;
    if (n === 1) s += fixed.length ? `, corregido en el paso ${fixed[0].e.fixedBy!.step}` : ", sin corregir";
    else if (fixed.length === n) s += `, ${n === 2 ? "ambos" : "todos"} corregidos (pasos ${[...new Set(fixed.map((x) => x.e.fixedBy!.step))].sort((a, b) => a - b).join(" y ")})`;
    else if (fixed.length) s += `, ${fixed.map((x) => `el ${ord(x.i)} corregido en el paso ${x.e.fixedBy!.step}`).join(" y ")}`;
    else s += ", ninguno corregido";
    parts.push(s);
  }
  parts.push(`${Math.round(r.durationMs / 1000)} s`);
  if (r.tokens) parts.push(`${compactTokens(totalTokens(r.tokens))} tokens`);
  return parts.join(" · ");
}

// ── Cómo se lee un paso en pantalla ─────────────────────────────────────

export interface StepLabel {
  /** "Lee", "Busca", "Ejecuta", "Llama"… */
  verb: string;
  /** Lo que tocó (ruta, patrón, comando, nombre de la tool). */
  target: string;
  /** Detalle chico ("líneas 10–80", "en src/"). */
  extra?: string;
}

export function describeStep(tool: string, input: Record<string, unknown>): StepLabel {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const n = (k: string) => (typeof input[k] === "number" ? (input[k] as number) : undefined);
  switch (tool) {
    case "Read": {
      const off = n("offset");
      const lim = n("limit");
      const extra = off !== undefined || lim !== undefined ? `líneas ${(off ?? 0) + 1}–${lim !== undefined ? (off ?? 0) + lim : "fin"}` : undefined;
      return { verb: "Lee", target: s("file_path"), extra };
    }
    case "Write":
      return { verb: "Escribe", target: s("file_path") };
    case "Edit":
    case "MultiEdit":
      return { verb: "Edita", target: s("file_path") };
    case "NotebookEdit":
      return { verb: "Edita", target: s("notebook_path") };
    case "Grep":
      return { verb: "Busca", target: s("pattern"), extra: s("path") ? `en ${s("path")}` : s("glob") ? `en ${s("glob")}` : "en el repo" };
    case "Glob":
      return { verb: "Busca archivos", target: s("pattern"), extra: s("path") ? `en ${s("path")}` : undefined };
    case "Bash":
      return { verb: "Ejecuta", target: s("command").split("\n")[0] };
    case "WebFetch":
      return { verb: "Abre", target: s("url") };
    case "WebSearch":
      return { verb: "Busca en la web", target: s("query") };
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? input.todos.length : 0;
      return { verb: "Actualiza su lista de tareas", target: todos ? `${todos} tareas` : "" };
    }
    case "Task":
    case "Agent":
      return { verb: "Delega a un subagente", target: s("description") || s("subagent_type") };
    case "Skill":
      return { verb: "Carga la skill", target: s("skill") || s("command") || s("name") };
    case "ExitPlanMode":
      return { verb: "Propone un plan", target: "" };
    case "ToolSearch":
      return { verb: "Busca tools", target: s("query") };
  }
  if (tool.startsWith("mcp__")) {
    const keys = ["query", "slug", "title", "name", "url", "pattern", "project", "action", "prompt"];
    const target = keys.map(s).find(Boolean) ?? "";
    return { verb: "Llama", target: tool, extra: target ? target.slice(0, 120) : undefined };
  }
  const target = ["file_path", "pattern", "url", "command", "query"].map(s).find(Boolean) ?? "";
  return { verb: "Usa", target: tool, extra: target || undefined };
}

// ── El system prompt tal como se envió, por secciones ───────────────────

export interface PromptSection {
  id: string;
  title: string;
  /** Por qué existe y por qué quedó así (escrito junto a la sección en system-prompt.ts); null = sin motivo escrito. */
  why: string | null;
  /** Datos personales del dueño (SOUL, USER.md, memorias…): en vista pública se ve el título, no el cuerpo. */
  personal?: boolean;
  /** Rango dentro del string exacto: raw.slice(start, end). */
  start: number;
  end: number;
}

/** El prompt exacto + sus secciones como rangos: el texto de cada una es un slice, byte a byte. */
export interface CapturedPrompt {
  kind: "sdk";
  raw: string;
  sections: PromptSection[];
}

/** Lo que controlamos de un run de claude -p (el prompt base de Claude Code no se expone). */
export interface CliRunConfig {
  kind: "cli";
  args: string[];
  cwd: string;
  model: string;
  effort: string;
  permissionMode: string;
  /** CLAUDE.md que el CLI carga para ese cwd (del más general al más cercano). */
  claudeMd: { path: string; content: string; cut?: number }[];
  /** --settings de Hermes (las reglas deny) y el --mcp-config sin secretos. */
  settings?: string;
  mcpConfig?: string;
  prompt: string;
}

export type TracePromptInfo = CapturedPrompt | CliRunConfig;

export function sectionText(p: CapturedPrompt, s: PromptSection): string {
  return p.raw.slice(s.start, s.end);
}

/** Arma un CapturedPrompt desde partes ya ordenadas, unidas con `sep` (el join es el raw). */
export function promptFromParts(parts: { id: string; title: string; why: string | null; personal?: boolean; text: string }[], sep: string): CapturedPrompt {
  let raw = "";
  const sections: PromptSection[] = [];
  parts.forEach((p, i) => {
    if (i > 0) raw += sep;
    const start = raw.length;
    raw += p.text;
    sections.push({ id: p.id, title: p.title, why: p.why, ...(p.personal ? { personal: true } : {}), start, end: raw.length });
  });
  return { kind: "sdk", raw, sections };
}

// ── Archivo de traza (~/.hermes-os/trazas/<id>.jsonl y la fixture) ───────

export interface TraceMeta {
  id: string;
  source: "sdk" | "cli";
  title: string;
  project: string;
  startedAt: string;
}

/** Inventario que el agente captura en vivo (tools del MCP con su descripción real, skills). */
export interface TraceInventoryCapture {
  /** Tools de cada servidor MCP como las ve el modelo (mcpServerStatus del SDK). */
  mcp: { server: string; status: string; tools: { name: string; description?: string }[] }[];
  /** Skills y comandos con su description (supportedCommands del SDK). */
  commands: { name: string; description: string }[];
}

/** La configuración de permisos con que se leen las tools (va en la exportación, para repetir sin agente). */
export interface TraceConfigInfo {
  sdk?: import("./office-inventory.js").SdkAgentConfig & { hermesTools?: { name: string; description: string }[] };
  cliDenyRules?: string[];
}

export type TraceLine =
  | { type: "meta"; meta: TraceMeta }
  | { type: "event"; event: TraceEvent }
  | { type: "prompt"; prompt: TracePromptInfo }
  | { type: "inventory"; inventory: TraceInventoryCapture }
  | { type: "config"; config: TraceConfigInfo };

export interface TraceFile {
  meta: TraceMeta | null;
  events: TraceEvent[];
  prompt: TracePromptInfo | null;
  inventory: TraceInventoryCapture | null;
  config?: TraceConfigInfo | null;
}

export function parseTraceJsonl(text: string): TraceFile {
  const file: TraceFile = { meta: null, events: [], prompt: null, inventory: null };
  const seen = new Set<number>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let l: TraceLine;
    try {
      l = JSON.parse(line) as TraceLine;
    } catch {
      continue;
    }
    if (l.type === "meta") file.meta = l.meta;
    else if (l.type === "prompt") file.prompt = l.prompt;
    else if (l.type === "inventory") file.inventory = l.inventory;
    else if (l.type === "config") file.config = l.config;
    else if (l.type === "event" && l.event && !seen.has(l.event.seq)) {
      seen.add(l.event.seq);
      file.events.push(l.event);
    }
  }
  file.events.sort((a, b) => a.seq - b.seq);
  return file;
}

export function traceToJsonl(f: TraceFile): string {
  const lines: TraceLine[] = [];
  if (f.meta) lines.push({ type: "meta", meta: f.meta });
  if (f.prompt) lines.push({ type: "prompt", prompt: f.prompt });
  if (f.inventory) lines.push({ type: "inventory", inventory: f.inventory });
  if (f.config) lines.push({ type: "config", config: f.config });
  for (const event of f.events) lines.push({ type: "event", event });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}
