/**
 * Formatos del Playground: tiempos, tamaños y fechas en español. Todo dato que
 * falta se devuelve como null para que el componente lo OMITA (regla de la
 * casa: nada de "—" inventado donde no hay medida).
 */
import { latinName, mod12, noteName, type Key } from "@/lib/music-theory";

/** 83.4 → "1:23"; con `tenths` → "1:23.4" (bordes de un pasaje). */
export function fmtTime(sec: number, tenths = false): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const ss = tenths ? rest.toFixed(1).padStart(4, "0") : String(Math.floor(rest)).padStart(2, "0");
  return `${m}:${ss}`;
}

/** Duración legible: "19 s", "4:12", "1 h 02 min". */
export function fmtDuration(sec: number | undefined | null): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return fmtTime(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec - h * 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

export function fmtBytes(b: number | undefined | null): string | null {
  if (b == null || !Number.isFinite(b)) return null;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${Math.round(b / 1024 / 1024)} MB`;
  return `${(b / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
}

/** "23 sep · 22:13" (con año solo si no es el actual). */
export function fmtDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const time = d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date.replace(".", "")} · ${time}`;
}

/** Porcentaje entero: 0.712 → "71 %". */
export const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Nombre de una nota MIDI con octava, deletreado según la tonalidad: 58 → "Bb3" / "Si♭3". */
export function midiName(m: number, key: Key, notation: "en" | "latin"): string {
  const r = Math.round(m);
  const pc = mod12(r);
  const oct = Math.floor(r / 12) - 1;
  const n = notation === "latin" ? latinName(pc, key) : noteName(pc, key).replace("b", "♭").replace("#", "♯");
  return `${n}${oct}`;
}

/** Semitonos con signo: +2 st / −3 st / 0 st. */
export const fmtSemis = (n: number) => (n > 0 ? `+${n} st` : n < 0 ? `−${Math.abs(n)} st` : "0 st");
