"use client";

import type { CSSProperties, ReactNode } from "react";
import { toneVar } from "./tones";

/**
 * Botón de comando del deck. Reusa la clase base `.cmd-btn` (prefijo ">",
 * hover glow) y aplica variante/tamaño por encima.
 *
 * Nota de especificidad: `.cmd-btn` vive fuera de @layer en globals.css,
 * así que gana a las utilities de Tailwind — los overrides van por `style`,
 * usando CSS vars (`--line`, `--violet`, `--violet-hot`) que la clase base
 * ya consume, para que su hover siga funcionando en cada variante.
 */
export function CmdButton({
  children,
  onClick,
  icon,
  variant = "line",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  variant?: "line" | "solid" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const style: Record<string, string> = {};

  if (size === "sm") {
    style.padding = "5px 9px";
    style.fontSize = "10px";
    style.gap = "7px";
    style.minHeight = "28px";
  }

  if (variant === "solid") {
    // Fondo violeta al 12% + borde line-2 (vía la var que lee .cmd-btn).
    style.background = "color-mix(in srgb, var(--color-violet) 12%, transparent)";
    style["--line"] = "var(--color-line-2)";
  } else if (variant === "danger") {
    // Tiñe texto/borde de rojo; el prefijo ">" y el hover de .cmd-btn
    // leen --violet/--violet-hot, así que también se vuelven rojos.
    style.color = toneVar("red");
    style["--line"] = "color-mix(in srgb, var(--color-red) 45%, transparent)";
    style["--violet"] = toneVar("red");
    style["--violet-hot"] = toneVar("red");
  }

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`cmd-btn ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      style={style as CSSProperties}
    >
      {loading ? (
        <span className="pulse-dot">···</span>
      ) : (
        <>
          {icon && (
            <span aria-hidden className="shrink-0">
              {icon}
            </span>
          )}
          {children}
        </>
      )}
    </button>
  );
}
