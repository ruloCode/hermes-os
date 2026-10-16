"use client";

import { useState } from "react";
import type { HabitToday } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { Segmented } from "@/components/ui/Segmented";
import { FIELD, IconCheck } from "./kit";

const DAY_LABELS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** "3 días" / "1 semana" — la unidad de la racha depende de la cadencia. */
export function streakLabel(n: number, cadence: string): string {
  if (cadence === "weekly") return `${n} ${n === 1 ? "semana" : "semanas"}`;
  return `${n} ${n === 1 ? "día" : "días"}`;
}

/**
 * Hábitos de hoy: check-in con un clic, la semana como 7 puntos (lunes→
 * domingo) y la racha. Crear hábito inline.
 *
 * v5: más calma. Cada hábito era una cajita con borde (verde al marcarlo), el
 * check un punto verde con glow y la racha un 🔥 en una píldora ámbar: tres
 * colores de estado en cada fila de una lista que es, sobre todo, una lista.
 * Ahora la fila es texto + hover; marcar llena el círculo del ACENTO (es el
 * control que tocaste, no un semáforo) y la semana va en gris: un punto lleno
 * es un día hecho, uno hueco es uno que no.
 */
export function HabitTracker({
  habits,
  onToggle,
  onAdd,
}: {
  habits: HabitToday[];
  onToggle: (habit: HabitToday) => Promise<unknown>;
  onAdd: (name: string, cadence?: "daily" | "weekly", timesPerWeek?: number) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [saving, setSaving] = useState(false);
  // Hoy en Bogotá (YYYY-MM-DD, en-CA formatea ISO) para ubicar el punto de hoy.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onAdd(name.trim(), cadence, cadence === "weekly" ? 3 : 7);
    setName("");
    setSaving(false);
  };

  return (
    <div className="flex min-h-0 flex-col">
      {/* Crear hábito */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="Nuevo hábito… (meditar, gym, leer)"
          aria-label="Nombre del hábito"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <Segmented
          ariaLabel="Frecuencia"
          value={cadence}
          onChange={setCadence}
          options={[
            { value: "daily", label: "Diario" },
            { value: "weekly", label: "Semanal" },
          ]}
        />
        <Button
          variant="primary"
          size="md"
          onClick={() => void add()}
          disabled={!name.trim() || saving}
        >
          {saving ? "Añadiendo…" : "Añadir"}
        </Button>
      </div>

      {/* Lista */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {habits.length === 0 && (
          <PanelState
            kind="empty"
            compact
            title="Sin hábitos aún"
            hint="Crea uno arriba o díselo a Hermes: “crea el hábito de meditar”."
          />
        )}
        <ul className="flex flex-col">
          {habits.map((h) => (
            <li
              key={h.id}
              className="flex min-w-0 items-center gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-hover"
            >
              {/* Check de hoy: el control que tocaste, en el color del acento */}
              <button
                type="button"
                onClick={() => void onToggle(h)}
                aria-pressed={h.done_today}
                aria-label={h.done_today ? `Des-marcar ${h.name} hoy` : `Marcar ${h.name} como hecho hoy`}
                title={h.done_today ? "Des-marcar hoy" : "Marcar como hecho hoy"}
                className={`grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors ${
                  h.done_today
                    ? "border-accent-solid bg-accent-solid text-on-accent"
                    : "border-line-2 text-transparent hover:border-accent hover:text-accent/50"
                }`}
              >
                <IconCheck size={12} />
              </button>

              <div className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${
                    h.done_today ? "text-text-dim" : "text-text"
                  }`}
                >
                  {h.name}
                </span>
                {h.cadence === "weekly" && (
                  <span className="block text-xs text-text-faint tabular-nums">
                    {h.week_count} de {h.times_per_week} esta semana
                  </span>
                )}
              </div>

              {/* Semana en 7 puntos (lunes→domingo), neutros. Hoy lleva el
                  aro más marcado para ubicarte; los días que vienen, más tenues. */}
              <div className="flex shrink-0 items-center gap-1" aria-label="Esta semana">
                {h.week_dates.map((d, i) => (
                  <span
                    key={d.date}
                    title={`${DAY_LABELS[i]} ${d.date.slice(8)}: ${d.done ? "hecho" : "sin hacer"}`}
                    className={`h-2 w-2 rounded-full ${
                      d.done
                        ? "bg-text-dim"
                        : d.date === today
                          ? "border border-text-dim"
                          : d.date > today
                            ? "border border-line"
                            : "border border-line-2"
                    }`}
                  />
                ))}
              </div>

              {/* Racha */}
              <span
                className={`w-20 shrink-0 text-right text-xs tabular-nums ${
                  h.streak > 0 ? "text-text-dim" : "text-text-faint"
                }`}
                title="Racha actual"
              >
                {h.streak > 0 ? streakLabel(h.streak, h.cadence) : "sin racha"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
