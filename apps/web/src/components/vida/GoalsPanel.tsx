"use client";

import type { Goal } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { IconCheck, num, Progress } from "./kit";

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-12-31" → "31 dic" (sin Date local para no correrse de día). */
function dueLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return MONTHS_SHORT[m - 1] ? `${d} ${MONTHS_SHORT[m - 1]}` : date;
}

/**
 * Metas activas: progreso current/target (o hitos como checklist para metas
 * cualitativas) con +1 rápido para las numéricas.
 *
 * v5: eran tarjetas con borde, la cifra en cyan, la barra del acento y el
 * "0 %" pintado del color de la barra. Un 0 % no es un error ni una señal: es
 * el punto de partida, y va en gris tenue. La barra es neutra y solo se vuelve
 * verde al cumplirse (eso SÍ es un estado). Las metas son filas del riel,
 * separadas por una hairline, no cajas.
 */
export function GoalsPanel({
  goals,
  onBump,
  onMilestone,
}: {
  goals: Goal[];
  onBump: (id: number, delta: number) => Promise<unknown>;
  onMilestone: (id: number, milestone: string) => Promise<unknown>;
}) {
  if (!goals.length) {
    return (
      <PanelState
        kind="empty"
        compact
        title="Sin metas activas"
        hint="Díselo a Hermes: “mi meta es leer 12 libros este año”."
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {goals.map((g) => {
        const doneMilestones = g.milestones.filter((m) => m.done).length;
        // Progreso real: numérico (current/target) o por hitos completados.
        const numeric = g.target_value != null && g.target_value > 0;
        const value = numeric ? g.current_value : doneMilestones;
        const max = numeric ? (g.target_value as number) : g.milestones.length;
        const pct = max > 0 ? Math.min(value / max, 1) : 0;
        const done = max > 0 && pct >= 1;
        const pctLabel = Math.round(pct * 100);

        return (
          <li key={g.id} className="flex flex-col gap-2 px-2 py-3">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm text-text">{g.title}</span>
              {g.due_date && (
                <span className="shrink-0 text-xs text-text-faint tabular-nums">
                  {dueLabel(g.due_date)}
                </span>
              )}
            </div>

            {/* Progreso: cifra real · barra neutra · % · +1 */}
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-xs text-text-dim tabular-nums">
                {g.target_value != null
                  ? `${num(g.current_value)} de ${num(g.target_value)}${g.unit ? ` ${g.unit}` : ""}`
                  : `${doneMilestones} de ${g.milestones.length} hito${g.milestones.length === 1 ? "" : "s"}`}
              </span>
              <div className="min-w-0 flex-1">
                <Progress value={value} max={max} done={done} label={`${g.title}: ${pctLabel} %`} />
              </div>
              <span
                className={`w-9 shrink-0 text-right text-xs tabular-nums ${
                  done ? "text-green" : pctLabel === 0 ? "text-text-faint" : "text-text-dim"
                }`}
              >
                {pctLabel} %
              </span>
              {numeric && (
                <Button
                  variant="ghost"
                  onClick={() => void onBump(g.id, 1)}
                  title="Sumar 1 al progreso"
                  aria-label={`Sumar 1 a ${g.title}`}
                  className="-my-1 tabular-nums"
                >
                  +1
                </Button>
              )}
            </div>

            {/* Hitos como checklist */}
            {g.milestones.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {g.milestones.map((m) => (
                  <button
                    key={m.title}
                    type="button"
                    disabled={m.done}
                    onClick={() => void onMilestone(g.id, m.title)}
                    title={m.done ? "Hito cumplido" : "Marcar hito como cumplido"}
                    className="group flex w-full cursor-pointer items-center gap-2 rounded-xs py-0.5 text-left text-xs disabled:cursor-default"
                  >
                    <span
                      aria-hidden
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
                        m.done
                          ? "border-text-faint bg-text-faint text-bg"
                          : "border-line-2 text-transparent group-hover:border-accent"
                      }`}
                    >
                      <IconCheck size={9} />
                    </span>
                    <span
                      className={
                        m.done
                          ? "text-text-faint line-through"
                          : "text-text-dim transition-colors group-hover:text-text"
                      }
                    >
                      {m.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
