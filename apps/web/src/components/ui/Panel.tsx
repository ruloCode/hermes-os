"use client";

import type { ReactNode } from "react";
import type { Tone } from "./tones";

const PADDING: Record<string, string> = {
  none: "",
  sm: "px-2 pb-2",
  md: "px-3 pb-3",
};

/**
 * Panel v2 — bloque atómico de toda la HUD. API retrocompatible con el
 * Panel original (title/right/children/className/delay) + variantes:
 * - default: glass con brackets
 * - hero:    brackets grandes + línea de acento superior con glow
 * - ghost:   sin fondo ni borde (sub-secciones dentro de otro panel)
 * - alert:   borde teñido por `tone` (estados warning/error)
 */
export function Panel({
  title,
  right,
  children,
  className = "",
  delay = 0,
  variant = "default",
  tone = "violet",
  padding = "md",
  scroll = false,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: "default" | "hero" | "ghost" | "alert";
  tone?: Tone;
  padding?: "none" | "sm" | "md";
  scroll?: boolean;
}) {
  const shell =
    variant === "ghost"
      ? ""
      : variant === "hero"
        ? "hud-panel hud-panel-hero"
        : variant === "alert"
          ? `hud-panel hud-panel-alert hud-alert-${tone}`
          : "hud-panel";
  return (
    <section
      className={`${shell} hud-in flex flex-col ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {variant === "hero" && <span aria-hidden className="hud-accent" />}
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
          {title ? <h2 className={`hud-title hud-title-${tone}`}>{title}</h2> : <span />}
          {right}
        </header>
      )}
      <div
        className={`min-h-0 flex-1 ${PADDING[padding]} ${scroll ? "overflow-y-auto overscroll-contain" : ""}`}
      >
        {children}
      </div>
    </section>
  );
}
