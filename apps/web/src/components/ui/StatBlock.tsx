"use client";

import { toneVar, type Tone } from "./tones";
import { Sparkline } from "./Sparkline";

// Tamaño del valor según la variante: md para grids densos,
// lg/xl para métricas hero (costos, tokens, ejecuciones).
const VALUE_SIZE: Record<string, string> = {
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-3xl",
};

// Glifo y color por dirección de tendencia. flat usa text-faint
// para no competir visualmente con el valor.
const TREND: Record<string, { glyph: string; className: string }> = {
  up: { glyph: "▲", className: "text-green" },
  down: { glyph: "▼", className: "text-red" },
  flat: { glyph: "—", className: "text-text-faint" },
};

/**
 * StatBlock — métrica puntual de la HUD: label pequeño arriba y valor
 * grande en display ("$1.42", "23 ejecuciones", "1.2M tokens").
 * Opcionalmente muestra tendencia (▲/▼/—) y un sparkline debajo.
 */
export function StatBlock({
  label,
  value,
  unit,
  tone = "neutral",
  size = "md",
  trend,
  spark,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: Tone;
  size?: "md" | "lg" | "xl";
  trend?: { dir: "up" | "down" | "flat"; label?: string };
  spark?: number[];
}) {
  const t = trend ? TREND[trend.dir] : null;

  return (
    <div className="flex flex-col">
      <span className="text-2xs tracking-label text-text-dim uppercase">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-display tabular-nums leading-tight ${VALUE_SIZE[size]} ${tone === "neutral" ? "text-text" : ""}`}
          style={tone !== "neutral" ? { color: toneVar(tone) } : undefined}
        >
          {value}
          {unit && <span className="ml-1 text-2xs text-text-dim tracking-normal">{unit}</span>}
        </span>
        {t && (
          <span className={`text-2xs tabular-nums ${t.className}`}>
            <span aria-hidden>{t.glyph}</span>
            {trend?.label && <span className="ml-1">{trend.label}</span>}
          </span>
        )}
      </div>
      {spark && spark.length > 0 && (
        <div className="mt-1">
          <Sparkline
            data={spark}
            tone={tone === "neutral" ? "violet" : tone}
            width={80}
            height={20}
            fill
          />
        </div>
      )}
    </div>
  );
}
