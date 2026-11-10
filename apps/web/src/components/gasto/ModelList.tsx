"use client";

// POR MODELO: cuánto del gasto se fue a cada modelo. Pocas filas (cuatro
// niveles, más algún modelo congelado), así que es una lista con barra de
// magnitud — neutra: el nombre ya dice cuál es, el color no añadiría nada.

import { formatTokens, type ModelUsage } from "@hermes/shared";
import type { CatalogTier, UsageModelInfo } from "@/lib/usage-api";
import { promptTokens } from "./CacheBar";
import { TIER_LABEL, duration, modelName, percent, usd } from "./format";

export function ModelList({
  byModel,
  models,
  tiers,
  totalCost,
}: {
  byModel: ModelUsage[];
  models: Record<string, UsageModelInfo>;
  tiers: CatalogTier[] | null;
  totalCost: number | null;
}) {
  const costKnown = byModel.some((m) => m.costUsd != null);
  // Sin costos informados la barra mide tokens de salida (el mismo criterio con que llega ordenada).
  const magnitude = (m: ModelUsage) => (costKnown ? (m.costUsd ?? 0) : m.output);
  const max = Math.max(0, ...byModel.map(magnitude));

  return (
    <ul className="flex flex-col gap-3.5" aria-label="Gasto por modelo">
      {byModel.map((m) => {
        const name = modelName(m.model, models, tiers);
        const tier = models[m.model]?.tier ?? null;
        const share = m.costUsd != null && totalCost ? percent(m.costUsd / totalCost) : null;
        const cache = percent(m.cacheRatio);
        const p50 = duration(m.p50Ms);
        const prompt = promptTokens(m);
        return (
          <li key={m.model} data-model={m.model} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-text">
                <span className={name === m.model ? "font-mono text-xs" : ""}>{name}</span>
                {tier && <span className="ml-2 text-xs text-text-faint">{TIER_LABEL[tier]}</span>}
              </p>
              <p className={`shrink-0 tabular-nums ${m.costUsd == null ? "text-xs text-text-faint" : "text-sm font-medium text-text"}`}>
                {usd(m.costUsd)}
                {share && <span className="ml-1.5 text-xs font-normal text-text-faint">{share}</span>}
              </p>
            </div>
            {max > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-selected">
                <div className="h-full rounded-full bg-text-dim" style={{ width: `${Math.max(1, (magnitude(m) / max) * 100)}%` }} />
              </div>
            )}
            <p className="text-xs break-words text-text-faint tabular-nums">
              {[
                m.calls === 1 ? "1 llamada" : `${m.calls} llamadas`,
                prompt > 0 ? `entrada ${formatTokens(prompt)}` : null,
                m.output > 0 ? `salida ${formatTokens(m.output)}` : null,
                cache ? `${cache} desde caché` : null,
                p50 ? `p50 ${p50}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {m.errors > 0 && <span className="text-red"> · {m.errors} con error</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
