"use client";

// Los 6 mini-paneles de métricas reales que beben del snapshot único de
// DashboardProvider. Dos disposiciones:
//  - vertical (default en pantallas anchas): riel lateral — la consola es la
//    protagonista del centro y no cede altura.
//  - horizontal: strip inferior, fallback en ventanas angostas.
// Sin snapshot (agente viejo sin /dashboard o caído) desaparece entero; cada
// mini además se auto-oculta si su sección viene null/no disponible.

import { useDashboard } from "@/state/DashboardProvider";
import { SystemMini } from "./SystemMini";
import { Activity24Mini } from "./Activity24Mini";
import { CalendarMini } from "./CalendarMini";
import { KnowledgeMini } from "./KnowledgeMini";
import { JobsMini } from "./JobsMini";
import { WeatherMini } from "./WeatherMini";

export function BottomStrip({ vertical = false }: { vertical?: boolean }) {
  const { snapshot } = useDashboard();
  if (!snapshot) return null;

  return (
    <section
      aria-label="Panel de estado"
      className={
        vertical
          ? "flex flex-col gap-3"
          : "grid grid-cols-2 gap-3 md:grid-cols-3 min-[1200px]:grid-cols-6"
      }
    >
      {/* Delays escalonados: entrada en cascada. */}
      <SystemMini system={snapshot.system} delay={0} />
      <Activity24Mini activity={snapshot.activity} delay={40} />
      <CalendarMini calendar={snapshot.calendar} delay={80} />
      <KnowledgeMini knowledge={snapshot.knowledge} delay={120} />
      <JobsMini jobs={snapshot.jobs} delay={160} />
      <WeatherMini weather={snapshot.weather} delay={200} />
    </section>
  );
}
