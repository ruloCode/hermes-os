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

import { useMemo } from "react";
import { useVidaContext } from "@/state/VidaProvider";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { RailSection } from "@/components/ui/Rail";
import { BarMeter } from "@/components/ui/BarMeter";
import { Sparkline } from "@/components/ui/Sparkline";
import { HabitTracker } from "@/components/vida/HabitTracker";
import { GoalsPanel } from "@/components/vida/GoalsPanel";

/** Cifra del encabezado: número grande, etiqueta debajo. Dato real o no sale. */
function Metric({
  label,
  value,
  tone = "text-text",
  children,
}: {
  label: string;
  value: string | number;
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <span className={`text-2xl font-light tabular-nums ${tone}`}>{value}</span>
      <span className="text-2xs text-text-faint">{label}</span>
      {children}
    </div>
  );
}

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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Sin contador aquí a propósito: la métrica "Hechos hoy" de abajo dice
          lo mismo con su barra. Dos veces el mismo número es ruido, no énfasis. */}
      <ViewHeader title="Hábitos" meta={completo ? "Día completo" : undefined} />

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-6 gap-y-3 overflow-hidden max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        {/* ── Centro: el día en cifras + LA lista ────────────────────── */}
        <div className="col-span-12 flex min-h-0 flex-col lg:col-span-7">
          {stats.total > 0 && (
            <div className="mb-6 flex shrink-0 flex-wrap items-start gap-x-10 gap-y-4">
              <Metric
                label="Hechos hoy"
                value={`${stats.doneToday}/${stats.total}`}
                tone={completo ? "text-green" : "text-text"}
              >
                <BarMeter
                  value={stats.doneToday}
                  max={Math.max(stats.total, 1)}
                  segments={Math.min(stats.total, 14)}
                  height={6}
                  tone={completo ? "green" : "accent"}
                  showValue={false}
                />
              </Metric>
              {stats.best.streak > 0 && (
                <Metric
                  label={`Mejor racha · ${stats.best.name}`}
                  value={`${stats.best.streak} ${stats.best.cadence === "weekly" ? "sem" : "días"}`}
                  tone="text-amber"
                />
              )}
              <Metric label="Check-ins esta semana" value={stats.weekTotal} tone="text-cyan">
                {/* Caja acotada: el spark suelto crece al alto por defecto del svg */}
                <div className="h-5 w-40">
                  <Sparkline data={stats.weekSeries} tone="cyan" fill />
                </div>
              </Metric>
            </div>
          )}

          {/* La ÚNICA caja del centro: lo que de verdad se opera aquí. */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line bg-panel">
            <h3 className="shrink-0 border-b border-line px-3 py-2.5 text-xs font-medium text-text-dim">
              Hábitos de hoy
            </h3>
            <div className="min-h-0 flex-1 p-3">
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
            <section className="flex min-h-full flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xs text-text-faint">Metas</span>
                {vida.goals.length > 0 && (
                  <span className="text-2xs text-text-dim tabular-nums">
                    {goalsDone}/{vida.goals.length} cumplidas
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1">
                <GoalsPanel
                  goals={vida.goals}
                  onBump={vida.bumpGoal}
                  onMilestone={vida.markMilestone}
                />
              </div>
            </section>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
