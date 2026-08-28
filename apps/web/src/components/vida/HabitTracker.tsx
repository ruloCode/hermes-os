"use client";

import { useState } from "react";
import type { HabitToday } from "@hermes/shared";
import { Badge } from "@/components/ui/Badge";
import { CmdButton } from "@/components/ui/CmdButton";
import { PanelState } from "@/components/ui/PanelState";

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

// Campos del alta inline: mismo borde/focus que el resto de la vista.
const FIELD =
  "rounded-sm border border-line bg-transparent outline-none transition-colors focus:border-line-2";

/**
 * Hábitos de hoy: check-in con un click (dot verde con glow al completar),
 * racha 🔥 como Badge ámbar y la semana como grid de 7 puntos
 * (lunes→domingo). Crear hábito inline.
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

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onAdd(name.trim(), cadence, cadence === "weekly" ? 3 : 7);
    setName("");
    setSaving(false);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Crear hábito */}
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="Nuevo hábito… (meditar, gym, leer)"
          className={`${FIELD} min-w-0 flex-1 px-2 py-1 text-xs text-text`}
        />
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as "daily" | "weekly")}
          className={`${FIELD} px-1.5 py-1 text-2xs text-text`}
        >
          <option value="daily" className="bg-bg">Diario</option>
          <option value="weekly" className="bg-bg">Semanal</option>
        </select>
        {/* Wrapper shrink-0: .cmd-btn trae width:100% y aquí va inline */}
        <div className="shrink-0">
          <CmdButton size="sm" onClick={() => void add()} disabled={!name.trim()} loading={saving}>
            Añadir
          </CmdButton>
        </div>
      </div>

      {/* Lista */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {habits.length === 0 && (
          <PanelState
            kind="empty"
            compact
            title="Sin hábitos aún"
            hint="Crea uno o díselo a Hermes: “crea el hábito de meditar”."
          />
        )}
        {habits.map((h) => (
          <div
            key={h.id}
            className={`flex items-center gap-2.5 rounded-sm border px-2 py-1.5 transition-colors ${
              h.done_today ? "border-green/40" : "border-line"
            }`}
          >
            {/* Check de hoy: dot verde con glow cuando está hecho */}
            <button
              type="button"
              onClick={() => void onToggle(h)}
              aria-pressed={h.done_today}
              title={h.done_today ? "Des-marcar hoy" : "Marcar como hecho hoy"}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                h.done_today ? "border-green" : "border-line-2 hover:border-green"
              }`}
            >
              {h.done_today && (
                <span aria-hidden className="glow-box-green h-2 w-2 rounded-full bg-green" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-text">
                {h.name}
                {h.cadence === "weekly" && (
                  <span className="ml-1 text-2xs text-text-dim tabular-nums">
                    {h.week_count}/{h.times_per_week} sem
                  </span>
                )}
              </div>
              {/* Semana en 7 puntos (lunes→domingo) */}
              <div className="mt-0.5 flex items-center gap-1">
                {h.week_dates.map((d, i) => (
                  <span
                    key={d.date}
                    title={`${DAY_LABELS[i]} ${d.date.slice(5)}`}
                    className={`h-1.5 w-1.5 rounded-full ${
                      d.done ? "bg-green" : "border border-line"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Racha */}
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
              {h.streak > 0 ? (
                <Badge tone="amber" size="sm">
                  🔥 {h.streak}
                </Badge>
              ) : (
                <span className="font-display text-sm text-text-dim">—</span>
              )}
              <span className="text-2xs tracking-label text-text-dim uppercase">
                {h.cadence === "weekly" ? "semanas" : "días"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
