"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { toneVar } from "./tones";

/**
 * TabBar — tabs HUD con acento animado bajo el tab activo.
 * El acento (barra de 2px con glow violeta) se posiciona midiendo
 * offsetLeft/offsetWidth del botón activo y anima translateX + width;
 * se recalcula al cambiar `active` y ante resize del contenedor.
 * Teclado: ArrowLeft/ArrowRight con wrap, Home/End a los extremos.
 */
export function TabBar({
  tabs,
  active,
  onChange,
  size = "sm",
}: {
  tabs: { id: string; label: string; badge?: string | number }[];
  active: string;
  onChange: (id: string) => void;
  size?: "sm" | "md";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

  // Mide el botón activo y reposiciona el acento antes del paint
  // (sin animación visible en el primer render). ResizeObserver cubre
  // cambios de layout (fuentes cargando, contenedor redimensionado).
  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current.get(active);
      if (!btn) {
        setIndicator(null);
        return;
      }
      const x = btn.offsetLeft;
      const w = btn.offsetWidth;
      setIndicator((prev) => (prev && prev.x === x && prev.w === w ? prev : { x, w }));
    };
    measure();
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, tabs, size]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (tabs.length === 0) return;
    const idx = Math.max(
      0,
      tabs.findIndex((t) => t.id === active),
    );
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = tabs[next].id;
    onChange(id);
    btnRefs.current.get(id)?.focus();
  };

  const sizing =
    size === "md" ? "min-h-8 px-2.5 text-xs" : "min-h-7 px-2 text-2xs";

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className="relative flex items-center gap-1 border-b border-line"
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) btnRefs.current.set(t.id, el);
              else btnRefs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`${sizing} tracking-label whitespace-nowrap uppercase transition-colors ${
              selected ? "text-violet" : "text-text-dim hover:text-text"
            }`}
          >
            {t.label}
            {t.badge !== undefined && (
              <sup className="ml-0.5 text-2xs text-cyan tabular-nums">{t.badge}</sup>
            )}
          </button>
        );
      })}
      {/* Acento animado: translateX + width siguen al tab activo */}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-px left-0 h-0.5 bg-violet"
        style={{
          width: indicator ? `${indicator.w}px` : 0,
          transform: `translateX(${indicator ? indicator.x : 0}px)`,
          opacity: indicator ? 1 : 0,
          boxShadow: `0 0 8px ${toneVar("violet")}`,
          transition:
            "transform 180ms cubic-bezier(.2,.7,.2,1), width 180ms cubic-bezier(.2,.7,.2,1)",
        }}
      />
    </div>
  );
}
