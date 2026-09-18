"use client";

// Barra superior: dónde estás parado. El badge lleva el color REAL de la línea
// (route_color del GTFS, resuelto por el agente); si el agente no sabe de qué
// color es, el badge sale en el color del sistema y nada se inventa. El
// "próximo tren" solo aparece si el horario existe, y dice que es horario
// publicado cuando el feed es una versión vieja.

import { EST, t, type EstLanguage } from "@/lib/estacion/theme";

interface Props {
  station: string;
  line: string;
  lineColor: string | null;
  clock: string;
  lang: EstLanguage;
  next: { line: string; headsign: string; inMinutes: number[] }[];
  scheduleStale: boolean;
}

export function StationBar({ station, line, lineColor, clock, lang, next, scheduleStale }: Props) {
  return (
    <header className="flex items-center gap-5">
      <span
        className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-2xl text-[40px] font-bold text-white"
        style={{ backgroundColor: lineColor ?? EST.system }}
      >
        {line}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-[family-name:var(--font-baloo)] text-[42px] leading-none font-semibold text-[var(--est-butter)]">
          {station}
        </p>
        {next.length > 0 && (
          <p className="mt-2 truncate text-[20px] text-[var(--est-butter)]/70">
            {t(lang, "next")}: {next.slice(0, 2).map((d) => `${d.line} → ${d.headsign} ${d.inMinutes[0]} ${t(lang, "minutes")}`).join(" · ")}
            {scheduleStale ? ` · ${t(lang, "scheduleNote")}` : ""}
          </p>
        )}
      </div>
      <span className="shrink-0 font-[family-name:var(--font-baloo)] text-[44px] leading-none font-semibold text-[var(--est-butter)] tabular-nums">
        {clock}
      </span>
    </header>
  );
}
