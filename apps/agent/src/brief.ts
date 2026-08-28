/**
 * Daily brief unificado: proyectos activos del vault + finanzas del mes +
 * hábitos de hoy con rachas. Texto plano corto en español, apto para que la
 * voz lo narre (lo consume /tools/get_daily_brief). Cada sección es
 * best-effort: sin datos, se omite.
 */
import { readProjects } from "./vault/projects.js";
import { financeBriefLine } from "./finance/advisor.js";
import { habitsToday } from "./habits/store.js";

export async function buildDailyBrief(): Promise<string> {
  const sections: string[] = [];

  // Proyectos activos (lógica original del brief).
  try {
    const projects = (await readProjects()).filter((p) => p.estado === "activo");
    if (projects.length) {
      sections.push(
        projects
          .map(
            (p) =>
              `${p.name}: ${p.estado_actual.split("\n")[0]?.slice(0, 150) || "sin estado"}. Próximo: ${p.tareas_pendientes[0] ?? "nada pendiente"}.`,
          )
          .join(" \n"),
      );
    }
  } catch (err) {
    console.error("[brief] proyectos:", err);
  }

  // Finanzas del mes (gastado vs presupuestado + riesgo).
  try {
    const finance = await financeBriefLine();
    if (finance) sections.push(finance);
  } catch (err) {
    console.error("[brief] finanzas:", err);
  }

  // Hábitos: pendientes de hoy + rachas notables.
  try {
    const habits = await habitsToday();
    if (habits.length) {
      const pending = habits.filter((h) => !h.done_today);
      const bits: string[] = [];
      if (pending.length) {
        bits.push(`Hábitos pendientes hoy: ${pending.map((h) => h.name).join(", ")}.`);
      } else {
        bits.push("Hábitos de hoy: todos hechos.");
      }
      const notable = habits.filter((h) => h.streak >= 3);
      if (notable.length) {
        bits.push(
          `Rachas: ${notable
            .map((h) => `${h.name} ${h.streak} ${h.cadence === "weekly" ? "semanas" : "días"}`)
            .join(", ")}.`,
        );
      }
      sections.push(bits.join(" "));
    }
  } catch (err) {
    console.error("[brief] hábitos:", err);
  }

  return sections.join("\n") || "No hay proyectos activos en el vault.";
}
