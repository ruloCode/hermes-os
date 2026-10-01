"use client";

// La sala de control en grande (E frente a la pared de pantallas): la terminal
// de cada agente vivo con su apodo, proyecto, estado y lo que lleva gastado.
// Las líneas son las de /office/events (las mismas de su monitor y su laptop).
// Clic en una = su panel, con el stream completo y la conversación. Esc o B cierra.

import { officeModeLabel, type OfficeWorker } from "@hermes/shared";
import { spendLabel, STATUS_TEXT } from "@/lib/oficina/terminal";
import { PadGlyph } from "./VoiceComposer";

const glass = "border border-line bg-panel/95 shadow-xl backdrop-blur-md";

const STATUS_DOT: Record<OfficeWorker["status"], string> = {
  starting: "bg-text-faint",
  working: "bg-amber",
  thinking: "bg-cyan",
  blocked: "bg-red",
  needs_you: "bg-accent",
  done: "bg-green",
  error: "bg-red",
};

function lineClass(l: string): string {
  const h = l.slice(0, 1);
  return h === "⚙" || h === "✋" ? "text-accent" : h === "↩" ? "text-text-dim" : h === "✗" ? "text-red" : h === "✓" ? "text-green" : "text-text";
}

export function ControlRoomPanel({
  workers,
  nicks,
  projectName,
  simulated,
  padConnected,
  onOpen,
  onClose,
}: {
  workers: OfficeWorker[];
  nicks: ReadonlyMap<string, string>;
  projectName: (slug: string) => string;
  simulated: boolean;
  padConnected: boolean;
  onOpen: (w: OfficeWorker) => void;
  onClose: () => void;
}) {
  return (
    <section
      role="dialog"
      aria-label="Sala de control"
      className={`pointer-events-auto absolute inset-4 z-40 flex flex-col rounded-2xl ${glass}`}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold text-text">Sala de control</h2>
        <span className="text-xs text-text-dim">
          {workers.length === 1 ? "1 agente" : `${workers.length} agentes`}
          {simulated ? " · simulación" : ""} · clic en uno para abrir su terminal completa
        </span>
        <button type="button" onClick={onClose} className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-text-dim hover:bg-panel-2 hover:text-text" aria-label="Cerrar">
          {padConnected ? <PadGlyph b="B" /> : null}✕
        </button>
      </header>
      {workers.length === 0 ? (
        <p className="m-auto text-sm text-text-dim">Sin agentes vivos. Contrata uno en un escritorio libre (+).</p>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-[minmax(14rem,1fr)] grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
          {workers.map((w) => {
            const spend = spendLabel(w);
            return (
              <li key={w.id} className="min-h-0">
                <button
                  type="button"
                  onClick={() => onOpen(w)}
                  data-control-tile={w.id}
                  className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-bg text-left hover:border-accent"
                >
                  <span className="flex w-full items-center gap-2 border-b border-line bg-panel-2/60 px-3 py-2 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[w.status]}`} />
                    <span className="min-w-0 flex-1 truncate font-medium text-text">
                      {nicks.get(w.id) ? `${nicks.get(w.id)} · ` : ""}
                      {projectName(w.project)}
                    </span>
                    <span className="shrink-0 text-xs text-text-dim">
                      {STATUS_TEXT[w.status]}
                      {w.mode && w.mode !== "auto" ? ` · ${officeModeLabel(w.mode)}` : ""}
                      {spend ? ` · ${spend}` : ""}
                    </span>
                  </span>
                  <span className="block truncate px-3 pt-2 text-xs text-text-dim">{w.name}</span>
                  <span className="block min-h-0 flex-1 overflow-hidden px-3 py-2 font-mono text-xs leading-relaxed">
                    {w.lines.length ? (
                      w.lines.map((l, i) => (
                        <span key={i} className={`block truncate ${lineClass(l)}`}>
                          {l}
                        </span>
                      ))
                    ) : (
                      <span className="text-text-dim">arrancando…</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
