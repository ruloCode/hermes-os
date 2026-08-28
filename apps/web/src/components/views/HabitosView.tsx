"use client";

// Vista HÁBITOS (antes mitad de /vida): stats del día (hechos/total, mejor
// racha, check-ins de la semana — patrón Me+/Habitify de Mobbin), el tracker
// de hoy y las metas activas. Todo sale del mismo poll de VidaProvider.

import { useMemo } from "react";
import { useVidaContext } from "@/state/VidaProvider";
import { Panel } from "@/components/ui/Panel";
import { BarMeter } from "@/components/ui/BarMeter";
import { Sparkline } from "@/components/ui/Sparkline";
import { StatBlock } from "@/components/ui/StatBlock";
import { HabitTracker } from "@/components/vida/HabitTracker";
import { GoalsPanel } from "@/components/vida/GoalsPanel";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* El día en un vistazo: hechos/total + barra + mejor racha + semana. */}
      <Panel title="Hábitos · hoy" variant="hero" delay={40} className="shrink-0">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
          <div className="flex min-w-44 flex-col gap-1.5">
            <StatBlock
              label="Hechos hoy"
              value={`${stats.doneToday}/${stats.total}`}
              size="lg"
              tone={stats.total > 0 && stats.doneToday === stats.total ? "green" : "neutral"}
            />
            <BarMeter
              value={stats.doneToday}
              max={Math.max(stats.total, 1)}
              segments={Math.min(stats.total, 14)}
              height={6}
              tone={stats.total > 0 && stats.doneToday === stats.total ? "green" : "violet"}
              showValue={false}
            />
            {stats.total > 0 && stats.doneToday === stats.total && (
              <p className="text-2xs text-green">Día completo ✓</p>
            )}
          </div>
          {stats.best.streak > 0 && (
            <StatBlock
              label={`Mejor racha · ${stats.best.name}`}
              value={`🔥 ${stats.best.streak}`}
              unit={stats.best.cadence === "weekly" ? "semanas" : "días"}
              size="lg"
              tone="amber"
            />
          )}
          <div className="flex flex-col gap-1.5">
            <StatBlock label="Check-ins esta semana" value={stats.weekTotal} size="lg" tone="cyan" />
            {/* Caja acotada: el spark suelto crece al alto por defecto del svg */}
            <div className="h-5 w-40">
              <Sparkline data={stats.weekSeries} tone="cyan" fill />
            </div>
          </div>
        </div>
      </Panel>

      {/* lg: fila = alto disponible (ver InglesView) — sin esto los trackers
          largos se cortan en vez de scrollear. */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        <div className="col-span-12 flex min-h-[300px] flex-col lg:col-span-7 lg:min-h-0">
          <Panel title="Hábitos de hoy" delay={90} className="min-h-0 flex-1">
            <HabitTracker habits={habits} onToggle={vida.toggleHabit} onAdd={vida.addHabit} />
          </Panel>
        </div>
        <div className="col-span-12 flex min-h-[300px] flex-col lg:col-span-5 lg:min-h-0">
          <Panel
            title="Metas"
            delay={130}
            className="min-h-0 flex-1"
            right={
              vida.goals.length > 0 ? (
                <span className="text-2xs text-text-dim tabular-nums">
                  {goalsDone}/{vida.goals.length} cumplidas
                </span>
              ) : undefined
            }
          >
            <GoalsPanel goals={vida.goals} onBump={vida.bumpGoal} onMilestone={vida.markMilestone} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
