"use client";

// Piezas compartidas por Finanzas y Hábitos (v5 "Grafito").
//
// Viven aquí y no en components/ui porque nacieron para estas dos vistas; si
// una tercera las necesita, se promueven. Lo que resuelven:
//
//  - StatStrip/Stat: la fila de cifras de arriba (patrón Stripe/Mercury). Sin
//    caja —se lee, no se opera—. Antes
//    cada vista tenía su propio "Metric"/StatBlock con mayúsculas, tamaños y
//    colores distintos, y el ingreso salía pintado del color del acento.
//  - Progress: barra fina y redondeada. Relleno NEUTRO; ámbar/rojo solo cuando
//    el valor es un estado (≥80 % / ≥100 % de un presupuesto). Un 0 % no es
//    un error y no se pinta de rojo.
//  - FIELD: el mismo alto (h-8), radio y borde para inputs y selects de las
//    dos vistas — antes cada formulario tenía su padding y su tamaño de letra.
//  - Iconos de trazo (lápiz, más, x, check): reemplazan los glifos ✎ ✕ ✓ +
//    que hacían de iconos y cambiaban de tamaño según la fuente.

import type { ReactNode } from "react";

/** Campo de formulario: input/select del mismo alto que <Button size="md">. */
export const FIELD =
  "h-8 rounded-sm border border-line bg-panel px-2.5 text-sm text-text transition-colors placeholder:text-text-faint hover:border-line-2";

type StatTone = "text" | "green" | "red" | "amber";

const VALUE_TONE: Record<StatTone, string> = {
  text: "text-text",
  green: "text-green",
  red: "text-red",
  amber: "text-amber",
};

/**
 * Fila de cifras sin caja, separadas por aire (no por bordes: cuatro cajas
 * iguales vuelven a ser "cuatro cosas diciendo mírame"). Se parte en 2×2
 * cuando la COLUMNA es angosta — container query, porque lo que importa es el
 * ancho de la columna, no el de la ventana.
 */
export function StatStrip({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return (
    <div className="@container">
      <div
        className={`grid grid-cols-2 gap-x-8 gap-y-5 ${
          cols === 4 ? "@2xl:grid-cols-4" : "@lg:grid-cols-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Una cifra: etiqueta → valor → línea de contexto. El valor va en el gris del
 * texto salvo que su COLOR diga algo (signo de un monto, un estado).
 */
export function Stat({
  label,
  value,
  tone = "text",
  context,
  size = "lg",
  children,
}: {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  /** lg = cifra principal de la vista · md = cifra secundaria (ritmo, totales). */
  size?: "md" | "lg";
  /** Contexto con dato real (vs. mes pasado, de dónde salió…). */
  context?: ReactNode;
  /** Extra visual bajo el contexto (barra, sparkline). */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-text-dim">{label}</span>
      <span
        className={`truncate leading-tight font-medium tabular-nums ${
          size === "lg" ? "text-2xl" : "text-lg"
        } ${VALUE_TONE[tone]}`}
      >
        {value}
      </span>
      {context != null && <span className="truncate text-xs text-text-faint">{context}</span>}
      {children}
    </div>
  );
}

/**
 * Barra de progreso fina. `warnAt`/`dangerAt` (fracciones) la vuelven ámbar o
 * roja; sin umbrales siempre es neutra. `done` la pinta de verde (meta
 * cumplida: es un estado, "bien").
 */
export function Progress({
  value,
  max,
  warnAt,
  dangerAt,
  done = false,
  label,
}: {
  value: number;
  max: number;
  warnAt?: number;
  dangerAt?: number;
  done?: boolean;
  label?: string;
}) {
  const ratio = max > 0 ? value / max : 0;
  const pct = Math.min(1, Math.max(0, ratio));
  const fill =
    dangerAt != null && ratio >= dangerAt
      ? "bg-red"
      : warnAt != null && ratio >= warnAt
        ? "bg-amber"
        : done
          ? "bg-green"
          : "bg-text-dim";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-1 w-full overflow-hidden rounded-full bg-selected"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${fill}`}
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}

/** Formato es-CO para cifras sin moneda (5000000 → 5.000.000). */
export function num(n: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(n);
}

// ── Iconos de trazo (heredan currentColor) ─────────────────────────────

function Svg({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconPencil = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Svg>
);
export const IconPlus = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconX = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const IconCheck = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
export const IconArrowUp = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Svg>
);
