"use client";

// BOTÓN DE ICONO: cuadrado, fantasma, para barras de herramientas (‹ › en un
// calendario, refrescar, cerrar, más opciones). Antes cada vista armaba el
// suyo con su tamaño; el `aria-label` es obligatorio porque no hay texto.

import { forwardRef, type ButtonHTMLAttributes } from "react";

export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
    "aria-label": string;
    size?: "sm" | "md";
    active?: boolean;
  }
>(function IconButton(
  { size = "sm", active = false, className = "", type = "button", title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={title ?? rest["aria-label"]}
      className={`grid shrink-0 cursor-pointer place-items-center rounded-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        size === "sm" ? "h-7 w-7" : "h-8 w-8"
      } ${active ? "bg-selected text-text" : "text-text-faint hover:bg-hover hover:text-text"} ${className}`}
      {...rest}
    />
  );
});
