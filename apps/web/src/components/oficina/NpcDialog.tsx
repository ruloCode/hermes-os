"use client";

// Diálogo corto con un NPC de la Oficina (Recepción, Barista, Respiro): lo que
// dice y dos o tres preguntas para elegir. Liviano a propósito — no es el
// panel de un agente: no hay micrófono ni envío, solo lectura de datos reales
// (las líneas salen de packages/shared/src/office-npc.ts). Teclado: 1-3 o
// ↑↓ + Enter, Esc cierra. Control: cruceta ↑↓, A elige, B cierra.

import type { NpcLine } from "@hermes/shared";
import { PadGlyph } from "./VoiceComposer";

export interface NpcOption {
  id: string;
  label: string;
}

const glass = "border border-line bg-panel/95 shadow-xl backdrop-blur-md";

export function NpcDialog({
  name,
  place,
  simulated,
  lines,
  options,
  focus,
  padConnected,
  onPick,
  onGo,
  onClose,
}: {
  name: string;
  place: string;
  simulated: boolean;
  /** Lo que dice ahora (saludo o respuesta a la última pregunta). */
  lines: NpcLine[];
  options: NpcOption[];
  focus: number;
  padConnected: boolean;
  onPick: (i: number) => void;
  /** Ir con el agente de una línea (Recepción). */
  onGo: (workerId: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      role="dialog"
      aria-label={name}
      className={`pointer-events-auto absolute bottom-20 left-1/2 z-40 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl p-4 ${glass}`}
    >
      <header className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 text-sm" aria-hidden>
          {name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text">{name}</h2>
          <p className="text-xs text-text-dim">{place}</p>
        </div>
        {simulated ? <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs text-amber">simulación</span> : null}
        <button type="button" onClick={onClose} className="rounded-md px-1.5 text-text-dim hover:text-text" aria-label="Cerrar">
          ✕
        </button>
      </header>

      <ul className="mt-3 space-y-1.5 text-sm text-text" aria-live="polite">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="min-w-0 flex-1">{l.text}</span>
            {l.workerId ? (
              <button
                type="button"
                onClick={() => onGo(l.workerId!)}
                className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs text-text-dim hover:border-accent hover:text-text"
              >
                Ir →
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-col gap-1" role="listbox" aria-label="Preguntas">
        {options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={focus === i}
            onClick={() => onPick(i)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
              focus === i ? "bg-accent/15 text-text" : "text-text-dim hover:bg-panel-2 hover:text-text"
            }`}
          >
            <kbd className="grid h-5 w-5 place-items-center rounded border border-line-2 bg-panel-2 font-mono text-xs text-text-dim">{i + 1}</kbd>
            {o.label}
          </button>
        ))}
      </div>

      <p className="mt-3 flex items-center gap-3 text-xs text-text-faint">
        {padConnected ? (
          <>
            <span className="flex items-center gap-1">
              <PadGlyph b="A" /> elegir
            </span>
            <span className="flex items-center gap-1">
              <PadGlyph b="B" /> cerrar
            </span>
            <span>cruceta ↑↓</span>
          </>
        ) : (
          <>
            <span>1–{options.length} o ↑↓ y Enter para elegir</span>
            <span>Esc cierra</span>
          </>
        )}
      </p>
    </section>
  );
}
