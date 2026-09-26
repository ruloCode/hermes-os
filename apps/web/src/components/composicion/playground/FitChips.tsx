"use client";

/**
 * Chips de CALCE de una línea contra el molde de su frase (patrón X/Grok: el
 * chip delta junto a cada variante). Sílabas x/y, final agudo/llano, acentos
 * que caen donde la melodía acentúa y, al respetar un melisma, si la vocal
 * estirada es abierta. Con un molde que trae posiciones (`slots`), además:
 *
 *  - ECO: cuánto conserva la línea las vocales del TARAREO (solo donde se
 *    tarareó un relleno con vocal; ponderado por duración). Sin tarareo con
 *    vocales no hay chip: no se inventa un eco que no se puede medir.
 *  - MALACENTO: una tónica que cae en un tiempo débil y corto («quería» con el
 *    acento donde la melodía no acentúa) — se oye mal dicha.
 *
 * Es medida aproximada — sinalefas posibles, acentos por regla — y la columna
 * lo rotula así. Sin `compact`, cada chip es enfocable y su explicación se
 * lee debajo al enfocarlo (no solo al pasar el mouse); en `compact` los chips
 * viven dentro de un botón (la celda de una versión), así que la explicación
 * va en el `title` y en el pie de la rejilla.
 */
import { useState } from "react";
import type { LineFit } from "@hermes/shared";
import { FIT_TEXT } from "./ui";
import { readingTokens, wordOfToken } from "./reading";

const ENDING_SHORT = { aguda: "aguda", llana: "llana", esdrujula: "esdrújula" } as const;

/** Umbrales del eco: ≥ 75 % conserva el tarareo; < 50 % lo pierde. */
export const ECO_OK = 0.75;
export const ECO_LOW = 0.5;

export const ecoTone = (score: number) => (score >= ECO_OK ? FIT_TEXT.ok : score >= ECO_LOW ? "text-text-dim" : FIT_TEXT.bad);

/** Las palabras mal acentuadas de una línea («quería»), sin repetir. */
export function misaccentWords(fit: LineFit, text?: string): string[] {
  const ms = fit.misaccents ?? [];
  if (!ms.length) return [];
  const toks = text && fit.reading ? readingTokens(text, fit.reading) : [];
  return [...new Set(ms.map((m) => wordOfToken(toks[m.pos - 1], m.syl)))];
}

/** La explicación del eco, con las posiciones donde la vocal cambia. */
export function ecoHint(fit: LineFit): string | null {
  const e = fit.echo;
  if (!e) return null;
  const pct = Math.round(e.score * 100);
  const changed = e.perSlot.filter((x) => x.sim < 1);
  const where = changed
    .slice(0, 4)
    .map((x) => `${x.pos}: «${x.want}» → ${x.got ? `«${x.got}»` : "nada"}`)
    .join(" · ");
  return changed.length
    ? `Eco ${pct} %: conserva ${e.perSlot.length - changed.length} de ${e.perSlot.length} vocales del tarareo (ponderado por duración). Cambia en ${where}${changed.length > 4 ? "…" : ""}.`
    : `Eco ${pct} %: conserva todas las vocales del tarareo (${e.perSlot.length}).`;
}

export function FitChips({ fit, compact = false, text }: { fit: LineFit | null; compact?: boolean; text?: string }) {
  const [hint, setHint] = useState<string | null>(null);
  if (!fit) return <span className="text-2xs text-text-faint">sin medida</span>;
  const syl =
    fit.range[0] !== fit.range[1] && !compact
      ? `${fit.syllables}/${fit.target} (${fit.range[0]}–${fit.range[1]})`
      : `${fit.syllables}/${fit.target}`;
  const bad = misaccentWords(fit, text);
  const echoPct = fit.echo ? Math.round(fit.echo.score * 100) : null;
  const eh = ecoHint(fit);
  const mh = bad.length
    ? `${bad.map((w) => `«${w}»`).join(", ")} ${bad.length === 1 ? "carga" : "cargan"} el acento en un tiempo débil y corto: la melodía no acentúa ahí y se oye mal dicho. Mueve la palabra o cámbiala por una que acentúe en otra sílaba.`
    : null;

  // Enfocable solo fuera de un botón (una versión es un botón: nada interactivo adentro).
  const focus = (h: string) =>
    compact
      ? { title: h }
      : {
          title: h,
          tabIndex: 0,
          onFocus: () => setHint(h),
          onBlur: () => setHint(null),
          className: "rounded-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent",
        };

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs tabular-nums">
        <span className={fit.syllablesOk ? FIT_TEXT.ok : FIT_TEXT.bad} title="Sílabas métricas / las que pide el molde">
          {fit.syllablesOk ? "✓" : "✕"} {syl}
        </span>
        <span className={fit.endingOk ? FIT_TEXT.ok : FIT_TEXT.bad} title="Final de la línea contra el de la melodía">
          {ENDING_SHORT[fit.ending]}
        </span>
        {fit.stressTotal > 0 && (
          <span
            className={fit.stressHits === fit.stressTotal ? FIT_TEXT.ok : FIT_TEXT.none}
            title="Acentos de la línea que caen en los acentos de la melodía"
          >
            acentos {fit.stressHits}/{fit.stressTotal}
          </span>
        )}
        {fit.melismaVowelOk !== null && (
          <span
            className={fit.melismaVowelOk ? FIT_TEXT.ok : FIT_TEXT.bad}
            title="En el melisma, la sílaba estirada pide vocal abierta (a, e, o) o la misma del tarareo"
          >
            vocal {fit.melismaVowelOk ? "abierta" : "cerrada"}
          </span>
        )}
        {echoPct !== null && eh && (
          <span {...focus(eh)}>
            <span className={ecoTone(fit.echo!.score)}>eco {echoPct} %</span>
          </span>
        )}
        {mh && (
          <span {...focus(mh)}>
            <span className={FIT_TEXT.bad}>
              {compact ? "acento débil" : "acento en tiempo débil"}: {bad.map((w) => `«${w}»`).join(", ")}
            </span>
          </span>
        )}
      </span>
      {hint && <span className="text-2xs leading-snug text-text-dim">↳ {hint}</span>}
    </span>
  );
}

/** ¿Calza lo esencial? (sílabas y final) — lo que decide "regenerar las que no calzan". */
export const fits = (f: LineFit | null) => !!f && f.syllablesOk && f.endingOk;
