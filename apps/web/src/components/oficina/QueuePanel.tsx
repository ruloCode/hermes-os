"use client";

// La cola de agentes de la Oficina: le pides trabajo al coordinador, él
// PROPONE tareas (con su prompt y su proyecto) y tú eliges cuáles entran. La
// cola las reparte a agentes nuevos sin pasar del tope. Abajo, la cola real:
// lo que corre (con un "Ir" a su escritorio), lo que espera (se puede sacar)
// y lo último que terminó. Todo sale de GET /office/queue.

import { useState } from "react";
import { QUEUE_MAX_LIMIT, queueCounts, type NewQueueItem, type OfficeMode, type QueueItem, type QueueState } from "@hermes/shared";
import { ModePicker } from "./ModePicker";

const glass = "border border-line bg-panel/95 shadow-xl backdrop-blur-md";

const STATUS: Record<QueueItem["status"], { label: string; dot: string }> = {
  running: { label: "en curso", dot: "bg-amber animate-pulse" },
  queued: { label: "esperando", dot: "bg-cyan" },
  done: { label: "lista", dot: "bg-green" },
  error: { label: "error", dot: "bg-red" },
  canceled: { label: "cancelada", dot: "bg-text-faint" },
};

export function QueuePanel({
  queue,
  projects,
  simulated,
  padConnected,
  planning,
  proposals,
  onPlan,
  onEnqueue,
  onDiscardProposals,
  onCancel,
  onSettings,
  onGoToRun,
  onClose,
}: {
  queue: (QueueState & { mode?: string }) | null;
  projects: { slug: string; name: string }[];
  simulated: boolean;
  padConnected: boolean;
  planning: boolean;
  proposals: NewQueueItem[] | null;
  onPlan: (text: string, project: string) => void;
  onEnqueue: (items: NewQueueItem[]) => void;
  onDiscardProposals: () => void;
  onCancel: (id: string) => void;
  onSettings: (s: { max?: number; mode?: OfficeMode }) => void;
  /** Lleva al dueño al escritorio del agente de esa tarea (si sigue vivo). */
  onGoToRun: (runId: string) => boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [project, setProject] = useState("general");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const counts = queue ? queueCounts(queue.items) : null;
  const live = queue?.items.filter((i) => i.status === "running" || i.status === "queued") ?? [];
  const finished = (queue?.items.filter((i) => i.status !== "running" && i.status !== "queued") ?? [])
    .slice()
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))
    .slice(0, 8);
  const chosen = proposals ? proposals.filter((_, i) => !picked.has(i)) : [];

  return (
    <section
      role="dialog"
      aria-label="Cola de agentes"
      className={`pointer-events-auto absolute top-1/2 left-1/2 z-40 flex max-h-[86vh] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl ${glass}`}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold text-text">Cola de agentes</h2>
        {counts ? (
          <span className="text-xs text-text-dim">
            {counts.running} en curso · {counts.queued} esperando
          </span>
        ) : (
          <span className="text-xs text-red">El agente no respondió</span>
        )}
        <button type="button" onClick={onClose} className="ml-auto rounded-md px-1.5 text-text-dim hover:text-text" aria-label="Cerrar">
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {/* El coordinador: propone, no encola. */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-text">¿Qué hay que hacer?</p>
          <p className="text-xs text-text-dim">El coordinador lo parte en tareas para agentes nuevos. Nada entra a la cola hasta que lo confirmes.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Ej.: revisa los tests de hermes-os y arregla los que fallen; resume los issues abiertos de Linear"
            className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-text-faint"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-sm text-text"
              aria-label="Proyecto sugerido"
            >
              <option value="general">General</option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!text.trim() || planning || simulated}
              onClick={() => {
                setPicked(new Set());
                onPlan(text, project);
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {planning ? "Pensando…" : "Proponer tareas"}
            </button>
            {simulated ? <span className="text-xs text-amber">En simulación no se encola nada.</span> : null}
          </div>
        </div>

        {proposals ? (
          <div className="space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
            <p className="text-sm font-medium text-text">Propuesta del coordinador</p>
            <ul className="space-y-2">
              {proposals.map((t, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={!picked.has(i)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                    className="mt-1"
                    aria-label={`Encolar «${t.title}»`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-text">
                      {t.title} <span className="text-xs text-text-faint">· {projects.find((p) => p.slug === t.project)?.name ?? t.project}</span>
                    </p>
                    <p className="line-clamp-2 text-xs text-text-dim">{t.prompt}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!chosen.length || simulated}
                onClick={() => onEnqueue(chosen)}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Encolar {chosen.length}
              </button>
              <button type="button" onClick={onDiscardProposals} className="rounded-lg px-2.5 py-1.5 text-sm text-text-dim hover:bg-panel-2 hover:text-text">
                Descartar
              </button>
              <span className="text-xs text-text-faint">Cada tarea es un agente que gasta tokens al correr.</span>
            </div>
          </div>
        ) : null}

        {queue ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-text">A la vez:</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Agentes a la vez">
                {Array.from({ length: QUEUE_MAX_LIMIT }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={queue.max === n}
                    onClick={() => onSettings({ max: n })}
                    className={`h-8 w-8 rounded-lg text-sm ${queue.max === n ? "bg-accent text-white" : "border border-line text-text-dim hover:text-text"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <ModePicker value={(queue.mode as OfficeMode) ?? "auto"} onChange={(mode) => onSettings({ mode })} padConnected={padConnected} />

            <ul className="divide-y divide-line rounded-xl border border-line">
              {!live.length && !finished.length ? <li className="px-3 py-4 text-center text-sm text-text-dim">La cola está vacía.</li> : null}
              {[...live, ...finished].map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS[it.status].dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text">
                      {it.linearId ? <span className="font-mono text-text-dim">{it.linearId} </span> : null}
                      {it.title}
                    </p>
                    <p className="truncate text-xs text-text-faint">
                      {STATUS[it.status].label}
                      {it.project !== "general" ? ` · ${projects.find((p) => p.slug === it.project)?.name ?? it.project}` : ""}
                      {it.error ? ` · ${it.error}` : ""}
                    </p>
                  </div>
                  {it.status === "running" && it.runId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (onGoToRun(it.runId!)) onClose();
                      }}
                      className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs text-text-dim hover:border-accent hover:text-text"
                    >
                      Ir →
                    </button>
                  ) : null}
                  {it.status === "queued" ? (
                    <button type="button" onClick={() => onCancel(it.id)} className="shrink-0 rounded-md px-2 py-0.5 text-xs text-text-dim hover:text-red">
                      Sacar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <footer className="border-t border-line px-5 py-2 text-xs text-text-faint">Esc cierra · los issues de Linear entran desde el tablero de Issues («→ Cola»)</footer>
    </section>
  );
}
