// Paleta de la Oficina: TODO color de la escena sale de los tokens del tema
// (readToken), así el modo claro y el oscuro funcionan sin código aparte. La
// escena se re-monta con key={theme.resolved}, y cada montaje lee la paleta
// una sola vez.

import type { OfficeWorkerStatus } from "@hermes/shared";
import { readToken } from "@/components/ui/tones";

export interface OfficePalette {
  dark: boolean;
  bg: string;
  floor: string;
  grid: string;
  desk: string;
  deskTrim: string;
  leg: string;
  chair: string;
  ink: string;
  dim: string;
  faint: string;
  accent: string;
  /** Un color por proyecto (los mismos de los charts del dashboard). */
  skins: string[];
  bulb: Record<OfficeWorkerStatus, string>;
  /** Fondo de las tarjetas sobre la cabeza por estado. */
  card: Record<OfficeWorkerStatus, string>;
  outline: string;
  font: string;
  mono: string;
}

function mix(a: string, b: string, t: number): string {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parse(c: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function luminance(c: string): number {
  const p = parse(c);
  if (!p) return 0;
  return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
}

export function readOfficePalette(): OfficePalette {
  const bg = readToken("--color-bg", "#121110");
  const panel = readToken("--color-panel", "#1a1917");
  const panel2 = readToken("--color-panel-2", "#232120");
  const ink = readToken("--color-text", "#f0ede6");
  const dim = readToken("--color-text-dim", "#b8b3a8");
  const faint = readToken("--color-text-faint", "#8f8a80");
  const accent = readToken("--color-accent", "#d97757");
  const amber = readToken("--color-amber", "#e7b04e");
  const green = readToken("--color-green", "#6ccb8f");
  const red = readToken("--color-red", "#f07070");
  const cyan = readToken("--color-cyan", "#7fc4d4");
  const dark = luminance(bg) < 0.5;
  const cardBase = dark ? panel2 : "#ffffff";
  const tint = (c: string) => mix(cardBase, c, dark ? 0.28 : 0.22);
  return {
    dark,
    bg,
    floor: mix(panel, bg, 0.35),
    grid: faint,
    desk: mix(panel2, "#c9a27a", dark ? 0.55 : 0.35),
    deskTrim: mix(panel2, accent, 0.35),
    leg: mix(faint, bg, 0.2),
    chair: mix(panel2, ink, dark ? 0.22 : 0.4),
    ink,
    dim,
    faint,
    accent,
    skins: [1, 2, 3, 4, 5].map((i) => readToken(`--color-chart-${i}`, accent)),
    bulb: { starting: faint, working: amber, thinking: cyan, blocked: red, needs_you: accent, done: green, error: red },
    card: {
      starting: cardBase,
      working: tint(amber),
      thinking: tint(cyan),
      blocked: tint(red),
      needs_you: tint(accent),
      done: tint(green),
      error: tint(red),
    },
    // Contorno de caricatura: la tinta del tema, lavada hacia el fondo.
    outline: mix(bg, dark ? "#000000" : ink, dark ? 0.6 : 0.75),
    font: readToken("--font-sans", "ui-sans-serif, system-ui, sans-serif"),
    mono: readToken("--font-mono", "ui-monospace, Menlo, monospace"),
  };
}
