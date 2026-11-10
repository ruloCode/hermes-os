/**
 * Contexto del turno (spec «sesion», requisito «System prompt estable por sesión»).
 *
 * El system prompt de una sesión es una foto (base): idéntico entre turnos para
 * que el prefijo cacheado se lea. Lo que depende del MENSAJE (memorias, lo
 * relevante que encontró searchKnowledge, las cifras frescas del modo vida)
 * viaja al inicio del mensaje del usuario dentro de <contexto-hermes>…</…>, y
 * la base le dice al modelo que ese bloque es dato, no instrucciones.
 *
 * Todo lo de aquí es puro (sin red ni disco): decidir si un mensaje merece
 * búsqueda, no repetir lo ya enviado en la sesión, armar el bloque y la foto
 * de la base con su vida útil.
 */

export const CONTEXT_TAG = "contexto-hermes";

/** Palabras que no cuentan como contenido (saludos, muletillas, conectores es/en). */
const FILLER = new Set(
  (
    "hola holi buenas buenos buen dias dia tardes noches hey oye ey epa saludos que tal como estas vas " +
    "gracias mil ok okay okey vale dale listo perfecto genial bien bueno si no claro ya jaja jeje " +
    "chao adios nos vemos hasta luego porfa por favor please hi hello hey thanks thank you yes yeah nope bye " +
    "el la los las un una unos unas de del al a en y o u e que con por para mi me te tu se lo le su es " +
    "the a an of to and or in on is it i you"
  ).split(/\s+/),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Palabras con contenido: ni muletillas ni conectores, y de más de una letra. */
export function contentWords(text: string): string[] {
  return words(text).filter((w) => w.length > 1 && !FILLER.has(w));
}

/**
 * Un saludo o algo con menos de tres palabras con contenido no merece una
 * búsqueda semántica: lo que encuentre es ruido que se paga en tokens.
 */
export function isTrivialMessage(text: string): boolean {
  return contentWords(text).length < 3;
}

/** Un fragmento candidato a viajar en el contexto. `key` identifica el dato (no el texto). */
export interface ContextItem {
  key: string;
  line: string;
}

/** Lo que aún no viajó en esta sesión (y las claves que quedan marcadas al mandarlo). */
export function selectUnsent(items: ContextItem[], sent: ReadonlySet<string>): ContextItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (sent.has(it.key) || seen.has(it.key)) return false;
    seen.add(it.key);
    return true;
  });
}

/** Lo que Hermes ya mandó en una sesión. Vive en memoria con la foto de la base. */
export class ContextLedger {
  readonly sent = new Set<string>();
  turns = 0;

  /** Filtra lo nuevo y lo marca como enviado. */
  take(items: ContextItem[]): ContextItem[] {
    const fresh = selectUnsent(items, this.sent);
    for (const it of fresh) this.sent.add(it.key);
    return fresh;
  }
}

/** El bloque no puede cerrarse desde adentro: una etiqueta en los datos se neutraliza. */
export function sanitizeContext(text: string): string {
  return text.replace(new RegExp(`<\\s*/?\\s*${CONTEXT_TAG}\\s*>`, "gi"), `[${CONTEXT_TAG}]`);
}

/** Secciones del contexto del turno → el texto del bloque (null = no hay nada que mandar). */
export function contextBlockText(sections: { title: string; body: string }[]): string | null {
  const parts = sections.filter((s) => s.body.trim()).map((s) => `## ${s.title}\n${s.body.trim()}`);
  return parts.length ? sanitizeContext(parts.join("\n\n")) : null;
}

/** El mensaje que de verdad viaja: el bloque (si hay) y luego lo que escribió el usuario. */
export function wrapUserMessage(context: string | null, message: string): string {
  if (!context) return message;
  return `<${CONTEXT_TAG}>\n${context}\n</${CONTEXT_TAG}>\n\n${message}`;
}

/**
 * Foto de la base por sesión del cliente (clave: sesión + proyecto en foco),
 * reutilizada durante `ttlMs`. Reloj inyectado para poder probarla.
 */
export class SnapshotCache<T> {
  private readonly items = new Map<string, { value: T; at: number }>();

  constructor(
    private readonly ttlMs = 60 * 60_000,
    private readonly max = 50,
  ) {}

  get(key: string, now: number): T | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    if (now - hit.at >= this.ttlMs) {
      this.items.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, now: number): void {
    this.items.delete(key);
    this.items.set(key, { value, at: now });
    // El Map recuerda el orden de inserción: el primero es el más viejo.
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value as string);
  }

  delete(key: string): void {
    this.items.delete(key);
  }

  get size(): number {
    return this.items.size;
  }
}

/** Clave de la foto: la sesión del cliente y el proyecto en foco. */
export function snapshotKey(clientSession: string, project: string | undefined): string {
  return `${clientSession}\u0000${(project ?? "").toLowerCase()}`;
}
