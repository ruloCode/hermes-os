// Apodo de cada personaje de la Oficina (puro). Un nombre corto y estable por
// sesión viva, para poder decir "Lince" en vez de "Arregla el login…": no es
// un dato, es cómo se llama el personaje, y la tarea real sigue al lado.
//
// Reglas: pegajoso (quien ya tenía apodo lo conserva), la sesión que continúa
// otra hereda el suyo (como hereda el escritorio), nunca dos vivos con el
// mismo, y el primero libre sale de un hash del id — mismo id, mismo apodo.

export const OFFICE_NICKNAMES = [
  "Lince",
  "Brújula",
  "Chispa",
  "Faro",
  "Tinta",
  "Mango",
  "Cometa",
  "Ceiba",
  "Quetzal",
  "Granizo",
  "Turpial",
  "Arepa",
  "Nebli",
  "Sisa",
  "Tucán",
  "Guadua",
  "Yuca",
  "Bruma",
  "Cuarzo",
  "Tolú",
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Apodos para los vivos. `previous` es la asignación anterior (id → apodo).
 * Si se acaban los nombres de la lista, se numeran ("Lince 2").
 */
export function assignNicknames(
  workers: readonly { id: string; continues?: string }[],
  previous: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  const pending: string[] = [];
  for (const w of workers) {
    const prev = previous.get(w.id) ?? (w.continues ? previous.get(w.continues) : undefined);
    if (prev && !taken.has(prev)) {
      out.set(w.id, prev);
      taken.add(prev);
    } else pending.push(w.id);
  }
  const n = OFFICE_NICKNAMES.length;
  for (const id of pending) {
    const start = hash(id) % n;
    let name: string | null = null;
    for (let k = 0; k < n && !name; k++) {
      const cand = OFFICE_NICKNAMES[(start + k) % n];
      if (!taken.has(cand)) name = cand;
    }
    for (let round = 2; !name; round++) {
      const cand = `${OFFICE_NICKNAMES[start]} ${round}`;
      if (!taken.has(cand)) name = cand;
    }
    out.set(id, name);
    taken.add(name);
  }
  return out;
}
