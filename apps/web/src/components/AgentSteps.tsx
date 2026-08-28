"use client";

// Pasos agénticos de UN turno de la consola (patrón Replit/Relevance AI): en
// vez de un "pensando…" opaco, el hilo muestra QUÉ está haciendo el agente.
// Los pasos llegan por el frame `hermes.tool` del SSE: son los tool_use REALES
// del turno — si el agente no usa tools, no se dibuja nada.

import { useState } from "react";
import type { ChatToolStep } from "@hermes/shared";

// Verbo en pasado por tool. Las mcp__hermes__* se buscan sin su prefijo.
const VERB: Record<string, string> = {
  Read: "Leyó",
  Glob: "Listó",
  Grep: "Buscó",
  Bash: "Ejecutó",
  Write: "Escribió",
  Edit: "Editó",
  WebSearch: "Buscó en la web",
  WebFetch: "Abrió",
  TodoWrite: "Actualizó el plan",
  ToolSearch: "Cargó herramientas",
  Task: "Lanzó un subagente",
  search_knowledge: "Buscó en el conocimiento",
  save_memory: "Guardó en memoria",
  search_memory: "Buscó en la memoria",
  save_preference: "Guardó una preferencia",
  get_project_status: "Leyó el estado del proyecto",
  update_project_note: "Actualizó la nota del proyecto",
  search_vault: "Buscó en el vault",
  capture_idea: "Capturó una idea",
  get_recent_activity: "Leyó la actividad reciente",
  search_meetings: "Buscó en reuniones",
  analyze_youtube: "Analizó un video",
  query_code_graph: "Consultó el grafo de código",
  log_transaction: "Registró una transacción",
  list_transactions: "Listó transacciones",
  get_finance_summary: "Leyó el resumen financiero",
  get_balance: "Leyó el saldo",
  set_wallet_balance: "Ajustó el saldo",
  set_budget: "Ajustó el presupuesto",
  log_habit: "Registró un hábito",
  get_habits_today: "Leyó los hábitos de hoy",
  manage_habit: "Gestionó un hábito",
  update_goal: "Actualizó una meta",
};

// Glifo por familia de tool (mismo vocabulario que la Actividad en vivo).
const GLYPH: Record<string, string> = {
  Read: "⌕",
  Glob: "⌕",
  Grep: "⌕",
  Bash: "❯",
  Write: "✎",
  Edit: "✎",
  WebSearch: "◈",
  WebFetch: "◈",
  TodoWrite: "☰",
  ToolSearch: "⚙",
  Task: "◆",
};

/** Nombre corto de la tool: mcp__hermes__save_memory → save_memory. */
function shortName(name: string): string {
  return name.startsWith("mcp__") ? (name.split("__").pop() ?? name) : name;
}

/** Etiqueta legible; sin verbo conocido cae al nombre crudo (nunca inventa). */
function verbOf(name: string): string {
  const short = shortName(name);
  return VERB[name] ?? VERB[short] ?? short;
}

function glyphOf(name: string): string {
  return GLYPH[name] ?? (name.startsWith("mcp__") ? "◆" : "⚙");
}

/** Acorta el objetivo: URLs → host, rutas → últimos 2 segmentos, texto → 60. */
function shortTarget(target: string): string {
  const t = target.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (/^https?:\/\//.test(t)) {
    try {
      return new URL(t).hostname;
    } catch {
      /* URL rota: cae al recorte de abajo */
    }
  }
  if (t.includes("/") && !t.includes(" ")) {
    const parts = t.split("/").filter(Boolean);
    return parts.length > 2 ? parts.slice(-2).join("/") : t;
  }
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/**
 * Lista de pasos de un turno. Corriendo se ven todos (son el feedback de que
 * algo pasa); terminado se pliegan a una línea para no tapar la respuesta.
 */
export function AgentSteps({ steps, busy }: { steps: ChatToolStep[]; busy: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;

  const expanded = busy || open;

  return (
    <div className="mb-1.5">
      {!busy && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-2xs tracking-label text-text-dim uppercase transition-colors hover:text-violet"
        >
          <span aria-hidden>{open ? "▾" : "▸"}</span>
          {steps.length} paso{steps.length === 1 ? "" : "s"}
        </button>
      )}
      {expanded && (
        <ul className="mt-1 space-y-0.5 border-l border-line pl-2">
          {steps.map((s, i) => {
            const target = shortTarget(s.target ?? "");
            const live = busy && i === steps.length - 1;
            return (
              <li key={i} className="flex items-baseline gap-1.5 text-2xs leading-snug">
                <span aria-hidden className={live ? "text-amber" : "text-violet"}>
                  {glyphOf(s.name)}
                </span>
                <span className={`shrink-0 ${live ? "pulse-dot text-text" : "text-text-dim"}`}>
                  {verbOf(s.name)}
                </span>
                {target && (
                  <span className="min-w-0 truncate font-mono text-text-dim opacity-70">
                    {target}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
