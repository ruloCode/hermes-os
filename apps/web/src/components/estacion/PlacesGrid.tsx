"use client";

// QUÉ HAY CERCA: bloques de color como la retícula de una silleta (nunca se
// dibuja la silleta). Cada bloque es un lugar REAL del archivo del humano:
// minutos a pie y horario tal como los publica su fuente. Si un lugar no tiene
// horario publicado, se dice — no se inventa uno.

import { EST, t, type EstLanguage } from "@/lib/estacion/theme";
import type { UiPlace } from "@/lib/sala/ui-bus";

// Tres tonos de la paleta local, en orden fijo: mismo lugar, mismo color.
const TONES = [EST.guava, "#D98E2B", "#2E7DA6"];

export function PlacesGrid({ station, places, lang }: { station: string; places: UiPlace[]; lang: EstLanguage }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h2 className="font-[family-name:var(--font-baloo)] text-[30px] font-semibold text-[var(--est-butter)]">
        {t(lang, "places")} · {station}
      </h2>
      <div className="flex flex-col gap-4">
        {places.slice(0, 3).map((p, i) => (
          <article
            key={p.name}
            className="min-w-0 rounded-[24px] p-6 text-white shadow-[0_14px_32px_rgba(0,0,0,0.22)] wrap-break-word"
            style={{ backgroundColor: TONES[i % TONES.length] }}
          >
            <p className="font-[family-name:var(--font-baloo)] text-[30px] leading-tight font-semibold">{p.name}</p>
            <p className="mt-1 text-[21px] opacity-95">
              {p.walkMinutes === 0 ? t(lang, "here") : `${p.walkMinutes} ${t(lang, "minutes")} ${t(lang, "walk")}`}
              {" · "}
              {p.hours ?? t(lang, "noHours")}
            </p>
            {p.note && <p className="mt-2 text-[19px] leading-snug opacity-90">{p.note}</p>}
            {p.source && <p className="mt-2 text-[14px] opacity-70">{p.source}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
