// Marca de Hermes — UNA sola fuente para la web, el teléfono y la app móvil.
//
// Antes cada superficie tenía su copia: la web en `globals.css` (Grafito,
// índigo) y Hermes Phone en su `Theme.kt` (todavía el terracota de v4). Dos
// copias = dos marcas en cuanto una cambia. Ahora:
//
//  - la WEB sigue leyendo `globals.css` (Tailwind v4 necesita sus @theme),
//    pero un test exige que cada token de aquí aparezca ahí con el MISMO valor;
//  - el TELÉFONO no se escribe a mano: `pnpm brand:sync` genera su `Brand.kt`
//    y el icono del launcher desde este archivo.
//
// Cambiar un color = cambiarlo aquí + en globals.css (el test avisa si falta
// uno) + `pnpm brand:sync`. Los valores van tal cual se escriben en CSS para
// que la comparación sea literal.

export const BRAND_NAME = "Hermes";

/** Los tokens de color que comparten todas las superficies, en el orden de globals.css. */
export const BRAND_COLOR_KEYS = [
  "chrome",
  "bg",
  "panel",
  "panel-2",
  "line",
  "line-2",
  "hover",
  "selected",
  "accent",
  "accent-hot",
  "accent-solid",
  "on-accent",
  "cyan",
  "blue",
  "green",
  "amber",
  "red",
  "text",
  "text-dim",
  "text-faint",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];
export type BrandPalette = Record<BrandColorKey, string>;

/**
 * Grafito oscuro: neutros fríos en tres alturas (chrome < bg < panel) y UN
 * acento índigo "Iris". Ver docs/ui-v5-grafito.md para el porqué de cada uno.
 */
export const BRAND_DARK: BrandPalette = {
  chrome: "#0e0f11",
  bg: "#131417",
  panel: "#18191d",
  "panel-2": "#1f2025",
  line: "rgb(255 255 255 / 0.07)",
  "line-2": "rgb(255 255 255 / 0.13)",
  hover: "rgb(255 255 255 / 0.05)",
  selected: "rgb(255 255 255 / 0.09)",
  accent: "#7c7ff5",
  "accent-hot": "#a5a7fa",
  "accent-solid": "#5b5bd6",
  "on-accent": "#ffffff",
  cyan: "#6db3c8",
  blue: "#7ea6ee",
  green: "#5cc58b",
  amber: "#e3ad55",
  red: "#ee7b7b",
  text: "#eceef1",
  "text-dim": "#a3a7b0",
  "text-faint": "#8a8e97",
  "chart-1": "#7c7ff5",
  "chart-2": "#4fb5ad",
  "chart-3": "#d57db3",
  "chart-4": "#6aa6ee",
  "chart-5": "#7cc48e",
};

/** Grafito claro: lienzo blanco sobre cromo gris; índigo más profundo para AA sobre blanco. */
export const BRAND_LIGHT: BrandPalette = {
  chrome: "#f4f4f5",
  bg: "#ffffff",
  panel: "#ffffff",
  "panel-2": "#f4f4f6",
  line: "rgb(17 19 24 / 0.09)",
  "line-2": "rgb(17 19 24 / 0.16)",
  hover: "rgb(17 19 24 / 0.045)",
  selected: "rgb(17 19 24 / 0.075)",
  accent: "#5048e5",
  "accent-hot": "#3f37cc",
  "accent-solid": "#5048e5",
  "on-accent": "#ffffff",
  cyan: "#0e7490",
  blue: "#2563eb",
  green: "#15803d",
  amber: "#b45309",
  red: "#dc2626",
  text: "#16171a",
  "text-dim": "#50545d",
  "text-faint": "#6b6f78",
  "chart-1": "#5048e5",
  "chart-2": "#0f8a82",
  "chart-3": "#b8458c",
  "chart-4": "#2f74d0",
  "chart-5": "#2e8b4f",
};

/** Seis pasos y piso de 12 (los nombres de la web colapsan a estos valores). */
export const BRAND_TYPE = {
  sans: "Geist",
  mono: "Geist Mono",
  /** px en la web, sp en Android. */
  scale: { label: 12, support: 14, body: 16, section: 20, title: 28, hero: 40 },
} as const;

/** Radios firmes, no de burbuja: controles · tarjetas · superficies grandes. */
export const BRAND_RADIUS = { control: 6, card: 8, surface: 12, sheet: 16 } as const;

/**
 * La marca: hoja índigo redondeada con una "H" cuyo travesaño SUBE — el
 * mensajero en marcha. Geometría en un viewBox de 24; el fondo es
 * `accent-solid` y el trazo `on-accent`, así que sigue al tema.
 */
export const BRAND_MARK = {
  viewBox: 24,
  cornerRadius: 7,
  path: "M8.2 6.8v10.4M15.8 6.8v10.4M8.2 13.4l7.6-2.8",
  strokeWidth: 2.1,
} as const;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

/** `#rrggbb` o `rgb(r g b / a)` (las dos formas que usa globals.css). Lanza si no es ninguna. */
export function parseBrandColor(css: string): Rgba {
  const v = css.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if ([r, g, b].some((c) => c > 255) || a < 0 || a > 1) throw new Error(`color fuera de rango: ${css}`);
    return { r, g, b, a };
  }
  throw new Error(`color de marca no reconocido: ${css}`);
}

/** Entero ARGB de 32 bits en hex (`0xAARRGGBB`), el formato de `Color(…)` en Compose. */
export function toArgbHex(c: Rgba): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase();
  return `0x${h(c.a * 255)}${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** `#AARRGGBB` para recursos XML de Android (vectores, colors.xml). */
export function toAndroidHex(c: Rgba): string {
  return `#${toArgbHex(c).slice(2)}`;
}

/** Contraste WCAG entre dos colores opacos (para que los tests midan, no supongan). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const lum = ({ r, g, b: bl }: Rgba) => {
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
