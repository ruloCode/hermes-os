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

// Icono por familia de tool (trazo fino, como el resto de la UI). v4 usaba
// glifos de texto (⌕ ❯ ✎ ◈) en el color del acento: veinte "iconos falsos"
// en índigo por respuesta.
type Family = "read" | "run" | "write" | "web" | "plan" | "tool";

const FAMILY: Record<string, Family> = {
  Read: "read",
  Glob: "read",
  Grep: "read",
  Bash: "run",
  Write: "write",
  Edit: "write",
  WebSearch: "web",
  WebFetch: "web",
  TodoWrite: "plan",
};

const FAMILY_PATH: Record<Family, string> = {
  read: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  run: "m5 8 4 4-4 4M12 16h7",
  write: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  web: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18",
  plan: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  tool: "M14.5 6.5a3.5 3.5 0 0 0 4.4 4.4L20 12l-8 8-3.5-3.5 8-8 1.1-1.1a3.5 3.5 0 0 0-3.1-.9ZM4 20l3-3",
};

function StepIcon({ name }: { name: string }) {
  const fam = FAMILY[name] ?? "tool";
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 translate-y-[2px]"
    >
      <path d={FAMILY_PATH[fam]} />
    </svg>
  );
}

/** Nombre corto de la tool: mcp__hermes__save_memory → save_memory. */
function shortName(name: string): string {
  return name.startsWith("mcp__") ? (name.split("__").pop() ?? name) : name;
}

/** Etiqueta legible; sin verbo conocido cae al nombre crudo (nunca inventa). */
function verbOf(name: string): string {
  const short = shortName(name);
  return VERB[name] ?? VERB[short] ?? short;
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
          className="-ml-1 flex h-6 cursor-pointer items-center gap-1 rounded-xs px-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          {steps.length} paso{steps.length === 1 ? "" : "s"}
        </button>
      )}
      {expanded && (
        <ul className="mt-1 space-y-1 border-l border-line pl-3">
          {steps.map((s, i) => {
            const target = shortTarget(s.target ?? "");
            const live = busy && i === steps.length - 1;
            return (
              <li
                key={i}
                className={`flex min-w-0 items-baseline gap-2 text-xs leading-snug ${
                  live ? "text-text" : "text-text-dim"
                }`}
              >
                {/* El paso EN CURSO lleva el cyan de "en curso"; los hechos, gris. */}
                <span className={live ? "pulse-dot text-cyan" : "text-text-faint"}>
                  <StepIcon name={s.name} />
                </span>
                <span className="shrink-0">{verbOf(s.name)}</span>
                {target && (
                  <span className="min-w-0 truncate font-mono text-2xs text-text-faint">
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
