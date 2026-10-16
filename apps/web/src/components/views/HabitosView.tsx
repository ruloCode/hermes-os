"use client";

// Vista HÁBITOS (antes mitad de /vida): cómo va el día, los hábitos de hoy y
// las metas activas. Todo sale del mismo poll de VidaProvider.
//
// Rediseño v4 — misma gramática que Finanzas (contexto → lista → pieza):
// las métricas del día dejan de vivir en un <Panel variant="hero"> y pasan a la
// cabecera, porque eso es lo que son: el encabezado de la página, no una
// tarjeta más. El centro se queda con LA lista (los hábitos de hoy, que es lo
// único que se toca aquí) y las metas se van al riel, que es donde vive el
// contexto en todas las rutas.
//
// v5: las cifras usan la MISMA fila que Finanzas (StatStrip de vida/kit):
// etiqueta → valor → contexto. Antes eran números finos de tres colores (la
// racha en ámbar, los check-ins en cyan) que no decían ningún estado.

import { useMemo } from "react";
import { useVidaContext } from "@/state/VidaProvider";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { RailSection } from "@/components/ui/Rail";
import { Sparkline } from "@/components/ui/Sparkline";
import { HabitTracker, streakLabel } from "@/components/vida/HabitTracker";
import { GoalsPanel } from "@/components/vida/GoalsPanel";
import { Progress, Stat, StatStrip } from "@/components/vida/kit";

export function HabitosView() {
  const vida = useVidaContext();
  const habits = vida.habits;

  const stats = useMemo(() => {
    const total = habits.length;
    const doneToday = habits.filter((h) => h.done_today).length;
    const best = habits.reduce(
      (a, h) => (h.streak > a.streak ? { streak: h.streak, name: h.name, cadence: h.cadence } : a),
      { streak: 0, name: "", cadence: "daily" as string },
    );
    // Check-ins por día de la semana (L→D) sumando todos los hábitos.
    const weekSeries = Array.from({ length: 7 }, (_, i) =>
      habits.reduce((a, h) => a + (h.week_dates[i]?.done ? 1 : 0), 0),
    );
    const weekTotal = weekSeries.reduce((a, b) => a + b, 0);
    return { total, doneToday, best, weekSeries, weekTotal };
  }, [habits]);

  const goalsDone = vida.goals.filter((g) => {
    const numeric = g.target_value != null && g.target_value > 0;
    return numeric
      ? g.current_value >= (g.target_value as number)
      : g.milestones.length > 0 && g.milestones.every((m) => m.done);
  }).length;

  const completo = stats.total > 0 && stats.doneToday === stats.total;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sin contador aquí a propósito: la cifra "Hechos hoy" de abajo dice
          lo mismo con su barra. Dos veces el mismo número es ruido, no énfasis. */}
      <ViewHeader title="Hábitos" meta={completo ? "Día completo" : undefined} />

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-8 gap-y-6 overflow-hidden max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        {/* ── Centro: el día en cifras + LA lista ────────────────────── */}
        <div className="col-span-12 flex min-h-0 flex-col gap-8 pt-1 lg:col-span-7">
          {stats.total > 0 && (
            <div className="shrink-0">
              <StatStrip cols={3}>
                <Stat
                  label="Hechos hoy"
                  value={`${stats.doneToday} de ${stats.total}`}
                  tone={completo ? "green" : "text"}
                  context={
                    completo
                      ? "día completo"
                      : `falta${stats.total - stats.doneToday === 1 ? "" : "n"} ${stats.total - stats.doneToday}`
                  }
                >
                  <div className="mt-1.5 max-w-48">
                    <Progress
                      value={stats.doneToday}
                      max={Math.max(stats.total, 1)}
                      done={completo}
                      label="Hábitos hechos hoy"
                    />
                  </div>
                </Stat>
                {stats.best.streak > 0 ? (
                  <Stat
                    label="Mejor racha"
                    value={streakLabel(stats.best.streak, stats.best.cadence)}
                    context={stats.best.name}
                  />
                ) : (
                  <Stat
                    label="Mejor racha"
                    value="Sin racha"
                    context="marca un hábito hoy para empezar una"
                  />
                )}
                <Stat
                  label="Check-ins esta semana"
                  value={stats.weekTotal}
                  context="de lunes a domingo"
                >
                  {/* Caja acotada: el spark suelto crece al alto por defecto del svg */}
                  <div className="mt-1.5 h-5 w-40">
                    <Sparkline data={stats.weekSeries} tone="neutral" fill />
                  </div>
                </Stat>
              </StatStrip>
            </div>
          )}

          {/* La ÚNICA caja del centro: lo que de verdad se opera aquí. */}
          {/* Mide su contenido (no flex-1): con cinco hábitos, una caja estirada
              hasta el pie es media pantalla de vacío enmarcado. Si la lista
              crece, min-h-0 la deja encoger y scrollea adentro. */}
          <section className="flex min-h-0 flex-col gap-3">
            <h2 className="shrink-0 text-sm font-medium text-text">Hábitos de hoy</h2>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel">
              <HabitTracker habits={habits} onToggle={vida.toggleHabit} onAdd={vida.addHabit} />
            </div>
          </section>
        </div>

        {/* ── Riel: las metas (contexto, no operación diaria) ────────── */}
        <aside
          aria-label="Contexto"
          className="col-span-12 flex min-h-0 flex-col border-line lg:col-span-5 lg:border-l lg:pl-6"
        >
          <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
            <div className="pt-1">
              <RailSection
                label="Metas"
                right={
                  vida.goals.length > 0 ? (
                    <span className="text-xs text-text-faint tabular-nums">
                      {goalsDone} de {vida.goals.length} cumplidas
                    </span>
                  ) : undefined
                }
              >
                <GoalsPanel
                  goals={vida.goals}
                  onBump={vida.bumpGoal}
                  onMilestone={vida.markMilestone}
                />
              </RailSection>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
