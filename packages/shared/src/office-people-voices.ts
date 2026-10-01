// Voces de la gente del edificio (puro, sin DOM): a cada persona de ambiente y
// a cada NPC con rol le toca una voz propia que NO se repite entre los vivos y
// que no cambia mientras siga en el edificio (pegajosa). Los NPC con rol tienen
// voz fija: Recepción siempre suena igual.
//
// El catálogo es el de la síntesis del sistema (speechSynthesis): en macOS,
// Chrome expone 18 voces en español (Eddy, Flo, Grandma, Grandpa, Reed, Rocko,
// Sandy y Shelley en es-ES y es-MX, más Mónica y Paulina). Con 13 personas
// alcanzan para que cada una tenga su propia voz; donde hay menos voces (otro
// sistema operativo) se separan por tono y velocidad, con pasos grandes para
// que se distingan de oído. Nunca hay dos perfiles iguales vivos a la vez.
//
// No son agentes: estas voces no son las del elenco de ElevenLabs.

export interface SystemVoice {
  name: string;
  lang: string;
}

export interface PersonVoice {
  /** Nombre de la voz del sistema ("" si el navegador no tiene ninguna en español). */
  voice: string;
  lang: string;
  /** 0.5..2 (speechSynthesis). */
  pitch: number;
  /** 0.5..2. */
  rate: number;
  /** Identidad del perfil: dos personas vivas nunca comparten clave. */
  key: string;
}

export interface VoiceRequest {
  id: string;
  /** NPC con rol: voz fija. */
  role?: string;
  /** Pista de timbre (la barba del personaje): prefiere una voz grave. */
  low?: boolean;
}

/** Timbre aproximado de las voces conocidas de macOS (para que una barba no hable con voz aguda). */
const LOW = ["Eddy", "Grandpa", "Reed", "Rocko", "Jorge", "Diego", "Juan", "Carlos"];
const HIGH = ["Flo", "Grandma", "Mónica", "Monica", "Paulina", "Sandy", "Shelley", "Marisol", "Soledad", "Angélica"];
/** Las voces de abuelos son caricaturescas: al final de la fila. */
const LAST = ["Grandma", "Grandpa"];

/** Voz fija de cada NPC con rol (nombre base y acento preferido). */
export const ROLE_VOICE: Record<string, { name: string; lang: string }> = {
  reception: { name: "Paulina", lang: "es-MX" },
  barista: { name: "Mónica", lang: "es-ES" },
  rooftop: { name: "Reed", lang: "es-MX" },
  queue: { name: "Shelley", lang: "es-ES" },
};

/** "Eddy (Spanish (Mexico))" → "Eddy"; "Mónica" → "Mónica". */
export function baseVoiceName(name: string): string {
  return name.replace(/\s*\(.*$/, "").trim();
}

export function voiceTimbre(name: string): "low" | "high" | "neutral" {
  const b = baseVoiceName(name);
  if (LOW.some((n) => n === b)) return "low";
  if (HIGH.some((n) => n === b)) return "high";
  return "neutral";
}

/** Solo español, sin duplicados de nombre, en orden estable (los abuelos al final). */
export function spanishCatalog(voices: readonly SystemVoice[]): SystemVoice[] {
  const seen = new Set<string>();
  const out: SystemVoice[] = [];
  for (const v of voices) {
    if (!v.lang.toLowerCase().startsWith("es") || seen.has(v.name)) continue;
    seen.add(v.name);
    out.push({ name: v.name, lang: v.lang });
  }
  const rank = (v: SystemVoice) => (LAST.includes(baseVoiceName(v.name)) ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tonos para repetir una voz: separados ≥ 0,12, se distinguen de oído. */
const PITCHES = [1, 1.3, 0.75, 1.6, 0.6, 1.15, 0.88, 1.45] as const;

function profile(v: SystemVoice | null, variant: number, id: string): PersonVoice {
  const pitch = PITCHES[variant % PITCHES.length];
  // Pasada la vuelta de tonos, cambia la velocidad (rarísimo: sistemas sin voces en español).
  const rate = 1 + 0.15 * Math.floor(variant / PITCHES.length) * (variant % 2 ? -1 : 1);
  // Un matiz propio por persona (±4 %) solo cuando la voz no se repite: no borra la separación entre variantes.
  const h = hash(id);
  const jitterP = variant === 0 ? 1 + ((h % 9) - 4) / 100 : 1;
  const jitterR = variant === 0 ? 1 + (((h >> 8) % 7) - 3) / 100 : 1;
  const name = v?.name ?? "";
  return {
    voice: name,
    lang: v?.lang ?? "es-CO",
    pitch: +Math.min(2, Math.max(0.5, pitch * jitterP)).toFixed(3),
    rate: +Math.min(2, Math.max(0.5, rate * jitterR)).toFixed(3),
    key: `${name || "sistema"}#${variant}`,
  };
}

/**
 * Reparte voces. `prev` es el reparto anterior (pegajoso): quien ya tenía voz
 * la conserva mientras nadie con prioridad (un NPC con rol) la reclame.
 */
export function assignVoices(people: readonly VoiceRequest[], voices: readonly SystemVoice[], prev: ReadonlyMap<string, PersonVoice> = new Map()): Map<string, PersonVoice> {
  const catalog = spanishCatalog(voices);
  const out = new Map<string, PersonVoice>();
  const taken = new Set<string>();
  const slots: { v: SystemVoice | null; variant: number }[] = [];
  // Todas las combinaciones voz × variante, voz por voz primero (variante 0 de todas antes que la 1).
  const pool: (SystemVoice | null)[] = catalog.length ? catalog : [null];
  for (let variant = 0; variant < PITCHES.length * 3; variant++) for (const v of pool) slots.push({ v, variant });
  const keyOf = (s: { v: SystemVoice | null; variant: number }) => `${s.v?.name || "sistema"}#${s.variant}`;
  const take = (id: string, s: { v: SystemVoice | null; variant: number }) => {
    const pv = profile(s.v, s.variant, id);
    taken.add(pv.key);
    out.set(id, pv);
  };

  // 1. Roles: voz fija (o la primera libre si este sistema no la tiene).
  const roles = people.filter((p) => p.role);
  for (const p of roles) {
    const want = ROLE_VOICE[p.role!];
    const match =
      catalog.find((v) => want && baseVoiceName(v.name) === want.name && v.lang === want.lang) ??
      catalog.find((v) => want && baseVoiceName(v.name) === want.name) ??
      null;
    const slot = match ? slots.find((s) => s.v === match && !taken.has(keyOf(s))) : undefined;
    if (slot) take(p.id, slot);
  }

  // 2. Pegajosos: conservan su perfil si sigue libre y la voz sigue existiendo.
  const rest = people.filter((p) => !out.has(p.id));
  for (const p of rest) {
    const old = prev.get(p.id);
    if (!old || taken.has(old.key)) continue;
    const slot = slots.find((s) => keyOf(s) === old.key);
    if (slot) take(p.id, slot);
  }

  // 3. El resto: primero voces sin usar (mejor si coincide el timbre), luego variantes.
  for (const p of rest) {
    if (out.has(p.id)) continue;
    const free = slots.filter((s) => !taken.has(keyOf(s)));
    if (!free.length) continue;
    const minVariant = Math.min(...free.map((s) => s.variant));
    const tierAll = free.filter((s) => s.variant === minVariant);
    // Los abuelos solo cuando ya no queda otra voz.
    const normal = tierAll.filter((s) => !s.v || !LAST.includes(baseVoiceName(s.v.name)));
    const tier = normal.length ? normal : tierAll;
    const fit = p.low === undefined ? tier : tier.filter((s) => !s.v || voiceTimbre(s.v.name) !== (p.low ? "high" : "low"));
    const options = fit.length ? fit : tier;
    // Determinista pero repartido: la persona elige por su hash dentro de las que le sirven.
    take(p.id, options[hash(p.id) % options.length]);
  }
  // Roles cuya voz fija no existe en este sistema: la primera libre.
  for (const p of roles) {
    if (out.has(p.id)) continue;
    const s = slots.find((x) => !taken.has(keyOf(x)));
    if (s) take(p.id, s);
  }
  return out;
}
