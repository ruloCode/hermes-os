import type { Tone } from "@/components/ui/tones";
import type { RefKind, SectionKind, SongStage } from "./types";

export const STAGE_ORDER: SongStage[] = ["idea", "letra", "armonia", "melodia", "demo", "terminada"];

export const STAGES: Record<SongStage, { label: string; hint: string; tone: Tone }> = {
  idea: { label: "Idea", hint: "Una frase-semilla, un título, un tarareo", tone: "neutral" },
  letra: { label: "Letra", hint: "Versos y coro: decir lo que hay que decir", tone: "accent" },
  armonia: { label: "Armonía", hint: "Tonalidad y acordes que sostienen la letra", tone: "cyan" },
  melodia: { label: "Melodía", hint: "Cantarla encima hasta que se pegue", tone: "blue" },
  demo: { label: "Demo", hint: "Grabarla fea para saber si vive", tone: "amber" },
  terminada: { label: "Terminada", hint: "Se deja ir", tone: "green" },
};

export const SECTION_KINDS: Record<SectionKind, { label: string; tone: Tone; hint: string }> = {
  intro: { label: "Intro", tone: "neutral", hint: "Establece el clima antes de la primera palabra" },
  verso: { label: "Verso", tone: "blue", hint: "Cuenta: detalles concretos, escena, tiempo" },
  pre: { label: "Pre-coro", tone: "cyan", hint: "Sube la tensión; prepara la frase del coro" },
  coro: { label: "Coro", tone: "accent", hint: "La idea central, dicha de la forma más simple" },
  puente: { label: "Puente", tone: "amber", hint: "Cambia el ángulo: otra armonía, otra verdad" },
  final: { label: "Final", tone: "green", hint: "Cierra con eco o con silencio" },
  instrumental: { label: "Instrumental", tone: "neutral", hint: "Deja respirar" },
};

export const REF_KINDS: Record<RefKind, { label: string; glyph: string; tone: Tone }> = {
  cancion: { label: "Canción", glyph: "♫", tone: "accent" },
  letra: { label: "Letra", glyph: "❝", tone: "cyan" },
  progresion: { label: "Progresión", glyph: "▤", tone: "blue" },
  poema: { label: "Poema", glyph: "✎", tone: "amber" },
  ambiente: { label: "Ambiente", glyph: "◌", tone: "green" },
  nota: { label: "Nota", glyph: "▪", tone: "neutral" },
};

export const PLAN_LABEL = { observar: "observar", probar: "probar", aplicado: "aplicado" } as const;

export const inputCls =
  "rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

export const btnCls =
  "rounded-sm border border-line-2 bg-panel-2 px-2.5 py-1 text-2xs tracking-label text-text uppercase hover:border-accent disabled:cursor-not-allowed disabled:opacity-50";

export const ghostBtnCls =
  "rounded-sm border border-transparent px-2 py-1 text-2xs tracking-label text-text-dim uppercase hover:border-line hover:text-text";

export function fmtRelative(iso: string, now = Date.now()): string {
  const d = Math.round((now - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} días`;
  if (d < 30) return `hace ${Math.round(d / 7)} sem`;
  return `hace ${Math.round(d / 30)} meses`;
}

/** Clases de tono ESTÁTICAS: Tailwind purga `bg-${tone}` / `text-${tone}`. */
export const DOT_BG: Record<string, string> = {
  accent: "bg-accent",
  cyan: "bg-cyan",
  blue: "bg-blue",
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
  neutral: "bg-text-faint",
};

export const TEXT_TONE: Record<string, string> = {
  accent: "text-accent",
  cyan: "text-cyan",
  blue: "text-blue",
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  neutral: "text-text-dim",
};
