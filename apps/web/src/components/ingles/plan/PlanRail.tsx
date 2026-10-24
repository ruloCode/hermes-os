"use client";

// Riel del plan: lo que dice "cómo voy". Tres preguntas, en orden:
//  1. ¿Cumplí hoy? → meta diaria en XP + racha + botón para seguir.
//  2. ¿Soy constante? → los últimos 14 días.
//  3. ¿Está sirviendo en mis clases de verdad? → errores por patrón en las
//     clases reales, que es la métrica que importa (el XP solo mide esfuerzo).
// Todo sale de datos reales; una clase sin errores anotados (falló el audio)
// no cuenta como clase perfecta.

import { PLAN_UNITS, planLesson, shortDate, type EnglishPlanPayload } from "@hermes/shared";
import { RadialGauge } from "@/components/ui/RadialGauge";
import { RailSection } from "@/components/ui/Rail";
import { Button } from "@/components/ui/Button";
import { FlameIcon, KIND_LABEL } from "./icons";
import { TrendBars, trendWord } from "./PlanPath";

function DayStrip({ days, goal }: { days: EnglishPlanPayload["days"]; goal: number }) {
  return (
    <div className="flex items-end gap-1">
      {days.map((d) => (
        <span
          key={d.date}
          title={`${shortDate(d.date)}: ${d.xp} XP`}
          className={`h-6 flex-1 rounded-xs ${
            d.xp >= goal ? "bg-green" : d.xp > 0 ? "bg-green/35" : "bg-hover"
          }`}
        />
      ))}
    </div>
  );
}

export function PlanRail({
  plan,
  onContinue,
}: {
  plan: EnglishPlanPayload;
  onContinue: (id: string) => void;
}) {
  const current = plan.current ? planLesson(plan.current) : null;
  const currentUnit = current ? PLAN_UNITS.find((u) => u.key === current.unit) : null;
  const mastered = plan.units.filter((u) => u.mastered).length;
  const lessonsDone = plan.units.reduce((a, u) => a + u.done, 0);
  const total = plan.units.length * 5;
  const classes = Math.max(0, ...Object.values(plan.trend).map((p) => p.length));
  const goalDone = plan.xp.today >= plan.xp.goal;

  return (
    <div className="flex flex-col gap-7 pb-4">
      <RailSection label="Hoy">
        <div className="flex items-center gap-4 pt-1">
          <RadialGauge
            value={Math.min(plan.xp.today, plan.xp.goal)}
            max={plan.xp.goal}
            size={76}
            stroke={7}
            tone={goalDone ? "green" : "accent"}
            format={() => `${plan.xp.today}`}
            sublabel="XP"
          />
          <div className="min-w-0 text-sm">
            <p className="text-text">
              {goalDone ? "Meta del día cumplida" : `${plan.xp.goal - plan.xp.today} XP para la meta`}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-text-dim">
              <span className={plan.streak > 0 ? "text-amber" : "text-text-faint"}>
                <FlameIcon />
              </span>
              {plan.streak > 0
                ? `${plan.streak} ${plan.streak === 1 ? "día" : "días"} seguidos`
                : "Sin racha todavía"}
            </p>
            <p className="mt-1 text-text-faint">{plan.xp.total} XP en total</p>
          </div>
        </div>
        {current && currentUnit && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm text-text-dim">
              Sigue: <span className="text-text">{KIND_LABEL[current.kind]}</span> de «{currentUnit.title}»
            </p>
            <Button variant="primary" size="md" onClick={() => onContinue(current.id)}>
              Continuar
            </Button>
          </div>
        )}
      </RailSection>

      <RailSection label="Últimos 14 días">
        <DayStrip days={plan.days} goal={plan.xp.goal} />
        <p className="text-xs text-text-faint">
          {lessonsDone} de {total} lecciones · {mastered} de {plan.units.length} unidades dominadas
        </p>
      </RailSection>

      <RailSection label="En tus clases">
        {classes === 0 ? (
          <p className="text-sm text-text-dim">
            Aún no hay clases con correcciones anotadas. Abre la compañera en tu próxima clase (Clase en vivo) y
            aquí verás si cada patrón baja.
          </p>
        ) : (
          <>
            <ul className="flex flex-col">
              {PLAN_UNITS.filter((u) => u.measured).map((u) => {
                const points = plan.trend[u.key];
                const t = trendWord(points);
                return (
                  <li key={u.key} className="flex items-center gap-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-text-dim">{u.title}</span>
                    <TrendBars points={points} />
                    <span className="w-6 text-right font-mono text-xs text-text">{points.at(-1)?.count ?? "—"}</span>
                    <span
                      className={`w-10 text-xs ${
                        t?.tone === "good" ? "text-green" : t?.tone === "bad" ? "text-amber" : "text-text-faint"
                      }`}
                    >
                      {t?.label ?? ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs leading-relaxed text-text-faint">
              Errores que anotó el corrector en tus últimas {classes} {classes === 1 ? "clase" : "clases"} con audio
              (de la más vieja a la última). Las clases donde no entró tu voz no cuentan.
            </p>
          </>
        )}
      </RailSection>
    </div>
  );
}
