"use client";

// Panel del personaje seleccionado: quién es, en qué proyecto, qué tool está
// usando y desde cuándo, y su salida. Para un run de claude -p la salida es el
// stream REAL del run (GET /claude/run/:id/stream, el mismo de la consola);
// para el resto de sesiones son las líneas que el agente guardó del bus.
// Si el agente espera tu permiso, lo primero del panel es QUÉ pide (el comando
// exacto) y los dos botones: el run está pausado hasta que decidas.

import { useEffect, useRef, useState } from "react";
import { PLAN_TOOL, formatTokens, formatUsd, officeModeLabel, totalTokens, type OfficeMode, type OfficeWorker, type OfficeWorkerStatus, type PublicViewContext } from "@hermes/shared";
import type { Redact } from "@/lib/oficina/public-view";
import { TraceList, type TraceListHandle } from "./trace/TraceList";
import { InventoryList } from "./trace/InventoryList";
import { PromptView } from "./trace/PromptView";
import { useTraceView } from "./trace/useTraceView";
import { LogsView, traceLogLines } from "./trace/LogsView";
import { Markdown } from "@/components/Markdown";
import { claudeKillRun, claudeRunStreamUrl } from "@/lib/hermes";
import type { OfficeDictation } from "@/hooks/useOfficeDictation";
import { VoiceComposer } from "./VoiceComposer";
import { ModePicker, modeNote } from "./ModePicker";

const STATUS_LABEL: Record<OfficeWorkerStatus, string> = {
  starting: "Arrancando",
  working: "Trabajando",
  thinking: "Pensando",
  blocked: "Bloqueado por un guardrail",
  needs_you: "Esperando tu permiso",
  done: "Listo",
  error: "Error",
};

const STATUS_DOT: Record<OfficeWorkerStatus, string> = {
  starting: "bg-text-faint",
  working: "bg-amber",
  thinking: "bg-cyan",
  blocked: "bg-red",
  needs_you: "bg-accent",
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
  t?: number;
}

export type DrawerTab = "out" | "log" | "trace" | "tools" | "prompt";
const TABS: { id: DrawerTab; label: string }[] = [
  { id: "out", label: "Salida" },
  { id: "log", label: "Log" },
  { id: "trace", label: "Traza" },
  { id: "tools", label: "Tools" },
  { id: "prompt", label: "Prompt" },
];

function remaining(until: string): string {
  const s = Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function elapsed(from: string, to?: string): string {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Stream real de un run; null si el run ya no existe en el agente (se evicta a los 5 min). */
export function useRunStream(runId: string | null): Line[] | null {
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
  deciding,
  onDecide,
  mode,
  onModeChange,
  model,
  redact,
  publicView,
  publicCtx,
}: {
  worker: OfficeWorker;
  projectName: string;
  simulated: boolean;
  onClose: () => void;
  voice: OfficeDictation;
  padConnected: boolean;
  sending: boolean;
  onSend: () => void;
  deciding: boolean;
  onDecide: (allow: boolean) => void;
  /** Modo con que correrá lo próximo que le digas (continuar su sesión). */
  mode: OfficeMode;
  onModeChange: (mode: OfficeMode) => void;
  model: string;
  /** Vista pública: todo texto pasa por aquí antes de pintarse. */
  redact: Redact;
  publicView: boolean;
  publicCtx: PublicViewContext;
}) {
  const isRun = worker.source === "run" && !simulated;
  const stream = useRunStream(isRun ? worker.id : null);
  const [, tick] = useState(0);
  // Pantalla completa: la terminal grande con scroll, sin perder la conversación.
  const [expanded, setExpanded] = useState(false);
  const [follow, setFollow] = useState(true);
  const [stopping, setStopping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = worker.status !== "done" && worker.status !== "error";
  // Clic en un personaje con error (o bloqueado): el panel abre en la traza, sobre el error.
  // Abre en el Log (lo que hace, completo y en vivo); con error o bloqueado, en la Traza sobre el error.
  const [tab, setTab] = useState<DrawerTab>(() => (worker.status === "error" || worker.status === "blocked" ? "trace" : "log"));
  const traceView = useTraceView(tab === "out" ? null : worker.id, { on: publicView, ctx: publicCtx });
  const listRef = useRef<TraceListHandle | null>(null);
  const [focusSeq, setFocusSeq] = useState<number | null>(null);
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (jumpedRef.current || tab !== "trace" || (worker.status !== "error" && worker.status !== "blocked")) return;
    const errs = traceView.reduced.errors;
    if (!errs.length) return;
    jumpedRef.current = true;
    const target = [...errs].reverse().find((e) => !e.fixedBy) ?? errs[errs.length - 1];
    requestAnimationFrame(() => listRef.current?.jumpTo(target.seq));
  }, [tab, worker.status, traceView.reduced.errors]);
  const plan = worker.approval?.tool === PLAN_TOOL;
  // Un plan aprobado se ejecuta en el modo elegido para el agente (Auto si ese modo es Plan).
  const runMode: OfficeMode = mode === "plan" ? "auto" : mode;
  const dictated = voice.text.trim();

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
    // Sigue el final solo si ya estabas abajo: subir a leer no te devuelve de un tirón.
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [lines.length, follow, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // La primera Esc sale de la pantalla completa; la página no cierra el panel.
      e.stopImmediatePropagation();
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded]);

  const spend = worker.spend;

  return (
    <aside
      data-expanded={expanded ? "true" : undefined}
      className={`absolute z-30 flex flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl ${
        expanded ? "inset-4" : "top-16 right-3 bottom-16 w-[min(460px,calc(100vw-24px))]"
      }`}
    >
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[worker.status]} ${active ? "animate-pulse" : ""}`} />
            <h2 className="truncate text-base font-medium text-text">{worker.name}</h2>
          </div>
          <p className="mt-0.5 text-xs text-text-dim">
            {projectName} · {SOURCE_LABEL[worker.source]}
            {worker.mode ? ` · modo ${officeModeLabel(worker.mode)}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md px-2 py-1 text-sm text-text-dim hover:bg-panel-2 hover:text-text"
          aria-label={expanded ? "Salir de pantalla completa" : "Pantalla completa"}
          title={expanded ? "Salir de pantalla completa (Esc)" : "Ver su terminal a pantalla completa"}
        >
          {expanded ? "⤡" : "⤢"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-text-dim hover:bg-panel-2 hover:text-text"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </header>

      <dl className="grid grid-cols-4 gap-px border-b border-line bg-line text-xs">
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
        <div className="bg-panel px-4 py-2" title={spend && !spend.final ? "Tokens que reporta la API mientras corre; el costo llega al terminar" : undefined}>
          <dt className="text-text-faint">Gasto</dt>
          <dd className="mt-0.5 text-text tabular-nums" data-worker-spend>
            {spend?.final && spend.costUsd !== undefined
              ? `${formatUsd(spend.costUsd)} · ${formatTokens(totalTokens(spend.tokens))}`
              : spend
                ? `${formatTokens(totalTokens(spend.tokens))} tok`
                : "—"}
          </dd>
        </div>
      </dl>

      {worker.approval ? (
        <section className="border-b border-line bg-accent/10 px-4 py-3" aria-live="assertive">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-text">{plan ? "📋 Propone este plan" : "✋ Pide permiso para ejecutar"}</p>
            <p className="shrink-0 text-xs text-text-dim tabular-nums">se niega sola en {remaining(worker.approval.expiresAt)}</p>
          </div>
          {plan ? (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-line bg-panel px-3 py-2 text-sm">
              <Markdown source={redact(worker.approval.detail)} />
            </div>
          ) : (
            <pre className="mt-2 max-h-40 overflow-y-auto rounded-md border border-line bg-panel px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-text">
              {redact(worker.approval.detail)}
            </pre>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={deciding}
              onClick={() => onDecide(true)}
              className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {plan ? `Aprobar y ejecutar en ${officeModeLabel(runMode)}` : "Aprobar"}
              {padConnected ? " (A)" : ""}
            </button>
            <button
              type="button"
              disabled={deciding}
              onClick={() => onDecide(false)}
              className="flex-1 rounded-md border border-line px-3 py-2 text-sm text-text hover:border-red hover:text-red disabled:opacity-50"
            >
              {plan ? "Pedir cambios" : "Negar"}
              {padConnected ? " (B)" : ""}
            </button>
          </div>
          <p className="mt-2 text-xs text-text-dim">
            {dictated
              ? `Al ${plan ? "pedir cambios" : "negar"} le llega lo que dictaste: “${dictated.length > 80 ? `${dictated.slice(0, 79)}…` : dictated}”`
              : `Dicta abajo ${plan ? "qué cambiar" : "por qué no"} (${padConnected ? "X" : "el micrófono"}) y le llega con tu decisión.`}
          </p>
        </section>
      ) : null}

      {worker.task.summary && !worker.approval ? (
        <p className="border-b border-line px-4 py-2 font-mono text-xs break-all text-text-dim">{redact(worker.task.summary)}</p>
      ) : null}

      <nav className="flex items-center gap-1 border-b border-line px-2" role="tablist" aria-label="Qué ver del agente">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-drawer-tab={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-1.5 text-sm ${tab === t.id ? "border-accent text-text" : "border-transparent text-text-dim hover:text-text"}`}
          >
            {t.label}
            {t.id === "trace" && traceView.reduced.errors.length ? <span className="ml-1 text-red">· {traceView.reduced.errors.length}</span> : null}
          </button>
        ))}
        {tab !== "out" && traceView.summary ? <span className="ml-auto truncate pr-2 text-[11px] text-text-dim" data-drawer-summary>{traceView.summary}</span> : null}
      </nav>

      {tab === "log" ? (
        <div className="min-h-0 flex-1 px-4 py-3">
          <LogsView
            full
            big={expanded}
            redact={redact}
            downloadName={`log-${worker.id}.txt`}
            lines={
              traceView.data.events.length
                ? traceLogLines(traceView.reduced, redact, publicView)
                : stream
                  ? stream.map((l) => ({ kind: l.kind, text: l.text, t: l.t }))
                  : worker.lines.map((text) => ({ kind: "text", text }))
            }
            source={
              traceView.data.events.length
                ? "Log completo de su traza: cada evento con su contenido entero (input de cada tool, lo que devolvió, texto del modelo, permisos)"
                : traceView.data.status === "loading"
                  ? "Cargando su traza…"
                  : stream
                    ? "Esta sesión no tiene traza: el stream de su run"
                    : "Esta sesión no tiene traza (no pasa por los puntos que la graban): sus últimas líneas"
            }
          />
        </div>
      ) : tab === "trace" ? (
        <TraceList reduced={traceView.reduced} redact={redact} publicView={publicView} size={expanded ? "xl" : "md"} focusSeq={focusSeq} onFocusSeq={setFocusSeq} handleRef={listRef} emptyText={traceView.data.status === "missing" ? "El agente no tiene la traza de esta sesión (empezó antes de que existiera o ya no está en disco)." : "Esperando el primer evento…"} />
      ) : tab === "tools" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <InventoryList
            cards={traceView.cards}
            redact={redact}
            big={expanded}
            onJump={(step) => {
              const st = traceView.reduced.steps[step - 1];
              if (!st) return;
              setTab("trace");
              requestAnimationFrame(() => listRef.current?.jumpTo(st.useSeq));
            }}
          />
        </div>
      ) : tab === "prompt" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <PromptView prompt={traceView.data.prompt} publicView={publicView} ctx={publicCtx} redact={redact} big={expanded} />
        </div>
      ) : (
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className={`min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono leading-relaxed ${expanded ? "text-sm" : "text-xs"}`}
      >
        {lines.length === 0 ? (
          <p className="text-text-faint">Sin salida todavía.</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`break-words whitespace-pre-wrap ${KIND_CLASS[l.kind] ?? "text-text"}`}>
              {redact(l.text)}
            </div>
          ))
        )}
        {isRun && stream === null ? (
          <p className="mt-2 text-text-faint">El run ya salió de memoria del agente: estas son sus últimas líneas.</p>
        ) : null}
      </div>
      )}

      {/* Conversación por voz: continúa la sesión del run (o abre uno nuevo en su proyecto). */}
      <section className="border-t border-line bg-panel-2/40 px-4 py-3">
        {worker.source === "run" ? (
          <div className="mb-3">
            <ModePicker value={mode} onChange={onModeChange} padConnected={padConnected} note={modeNote(mode, model)} />
            {plan ? (
              <p className="mt-1 text-xs text-text-faint">Así ejecutará el plan cuando lo apruebes (Plan = Auto).</p>
            ) : active ? (
              <p className="mt-1 text-xs text-text-faint">Un run que ya corre no cambia de modo: se aplica cuando le vuelvas a hablar.</p>
            ) : null}
          </div>
        ) : null}
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
