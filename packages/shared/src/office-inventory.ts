// "Qué tiene este agente": una ficha por tool con su origen (CLI, MCP de
// Hermes, Linear, chrome-devtools, skill), su permiso REAL y cuántas veces la
// usó en este run. Puro. Las fuentes son de verdad, nunca una lista copiada:
// - Tareas del SDK: la configuración que exporta session.ts + el init del run +
//   mcpServerStatus() (la descripción que ve el modelo) + supportedCommands().
// - Runs de claude -p: el init del CLI (tools, mcp_servers, skills, modo).
// Lo que no se expone (la descripción de las tools integradas del CLI) se dice.

import type { ReducedTrace, TraceInit, TraceInventoryCapture } from "./office-trace.js";

export type ToolOrigin = "cli" | "hermes" | "linear" | "chrome" | "mcp" | "skill";

/** libre · pasa por un guardrail · se revisa en canUseTool · pide permiso · el modo la niega. */
export type ToolPermission = "free" | "guardrail" | "checked" | "asks" | "denied-by-mode";

export interface ToolCard {
  name: string;
  origin: ToolOrigin;
  /** Servidor MCP del que viene (si aplica). */
  server?: string;
  permission: ToolPermission;
  permissionNote: string;
  /** La descripción que ve el modelo; null = no expuesta. */
  description: string | null;
  /** Pasos de la traza donde la usó (1-based). */
  steps: number[];
  /** La está usando ahora (tool_use sin resultado). */
  active: boolean;
  /** Solo skills: se cargó en este run. */
  loaded?: boolean;
}

/** La configuración de permisos de las tareas del SDK, exportada desde session.ts (no se copia a mano). */
export interface SdkAgentConfig {
  allowedTools: string[];
  /** Tools que el guardrail de Hermes revisa (guardrails.ts). */
  guardedTools: string[];
  /** Prefijos que pasan por canUseTool con una revisión propia (p. ej. el Chrome CDP). */
  checkedPrefixes: { prefix: string; note: string }[];
  /** Tools que, si miras la Oficina, levantan la mano para lo que tiene efectos. */
  approvalTools: string[];
  permissionMode: string;
  mcpServers: string[];
}

export const ORIGIN_LABEL: Record<ToolOrigin, string> = {
  cli: "Claude Code (integrada)",
  hermes: "MCP de Hermes (en proceso)",
  linear: "MCP de Linear",
  chrome: "chrome-devtools (MCP)",
  mcp: "Servidor MCP",
  skill: "Skill del plugin",
};

export const PERMISSION_LABEL: Record<ToolPermission, string> = {
  free: "Libre",
  guardrail: "Pasa por guardrail",
  checked: "Revisada en canUseTool",
  asks: "Pide permiso",
  "denied-by-mode": "Negada por el modo",
};

export function toolOrigin(name: string): { origin: ToolOrigin; server?: string } {
  const m = /^mcp__(.+?)__/.exec(name);
  if (!m) return { origin: "cli" };
  const server = m[1];
  if (server === "hermes") return { origin: "hermes", server };
  if (server === "linear") return { origin: "linear", server };
  if (server === "chrome-devtools") return { origin: "chrome", server };
  return { origin: "mcp", server };
}

function allowedBy(name: string, allowed: string[]): boolean {
  return allowed.some((a) => a === name || (a.startsWith("mcp__") && !a.slice(5).includes("__") && name.startsWith(`${a}__`)));
}

export function sdkPermission(name: string, cfg: SdkAgentConfig): { permission: ToolPermission; note: string } {
  if (allowedBy(name, cfg.allowedTools)) return { permission: "free", note: "En allowedTools: corre sin preguntar" };
  const pre = cfg.checkedPrefixes.find((p) => name.startsWith(p.prefix));
  if (pre) return { permission: "checked", note: pre.note };
  if (cfg.guardedTools.includes(name)) {
    const asks = cfg.approvalTools.includes(name);
    return {
      permission: "guardrail",
      note: `canUseTool → guardrails.ts${name === "Bash" ? " (deny-list de comandos destructivos)" : " (solo escribe en el vault, ~/dev y ~/Documents)"}${asks ? "; si miras la Oficina, lo que tiene efectos levanta la mano" : ""}`,
    };
  }
  return { permission: "checked", note: "canUseTool: pasa (el guardrail solo restringe Bash y escrituras)" };
}

const CLI_READ_ONLY = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "ToolSearch", "Task", "Agent", "Skill", "ExitPlanMode", "EnterPlanMode", "BashOutput", "KillShell", "ListMcpResourcesTool", "ReadMcpResourceTool", "AskUserQuestion", "Monitor"]);
const CLI_EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function cliPermission(name: string, mode: string | undefined, denyRules: string[] = []): { permission: ToolPermission; note: string } {
  const m = mode ?? "default";
  const deny = denyRules.filter((r) => r.startsWith(`${name}(`));
  const denyNote = deny.length ? ` · reglas deny: ${deny.slice(0, 3).join(", ")}${deny.length > 3 ? "…" : ""}` : "";
  if (CLI_READ_ONLY.has(name)) return { permission: "free", note: `No necesita permiso${denyNote}` };
  if (CLI_EDITS.has(name)) {
    if (m === "plan") return { permission: "denied-by-mode", note: "Modo Plan: solo lee" };
    if (m === "acceptEdits" || m === "auto" || m === "bypassPermissions") return { permission: "free", note: `El modo ${m} acepta ediciones` };
    return { permission: "asks", note: `Modo ${m}: cada edición levanta la mano` };
  }
  if (m === "plan" && (name === "Bash" || name.startsWith("mcp__"))) return { permission: "denied-by-mode", note: "Modo Plan: solo lee" };
  if (m === "auto") return { permission: "checked", note: `El clasificador del modo Auto decide; lo riesgoso lo niega solo${denyNote}` };
  if (m === "bypassPermissions") return { permission: "free", note: `bypassPermissions${denyNote}` };
  return { permission: "asks", note: `Levanta la mano en la Oficina (salvo reglas allow del usuario)${denyNote}` };
}

export interface InventoryInput {
  source: "sdk" | "cli";
  init?: TraceInit;
  capture?: TraceInventoryCapture | null;
  sdk?: SdkAgentConfig;
  /** Tools de Hermes con su descripción (las que define tools.ts). */
  hermesTools?: { name: string; description: string }[];
  cliDenyRules?: string[];
  reduced?: ReducedTrace;
}

/** Nombre de la skill que cargó un paso `Skill` (o null). */
function skillOf(input: Record<string, unknown>): string | null {
  const v = input.skill ?? input.command ?? input.name;
  return typeof v === "string" && v ? v.replace(/^\//, "") : null;
}

export function buildInventory(inp: InventoryInput): ToolCard[] {
  const init = inp.init ?? inp.reduced?.init;
  const mode = init?.permissionMode ?? inp.sdk?.permissionMode;
  const descriptions = new Map<string, string>();
  for (const s of inp.capture?.mcp ?? []) for (const t of s.tools) if (t.description) descriptions.set(t.name.startsWith("mcp__") ? t.name : `mcp__${s.server}__${t.name}`, t.description);
  for (const t of inp.hermesTools ?? []) {
    const full = t.name.startsWith("mcp__") ? t.name : `mcp__hermes__${t.name}`;
    if (!descriptions.has(full)) descriptions.set(full, t.description);
  }

  // Las tools que el modelo TUVO: las del init. Sin init (una repetición vieja), las de la configuración.
  const names = new Set<string>(init?.tools ?? []);
  if (!names.size) {
    for (const t of inp.hermesTools ?? []) names.add(t.name.startsWith("mcp__") ? t.name : `mcp__hermes__${t.name}`);
    for (const t of inp.sdk?.allowedTools ?? []) if (!/^mcp__[^_]+$/.test(t) && !t.endsWith("__")) names.add(t);
  }
  // Una tool que aparece en la traza siempre está (aunque el init no llegara).
  for (const tool of Object.keys(inp.reduced?.byTool ?? {})) names.add(tool);

  const active = new Set((inp.reduced?.inFlight ?? []).map((s) => s.tool));
  const cards: ToolCard[] = [];
  for (const name of names) {
    if (name === "mcp__hermes-approval__ask") continue;
    const { origin, server } = toolOrigin(name);
    const perm = inp.source === "sdk" && inp.sdk ? sdkPermission(name, inp.sdk) : cliPermission(name, mode, inp.cliDenyRules);
    cards.push({
      name,
      origin,
      server,
      ...{ permission: perm.permission, permissionNote: perm.note },
      description: descriptions.get(name) ?? null,
      steps: inp.reduced?.byTool[name] ?? [],
      active: active.has(name),
    });
  }

  // Skills: el init dice cuáles hay; supportedCommands, su description; un paso Skill, que se cargó.
  const skillSteps = new Map<string, number[]>();
  for (const step of inp.reduced?.steps ?? []) {
    if (step.tool !== "Skill") continue;
    const s = skillOf(step.input);
    if (s) skillSteps.set(s, [...(skillSteps.get(s) ?? []), step.n]);
  }
  const commandDesc = new Map((inp.capture?.commands ?? []).map((c) => [c.name, c.description]));
  const skills = new Set<string>([...(init?.skills ?? []), ...skillSteps.keys()]);
  for (const s of skills) {
    const steps = skillSteps.get(s) ?? [];
    const inFlight = (inp.reduced?.inFlight ?? []).some((x) => x.tool === "Skill" && skillOf(x.input) === s);
    cards.push({
      name: s,
      origin: "skill",
      permission: "free",
      permissionNote: "Solo el índice va en el prompt; el cuerpo se carga al usarla",
      description: commandDesc.get(s) ?? commandDesc.get(s.replace(/^[^:]+:/, "")) ?? null,
      steps,
      active: inFlight,
      loaded: steps.length > 0,
    });
  }

  const order: ToolOrigin[] = ["hermes", "cli", "linear", "chrome", "mcp", "skill"];
  return cards.sort((a, b) => Number(b.active) - Number(a.active) || b.steps.length - a.steps.length || order.indexOf(a.origin) - order.indexOf(b.origin) || a.name.localeCompare(b.name));
}
