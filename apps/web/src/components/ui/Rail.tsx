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
//
// v5: el tono se pinta como un PUNTO y solo cuando dice algo (en curso, aquí,
// error). v4 ponía una barra de 2px en CADA fila — una lista de proyectos era
// una columna de rayitas azules que no distinguían nada. `line` = sin marca.
const DOT: Record<RailTone, string> = {
  line: "",
  accent: "bg-accent",
  cyan: "bg-cyan",
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
};

/** Contenedor del riel: scroll propio y aire. Va dentro de un <aside>. */
export function Rail({ children }: { children: ReactNode }) {
  return (
    <ScrollArea rail fade="y" className="h-full px-4 py-5">
      <div className="flex flex-col gap-7">{children}</div>
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
    <section className={`flex flex-col gap-1.5 ${grow ? "min-h-[320px] flex-1" : "shrink-0"}`}>
      <div className="flex items-center justify-between gap-2 px-2">
        <span className="text-2xs font-medium text-text-faint">{label}</span>
        {right}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** Fila del riel: aire y hover; el punto de tono solo si dice algo. */
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
      className={`group flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-hover ${
        tone === "accent" ? "bg-selected" : ""
      }`}
    >
      {DOT[tone] && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text">{title}</span>
        {sub && <span className="mt-px block truncate text-xs text-text-faint">{sub}</span>}
      </span>
      {value != null && (
        <span className="shrink-0 text-xs text-text-faint tabular-nums">{value}</span>
      )}
    </button>
  );
}
