// Gente de ambiente de la Oficina (puro, sin three.js): quién va a dónde y
// cuánto se queda. La sala exporta lugares con intención (café, sofá, ventana,
// ping-pong…) y este planificador reparte a las personas entre ellos; el mundo
// las hace caminar (office-nav.ts) y avisa cuándo llegaron.
//
// No son agentes ni muestran datos: son decorado que se mueve. Por eso la
// regla de honestidad del dashboard no los toca, siempre que nunca se sienten
// en un escritorio de pod ni cuenten como sesión (eso lo garantiza el mundo,
// que no les da escritorios y los deja fuera de los conteos).
//
// Determinista con semilla: el QA siembra el RNG y obtiene siempre la misma
// coreografía.

export type AmbientActivity =
  | "coffee"
  | "water"
  | "snack"
  | "sit"
  | "window"
  | "board"
  | "books"
  | "tv"
  | "pingpong"
  | "foosball"
  | "darts"
  | "arcade"
  | "lights"
  | "view";

export interface AmbientSlot {
  /** Dónde se para la persona (punto de la rejilla de navegación). */
  x: number;
  z: number;
  /** Hacia dónde mira al llegar (rad, 0 = +z, como `rotation.y` del personaje). */
  facing: number;
  /** Si el lugar es para sentarse: el asiento (se sube desde el punto de pie). */
  seat?: { x: number; y: number; z: number };
}

export interface AmbientPoi {
  id: string;
  floor: number;
  activity: AmbientActivity;
  /** Un cupo por puesto: el sofá trae dos, la ventana uno. */
  slots: AmbientSlot[];
  /** Solo arranca con todos los puestos llenos (ping-pong y futbolín son de a dos). */
  together?: boolean;
}

/** Segundos que alguien se queda en cada actividad (mín, máx). */
export const AMBIENT_DWELL: Record<AmbientActivity, readonly [number, number]> = {
  coffee: [8, 14],
  water: [5, 9],
  snack: [5, 9],
  sit: [16, 32],
  window: [9, 16],
  board: [8, 13],
  books: [8, 14],
  tv: [14, 26],
  pingpong: [18, 32],
  foosball: [16, 28],
  darts: [10, 16],
  arcade: [12, 22],
  lights: [8, 14],
  view: [9, 16],
};

/** Cuánto espera alguien a su pareja en un juego de a dos antes de rendirse. */
export const AMBIENT_PARTNER_WAIT = 22;
/** Si alguien lleva este tiempo caminando sin llegar, algo lo trabó: elige otra cosa. */
export const AMBIENT_GOING_TIMEOUT = 90;

/** PRNG pequeño y sembrable (mulberry32): mismo `seed`, misma secuencia. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cuánta gente de ambiente: 9 con la oficina casi vacía y menos a medida que
 * llegan sesiones vivas (con muchos agentes la oficina ya se ve llena). Subió de
 * 6/5/4 cuando el edificio creció a 33 lugares (zonas nuevas): con 6 repartidos
 * en tres pisos, el piso donde estás se sentía vacío.
 */
export function ambientPopulation(liveSessions: number): number {
  if (liveSessions <= 2) return 9;
  if (liveSessions <= 5) return 8;
  return 6;
}

export type AmbientPhase = "idle" | "going" | "staying" | "waiting";

export interface AmbientPerson {
  id: string;
  phase: AmbientPhase;
  poi: string | null;
  slot: number;
  /** Cuándo empezó la fase actual (s). */
  since: number;
  /** Fin de la estadía o de la espera (s). */
  until: number;
  /** Piso donde está (o al que va). */
  floor: number;
  /** Últimos lugares, para no repetir. */
  history: string[];
}

export interface AmbientOrder {
  id: string;
  poi: AmbientPoi;
  slot: number;
}

export class AmbientPlanner {
  readonly people = new Map<string, AmbientPerson>();
  private readonly pois = new Map<string, AmbientPoi>();
  private readonly rng: () => number;
  /** Lugar que a alguien no le dio camino: lo evita un rato. */
  private readonly avoid = new Map<string, number>();
  /** Lugar tomado por el dueño (está jugando ahí): nadie va y quien estaba se aparta. */
  private reserved: string | null = null;

  constructor(pois: readonly AmbientPoi[], seed: number) {
    for (const p of pois) if (p.slots.length) this.pois.set(p.id, p);
    this.rng = mulberry32(seed);
  }

  random(): number {
    return this.rng();
  }

  poi(id: string): AmbientPoi | undefined {
    return this.pois.get(id);
  }

  /** Quiénes ocupan (o van a ocupar) cada puesto de un lugar. */
  occupants(poiId: string): AmbientPerson[] {
    return [...this.people.values()].filter((p) => p.poi === poiId && p.phase !== "idle");
  }

  private freeSlot(poi: AmbientPoi): number {
    const taken = new Set(this.occupants(poi.id).map((p) => p.slot));
    for (let i = 0; i < poi.slots.length; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /** Alguien nuevo en el edificio (todavía sin plan: el próximo `tick` lo manda a algún lado). */
  add(id: string, floor: number, now: number) {
    this.people.set(id, { id, phase: "idle", poi: null, slot: 0, since: now, until: now, floor, history: [] });
  }

  remove(id: string) {
    this.people.delete(id);
  }

  /**
   * Arranque: deja a alguien ya instalado en un lugar (la oficina abre viva,
   * no con todos saliendo de la puerta). Nunca en un juego de a dos: esos
   * empiezan cuando llegan los dos.
   */
  place(id: string, now: number): AmbientOrder | null {
    const p = this.people.get(id);
    if (!p) return null;
    const choice = this.choose(p, now, true);
    if (!choice) return null;
    const [lo, hi] = AMBIENT_DWELL[choice.poi.activity];
    p.phase = "staying";
    p.poi = choice.poi.id;
    p.slot = choice.slot;
    p.since = now;
    // Cada uno va por una parte distinta de su estadía: no se levantan todos a la vez.
    p.until = now + (lo + this.rng() * (hi - lo)) * (0.25 + this.rng() * 0.75);
    p.floor = choice.poi.floor;
    p.history = [choice.poi.id];
    return { id, ...choice };
  }

  /** Avanza el reloj: devuelve a quién hay que mandar a un lugar nuevo. */
  tick(now: number): AmbientOrder[] {
    const orders: AmbientOrder[] = [];
    for (const p of this.people.values()) {
      if (p.phase === "going" && now - p.since > AMBIENT_GOING_TIMEOUT) this.release(p, now);
      if ((p.phase === "staying" || p.phase === "waiting") && now >= p.until) {
        // En un juego de a dos se levantan juntos.
        const poi = p.poi ? this.pois.get(p.poi) : undefined;
        if (poi?.together && p.phase === "staying") for (const o of this.occupants(poi.id)) this.release(o, now);
        else this.release(p, now);
      }
    }
    for (const p of this.people.values()) {
      if (p.phase !== "idle") continue;
      const choice = this.choose(p, now, false);
      if (!choice) continue;
      p.phase = "going";
      p.poi = choice.poi.id;
      p.slot = choice.slot;
      p.since = now;
      p.until = now;
      p.floor = choice.poi.floor;
      p.history = [...p.history, choice.poi.id].slice(-3);
      orders.push({ id: p.id, ...choice });
    }
    return orders;
  }

  /** Llegó a su puesto. En un juego de a dos espera a la pareja; con los dos, juegan. */
  arrived(id: string, now: number) {
    const p = this.people.get(id);
    if (!p || p.phase !== "going" || !p.poi) return;
    const poi = this.pois.get(p.poi)!;
    const [lo, hi] = AMBIENT_DWELL[poi.activity];
    const dwell = lo + this.rng() * (hi - lo);
    if (!poi.together) {
      p.phase = "staying";
      p.since = now;
      p.until = now + dwell;
      return;
    }
    const others = this.occupants(poi.id).filter((o) => o.id !== id);
    const ready = others.filter((o) => o.phase === "waiting");
    if (ready.length === poi.slots.length - 1) {
      for (const o of [p, ...ready]) {
        o.phase = "staying";
        o.since = now;
        o.until = now + dwell;
      }
      return;
    }
    p.phase = "waiting";
    p.since = now;
    p.until = now + AMBIENT_PARTNER_WAIT;
  }

  /**
   * El dueño toma un lugar (un minijuego): quien estaba ahí (o iba) lo suelta y
   * busca otro en el próximo `tick`; nadie elige ese lugar hasta liberarlo (null).
   * Devuelve a quiénes se les pidió que se aparten.
   */
  reserve(poiId: string | null, now: number): string[] {
    this.reserved = poiId && this.pois.has(poiId) ? poiId : null;
    if (!this.reserved) return [];
    const moved = this.occupants(this.reserved);
    for (const o of moved) this.release(o, now);
    return moved.map((o) => o.id);
  }

  /** No hubo camino a su lugar: lo suelta y lo evita un rato. */
  failed(id: string, now: number) {
    const p = this.people.get(id);
    if (!p) return;
    if (p.poi) this.avoid.set(p.poi, now + 60);
    this.release(p, now);
  }

  private release(p: AmbientPerson, now: number) {
    p.phase = "idle";
    p.poi = null;
    p.since = now;
  }

  private choose(p: AmbientPerson, now: number, seeding: boolean): { poi: AmbientPoi; slot: number } | null {
    // Cuánta gente hay (o va) en cada piso, sin contar a esta persona.
    const perFloor = new Map<number, number>();
    for (const o of this.people.values()) {
      if (o.id === p.id || o.phase === "idle") continue;
      perFloor.set(o.floor, (perFloor.get(o.floor) ?? 0) + 1);
    }
    const company = [...this.people.values()].filter((o) => o.id !== p.id).length;
    const options: { poi: AmbientPoi; slot: number; w: number }[] = [];
    for (const poi of this.pois.values()) {
      if (p.history.includes(poi.id)) continue;
      if ((this.avoid.get(poi.id) ?? 0) > now) continue;
      if (poi.id === this.reserved) continue;
      const slot = this.freeSlot(poi);
      if (slot < 0) continue;
      let w = 1 / (1 + 0.9 * (perFloor.get(poi.floor) ?? 0));
      // Variedad: cambiar de piso pesa más que quedarse.
      if (!seeding && poi.floor === p.floor) w *= 0.55;
      if (poi.together) {
        if (seeding || company === 0) continue;
        const there = this.occupants(poi.id);
        if (there.length) w *= 10; // alguien espera pareja: ir a jugar con él
        else {
          // Un solo juego a medio armar a la vez: no todos esperando pareja.
          const pending = [...this.pois.values()].some((q) => q.together && q.id !== poi.id && this.occupants(q.id).length > 0 && this.occupants(q.id).length < q.slots.length);
          w *= pending ? 0.1 : 0.8;
        }
      }
      options.push({ poi, slot, w });
    }
    if (!options.length) return null;
    // Cada piso pesa lo mismo aunque tenga más lugares (el café tiene muchos y el piso de los equipos pocos).
    const perFloorOptions = new Map<number, number>();
    for (const o of options) perFloorOptions.set(o.poi.floor, (perFloorOptions.get(o.poi.floor) ?? 0) + 1);
    for (const o of options) o.w /= perFloorOptions.get(o.poi.floor)!;
    const total = options.reduce((s, o) => s + o.w, 0);
    let r = this.rng() * total;
    for (const o of options) {
      r -= o.w;
      if (r <= 0) return { poi: o.poi, slot: o.slot };
    }
    const last = options[options.length - 1];
    return { poi: last.poi, slot: last.slot };
  }
}
