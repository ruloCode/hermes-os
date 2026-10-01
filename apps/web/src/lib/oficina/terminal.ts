// Pintor de "terminal" compartido por el monitor de cada escritorio y la pared
// de pantallas: las líneas REALES del personaje (OfficeWorker.lines, las mismas
// de la laptop) con el color de su tipo, cortadas con "…" — nunca completadas.

import { formatTokens, formatUsd, totalTokens, type OfficeWorker, type OfficeWorkerStatus } from "@hermes/shared";

export const STATUS_TEXT: Record<OfficeWorkerStatus, string> = {
  starting: "arrancando",
  working: "trabajando",
  thinking: "pensando",
  blocked: "bloqueado",
  needs_you: "te necesita",
  done: "listo",
  error: "error",
};

export const STATUS_COLOR: Record<OfficeWorkerStatus, string> = {
  starting: "#9aa3b2",
  working: "#e7b04e",
  thinking: "#7fc4d4",
  blocked: "#f07070",
  needs_you: "#d97757",
  done: "#6ccb8f",
  error: "#f07070",
};

/** Color de una línea según su marca (⚙ tool, ↩ resultado, ✗ error, ✓ cierre, ❯ prompt, ✋ permiso). */
export function lineColor(line: string, accent: string): string {
  const head = line.slice(0, 1);
  return head === "⚙" ? accent : head === "↩" ? "#7f849c" : head === "✗" ? "#f38ba8" : head === "✓" ? "#a6e3a1" : head === "❯" ? "#89b4fa" : head === "✋" ? accent : "#cdd6f4";
}

/** Corta al ancho con "…" (sin inventar el resto). */
export function clip(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 2 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Lo que lleva gastado, como lo dice el agente: costo final, o tokens hasta ahora. */
export function spendLabel(w: Pick<OfficeWorker, "spend">): string | null {
  const s = w.spend;
  if (!s) return null;
  if (s.final && s.costUsd !== undefined) return formatUsd(s.costUsd);
  const t = totalTokens(s.tokens);
  return t ? `${formatTokens(t)} tok` : null;
}

/** Líneas de la terminal dentro de un rectángulo (las últimas que caben). */
export function paintLines(g: CanvasRenderingContext2D, lines: string[], x: number, y: number, w: number, h: number, size: number, mono: string, accent: string) {
  g.font = `500 ${size}px ${mono}`;
  g.textBaseline = "top";
  g.textAlign = "left";
  const lh = Math.round(size * 1.35);
  if (!lines.length) {
    g.fillStyle = "#6c7086";
    g.fillText("arrancando…", x, y);
    return;
  }
  const rows = Math.max(1, Math.floor(h / lh));
  lines.slice(-rows).forEach((line, i) => {
    g.fillStyle = lineColor(line, accent);
    g.fillText(clip(g, line, w), x, y + i * lh);
  });
}
