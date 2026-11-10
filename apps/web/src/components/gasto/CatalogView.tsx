"use client";

// EL CATÁLOGO: qué modelo usa cada función EN ESTE AGENTE y de dónde salió esa
// decisión (la tabla de agent/models.ts o una variable de entorno, que gana).
// Agrupado por nivel porque así se decide: el nivel fija el modelo y el precio;
// la función solo elige nivel.
//
// Se lee, no se opera: cambiar un modelo es cambiar una variable y reiniciar el
// agente, y la vista lo dice en vez de fingir un control.

import { Badge } from "@/components/ui/Badge";
import type { CatalogFeature, CatalogTier, UsageCatalog } from "@/lib/usage-api";
import { EFFORT_LABEL, TIER_LABEL, TIER_ORDER, modelName } from "./format";

function price(n: number): string {
  return `$${n < 1 ? n.toFixed(2) : n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

function settings(f: CatalogFeature): string {
  return [f.effort ? EFFORT_LABEL[f.effort] : null, f.thinking === "off" ? "sin razonamiento" : f.thinking === "adaptive" ? "razonamiento adaptativo" : null]
    .filter(Boolean)
    .join(" · ");
}

function TierHeader({ tier, count }: { tier: CatalogTier; count: number }) {
  const swapped = tier.source === "env";
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
      <h2 className="text-sm font-medium text-text">{TIER_LABEL[tier.tier]}</h2>
      <span className="text-sm text-text-dim">{swapped ? <span className="font-mono text-xs">{tier.active}</span> : tier.label}</span>
      <span className="text-xs text-text-faint tabular-nums">
        {swapped
          ? `cambiado por variable (de lista sería ${tier.label}: el precio de lista no aplica)`
          : `${price(tier.inputUsd)} entrada · ${price(tier.outputUsd)} salida, por millón de tokens`}
      </span>
      <span className="ml-auto text-xs text-text-faint tabular-nums">{count === 1 ? "1 función" : `${count} funciones`}</span>
    </header>
  );
}

export function CatalogView({ catalog }: { catalog: UsageCatalog }) {
  const overrides = catalog.features.filter((f) => f.source === "env").length;
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-[80ch] text-sm text-text-dim">
        Qué modelo usa cada función en este agente.{" "}
        {overrides > 0
          ? `${overrides === 1 ? "Una función tiene" : `${overrides} funciones tienen`} el modelo puesto por una variable de entorno, que gana sobre el catálogo.`
          : "Ninguna función tiene el modelo cambiado por variable: todo sale del catálogo."}{" "}
        Los precios son de lista, por millón de tokens.
      </p>

      {TIER_ORDER.map((key) => {
        const tier = catalog.tiers.find((t) => t.tier === key);
        const items = catalog.features.filter((f) => f.tier === key);
        if (!tier) return null;
        return (
          <section key={key} data-tier={key} className="flex flex-col">
            <TierHeader tier={tier} count={items.length} />
            {items.length === 0 ? (
              <p className="py-3 text-sm text-text-faint">
                Ninguna función usa este nivel por defecto; queda disponible por variable.
              </p>
            ) : (
              <ul className="flex flex-col">
                {items.map((f) => {
                  const extra = settings(f);
                  // El modelo solo se repite en la fila cuando NO es el del nivel (esa es la noticia).
                  const differs = f.model !== tier.active;
                  return (
                    <li
                      key={f.feature}
                      data-feature={f.feature}
                      className="grid grid-cols-1 items-baseline gap-x-4 gap-y-0.5 border-b border-line px-2 py-2 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-text">{f.label}</p>
                        <p className="truncate font-mono text-xs text-text-faint">{f.feature}</p>
                      </div>
                      <p className="min-w-0 text-xs break-words text-text-dim">
                        {differs && <span className="font-mono text-text">{modelName(f.model, null, catalog.tiers)}</span>}
                        {differs && extra ? " · " : ""}
                        {extra}
                      </p>
                      <span className="justify-self-start sm:justify-self-end">
                        {f.source === "env" ? (
                          <Badge size="sm">por variable</Badge>
                        ) : (
                          <span className="text-xs text-text-faint">catálogo</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <p className="max-w-[80ch] text-xs text-text-faint">
        Para cambiar el modelo de una función: <span className="font-mono">HERMES_MODEL_&lt;FUNCION&gt;</span> (por ejemplo{" "}
        <span className="font-mono">HERMES_MODEL_COPILOT_FAST</span>); para un nivel entero,{" "}
        <span className="font-mono">HERMES_MODEL_TIER_&lt;NIVEL&gt;</span>. Se lee al arrancar el agente.
      </p>
    </div>
  );
}
