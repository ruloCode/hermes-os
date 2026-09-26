"use client";

// EL RIEL: la columna de contexto que acompaña a cada vista.
//
// Este patrón nació dentro de ContextRail (el riel del home) y estaba bien
// resuelto: secciones con un eyebrow discreto, filas separadas por una hairline
// y una barra de color de 2px que es la ÚNICA jerarquía. Pero vivía ahí, así
// que las demás vistas resolvían su columna derecha apilando <Panel> con
// título — cajas dentro de cajas, todas con el mismo peso visual.
//
// Extraerlo es la mitad barata de "una sola gramática": el contexto se ve igual
// en las diez rutas, y una vista nueva no tiene que inventarse cómo es un riel.
//
// Regla que hereda del original: el riel es para lo que SIGUE, no telemetría.
// Y dato real o nada — cada sección se omite si su fuente no responde.

import type { ReactNode } from "react";
import { ScrollArea } from "./ScrollArea";

export type RailTone = "line" | "accent" | "cyan" | "green" | "amber" | "red";

// Tailwind purga las clases construidas por interpolación (`bg-${tone}`), así
// que el mapa es estático a propósito.
const BAR: Record<RailTone, string> = {
  line: "bg-line-2",
  accent: "bg-accent",
  cyan: "bg-cyan",
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
};

/** Contenedor del riel: scroll propio y aire. Va dentro de un <aside>. */
export function Rail({ children }: { children: ReactNode }) {
  return (
    <ScrollArea rail fade="y" className="h-full px-5 py-5">
      <div className="flex flex-col gap-6">{children}</div>
    </ScrollArea>
  );
}

/**
 * Bloque del riel: etiqueta discreta + contenido, SIN caja. La etiqueta separa
 * lo suficiente; meterle borde y fondo convierte el riel en una pila de
 * tarjetas, que es de lo que veníamos.
 *
 * `grow` es para el bloque que se queda con el alto sobrante (un chat, una
 * lista larga). Necesita `min-h-0` para que su scroll interno enganche: sin él,
 * el min-height:auto de flexbox lo estira a su contenido y el scroll nunca
 * aparece.
 */
export function RailSection({
  label,
  right,
  children,
  grow = false,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
  grow?: boolean;
}) {
  return (
    <section className={`flex flex-col gap-2.5 ${grow ? "min-h-[320px] flex-1" : "shrink-0"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-text-faint">{label}</span>
        {right}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** Fila del riel: hairline + aire. La jerarquía la da la barra de color. */
export function RailRow({
  title,
  sub,
  value,
  tone = "line",
  onClick,
}: {
  title: string;
  sub?: string;
  value?: ReactNode;
  tone?: RailTone;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="group flex w-full items-center gap-2.5 border-t border-line/50 py-2 text-left first:border-t-0 enabled:cursor-pointer"
    >
      <span className={`h-5.5 w-0.5 shrink-0 rounded-xs ${BAR[tone]}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text transition-colors group-enabled:group-hover:text-accent">
          {title}
        </span>
        {sub && <span className="mt-0.5 block truncate text-xs text-text-faint">{sub}</span>}
      </span>
      {value != null && <span className="shrink-0 text-xs text-text-dim">{value}</span>}
    </button>
  );
}
