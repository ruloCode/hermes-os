"use client";

// BOTÓN CANÓNICO (v5). Antes cada vista armaba los suyos con clases sueltas:
// bordes de acento, fondos al 15%, flechas ▶ en el texto, mayúsculas con
// tracking. Cuatro variantes cubren todo:
//
//  - primary:   la acción principal de la vista (índigo sólido). UNA por zona.
//  - secondary: acciones normales (borde + fondo de tarjeta).
//  - ghost:     acciones de barra de herramientas (sin borde hasta el hover).
//  - danger:    destruir/cortar (texto rojo; el rojo nunca es primario).
//
// Tamaños: xs (24px, acciones dentro de una fila) · sm (28px, barras) ·
// md (32px, formularios y cabeceras).

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "xs" | "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent-solid text-on-accent hover:brightness-110 disabled:bg-selected disabled:text-text-faint",
  secondary:
    "border border-line bg-panel text-text shadow-[var(--shadow-card)] hover:border-line-2 hover:bg-hover",
  ghost: "text-text-dim hover:bg-hover hover:text-text",
  danger: "border border-red/30 text-red hover:bg-red/10",
};

const SIZE: Record<Size, string> = {
  xs: "h-6 gap-1 px-2 text-xs",
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-8 gap-2 px-3 text-sm",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    icon?: ReactNode;
  }
>(function Button(
  { variant = "secondary", size = "sm", icon, className = "", children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {icon && (
        <span aria-hidden className="-ml-0.5 shrink-0">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
});
