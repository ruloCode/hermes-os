"use client";

// QA de las máquinas del Dojo (solo dev): ?item=<id de lección> muestra su
// figura a ancho de la columna real del problema (520 px) y a ancho de teléfono
// (390 px). ?theme=light|dark fuerza el tema; ?reveal=0 la muestra como antes
// de resolver el problema (sin el mecanismo). Sin item, el índice.
//
// ?live=1 = MODO EN VIVO: corre la solución de referencia (o ?code=, código
// URL-encoded, para probar uno equivocado) con el ejemplo ?ex=N bajo el
// trazador y la reproduce con la máquina, como en el problema real.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { dojoItem } from "@hermes/shared";
import { DojoFigure } from "@/components/dojo/figures/DojoFigure";
import { DOJO_FIGURES, FIGURE_PLAN } from "@/components/dojo/figures/registry";
import { LiveQa } from "./LiveQa";

function Page() {
  const q = useSearchParams();
  const id = q.get("item");
  const t = q.get("theme");
  const theme = t === "light" || t === "dark" ? t : undefined;
  const reveal = q.get("reveal") !== "0";
  const item = id ? dojoItem(id) : null;
  if (item && q.get("live") === "1" && item.problem) {
    return <LiveQa item={item} code={q.get("code") ?? item.problem.solution} ex={Number(q.get("ex") ?? 0)} theme={theme} />;
  }
  if (!item) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-lg font-semibold text-text">Máquinas del Dojo</h1>
        {Object.entries(FIGURE_PLAN).map(([machine, ids]) => (
          <section key={machine} className="mt-5">
            <h2 className="text-sm font-medium text-text-dim">{machine}</h2>
            <ul className="mt-1 flex flex-wrap gap-2">
              {ids.map((i) => (
                <li key={i}>
                  <a
                    href={`?item=${i}`}
                    className={`rounded-sm border px-2 py-1 font-mono text-xs ${
                      i in DOJO_FIGURES ? "border-green/40 text-green" : "border-line text-text-faint"
                    }`}
                  >
                    {i}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    );
  }
  return (
    <main className="flex flex-wrap items-start gap-8 bg-bg p-8">
      <section data-qa="desktop" style={{ width: 520 }}>
        <p className="mb-2 font-mono text-xs text-text-faint">{item.id} · 520 px</p>
        <DojoFigure itemId={item.id} theme={theme} reveal={reveal} />
      </section>
      <section data-qa="phone" style={{ width: 358 }}>
        <p className="mb-2 font-mono text-xs text-text-faint">390 px (menos 16 de margen por lado)</p>
        <DojoFigure itemId={item.id} theme={theme} reveal={reveal} />
      </section>
    </main>
  );
}

export default function DojoFigurasPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  );
}
