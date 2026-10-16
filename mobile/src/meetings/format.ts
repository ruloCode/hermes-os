/** Formatos compartidos de la pantalla de Reuniones. */

/** 0:07 · 12:34 · 1:02:03 */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "52 min" · "1 h 12 min" · "40 s" */
export function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return "";
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Fecha legible en hora LOCAL (el agente guarda UTC): "hoy 9:05am", "ayer
 * 2pm", "martes 2pm" dentro de la semana, "8 jul · 2pm" más atrás.
 */
export function whenLabel(iso: string, withMinutes = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  const mins = withMinutes ? `:${String(d.getMinutes()).padStart(2, "0")}` : "";
  const hour = `${h % 12 || 12}${mins}${h < 12 ? "am" : "pm"}`;
  const now = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (days === 0) return `hoy ${hour}`;
  if (days === 1) return `ayer ${hour}`;
  if (days > 1 && days < 7) return `${DIAS[d.getDay()]} ${hour}`;
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MESES[d.getMonth()]}${year} · ${hour}`;
}

/** "en 2 min" · "en 40 s" para el próximo reintento automático. */
export function inLabel(at: number | null): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((at - Date.now()) / 1000));
  return s < 60 ? `en ${s} s` : `en ${Math.round(s / 60)} min`;
}
