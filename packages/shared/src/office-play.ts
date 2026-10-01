// Lo que el dueño hace en la oficina (capa "Interacciones"): el contador del día
// y sus logros. Puro: la página guarda el día en localStorage y le pregunta a
// estas funciones qué se desbloqueó. Un logro sale SOLO de acciones reales del
// dueño (cafés que preparó, asientos donde se sentó, pisos que recorrió…).

export interface DayPlay {
  day: string;
  coffee: number;
  water: number;
  snack: number;
  pet: number;
  greet: number;
  sit: number;
  dance: number;
  /** Cafés que le dejó a un agente en su escritorio. */
  gift: number;
  /** Bloques de foco terminados completos (no cortados). */
  focus: number;
  /** Pisos que pisó hoy (0, 1, 2). */
  floors: number[];
  /** Asientos distintos donde se sentó (id del objeto). */
  seats: string[];
  /** Logros ya desbloqueados hoy (para no avisarlos dos veces). */
  unlocked: string[];
}

export type PlayStat = "coffee" | "water" | "snack" | "pet" | "greet" | "sit" | "dance" | "gift" | "focus";

export function emptyDay(day: string): DayPlay {
  return { day, coffee: 0, water: 0, snack: 0, pet: 0, greet: 0, sit: 0, dance: 0, gift: 0, focus: 0, floors: [], seats: [], unlocked: [] };
}

/** Lo guardado si es de hoy (completando campos que falten); si no, un día nuevo. */
export function loadDay(raw: unknown, today: string): DayPlay {
  if (!raw || typeof raw !== "object" || (raw as DayPlay).day !== today) return emptyDay(today);
  const r = raw as Partial<DayPlay>;
  const base = emptyDay(today);
  const num = (k: PlayStat) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : 0);
  return {
    ...base,
    coffee: num("coffee"),
    water: num("water"),
    snack: num("snack"),
    pet: num("pet"),
    greet: num("greet"),
    sit: num("sit"),
    dance: num("dance"),
    gift: num("gift"),
    focus: num("focus"),
    floors: Array.isArray(r.floors) ? r.floors.filter((f) => typeof f === "number") : [],
    seats: Array.isArray(r.seats) ? r.seats.filter((x) => typeof x === "string") : [],
    unlocked: Array.isArray(r.unlocked) ? r.unlocked.filter((x) => typeof x === "string") : [],
  };
}

/** Suma una acción (y, al sentarse, el asiento; al cambiar de piso, el piso). */
export function addPlay(d: DayPlay, stat: PlayStat | "floor", detail?: string | number): DayPlay {
  if (stat === "floor") {
    return typeof detail === "number" && !d.floors.includes(detail) ? { ...d, floors: [...d.floors, detail].sort() } : d;
  }
  const next = { ...d, [stat]: d[stat] + 1 };
  if (stat === "sit" && typeof detail === "string" && !d.seats.includes(detail)) next.seats = [...d.seats, detail];
  return next;
}

export interface Achievement {
  id: string;
  title: string;
  /** Qué hiciste para ganarlo (se muestra en la lista). */
  how: string;
  test: (d: DayPlay) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "primer-cafe", title: "Primer café", how: "Te preparaste un café", test: (d) => d.coffee >= 1 },
  { id: "tercer-cafe", title: "Tercer café", how: "Tres cafés en un día", test: (d) => d.coffee >= 3 },
  { id: "hidratado", title: "Hidratado", how: "Tres vasos de agua", test: (d) => d.water >= 3 },
  { id: "gata", title: "Amigo de la gata", how: "Acariciaste a la gata", test: (d) => d.pet >= 1 },
  { id: "sociable", title: "Sociable", how: "Saludaste a cinco personas", test: (d) => d.greet >= 5 },
  { id: "pisos", title: "Explorador", how: "Pisaste los tres pisos", test: (d) => d.floors.length >= 3 },
  { id: "asientos", title: "Probador de sillas", how: "Te sentaste en cinco lugares distintos", test: (d) => d.seats.length >= 5 },
  { id: "baile", title: "Pista de baile", how: "Bailaste en la oficina", test: (d) => d.dance >= 1 },
  { id: "regalo", title: "Buen jefe", how: "Le llevaste un café a un agente", test: (d) => d.gift >= 1 },
  { id: "foco", title: "En la zona", how: "Terminaste un bloque de foco de 25 min", test: (d) => d.focus >= 1 },
];

/** Los logros que se cumplen ahora y todavía no estaban desbloqueados. */
export function newAchievements(d: DayPlay): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !d.unlocked.includes(a.id) && a.test(d));
}
