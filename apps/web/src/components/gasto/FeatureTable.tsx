"use client";

// POR FUNCIÓN: la tabla que responde "¿en qué se va el gasto?". Llega ordenada
// por costo desde el agente (summarizeCalls) y aquí no se reordena.
//
// Jerarquía de cada fila: qué función es → cuánto costó → cuánta de su entrada
// salió de caché (la barra de color). Tokens y latencias son contexto, en gris.
//
// Dos formas del MISMO dato según el ancho de la columna (container query, no
// de la ventana): tabla con columnas alineadas cuando caben, y filas apiladas
// cuando no (bajo 64rem: las columnas mínimas suman ~62rem) — una tabla de ocho columnas con scroll lateral esconde justo lo
// que más importa.
//
// Dato o nada: una latencia sin muestras deja la celda vacía y un costo que el
// SDK no informó dice «sin dato».

import { formatTokens, type FeatureUsage } from "@hermes/shared";
import type { CatalogTier, UsageModelInfo } from "@/lib/usage-api";
import { CacheBar, promptSummary, promptTokens } from "./CacheBar";
import { duration, modelName, percent, usd } from "./format";

const COLS =
  "grid-cols-[minmax(11rem,1.5fr)_4.25rem_4.5rem_4.5rem_minmax(9rem,1fr)_10.5rem_5rem_6rem]";

function calls(n: number): string {
  return n === 1 ? "1 llamada" : `${n} llamadas`;
}

export function FeatureTable({
  features,
  labels,
  models,
  tiers,
  totalCost,
}: {
  features: FeatureUsage[];
  /** feature → para qué se usa (del catálogo). Sin entrada, se muestra la clave. */
  labels: Map<string, string>;
  models: Record<string, UsageModelInfo>;
  tiers: CatalogTier[] | null;
  /** Costo del periodo, para la parte de cada función. null = el SDK no informó costos. */
  totalCost: number | null;
}) {
  const maxCost = Math.max(0, ...features.map((f) => f.costUsd ?? 0));

  const rows = features.map((f) => {
    const p50 = duration(f.p50Ms);
    const p95 = duration(f.p95Ms);
    return {
      f,
      label: labels.get(f.feature) ?? f.feature,
      modelNames: f.models.map((m) => modelName(m, models, tiers)).join(" · "),
      cache: percent(f.cacheRatio),
      p50,
      p95,
      ttft: duration(f.p50TtftMs),
      latency: p50 && p95 ? `${p50} · ${p95}` : p50,
      share: f.costUsd != null && totalCost ? percent(f.costUsd / totalCost) : null,
      bar: f.costUsd != null && maxCost > 0 ? f.costUsd / maxCost : null,
      prompt: promptTokens(f),
    };
  });

  return (
    <div className="@container">
      {/* ── Ancho: columnas alineadas ─────────────────────────────── */}
      <div role="table" aria-label="Gasto por función" className="hidden @5xl:block">
        <div role="row" className={`grid ${COLS} items-end gap-x-4 border-b border-line px-2 pb-2 text-xs text-text-faint`}>
          <span role="columnheader">Función</span>
          <span role="columnheader" className="text-right">Llamadas</span>
          <span role="columnheader" className="text-right">Entrada</span>
          <span role="columnheader" className="text-right">Salida</span>
          <span role="columnheader">Entrada desde caché</span>
          <span role="columnheader" className="text-right" title="Duración del turno: mediana y percentil 95, sobre los que terminaron bien">
            Duración p50 · p95
          </span>
          <span role="columnheader" className="text-right" title="Tiempo al primer texto (mediana)">
            1.er texto
          </span>
          <span role="columnheader" className="text-right">Costo est.</span>
        </div>
        {rows.map(({ f, label, modelNames, cache, latency, ttft, share, bar, prompt }) => (
          <div
            key={f.feature}
            role="row"
            data-feature={f.feature}
            className={`grid ${COLS} items-center gap-x-4 rounded-sm border-b border-line px-2 py-2.5 text-sm transition-colors hover:bg-hover`}
          >
            <div role="cell" className="min-w-0">
              <p className="truncate text-text" title={`${label} · ${f.feature}`}>
                {label}
              </p>
              <p className="truncate text-xs text-text-faint">
                {modelNames}
                {f.errors > 0 && <span className="text-red"> · {f.errors} con error</span>}
              </p>
            </div>
            <span role="cell" className="text-right text-text-dim tabular-nums">
              {f.calls}
            </span>
            <span role="cell" className="text-right text-text-dim tabular-nums" title={promptSummary(f) ?? undefined}>
              {prompt > 0 ? formatTokens(prompt) : ""}
            </span>
            <span role="cell" className="text-right text-text-dim tabular-nums">
              {f.output > 0 ? formatTokens(f.output) : ""}
            </span>
            <div role="cell" className="flex min-w-0 items-center gap-3">
              {cache ? (
                <>
                  <span className="w-10 shrink-0 text-right font-medium text-text tabular-nums">{cache}</span>
                  <CacheBar parts={f} size="md" />
                </>
              ) : (
                <span className="text-xs text-text-faint">sin tokens de entrada</span>
              )}
            </div>
            <span role="cell" className="text-right whitespace-nowrap text-text-dim tabular-nums">
              {latency ?? ""}
            </span>
            <span role="cell" className="text-right text-text-dim tabular-nums">
              {ttft ?? ""}
            </span>
            <div role="cell" className="flex min-w-0 flex-col items-end gap-1">
              <span className={`tabular-nums ${f.costUsd == null ? "text-xs text-text-faint" : "font-medium text-text"}`}>
                {usd(f.costUsd)}
              </span>
              {bar != null && (
                <span
                  className="flex h-1 w-full justify-end overflow-hidden rounded-full bg-selected"
                  title={share ? `${share} del costo del periodo` : undefined}
                >
                  <span className="h-full rounded-full bg-text-dim" style={{ width: `${Math.max(2, bar * 100)}%` }} />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Angosto: la misma fila, apilada ───────────────────────── */}
      <ul className="flex flex-col @5xl:hidden" aria-label="Gasto por función">
        {rows.map(({ f, label, modelNames, cache, p50, p95, ttft, share, prompt }) => (
          <li key={f.feature} data-feature={f.feature} className="flex flex-col gap-2 border-b border-line py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-text">{label}</p>
              <p className={`shrink-0 tabular-nums ${f.costUsd == null ? "text-xs text-text-faint" : "text-sm font-medium text-text"}`}>
                {usd(f.costUsd)}
                {share && <span className="ml-1.5 text-xs font-normal text-text-faint">{share}</span>}
              </p>
            </div>
            {cache && (
              <div className="flex items-center gap-3">
                <CacheBar parts={f} size="md" />
                <span className="shrink-0 text-xs text-text-dim tabular-nums">
                  <b className="font-medium text-text">{cache}</b> desde caché
                </span>
              </div>
            )}
            <p className="text-xs break-words text-text-faint tabular-nums">
              {[
                modelNames,
                calls(f.calls),
                prompt > 0 ? `entrada ${formatTokens(prompt)}` : null,
                f.output > 0 ? `salida ${formatTokens(f.output)}` : null,
                p50 ? `p50 ${p50}` : null,
                p95 ? `p95 ${p95}` : null,
                ttft ? `1.er texto ${ttft}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {f.errors > 0 && <span className="text-red"> · {f.errors} con error</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
