"use client";

// Panel del personaje seleccionado: quién es, en qué proyecto, qué tool está
// usando y desde cuándo, y su salida. Para un run de claude -p la salida es el
// stream REAL del run (GET /claude/run/:id/stream, el mismo de la consola);
// para el resto de sesiones son las líneas que el agente guardó del bus.

import { useEffect, useRef, useState } from "react";
import type { OfficeWorker, OfficeWorkerStatus } from "@hermes/shared";
import { claudeKillRun, claudeRunStreamUrl } from "@/lib/hermes";
import type { OfficeDictation } from "@/hooks/useOfficeDictation";
import { VoiceComposer } from "./VoiceComposer";

const STATUS_LABEL: Record<OfficeWorkerStatus, string> = {
  starting: "Arrancando",
  working: "Trabajando",
  thinking: "Pensando",
  blocked: "Bloqueado por un guardrail",
  done: "Listo",
  error: "Error",
};

const STATUS_DOT: Record<OfficeWorkerStatus, string> = {
  starting: "bg-text-faint",
  working: "bg-amber",
  thinking: "bg-cyan",
  blocked: "bg-red",
  done: "bg-green",
  error: "bg-red",
};

const SOURCE_LABEL: Record<OfficeWorker["source"], string> = {
  run: "Run de Claude Code",
  task: "Tarea de Hermes",
  scheduled: "Tarea programada",
  meeting: "Junta",
  "content-edit": "Edición del Estudio",
  "content-chat": "Chat del Estudio",
  "content-gen": "Generación del Estudio",
  "english-report": "Reporte de inglés",
  other: "Sesión",
};

interface Line {
  kind: string;
  text: string;
}

function elapsed(from: string, to?: string): string {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Stream real de un run; null si el run ya no existe en el agente (se evicta a los 5 min). */
function useRunStream(runId: string | null): Line[] | null {
  const [lines, setLines] = useState<Line[] | null>(null);
  useEffect(() => {
    if (!runId) {
      setLines(null);
      return;
    }
    setLines([]);
    const es = new EventSource(claudeRunStreamUrl(runId));
    let got = false;
    es.addEventListener("line", (e) => {
      got = true;
      try {
        const l = JSON.parse((e as MessageEvent).data) as Line;
        setLines((prev) => [...(prev ?? []), l].slice(-400));
      } catch {
        /* línea rota */
      }
    });
    es.addEventListener("end", () => es.close());
    es.onerror = () => {
      es.close();
      if (!got) setLines(null);
    };
    return () => es.close();
  }, [runId]);
  return lines;
}

const KIND_CLASS: Record<string, string> = {
  tool: "text-accent",
  result: "text-text-faint",
  error: "text-red",
  done: "text-green",
  init: "text-text-faint",
  text: "text-text",
};

export function WorkerDrawer({
  worker,
  projectName,
  simulated,
  onClose,
  voice,
  padConnected,
  sending,
  onSend,
}: {
  worker: OfficeWorker;
  projectName: string;
  simulated: boolean;
  onClose: () => void;
  voice: OfficeDictation;
  padConnected: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const isRun = worker.source === "run" && !simulated;
  const stream = useRunStream(isRun ? worker.id : null);
  const [, tick] = useState(0);
  const [stopping, setStopping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = worker.status !== "done" && worker.status !== "error";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  const lines: Line[] =
    stream ??
    worker.lines.map((text) => ({
      kind: text.startsWith("⚙") ? "tool" : text.startsWith("↩") ? "result" : text.startsWith("✗") ? "error" : text.startsWith("✓") ? "done" : "text",
      text,
    }));

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <aside className="absolute top-16 right-3 bottom-16 z-30 flex w-[min(460px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[worker.status]} ${active ? "animate-pulse" : ""}`} />
            <h2 className="truncate text-base font-medium text-text">{worker.name}</h2>
          </div>
          <p className="mt-0.5 text-xs text-text-dim">
            {projectName} · {SOURCE_LABEL[worker.source]}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-text-dim hover:bg-panel-2 hover:text-text"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </header>

      <dl className="grid grid-cols-3 gap-px border-b border-line bg-line text-xs">
        <div className="bg-panel px-4 py-2">
          <dt className="text-text-faint">Estado</dt>
          <dd className="mt-0.5 text-text">{STATUS_LABEL[worker.status]}</dd>
        </div>
        <div className="bg-panel px-4 py-2">
          <dt className="text-text-faint">Tools</dt>
          <dd className="mt-0.5 text-text tabular-nums">{worker.toolCalls}</dd>
        </div>
        <div className="bg-panel px-4 py-2">
          <dt className="text-text-faint">Tiempo</dt>
          <dd className="mt-0.5 text-text tabular-nums">{elapsed(worker.startedAt, worker.finishedAt)}</dd>
        </div>
      </dl>

      {worker.task.summary ? (
        <p className="border-b border-line px-4 py-2 font-mono text-xs break-all text-text-dim">{worker.task.summary}</p>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-text-faint">Sin salida todavía.</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`break-words whitespace-pre-wrap ${KIND_CLASS[l.kind] ?? "text-text"}`}>
              {l.text}
            </div>
          ))
        )}
        {isRun && stream === null ? (
          <p className="mt-2 text-text-faint">El run ya salió de memoria del agente: estas son sus últimas líneas.</p>
        ) : null}
      </div>

      {/* Conversación por voz: continúa la sesión del run (o abre uno nuevo en su proyecto). */}
      <section className="border-t border-line bg-panel-2/40 px-4 py-3">
        <VoiceComposer
          voice={voice}
          padConnected={padConnected}
          sending={sending}
          sendLabel={worker.source === "run" && worker.sessionId ? `Seguir con ${worker.name}` : `Nuevo agente en ${projectName}`}
          blockedReason={
            simulated
              ? "Simulación: aquí no se envía nada."
              : active && worker.source === "run"
                ? "Sigue trabajando: háblale cuando termine (o detenlo)."
                : null
          }
          placeholder="Ahora corre los tests y arregla lo que falle"
          onSend={onSend}
        />
      </section>

      {isRun && active ? (
        <footer className="flex justify-end border-t border-line px-4 py-2.5">
          <button
            type="button"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              await claudeKillRun(worker.id);
              setStopping(false);
            }}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-text hover:border-red hover:text-red disabled:opacity-50"
          >
            {stopping ? "Deteniendo…" : "⏹ Detener"}
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
