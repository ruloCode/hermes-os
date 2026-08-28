"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toneVar, type Tone } from "./tones";

/** Rebanada del donut. `color` llega resuelto (chartVar/CHART_OTHER). */
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
  /** icono del callout (SVG stroke currentColor); sin él no hay chip. */
  icon?: ReactNode;
  /** línea extra bajo el valor al hacer hover ("4 movs"). */
  sub?: string;
}

// Chip del callout (px) y umbral de share para mostrarlo (rebanadas ínfimas
// solo viven en la leyenda — un chip por astilla colisiona con sus vecinos).
const CHIP = 26;
const CALLOUT_MIN = 0.045;
// Ángulo mínimo dibujable: una astilla visible en vez de un path degenerado.
const MIN_SPAN = 0.02;

/** Punto polar → cartesiano con centro c (SVG: y crece hacia abajo).
 * Redondeado a 3 decimales: Math.cos/sin puede diferir en el último ulp
 * entre el Node del SSR y el browser → mismatch de hidratación. */
const pt = (c: number, r: number, a: number) => ({
  x: Math.round((c + r * Math.cos(a)) * 1000) / 1000,
  y: Math.round((c + r * Math.sin(a)) * 1000) / 1000,
});

/**
 * DonutChart — parte-de-todo de la HUD (gastos/ingresos por categoría).
 * Arcos SVG con gap de superficie de 2px, callouts de icono con línea guía
 * alrededor del anillo, y centro vivo: total por defecto y detalle de la
 * rebanada al hacer hover (el resto del anillo se atenúa — énfasis).
 * El color identifica junto al icono y la leyenda, nunca solo.
 */
export function DonutChart({
  slices,
  size = 240,
  thickness = 20,
  centerLabel,
  centerValue,
  centerTone = "neutral",
  format = (v) => String(Math.round(v)),
  callouts = true,
  hoveredKey,
  onHoverKey,
  ariaLabel,
  emptyHint = "Sin datos",
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  /** tono del valor central por defecto (polaridad: green ingresos, red gastos). */
  centerTone?: Tone;
  format?: (v: number) => string;
  callouts?: boolean;
  /** hover controlado (sincroniza con la leyenda); sin él, estado interno. */
  hoveredKey?: string | null;
  onHoverKey?: (key: string | null) => void;
  ariaLabel?: string;
  emptyHint?: string;
}) {
  const [innerHover, setInnerHover] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => setDrawn(true), []);

  const hovered = hoveredKey !== undefined ? hoveredKey : innerHover;
  const setHovered = (k: string | null) => {
    setInnerHover(k);
    onHoverKey?.(k);
  };

  const c = size / 2;
  const pad = callouts ? 46 : 8;
  const r = c - pad - thickness / 2;
  const rOut = r + thickness / 2;

  const data = useMemo(() => slices.filter((s) => s.value > 0), [slices]);
  const total = data.reduce((a, s) => a + s.value, 0);

  // Geometría de arcos: arranque arriba (-90°), horario, gap angular de 2px
  // de superficie entre rebanadas (solo si hay más de una).
  const arcs = useMemo(() => {
    if (total <= 0) return [];
    const gapAngle = data.length > 1 ? 2 / r : 0;
    let cum = 0;
    return data.map((s) => {
      const a0 = -Math.PI / 2 + (cum / total) * Math.PI * 2;
      cum += s.value;
      const a1 = -Math.PI / 2 + (cum / total) * Math.PI * 2;
      const b0 = a0 + gapAngle / 2;
      const b1 = Math.max(a1 - gapAngle / 2, b0 + MIN_SPAN);
      const mid = (a0 + a1) / 2;
      return { slice: s, a0: b0, a1: b1, mid, share: s.value / total };
    });
  }, [data, total, r]);

  // Callouts: chip en el ángulo medio; si el anterior queda muy cerca en
  // ángulo, el radio se escalona hacia afuera para que no se pisen.
  const chips = useMemo(() => {
    if (!callouts) return [];
    let lastAngle = -Infinity;
    let lastDist = 0;
    return arcs
      .filter((a) => a.share >= CALLOUT_MIN && a.slice.icon)
      .map((a) => {
        const near = a.mid - lastAngle < 0.4;
        const dist = rOut + 16 + (near && lastDist <= rOut + 16 ? 13 : 0);
        lastAngle = a.mid;
        lastDist = dist;
        return { ...a, chip: pt(c, dist, a.mid), lineEnd: pt(c, dist - CHIP / 2 - 1, a.mid) };
      });
  }, [arcs, callouts, c, rOut]);

  const hoveredArc = hovered ? arcs.find((a) => a.slice.key === hovered) : undefined;
  const hole = 2 * (r - thickness / 2) - 10;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={() => setHovered(null)}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" aria-hidden>
        {/* Sin datos: aro punteado de track, como los empty de la HUD */}
        {total <= 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={2}
            strokeDasharray="3 5"
          />
        )}

        {/* Líneas guía de los callouts (bajo los arcos, tinte de la rebanada) */}
        {chips.map((a) => {
          const from = pt(c, rOut + 2, a.mid);
          return (
            <line
              key={`l-${a.slice.key}`}
              x1={from.x}
              y1={from.y}
              x2={a.lineEnd.x}
              y2={a.lineEnd.y}
              stroke={a.slice.color}
              strokeOpacity={hovered && hovered !== a.slice.key ? 0.15 : 0.45}
              strokeWidth={1}
              style={{ transition: "stroke-opacity .2s" }}
            />
          );
        })}

        {/* Rebanadas */}
        {arcs.map((a, i) => {
          const isHover = hovered === a.slice.key;
          const dimmed = hovered !== null && hovered !== undefined && !isHover;
          const common = {
            fill: "none",
            stroke: a.slice.color,
            strokeWidth: isHover ? thickness + 4 : thickness,
            pathLength: 100,
            strokeDasharray: 100,
            strokeDashoffset: drawn ? 0 : 100,
            opacity: dimmed ? 0.3 : 1,
            style: {
              transition: `stroke-dashoffset .7s cubic-bezier(.2,.7,.2,1) ${i * 70}ms, stroke-width .18s, opacity .18s`,
              filter: isHover
                ? `drop-shadow(0 0 7px color-mix(in srgb, ${a.slice.color} 55%, transparent))`
                : undefined,
              cursor: "default",
            } as const,
            pointerEvents: "visibleStroke" as const,
            onMouseEnter: () => setHovered(a.slice.key),
          };
          // Una sola rebanada = anillo completo (un arco de 360° degenera).
          if (arcs.length === 1) {
            return <circle key={a.slice.key} cx={c} cy={c} r={r} {...common} />;
          }
          const p0 = pt(c, r, a.a0);
          const p1 = pt(c, r, a.a1);
          const large = a.a1 - a.a0 > Math.PI ? 1 : 0;
          return (
            <path
              key={a.slice.key}
              d={`M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`}
              {...common}
            />
          );
        })}
      </svg>

      {/* Chips de callout (HTML: iconos nítidos y estilables) */}
      {chips.map((a) => {
        const dimmed = hovered !== null && hovered !== undefined && hovered !== a.slice.key;
        return (
          <div
            key={`c-${a.slice.key}`}
            className="absolute grid place-items-center rounded-full border bg-panel-2"
            style={{
              width: CHIP,
              height: CHIP,
              left: a.chip.x - CHIP / 2,
              top: a.chip.y - CHIP / 2,
              color: a.slice.color,
              borderColor: `color-mix(in srgb, ${a.slice.color} 55%, transparent)`,
              opacity: dimmed ? 0.3 : 1,
              transition: "opacity .18s",
            }}
            title={`${a.slice.label} · ${format(a.slice.value)}`}
            onMouseEnter={() => setHovered(a.slice.key)}
          >
            <span className="h-3.5 w-3.5 [&>svg]:h-full [&>svg]:w-full">{a.slice.icon}</span>
          </div>
        );
      })}

      {/* Centro vivo: total por defecto; detalle de la rebanada en hover */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div
          className="flex flex-col items-center text-center leading-tight"
          style={{ maxWidth: hole }}
        >
          {total <= 0 ? (
            <span className="text-2xs text-text-faint">{emptyHint}</span>
          ) : hoveredArc ? (
            <>
              <span className="flex items-center gap-1 text-2xs tracking-label text-text-dim uppercase">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: hoveredArc.slice.color }}
                />
                <span className="max-w-24 truncate">{hoveredArc.slice.label}</span>
              </span>
              <span className="font-display text-lg text-text tabular-nums">
                {format(hoveredArc.slice.value)}
              </span>
              <span className="text-2xs text-text-dim tabular-nums">
                {Math.round(hoveredArc.share * 100)}%
                {hoveredArc.slice.sub ? ` · ${hoveredArc.slice.sub}` : ""}
              </span>
            </>
          ) : (
            <>
              {centerLabel && (
                <span className="text-2xs tracking-label text-text-dim uppercase">
                  {centerLabel}
                </span>
              )}
              {centerValue && (
                <span
                  className={`font-display tabular-nums ${
                    centerValue.length > 11 ? "text-base" : "text-lg"
                  } ${centerTone === "neutral" ? "text-text" : ""}`}
                  style={centerTone !== "neutral" ? { color: toneVar(centerTone) } : undefined}
                >
                  {centerValue}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
