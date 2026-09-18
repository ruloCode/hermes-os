"use client";

// El código para llevarse la conversación al bolsillo. El QR se dibuja aquí
// mismo (packages/shared/src/qr.ts, sin dependencias): un <path> en un <svg>.
// Aparece solo cuando hay algo que llevarse —una ruta en pantalla— y muere
// con su pase de 15 minutos.

import { useEffect, useMemo, useState } from "react";
import { qrSvg } from "@hermes/shared";
import { EST, type EstLanguage } from "@/lib/estacion/theme";
import { createHandoffUrl } from "@/lib/estacion/handoff";
import type { UiRoutePlan } from "@/lib/sala/ui-bus";

const LABEL: Record<EstLanguage, { title: string; hint: string }> = {
  es: { title: "Sigue en tu celular", hint: "Apunta la cámara: la ruta y la charla siguen ahí." },
  en: { title: "Continue on your phone", hint: "Point your camera: the route and the chat carry on." },
  pt: { title: "Continue no seu celular", hint: "Aponte a câmera: a rota e a conversa continuam." },
};

interface Props {
  plan: UiRoutePlan;
  summary: string;
  station: string;
  lang: EstLanguage;
}

export function HandoffQr({ plan, summary, station, lang }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  // Un pase por ruta: si el viajero pide otra, se emite otro.
  const key = `${plan.from}→${plan.to}`;
  useEffect(() => {
    let alive = true;
    setUrl(null);
    void createHandoffUrl({ summary, language: lang, route: plan, station }).then((r) => {
      if (alive) setUrl(r?.url ?? null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const svg = useMemo(() => (url ? qrSvg(url, { ecc: "M", quietZone: 2 }) : null), [url]);
  // Sin host alcanzable no hay QR: un código que no abre nada es peor que nada.
  if (!svg || !url) return null;

  return (
    <aside className="flex items-center gap-5 rounded-[24px] bg-[var(--est-butter)] p-5 text-[var(--est-ink)]">
      <svg viewBox={svg.viewBox} className="h-[150px] w-[150px] shrink-0" role="img" aria-label={url}>
        <rect width="100%" height="100%" fill={EST.butter} />
        <path d={svg.path} fill={EST.ink} />
      </svg>
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-baloo)] text-[28px] leading-tight font-semibold">{LABEL[lang].title}</p>
        <p className="mt-1 text-[20px] opacity-75">{LABEL[lang].hint}</p>
      </div>
    </aside>
  );
}
