// Identidad visual de las categorías de finanzas: icono + label en español.
// Iconos stroke inline (geometría simple, sin dependencias) — heredan color
// vía currentColor, así el donut/leyenda/movimientos los tiñen por rebanada.

import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  mercado: (
    <>
      <circle cx={9} cy={20} r={1.4} />
      <circle cx={17} cy={20} r={1.4} />
      <path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  restaurantes: (
    <>
      <path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7" />
    </>
  ),
  transporte: (
    <>
      <path d="M19 17h2a1 1 0 0 0 1-1v-3c0-.9-.7-1.7-1.5-1.9L16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4a1 1 0 0 0 1 1h2" />
      <circle cx={7} cy={17} r={2} />
      <path d="M9 17h6" />
      <circle cx={17} cy={17} r={2} />
    </>
  ),
  vivienda: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 9.5V21h14V9.5" />
    </>
  ),
  servicios: <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z" />,
  salud: (
    <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
  ),
  entretenimiento: (
    <>
      <circle cx={12} cy={12} r={10} />
      <path d="m10 8 6 4-6 4Z" />
    </>
  ),
  suscripciones: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),
  ropa: (
    <path d="M20.4 6.5 17 4l-2 2c-.9.9-5.1.9-6 0L7 4 3.6 6.5c-.4.3-.5.8-.3 1.2l1.5 2.6c.2.4.7.6 1.1.4L7 10v10h10V10l1.1.7c.4.2.9 0 1.1-.4l1.5-2.6c.2-.4.1-.9-.3-1.2Z" />
  ),
  educacion: (
    <>
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" />
    </>
  ),
  viajes: (
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z" />
  ),
  regalos: (
    <>
      <rect x={3} y={8} width={18} height={4} rx={1} />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </>
  ),
  mascotas: (
    <>
      <circle cx={12} cy={5} r={1.8} />
      <circle cx={5} cy={9} r={1.8} />
      <circle cx={19} cy={9} r={1.8} />
      <path d="M12 11.5c-3 0-5.5 2.5-5.5 5 0 1.7 1.3 3 3 3 1 0 1.6-.4 2.5-.4s1.5.4 2.5.4c1.7 0 3-1.3 3-3 0-2.5-2.5-5-5.5-5Z" />
    </>
  ),
  otros: (
    <>
      <circle cx={5} cy={12} r={1} fill="currentColor" stroke="none" />
      <circle cx={12} cy={12} r={1} fill="currentColor" stroke="none" />
      <circle cx={19} cy={12} r={1} fill="currentColor" stroke="none" />
      <circle cx={12} cy={12} r={10} />
    </>
  ),
  // ingresos
  salario: (
    <>
      <rect x={2} y={6} width={20} height={12} rx={2} />
      <circle cx={12} cy={12} r={2.5} />
    </>
  ),
  freelance: (
    <>
      <rect x={4} y={4} width={16} height={12} rx={1} />
      <path d="M2 20h20" />
    </>
  ),
  inversiones: (
    <>
      <path d="m22 7-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </>
  ),
  otros_ingreso: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
};

// Fallback para categorías libres fuera del set canónico: etiqueta.
const FALLBACK: ReactNode = (
  <>
    <path d="M12.6 2.9c-.4-.4-.9-.6-1.4-.6H4a2 2 0 0 0-2 2v7.2c0 .5.2 1 .6 1.4l8.3 8.3a2.4 2.4 0 0 0 3.4 0l6.8-6.8a2.4 2.4 0 0 0 0-3.4L12.6 2.9Z" />
    <circle cx={7.5} cy={7.5} r={0.5} fill="currentColor" />
  </>
);

const LABELS: Record<string, string> = {
  educacion: "educación",
  otros_ingreso: "otros ingresos",
};

/** Set canónico de categorías de GASTO (para el alta de presupuestos). */
export const EXPENSE_CATEGORIES = [
  "mercado",
  "restaurantes",
  "transporte",
  "vivienda",
  "servicios",
  "salud",
  "entretenimiento",
  "suscripciones",
  "ropa",
  "educacion",
  "viajes",
  "regalos",
  "mascotas",
  "otros",
] as const;

/** Label legible de la categoría ("otros_ingreso" → "otros ingresos"). */
export function categoryLabel(category: string): string {
  return LABELS[category] ?? category.replaceAll("_", " ");
}

/** Icono stroke de la categoría; tiñe con currentColor y escala con className. */
export function CategoryIcon({
  category,
  className = "h-3.5 w-3.5",
}: {
  category: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {ICONS[category] ?? FALLBACK}
    </svg>
  );
}
