"use client";

// MODO TARIMA (tecla P): la Oficina "por dentro" para un proyector de 1920×1080,
// legible a 10 metros. Un área grande con la traza del loop, al lado el
// escritorio del agente en la oficina 3D (la página pone el canvas en ese
// hueco y la cámara lo sigue) y abajo tres pestañas: Tools, System prompt y
// Logs. Desde aquí se le da la tarea al escritorio General (el agente del SDK),
// escrita o dictada. La vista pública viene prendida, con su indicador.
//
// Teclado: P/Esc salir · 1 2 3 pestañas · ← → pestañas · ↑ ↓ (j k) recorrer la
// traza · Enter desplegar · End seguir el final · Tab otro agente · N escribir
// · M dictar · O vista pública. Control: cruceta, A, X, LB/RB, View.

import { useEffect, useMemo, useRef } from "react";
import { officeModeFromCli, officeModeLabel, type OfficeWorker, type PublicViewContext } from "@hermes/shared";
import type { OfficeDictation } from "@/hooks/useOfficeDictation";
import type { Redact } from "@/lib/oficina/public-view";
import { TraceList, type TraceListHandle } from "./TraceList";
import { InventoryList } from "./InventoryList";
import { PromptView } from "./PromptView";
import { LogsView, type LogLine } from "./LogsView";
import type { TraceView } from "./useTraceView";

export type StageTab = "tools" | "prompt" | "logs";
export const STAGE_TABS: StageTab[] = ["tools", "prompt", "logs"];
const TAB_LABEL: Record<StageTab, string> = { tools: "Tools", prompt: "System prompt", logs: "Logs" };

/** Dónde va el canvas 3D en tarima (la página lo posiciona con esto). */
export const STAGE_SCENE_STYLE: React.CSSProperties = { position: "absolute", left: "calc(60% + 8px)", top: 84, right: 16, bottom: "calc(40% + 8px)" };

const STATUS: Record<OfficeWorker["status"], { label: string; cls: string }> = {
  starting: { label: "arrancando", cls: "bg-panel-2 text-text-dim" },
  working: { label: "trabajando", cls: "bg-amber/20 text-amber" },
  thinking: { label: "pensando", cls: "bg-cyan/20 text-cyan" },
  blocked: { label: "bloqueado", cls: "bg-red/20 text-red" },
  needs_you: { label: "te necesita", cls: "bg-accent/25 text-accent" },
  done: { label: "listo", cls: "bg-green/20 text-green" },
  error: { label: "error", cls: "bg-red/20 text-red" },
};

export function StageView({
  traceId,
  worker,
  nick,
  projectName,
  view,
  redact,
  publicView,
  publicCtx,
  hiddenCount,
  onTogglePublic,
  tab,
  onTab,
  logs,
  logsSource,
  replay,
  replayHint,
  simulated,
  focusSeq,
  onFocusSeq,
  listRef,
  voice,
  sending,
  onSubmit,
  onExit,
  onExport,
  agentIndex,
  agentCount,
  padConnected,
  inputRef,
  deciding,
  onDecide,
}: {
  traceId: string | null;
  worker: OfficeWorker | undefined;
  nick?: string;
  projectName: string;
  view: TraceView;
  redact: Redact;
  publicView: boolean;
  publicCtx: PublicViewContext;
  hiddenCount: number;
  onTogglePublic: () => void;
  tab: StageTab;
  onTab: (t: StageTab) => void;
  logs: LogLine[] | null;
  logsSource: string;
  /** "repetición de las 19:42" o null si es en vivo. */
  replay: string | null;
  /** Cómo se sale de la repetición ("cualquier tecla vuelve a lo vivo" / "R vuelve a lo vivo"). */
  replayHint?: string;
  simulated: boolean;
  focusSeq: number | null;
  onFocusSeq: (seq: number | null) => void;
  listRef: React.MutableRefObject<TraceListHandle | null>;
  voice: OfficeDictation;
  sending: boolean;
  onSubmit: () => void;
  onExit: () => void;
  onExport: (() => void) | null;
  agentIndex: number;
  agentCount: number;
  padConnected: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  deciding: boolean;
  /** El agente levantó la mano: aprobar (A) o negar (B) sin salir de la tarima. */
  onDecide: (allow: boolean) => void;
}) {
  const { data, reduced, cards, summary } = view;
  const model = reduced.init?.model;
  const mode = reduced.init?.permissionMode;
  const source = data.meta?.source;
  const title = worker ? redact(nick ? `${nick} · ${worker.name}` : worker.name) : data.meta ? redact(data.meta.title.split("\n").pop() ?? "") : "";
  const hasErrors = reduced.errors.length > 0;
  const dictating = voice.state === "listening" || voice.state === "transcribing";
  const text = dictating ? voice.interim || voice.text : voice.text;

  // Saltar desde una ficha de tool a su paso en la traza.
  const jumpToStep = (step: number) => {
    const s = reduced.steps[step - 1];
    if (s) listRef.current?.jumpTo(s.useSeq);
  };

  const live = !replay && !simulated;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // Un run de claude -p tiene uno de los modos de Claude Code; una tarea del SDK corre en "default" + canUseTool.
  const modeLabel = useMemo(() => {
    if (!mode) return null;
    const m = source === "cli" ? officeModeFromCli(mode) : undefined;
    return m ? officeModeLabel(m) : `${mode} + canUseTool`;
  }, [mode, source]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 text-text" data-stage data-stage-tab={tab} data-public-view={publicView ? "on" : "off"}>
      {/* Fondo: todo opaco menos el hueco de la oficina 3D. */}
      <div className="absolute inset-x-0 top-0 h-[84px] bg-bg" />
      <div className="absolute top-[84px] bottom-0 left-0 w-[calc(60%+8px)] bg-bg" />
      <div className="absolute top-[84px] right-0 bottom-0 w-4 bg-bg" />
      <div className="absolute right-0 bottom-0 left-[calc(60%+8px)] h-[calc(40%+8px)] bg-bg" />

      <header className="pointer-events-auto absolute inset-x-4 top-3 flex h-[66px] items-center gap-4">
        {live ? (
          <span className="flex shrink-0 items-center gap-2 rounded-full bg-green/15 px-3 py-1 text-[20px] font-semibold text-green" data-stage-live>
            <span className="h-3 w-3 animate-pulse rounded-full bg-green" /> EN VIVO
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-amber/20 px-3 py-1 text-[20px] font-semibold text-amber" data-stage-replay>
            {replay ? `⟲ ${replay}` : "simulación"}
            {replay ? <span className="ml-2 text-[15px] font-normal text-amber/80">{replayHint}</span> : null}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[28px] leading-8 font-semibold" data-stage-title>
            {title || "Sin agente seleccionado"}
          </p>
          <p className="truncate text-[18px] text-text-dim">
            {[
              projectName,
              source === "sdk" ? "Tarea del Agent SDK" : source === "cli" ? "Run de claude -p" : null,
              model,
              modeLabel ? `modo ${modeLabel}` : null,
              agentCount > 1 ? `agente ${agentIndex + 1} de ${agentCount} (Tab)` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {worker ? <span className={`shrink-0 rounded-full px-3 py-1 text-[20px] ${STATUS[worker.status].cls}`}>{STATUS[worker.status].label}</span> : null}
        <button
          type="button"
          onClick={onTogglePublic}
          data-public-toggle
          title="O: vista pública (oculta secretos, correos, teléfonos, proyectos de clientes y lo personal)"
          className={`shrink-0 rounded-full px-3 py-1 text-[18px] font-medium ${publicView ? "bg-green/15 text-green" : "bg-red text-white"}`}
        >
          {publicView ? `👁 Vista pública · ${hiddenCount} proyectos ocultos` : "⚠ Vista pública APAGADA"}
        </button>
        {onExport ? (
          <button type="button" onClick={onExport} className="shrink-0 rounded-md px-2 py-1 text-[16px] text-text-dim hover:bg-panel-2 hover:text-text" title="Exportar la traza en JSONL (vista pública)">
            ⤓ JSONL
          </button>
        ) : null}
        <button type="button" onClick={onExit} className="shrink-0 rounded-md px-3 py-1 text-[18px] text-text-dim hover:bg-panel-2 hover:text-text" aria-label="Salir del modo tarima">
          P · salir
        </button>
      </header>

      {/* Traza (área grande) */}
      <section className="pointer-events-auto absolute top-[84px] left-4 flex w-[calc(60%-24px)] flex-col overflow-hidden rounded-xl border border-line bg-panel" style={{ bottom: "calc(40% + 8px)" }}>
        <div className="flex items-baseline gap-3 border-b border-line px-4 py-2">
          <h2 className="text-[24px] font-semibold">Traza del loop</h2>
          <span className="text-[18px] text-text-dim tabular-nums">{data.events.length} eventos</span>
          <span className={`min-w-0 flex-1 truncate text-right text-[19px] tabular-nums ${hasErrors ? "text-text" : "text-text-dim"}`} data-stage-summary>
            {summary}
          </span>
        </div>
        {hasErrors ? (
          <div className="flex flex-wrap gap-2 border-b border-line bg-red/5 px-4 py-1.5 text-[17px]" data-stage-errors>
            {reduced.errors.map((e, i) => (
              <button key={e.seq} type="button" onClick={() => listRef.current?.jumpTo(e.seq)} className="rounded-md bg-red/10 px-2 text-red hover:bg-red/20">
                ✗ {i + 1}.º {e.tool ?? "error"}
                {e.step ? ` (paso ${e.step})` : ""}
                {e.fixedBy ? <span className="text-green"> → corregido en el {e.fixedBy.step}</span> : " · sin corregir"}
              </button>
            ))}
          </div>
        ) : null}
        {worker?.approval ? (
          <div className="flex items-center gap-3 border-b border-accent/40 bg-accent/10 px-4 py-2" data-stage-approval aria-live="assertive">
            <span className="shrink-0 text-[22px]">✋</span>
            <div className="min-w-0 flex-1">
              <p className="text-[19px] font-semibold text-text">{worker.approval.tool === "ExitPlanMode" ? "Propone un plan" : "Pide permiso para ejecutar"}</p>
              <p className="truncate font-mono text-[18px] text-text">{worker.approval.detail}</p>
            </div>
            <button type="button" disabled={deciding} onClick={() => onDecide(true)} className="shrink-0 rounded-md bg-accent px-4 py-1.5 text-[19px] font-medium text-white disabled:opacity-50" data-stage-approve>
              Aprobar (A)
            </button>
            <button type="button" disabled={deciding} onClick={() => onDecide(false)} className="shrink-0 rounded-md border border-line px-4 py-1.5 text-[19px] text-text hover:border-red hover:text-red disabled:opacity-50">
              Negar (B)
            </button>
          </div>
        ) : null}
        <TraceList
          reduced={reduced}
          redact={redact}
          publicView={publicView}
          size="xl"
          focusSeq={focusSeq}
          onFocusSeq={onFocusSeq}
          handleRef={listRef}
          emptyText={traceId ? (data.status === "loading" ? "Cargando la traza…" : data.status === "missing" ? "El agente no tiene la traza de esta sesión." : "Esperando el primer evento…") : "No hay agentes vivos. Dale una tarea a Hermes aquí abajo (N escribir · M dictar)."}
        />
        {/* La tarea al escritorio General: el agente del Agent SDK. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex items-center gap-2 border-t border-line bg-panel-2/40 px-3 py-2"
          data-stage-composer
        >
          <span className="shrink-0 text-[17px] text-text-dim">Tarea para Hermes (General · SDK)</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => voice.edit(e.target.value)}
            disabled={dictating || simulated || !!replay}
            placeholder={replay || simulated ? "En la repetición no se envía nada" : "Ej.: corre los tests de shared y arregla lo que falle"}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-1.5 text-[20px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            data-stage-input
          />
          <button
            type="button"
            onClick={() => (dictating ? voice.stop() : voice.start())}
            disabled={simulated || !!replay}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[18px] ${dictating ? "bg-red text-white" : "border border-line text-text hover:bg-panel-2"} disabled:opacity-40`}
          >
            {dictating ? "■ Parar" : `🎤 Dictar (${padConnected ? "X" : "M"})`}
          </button>
          <button type="submit" disabled={sending || !voice.text.trim() || dictating || simulated || !!replay} className="shrink-0 rounded-md bg-accent px-4 py-1.5 text-[18px] font-medium text-white disabled:opacity-40">
            {sending ? "Enviando…" : `Enviar (${padConnected ? "A" : "Enter"})`}
          </button>
        </form>
      </section>

      {/* Pestañas de abajo */}
      <section className="pointer-events-auto absolute right-4 bottom-4 left-4 flex flex-col overflow-hidden rounded-xl border border-line bg-panel" style={{ top: "calc(60% + 8px)" }}>
        <nav className="flex items-center gap-1 border-b border-line px-2" role="tablist">
          {STAGE_TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-stage-tab-button={t}
              onClick={() => onTab(t)}
              className={`border-b-2 px-4 py-2 text-[22px] ${tab === t ? "border-accent font-semibold text-text" : "border-transparent text-text-dim hover:text-text"}`}
            >
              <span className="mr-2 text-[16px] text-text-faint">{i + 1}</span>
              {TAB_LABEL[t]}
              {t === "tools" && cards.length ? <span className="ml-2 text-[17px] text-text-faint">{cards.filter((c) => c.steps.length).length}/{cards.length}</span> : null}
            </button>
          ))}
          <span className="ml-auto pr-2 text-[16px] text-text-faint">{padConnected ? "cruceta ◀ ▶ pestañas · ▲ ▼ traza · A desplegar" : "← → pestañas · ↑ ↓ traza · Enter desplegar · End seguir · R repetición"}</span>
        </nav>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "tools" ? <InventoryList cards={cards} redact={redact} big onJump={jumpToStep} note={source === "sdk" ? "permisos: la configuración de session.ts" : source === "cli" ? "permisos: el modo del run + las reglas deny" : undefined} /> : null}
          {tab === "prompt" ? <PromptView prompt={data.prompt} publicView={publicView} ctx={publicCtx} redact={redact} big /> : null}
          {tab === "logs" ? <LogsView lines={logs} source={logsSource} redact={redact} big /> : null}
        </div>
      </section>
    </div>
  );
}
