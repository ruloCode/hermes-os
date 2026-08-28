"use client";

// Mini CLIMA: temperatura actual de Open-Meteo con glifo por código WMO y
// min/máx de hoy. Se oculta sin reporte; con cache viejo (stale) el dot del
// título pasa a amber con title explicativo.

import type { WeatherReport } from "@hermes/shared";

/** Glifo por código WMO (rangos oficiales, de mayor a menor severidad). */
function weatherGlyph(code: number): string {
  if (code >= 95) return "⛈";
  if (code >= 85) return "❄"; // chubascos de nieve
  if (code >= 80) return "🌧";
  if (code >= 71) return "❄";
  if (code >= 51) return "🌧";
  if (code >= 45) return "🌫";
  if (code >= 2) return "⛅";
  return "☀";
}

export function WeatherMini({
  weather,
  delay = 0,
}: {
  weather: WeatherReport | null;
  delay?: number;
}) {
  if (!weather) return null;

  // daily[0] = hoy (el agente manda hoy + 2 días); guard por si viene vacío.
  const today = weather.daily[0] ?? null;

  return (
    <div
      className="hud-panel hud-in flex min-h-[92px] flex-col gap-1.5 p-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center gap-1.5">
        <span
          aria-hidden
          title={weather.stale ? "cache viejo" : undefined}
          className={`h-1 w-1 shrink-0 rounded-full ${weather.stale ? "bg-amber" : "bg-cyan"}`}
        />
        <h3 className="text-2xs tracking-label uppercase text-text-dim">Clima</h3>
      </header>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <span aria-hidden className="text-lg leading-none">
          {weatherGlyph(weather.now.weatherCode)}
        </span>
        <span className="font-display text-xl leading-none tabular-nums text-cyan">
          {Math.round(weather.now.tempC)}°
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xs text-text-dim" title={weather.place}>
            {weather.place}
          </p>
          {today && (
            <p className="text-2xs tabular-nums text-text-dim">
              mín {Math.round(today.minC)}° · máx {Math.round(today.maxC)}°
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
