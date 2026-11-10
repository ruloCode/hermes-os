"use client";

// GASTO DE MODELOS (/gasto): cuánto consume cada función que llama al modelo.
// Fuente única: el registro por llamada del agente (`/usage/summary`), que
// escribe tracked-query.ts — una línea por turno, de TODA llamada.
//
// No es la vista de gasto de la Oficina: aquella cuenta runs con personaje
// (claude -p y tareas); esta cuenta también el chat, las juntas, el Estudio y
// lo que corre de fondo, y los agrupa por función del catálogo.
//
// Tres alturas, como el resto de v5:
//  - cabecera: dónde estás, desde cuándo se mide y el periodo;
//  - la fila de cifras del periodo (sin caja: se lee, no se opera);
//  - por función → por día y por modelo. Nada lleva marco: aquí no hay nada
//    que operar, solo leer.
//
// Regla de oro: todo dato visible es real. Sin registro la vista lo DICE (el
// gasto se mide desde que corre v6) y no pinta ceros.

import { useMemo, useState } from "react";
import { formatTokens } from "@hermes/shared";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Segmented } from "@/components/ui/Segmented";
import { PanelState } from "@/components/ui/PanelState";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/vida/kit";
import { CacheBar, CacheLegend, promptTokens } from "./CacheBar";
import { CatalogView } from "./CatalogView";
import { DaySeries } from "./DaySeries";
import { FeatureTable } from "./FeatureTable";
import { ModelList } from "./ModelList";
import { dayLabel, duration, percent, usd } from "./format";
import { useUsage, type UsagePeriod } from "./useUsage";

type Section = "resumen" | "catalogo";

const PERIODS: { value: `${UsagePeriod}`; label: string }[] = [
  { value: "1", label: "Hoy" },
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
];

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

/** Título de bloque: texto, sin caja ni punto de color. `right` = contexto real del bloque. */
function Block({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-text">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

export function GastoView({ active }: { active: boolean }) {
  const [days, setDays] = useState<UsagePeriod>(7);
  const [section, setSection] = useState<Section>("resumen");
  const { state: st, refresh } = useUsage(active, days);

  const labels = useMemo(
    () => new Map((st.catalog?.features ?? []).map((f) => [f.feature, f.label])),
    [st.catalog],
  );

  const data = st.data;
  const summary = data?.summary ?? null;
  const total = summary?.total ?? null;
  const since = data?.since ?? null;
  const hasCalls = (total?.calls ?? 0) > 0;
  const periodWord = days === 1 ? "hoy" : `en los últimos ${days} días`;

  const meta = since ? `Se mide desde el ${dayLabel(since)}` : undefined;

  // Lo que se ve es viejo: el último intento falló pero hay un resumen anterior de este periodo.
  const stale = st.error && data ? (
    <p className="flex items-start gap-2 text-sm text-amber" role="status">
      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
      {st.offline
        ? `Sin conexión con el agente: esto es lo último que vi, a las ${hhmm(st.fetchedAt)}.`
        : `${st.error} Esto es lo último que vi, a las ${hhmm(st.fetchedAt)}.`}
    </p>
  ) : null;

  let body: React.ReactNode;
  if (section === "catalogo") {
    body = st.catalog ? (
      <CatalogView catalog={st.catalog} />
    ) : st.catalogError ? (
      <PanelState kind="error" title="No se pudo leer el catálogo" hint={st.catalogError} retry={refresh} />
    ) : (
      <PanelState kind="loading" title="Leyendo el catálogo" />
    );
  } else if (!data) {
    body = st.loading ? (
      <PanelState kind="loading" title="Leyendo el registro de gasto" />
    ) : st.offline ? (
      <PanelState kind="offline" hint="Sin el agente no hay registro que leer. Se reintenta solo cada minuto." retry={refresh} />
    ) : (
      <PanelState kind="error" title="No se pudo leer el gasto" hint={st.error ?? undefined} retry={refresh} />
    );
  } else if (!since) {
    // Nunca se ha registrado nada: se dice desde cuándo se mide, sin ceros decorativos.
    body = (
      <PanelState
        kind="empty"
        title="Todavía no hay gasto registrado"
        hint="El gasto se mide desde que corre v6: cada llamada al modelo deja una línea en el registro. Aparece aquí en cuanto Hermes atienda la primera."
        action={
          <Button variant="secondary" onClick={() => setSection("catalogo")}>
            Ver qué modelo usa cada función
          </Button>
        }
      />
    );
  } else if (!hasCalls || !summary || !total) {
    body = (
      <PanelState
        kind="empty"
        title={days === 1 ? "Hoy no ha habido llamadas al modelo" : `Sin llamadas al modelo ${periodWord}`}
        hint={`Hay registro desde el ${dayLabel(since)}.${days < 30 ? " Prueba con un periodo más largo." : ""}`}
        action={
          days < 30 ? (
            <Button variant="secondary" onClick={() => setDays(days === 1 ? 7 : 30)}>
              Ver {days === 1 ? "7 días" : "30 días"}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    const prompt = promptTokens(total);
    const cache = percent(total.cacheRatio);
    const p50 = duration(total.p50Ms);
    const p95 = duration(total.p95Ms);
    const ttft = duration(total.p50TtftMs);
    const top = summary.byFeature[0];
    const topShare = top?.costUsd != null && total.costUsd ? percent(top.costUsd / total.costUsd) : null;
    body = (
      <>
        {/* Fila de cifras: cuatro columnas solo cuando caben sin cortar su contexto (container query). */}
        <div className="@container">
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 @md:grid-cols-2 @4xl:grid-cols-4">
          <Stat
            label={`Costo estimado ${days === 1 ? "de hoy" : `de ${days} días`}`}
            value={usd(total.costUsd)}
            context={
              top && topShare && summary.byFeature.length > 1
                ? `${topShare} en ${labels.get(top.feature) ?? top.feature}`
                : "A precio de lista"
            }
          />
          {cache && (
            <Stat
              label="Entrada leída de caché"
              value={cache}
              context={`${formatTokens(total.cacheRead)} de ${formatTokens(prompt)} tokens de entrada`}
            >
              <div className="mt-1">
                <CacheBar parts={total} size="md" />
              </div>
            </Stat>
          )}
          <Stat
            label="Llamadas al modelo"
            value={total.calls.toLocaleString("es-CO")}
            context={
              <>
                {`${formatTokens(prompt)} de entrada · ${formatTokens(total.output)} de salida`}
                {total.errors > 0 && <span className="text-red"> · {total.errors} con error</span>}
              </>
            }
          />
          {p50 && (
            <Stat
              label="Duración de un turno (p50)"
              value={p50}
              context={[p95 ? `p95 ${p95}` : null, ttft ? `primer texto en ${ttft}` : null].filter(Boolean).join(" · ") || undefined}
            />
          )}
          </div>
        </div>

        {/* La nota fija: qué ES este número, siempre a la vista. */}
        <p className="-mt-3 max-w-[92ch] text-xs text-text-faint" data-cost-note>
          El costo es la estimación del cliente del SDK a precio de lista. Con suscripción indica el consumo
          relativo entre funciones, no una factura.
        </p>

        <Block
          title="Por función"
          right={<CacheLegend />}
        >
          <FeatureTable
            features={summary.byFeature}
            labels={labels}
            models={data.models}
            tiers={st.catalog?.tiers ?? null}
            totalCost={total.costUsd}
          />
        </Block>

        <div className={`grid grid-cols-1 gap-x-12 gap-y-8 ${days > 1 ? "xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" : ""}`}>
          {/* Un solo día no es una serie: su cifra ya está arriba. */}
          {days > 1 && (
            <Block title={total.costUsd != null ? "Costo estimado por día" : "Llamadas por día"}>
              <DaySeries byDay={summary.byDay} days={days} since={since} costKnown={total.costUsd != null} />
            </Block>
          )}
          <Block title="Por modelo" className={days > 1 ? "" : "max-w-3xl"}>
            <ModelList byModel={summary.byModel} models={data.models} tiers={st.catalog?.tiers ?? null} totalCost={total.costUsd} />
          </Block>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-view="gasto">
      <ViewHeader
        title="Gasto de modelos"
        meta={meta}
        tabs={
          <Segmented<Section>
            ariaLabel="Secciones de gasto"
            value={section}
            onChange={setSection}
            options={[
              { value: "resumen", label: "Resumen" },
              { value: "catalogo", label: "Catálogo" },
            ]}
          />
        }
        actions={
          section === "resumen" ? (
            <Segmented
              ariaLabel="Periodo"
              value={`${days}` as `${UsagePeriod}`}
              onChange={(v) => setDays(Number(v) as UsagePeriod)}
              options={PERIODS}
            />
          ) : undefined
        }
      />
      {/* key: cambiar de sección vuelve arriba (el resumen bajado no deja el catálogo a media página). */}
      <ScrollArea key={section} fade="y" className="min-h-0 flex-1">
        <div className="flex flex-col gap-8 pb-8">
          {section === "resumen" && stale}
          {body}
        </div>
      </ScrollArea>
    </div>
  );
}
