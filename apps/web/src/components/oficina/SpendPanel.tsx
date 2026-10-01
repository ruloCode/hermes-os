"use client";

// Detalle del tablero de gasto de la Oficina (E o clic en la pared, o el
// monitor del CEO). Todo sale de GET /office/spend; cada bloque dice de dónde:
//   · Hoy y la serie diaria: los archivos diarios de usage.ts.
//   · Por proyecto / por modelo / recientes: el registro por run (desde `since`).
//   · Por agente vivo: lo que el CLI reportó de ese run (tokens mientras corre,
//     costo al terminar).
// Esc o B cierra.

import { useState } from "react";
import { formatPlanReset, formatTokens, formatUsd, totalTokens, type OfficeSpend, type PlanUsage, type SpendRow } from "@hermes/shared";
import { Sparkline } from "@/components/ui/Sparkline";
import { PadGlyph } from "./VoiceComposer";

const glass = "border border-line bg-panel/95 shadow-xl backdrop-blur-md";

const STATUS_DOT: Record<string, string> = {
  starting: "bg-text-faint",
  working: "bg-amber",
  thinking: "bg-cyan",
  blocked: "bg-red",
  needs_you: "bg-accent",
  done: "bg-green",
  error: "bg-red",
};

function day(d: string): string {
  const [, m, dd] = d.split("-").map(Number);
  return `${dd}/${m}`;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Rows({ rows, label }: { rows: SpendRow[]; label: (k: string) => string }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.costUsd));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
          <span className="truncate text-text">{label(r.key)}</span>
          <span className="font-mono text-text tabular-nums">{formatUsd(r.costUsd)}</span>
          <span className="col-span-2 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.costUsd / max) * 100)}%` }} />
            </span>
            <span className="w-28 shrink-0 text-right text-xs text-text-dim tabular-nums">
              {r.runs === 1 ? "1 run" : `${r.runs} runs`} · {formatTokens(totalTokens(r.tokens))} tok
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * El uso del plan de Claude, como en la página de uso de claude.ai: sesión
 * actual (5 h), esta semana y los límites semanales propios de un modelo
 * (Fable…). Fuente: GET /office/plan-usage (el /usage del CLI).
 */
function PlanUsageRows({ plan }: { plan: PlanUsage | null | undefined }) {
  if (plan === undefined) return <p className="text-sm text-text-dim">Cargando el uso del plan…</p>;
  if (plan === null) return <p className="text-sm text-text-dim">Uso del plan: sin datos (el agente no respondió).</p>;
  if (!plan.available || !plan.windows.length) return <p className="text-sm text-text-dim">{plan.error ?? "Sin límites de plan en esta sesión."}</p>;
  const now = new Date();
  return (
    <ul className="divide-y divide-line" data-plan-usage>
      {plan.windows.map((w) => {
        const reset = formatPlanReset(w.resetsAt, now, w.key !== "five_hour");
        const tone = w.utilization >= 95 ? "bg-red" : w.utilization >= 80 ? "bg-amber" : "bg-blue";
        return (
          <li key={w.key} className="grid grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)_6.5rem] items-center gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">{w.label}</p>
              <p className="text-xs text-text-dim">{[w.note, reset].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="meter" aria-label={w.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.utilization)}>
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(1, w.utilization)}%` }} />
            </div>
            <p className="text-right text-sm text-text-dim tabular-nums">{Math.round(w.utilization)}% usado</p>
          </li>
        );
      })}
    </ul>
  );
}

export function SpendPanel({
  data,
  plan,
  projectName,
  nicks,
  refreshing,
  padConnected,
  onRefresh,
  onGoTo,
  onClose,
}: {
  /** undefined = cargando · null = el agente no respondió. */
  data: OfficeSpend | null | undefined;
  /** Uso del plan de Claude (sesión, semana, por modelo). */
  plan: PlanUsage | null | undefined;
  projectName: (slug: string) => string;
  nicks: ReadonlyMap<string, string>;
  refreshing: boolean;
  padConnected: boolean;
  onRefresh: () => void;
  /** Ir con un agente vivo (cierra el panel). */
  onGoTo: (id: string) => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState<"today" | "week">("today");
  const t = data?.today.tokens ?? null;
  const known = data?.series.filter((p) => p.known) ?? [];
  const week = data?.series.slice(-7) ?? [];
  const weekMax = Math.max(0.01, ...week.map((p) => p.costUsd));
  const projects = data ? (range === "today" ? data.byProject.today : data.byProject.week) : [];
  const models = data?.byModel ? (range === "today" ? data.byModel.today : data.byModel.week) : [];

  return (
    <section
      role="dialog"
      aria-label="Uso de Claude"
      className={`pointer-events-auto absolute top-1/2 left-1/2 z-40 flex max-h-[86vh] w-[min(68rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl ${glass}`}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold text-text">Uso de Claude</h2>
        <span className="text-xs text-text-dim">
          {plan?.subscription ? `plan ${plan.subscription} · ` : ""}límites del plan (lo mismo que /usage) y gasto de los agentes
        </span>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="ml-auto rounded-md px-2 py-1 text-sm text-text-dim hover:bg-panel-2 hover:text-text disabled:opacity-50">
          {refreshing ? "Actualizando…" : "↻ Actualizar"}
        </button>
        <button type="button" onClick={onClose} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-text-dim hover:bg-panel-2 hover:text-text" aria-label="Cerrar">
          {padConnected ? <PadGlyph b="B" /> : null}✕
        </button>
      </header>

      <div className="border-b border-line px-5 pt-2 pb-1">
        <PlanUsageRows plan={plan} />
      </div>

      {!data ? (
        <p className="px-5 py-10 text-center text-sm text-text-dim">{data === null ? "Sin datos: el agente no respondió." : "Cargando…"}</p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-8 gap-y-6 overflow-y-auto px-5 py-4 lg:grid-cols-2">
          {/* Hoy: el archivo diario. */}
          <div className="space-y-3">
            <p className="text-xs text-text-dim">
              Gasto equivalente hoy · {day(data.today.day)} · runs de claude -p y tareas de Hermes (sin chat, juntas ni Estudio)
            </p>
            <div className="flex items-end gap-6">
              <p className="font-mono text-4xl font-semibold text-text tabular-nums" data-spend-today>
                {formatUsd(data.today.costUsd)}
              </p>
              <p className="pb-1 text-sm text-text-dim">{data.today.runs === 1 ? "1 ejecución terminada" : `${data.today.runs} ejecuciones terminadas`}</p>
            </div>
            {t ? (
              <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
                {(
                  [
                    ["Entrada", t.inputTokens],
                    ["Salida", t.outputTokens],
                    ["Caché creada", t.cacheCreationTokens],
                    ["Caché leída", t.cacheReadTokens],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="bg-panel px-3 py-2">
                    <dt className="text-text-dim">{k}</dt>
                    <dd className="mt-0.5 font-mono text-sm text-text tabular-nums">{formatTokens(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-text-dim">El archivo de hoy no trae tokens.</p>
            )}
            {/* Serie diaria: 7 días en barras y la tendencia de 30. */}
            <div>
              <p className="mb-2 text-xs text-text-dim">Últimos 7 días</p>
              {week.length ? (
                <div className="flex h-24 items-end gap-2">
                  {week.map((p) => (
                    <div key={p.day} className="flex flex-1 flex-col items-center gap-1" title={p.known ? `${day(p.day)}: ${formatUsd(p.costUsd)} · ${p.runs} runs` : `${day(p.day)}: sin dato`}>
                      <span className="text-[11px] text-text-dim tabular-nums">{p.known && p.costUsd > 0 ? formatUsd(p.costUsd) : ""}</span>
                      <span
                        className={`w-full rounded-t ${p.known ? "bg-accent" : "bg-panel-2"}`}
                        style={{ height: p.known ? `${Math.max(2, (p.costUsd / weekMax) * 64)}px` : "2px" }}
                      />
                      <span className="text-[11px] text-text-dim">{day(p.day)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-dim">Sin histórico en esta máquina.</p>
              )}
              {known.length > 7 ? (
                <div className="mt-3 flex items-center gap-3">
                  <Sparkline data={known.map((p) => p.costUsd)} width={260} height={36} fill tone="accent" />
                  <span className="text-xs text-text-dim">
                    30 días · {formatUsd(known.reduce((a, p) => a + p.costUsd, 0))} · desde {day(known[0].day)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Por agente: los vivos (lo que reportó su run) y los últimos que terminaron (registro). */}
          <div className="space-y-3">
            <p className="text-xs text-text-dim">Por agente</p>
            {data.live.length ? (
              <ul className="space-y-1">
                {data.live.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => onGoTo(l.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[l.status] ?? "bg-text-faint"}`} />
                      <span className="min-w-0 flex-1 truncate text-text">
                        {nicks.get(l.id) ? `${nicks.get(l.id)} · ` : ""}
                        {l.name} <span className="text-text-dim">· {projectName(l.project)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-text tabular-nums">
                        {l.spend?.final ? formatUsd(l.spend.costUsd) : l.spend ? `${formatTokens(totalTokens(l.spend.tokens))} tok` : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-dim">Ningún agente vivo en la oficina.</p>
            )}
            {data.live.some((l) => l.spend && !l.spend.final) ? (
              <p className="text-xs text-text-dim">Mientras corre, el CLI reporta tokens; el costo llega al terminar.</p>
            ) : null}
            {data.recent.length ? (
              <>
                <p className="pt-2 text-xs text-text-dim">Terminaron hace poco</p>
                <ul className="space-y-1 text-sm">
                  {data.recent.slice(0, 8).map((e) => (
                    <li key={`${e.id}-${e.ts}`} className="flex items-center gap-2 px-2">
                      <span className="w-11 shrink-0 text-xs text-text-dim tabular-nums">{hhmm(e.ts)}</span>
                      <span className="min-w-0 flex-1 truncate text-text">
                        {e.title} <span className="text-text-dim">· {projectName(e.project)}</span>
                      </span>
                      <span className={`shrink-0 font-mono text-xs tabular-nums ${e.status === "error" ? "text-red" : "text-text"}`}>{formatUsd(e.costUsd)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          {/* Por proyecto y por modelo: el registro por run (existe desde `since`). */}
          <div className="space-y-3 lg:col-span-2">
            <div className="flex items-center gap-3">
              <p className="text-xs text-text-dim">Por proyecto{data.byModel ? " y por modelo" : ""}</p>
              <div className="flex rounded-lg border border-line p-0.5 text-xs" role="tablist">
                {(["today", "week"] as const).map((r) => (
                  <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={`rounded-md px-2.5 py-1 ${range === r ? "bg-accent text-white" : "text-text-dim hover:text-text"}`}>
                    {r === "today" ? "Hoy" : "7 días"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-text-dim">{data.since ? `registro por run desde el ${day(data.since)}` : "el registro por run empieza con el próximo que termine"}</span>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
              <div>{projects.length ? <Rows rows={projects} label={projectName} /> : <p className="text-sm text-text-dim">{data.since ? "Nada en este rango." : "Sin desglose todavía."}</p>}</div>
              {data.byModel ? <div>{models.length ? <Rows rows={models} label={(k) => k} /> : <p className="text-sm text-text-dim">Nada en este rango.</p>}</div> : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
