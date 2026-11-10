"use client";

// DE QUÉ ESTÁ HECHA LA ENTRADA de una función: leída de caché · escrita a caché
// · sin caché. Es la medida de si el prefijo estable funciona (un prompt que
// cambia en cada turno paga la entrada completa), así que es lo ÚNICO que lleva
// color en el panel: todo lo demás (costo, llamadas) son barras neutras.
//
// Los dos tonos son slots fijos de la paleta de charts — el color sigue a la
// parte, no al rango — y lo que no pasó por caché es la pista vacía.

import { formatTokens } from "@hermes/shared";
import { chartVar } from "@/components/ui/tones";
import { percent } from "./format";

const READ = chartVar(0);
const WRITE = chartVar(1);

export interface PromptParts {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Total de tokens de entrada: lo que no pasó por caché + lo leído + lo escrito. */
export const promptTokens = (p: PromptParts): number => p.input + p.cacheRead + p.cacheWrite;

/** Desglose en palabras (tooltip y lectores de pantalla). null sin tokens de entrada. */
export function promptSummary(p: PromptParts): string | null {
  const total = promptTokens(p);
  if (total <= 0) return null;
  return [
    `${formatTokens(total)} tokens de entrada`,
    `${percent(p.cacheRead / total)} leídos de caché (${formatTokens(p.cacheRead)})`,
    `${percent(p.cacheWrite / total)} escritos a caché (${formatTokens(p.cacheWrite)})`,
    `${percent(p.input / total)} sin caché (${formatTokens(p.input)})`,
  ].join(" · ");
}

export function CacheBar({ parts, size = "sm" }: { parts: PromptParts; size?: "sm" | "md" }) {
  const total = promptTokens(parts);
  if (total <= 0) return null;
  const summary = promptSummary(parts) ?? undefined;
  const seg = (value: number, color: string) =>
    value > 0 ? (
      // Mínimo de 2px: una parte real, por pequeña que sea, se ve.
      <span className="h-full min-w-0.5 rounded-full" style={{ width: `${(value / total) * 100}%`, background: color }} />
    ) : null;
  return (
    <div
      role="img"
      aria-label={summary}
      title={summary}
      className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-selected ${size === "md" ? "h-2" : "h-1.5"}`}
    >
      {seg(parts.cacheRead, READ)}
      {seg(parts.cacheWrite, WRITE)}
    </div>
  );
}

/** La leyenda va UNA vez, sobre la tabla: identidad por nombre, no solo por color. */
export function CacheLegend() {
  const item = (color: string | null, label: string) => (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${color ? "" : "bg-selected ring-1 ring-line"}`}
        style={color ? { background: color } : undefined}
      />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-dim" aria-label="Leyenda de la entrada">
      {item(READ, "Leída de caché")}
      {item(WRITE, "Escrita a caché")}
      {item(null, "Sin caché")}
    </div>
  );
}
