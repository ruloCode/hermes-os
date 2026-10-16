"use client";

import type { LiveSuggestion } from "@hermes/shared";

/**
 * Cuerpo de una tarjeta: la corrección (clase) y el «dilo más claro» (junta)
 * se leen «lo que dijiste → cómo se dice».
 */
export function SuggestionBody({ s }: { s: LiveSuggestion }) {
  if (s.kind === "corregir" || s.kind === "pulir") {
    const [said, better] = s.text.split(" → ");
    if (better)
      return (
        <>
          <p className="mt-1 text-xs leading-snug text-text-dim line-through">{said}</p>
          <p className="text-sm leading-snug text-text">{better}</p>
          {s.why && <p className="mt-1 text-2xs leading-snug text-text-dim">{s.why}</p>}
        </>
      );
  }
  // Concepto de la reunión de equipo: «término — explicación» (una línea por término).
  if (s.kind === "entender") {
    return (
      <>
        {s.text.split("\n").map((line, i) => {
          const [term, ...rest] = line.split(" — ");
          return rest.length ? (
            <p key={i} className="mt-1 text-xs leading-snug text-text">
              <span className="font-semibold">{term}</span>
              <span className="text-text-dim"> — {rest.join(" — ")}</span>
            </p>
          ) : (
            <p key={i} className="mt-1 text-xs leading-snug text-text">
              {line}
            </p>
          );
        })}
        {s.why && <p className="mt-1 text-2xs leading-snug text-text-dim">{s.why}</p>}
      </>
    );
  }
  // El aporte es lo que vas a decir: se lee de un vistazo, más grande.
  const big = s.kind === "aportar" || s.kind === "preguntar";
  return (
    <>
      <p
        className={`mt-1 leading-snug whitespace-pre-line text-text ${big ? "text-sm" : "text-xs"}`}
      >
        {s.text}
      </p>
      {s.why && <p className="mt-1 text-2xs leading-snug text-text-dim">{s.why}</p>}
    </>
  );
}
