/**
 * Clases y guardas compartidas del Playground.
 *
 * Estilo del look limpio (docs/ui-diagnostico-2026-09.md): superficies planas,
 * borde 1px, UN acento terracota para la acción primaria, la selección y el
 * playhead; nada de mayúsculas con tracking. Las clases de tono van en mapas
 * ESTÁTICOS porque Tailwind purga las interpoladas (`bg-${x}`).
 */

export const btn =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2.5 py-1 text-xs text-text-dim transition-colors hover:border-line-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-45";

export const btnPrimary =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-accent bg-accent px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45";

export const btnGhost =
  "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-text-dim transition-colors hover:bg-panel-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-45";

export const field =
  "rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

/** Chip de filtro/segmento: activo = acento suave. */
export const chip = (on: boolean) =>
  `inline-flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-xs transition-colors ${
    on ? "bg-accent/15 text-accent" : "text-text-dim hover:bg-panel-2 hover:text-text"
  }`;

/** Voces: paleta categórica (chart-2.. primero: chart-1 ES el acento). */
export const VOICE_BG = ["bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-1"];
export const VOICE_FILL = ["fill-chart-2", "fill-chart-3", "fill-chart-4", "fill-chart-5", "fill-chart-1"];

/** Estado de un calce: verde = calza, ámbar = no calza, gris = sin medida. */
export const FIT_TEXT = { ok: "text-green", bad: "text-amber", none: "text-text-faint" } as const;

/**
 * ¿La tecla es para un campo de texto? Las teclas sueltas se ignoran ahí (los
 * atajos con ⌘ no pasan por aquí). Espacio además cede ante un BUTTON: el
 * browser ya le manda el clic y se disparaba dos veces (lección de VoiceTab).
 */
export function typingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

export function spaceOnButton(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return e.key === " " && !!el && (el.tagName === "BUTTON" || el.getAttribute("role") === "tab");
}

/** Hay una hoja/modal abierta: los atajos de la pantalla de atrás esperan. */
export function modalOpen(): boolean {
  return typeof document !== "undefined" && !!document.querySelector("[data-composicion-modal]");
}

/** Guardas comunes para una tecla suelta del Playground. */
export function plainKey(e: KeyboardEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey && !typingTarget(e) && !modalOpen();
}
