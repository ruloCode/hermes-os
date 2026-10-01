// El cielo de la Oficina según la hora real (puro, sin three.js): cuánto pesa
// el día, el atardecer y la noche, los colores del cielo y de dónde viene el
// sol. Lo usan el domo, el panorama de la ciudad (se funden tres imágenes con
// estos pesos), la niebla y la luz.
//
// La hora manda, no el tema: el tema oscuro es de la interfaz, no de la noche.
// Bogotá está casi en el ecuador, así que el sol sale ~6:00 y se pone ~18:00
// todo el año; con eso alcanza (no es un modelo astronómico y no lo pretende).
//
// Regla del QA visual: ningún color del cielo es casi negro, ni a medianoche.

export interface SkyWeights {
  day: number;
  dusk: number;
  night: number;
}

export interface SkyState {
  /** Hora decimal 0..24. */
  hour: number;
  /** Altura del sol: 1 a mediodía, 0 en el horizonte, negativa de noche. */
  elevation: number;
  /** Pesos de las tres imágenes del panorama (suman 1). */
  weights: SkyWeights;
  /** Cielo arriba, en el horizonte y bajo el horizonte (hex). */
  zenith: string;
  horizon: string;
  /** Luces de la ciudad y de los postes: 0 apagadas · 1 toda la noche. */
  cityLights: number;
  /** Dirección hacia el sol (normalizada): +x es el este, +y arriba, +z el frente del edificio. */
  sun: { x: number; y: number; z: number };
  label: "día" | "amanecer" | "atardecer" | "noche";
}

const PALETTE = {
  day: { zenith: [74, 144, 217], horizon: [207, 232, 247] },
  dusk: { zenith: [70, 84, 150], horizon: [244, 166, 107] },
  // La noche es azul profundo, nunca negra: la escena no debe tener huecos oscuros.
  night: { zenith: [24, 36, 82], horizon: [52, 68, 118] },
} as const;

const SUNRISE = 6;
const SUNSET = 18;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

function blend(w: SkyWeights, key: "zenith" | "horizon"): number[] {
  return [0, 1, 2].map((i) => PALETTE.day[key][i] * w.day + PALETTE.dusk[key][i] * w.dusk + PALETTE.night[key][i] * w.night);
}

/** Hora decimal de un Date (hora local del navegador). */
export function hourOf(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** Altura del sol (−1..1): seno del arco entre la salida y la puesta. */
export function sunElevation(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.sin((Math.PI * (h - SUNRISE)) / (SUNSET - SUNRISE));
}

/**
 * Pesos día · atardecer · noche. El atardecer (y el amanecer) ocupa la franja en
 * que el sol está cerca del horizonte, de modo que el cruce entre imágenes dura
 * casi una hora a cada lado de la puesta y nunca hay un salto.
 */
export function skyWeights(hour: number): SkyWeights {
  const e = sunElevation(hour);
  const day = smoothstep(0.1, 0.38, e);
  const night = 1 - smoothstep(-0.32, 0, e);
  const dusk = Math.max(0, 1 - day - night);
  const sum = day + dusk + night;
  return { day: day / sum, dusk: dusk / sum, night: night / sum };
}

export function skyAt(hour: number): SkyState {
  const h = ((hour % 24) + 24) % 24;
  const elevation = sunElevation(h);
  const weights = skyWeights(h);
  // El sol cruza de este (+x) a oeste (−x), un poco hacia el frente (+z) para que la fachada no quede a contraluz.
  const arc = (Math.PI * (h - SUNRISE)) / (SUNSET - SUNRISE);
  const sx = Math.cos(arc);
  const sy = Math.max(0.12, elevation);
  const sz = 0.45;
  const len = Math.hypot(sx, sy, sz);
  const label = weights.night > 0.6 ? "noche" : weights.day > 0.6 ? "día" : h < 12 ? "amanecer" : "atardecer";
  return {
    hour: h,
    elevation,
    weights,
    zenith: hex(blend(weights, "zenith")),
    horizon: hex(blend(weights, "horizon")),
    cityLights: Math.min(1, weights.night + weights.dusk * 0.6),
    sun: { x: sx / len, y: sy / len, z: sz / len },
    label,
  };
}

/** Luminancia relativa (0..1) de un hex: el QA y los tests la usan para "casi negro". */
export function luminance(color: string): number {
  const n = parseInt(color.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
