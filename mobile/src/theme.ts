/**
 * Paleta "AGENTIC OS" — misma que el dashboard web, adaptada a móvil.
 * Fondo casi negro con acentos violeta/cyan/verde. Todo oscuro.
 */
export const C = {
  bg: "#07070c",
  panel: "#0d0d16",
  panel2: "#12121f",
  line: "rgba(122,132,255,0.16)",
  lineSoft: "rgba(255,255,255,0.06)",
  text: "#e7e7f2",
  textDim: "#7a7a92",
  textFaint: "#4a4a5e",
  violet: "#7a84ff",
  violetHot: "#c4b5fd",
  cyan: "#22d3ee",
  green: "#6ee7a0",
  amber: "#fbbf24",
  red: "#fb7185",
  blue: "#60a5fa",
} as const;

/** Color por estado de proyecto/tarea. */
export function stateColor(estado?: string | null): string {
  const s = (estado ?? "").toLowerCase();
  if (s.includes("activo") || s === "running") return C.green;
  if (s.includes("pausa") || s === "pending") return C.amber;
  if (s === "done" || s.includes("termin") || s.includes("complet")) return C.cyan;
  if (s === "dismissed" || s.includes("ignor")) return C.textFaint;
  if (s === "error") return C.red;
  return C.violet;
}

export const mono = "monospace";
