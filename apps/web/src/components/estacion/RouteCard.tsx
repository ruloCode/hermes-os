"use client";

// LA RUTA, que es el dato por el que existe esta pantalla. Cada tramo lleva el
// color OFICIAL de su línea (route_color del GTFS, no una constante nuestra),
// las estaciones que recorre, cuántas paradas y cuántos minutos. Todo viene
// del agente: aquí no se calcula ni se redondea nada.

import { t, type EstLanguage } from "@/lib/estacion/theme";
import type { UiRoutePlan } from "@/lib/sala/ui-bus";

interface Props {
  plan: UiRoutePlan;
  lang: EstLanguage;
  next: { line: string; headsign: string; inMinutes: number[] }[];
  scheduleStale: boolean;
}

export function RouteCard({ plan, lang, next, scheduleStale }: Props) {
  const transfers =
    plan.transfers === 0
      ? t(lang, "noTransfers")
      : `${plan.transfers} ${plan.transfers === 1 ? t(lang, "transfer") : t(lang, "transfers")}`;
  const first = next[0];

  return (
    <section className="rounded-[28px] bg-[var(--est-butter)] p-7 text-[var(--est-ink)] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
      <header className="flex items-baseline justify-between gap-4">
        <p className="font-[family-name:var(--font-baloo)] text-[34px] leading-tight font-semibold">
          {plan.from} → {plan.to}
        </p>
      </header>
      <p className="mt-1 text-[22px] opacity-80">
        {plan.minutes} {t(lang, "minutes")} · {transfers}
      </p>

      <ol className="mt-6 flex flex-col gap-5">
        {plan.legs.map((leg, i) => (
          <li key={`${leg.line}-${i}`} className="flex gap-4">
            {/* Riel de la línea con su color oficial: se lee a distancia. */}
            <div className="flex w-[64px] shrink-0 flex-col items-center">
              <span
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full text-[26px] font-bold text-white"
                style={{ backgroundColor: leg.color }}
              >
                {leg.line}
              </span>
              {i < plan.legs.length - 1 && <span className="mt-2 w-[6px] flex-1 rounded-full bg-[var(--est-ink)]/15" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[26px] leading-snug font-semibold">
                {leg.from} → {leg.to}
              </p>
              <p className="mt-0.5 text-[20px] opacity-75">
                {leg.headsign ? `${leg.headsign} · ` : ""}
                {leg.stops} {leg.stops === 1 ? t(lang, "stop") : t(lang, "stops")} · {leg.minutes} {t(lang, "minutes")}
              </p>
              {/* Las estaciones intermedias, chiquitas: quien las quiere, las lee. */}
              {leg.stations.length > 2 && (
                <p className="mt-1 truncate text-[16px] opacity-55">{leg.stations.slice(1, -1).join(" · ")}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {first && (
        <footer className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--est-ink)]/12 pt-4 text-[20px]">
          <span className="font-semibold">
            {t(lang, "next")} {first.line}
          </span>
          <span className="opacity-75">
            {first.headsign} · {first.inMinutes[0]} {t(lang, "minutes")}
          </span>
          {scheduleStale && <span className="ml-auto shrink-0 text-[15px] opacity-55">{t(lang, "scheduleNote")}</span>}
        </footer>
      )}
    </section>
  );
}
