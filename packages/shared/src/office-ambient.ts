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

/** Charlas entre personas (capa "Gente viva"). */
/** Distancia a la que dos personas que coinciden se ponen a conversar. */
export const CHAT_RADIUS = 1.9;
/** Después de una charla, alguien no arranca otra hasta pasados estos segundos. */
export const CHAT_PERSON_COOLDOWN = 35;
/** La misma pareja no repite charla antes de esto. */
export const CHAT_PAIR_COOLDOWN = 150;
/** Cada cuánto se buscan parejas (s): una pareja que coincide arranca pronto, pero no en el mismo frame. */
export const CHAT_CHECK_EVERY = 1.5;
/** Probabilidad de que una pareja que coincide se ponga a hablar en cada revisión. */
export const CHAT_CHANCE = 0.55;

export interface AmbientChat {
  id: string;
  /** 2 o 3 personas; la primera abre la charla. */
  members: string[];
  started: number;
  until: number;
  /** Qué hacen donde se juntaron (actividad del lugar) o "walk" si se cruzaron caminando. */
  place: string;
  floor: number;
}

/** Dónde está cada quien (lo pasa el mundo): para encontrar parejas que coinciden. */
export interface AmbientPosition {
  x: number;
  z: number;
  floor: number;
  /** Ocupado con otra cosa (saludando al dueño, reaccionando, sentándose…): no arranca charla. */
  busy?: boolean;
}

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
  /** Charla en curso (id) o null. */
  chat: string | null;
  /** No arranca otra charla antes de esto (s). */
  chatReadyAt: number;
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
    this.people.set(id, { id, phase: "idle", poi: null, slot: 0, since: now, until: now, floor, history: [], chat: null, chatReadyAt: now + 6 });
  }

  remove(id: string) {
    const p = this.people.get(id);
    if (p?.chat) this.endChat(p.chat, p.since);
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
      // Conversando nadie se va: la estadía se estira hasta que termine la charla.
      if (p.chat) {
        const c = this.chatsById.get(p.chat);
        if (c && p.phase === "staying" && p.until < c.until + 1) p.until = c.until + 1;
        continue;
      }
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

  // ── Charlas ───────────────────────────────────────────────────────────

  private readonly chatsById = new Map<string, AmbientChat>();
  private readonly pairAt = new Map<string, number>();
  private nextChat = 0;
  private chatCheckAt = 0;

  get chats(): AmbientChat[] {
    return [...this.chatsById.values()];
  }

  chatOf(id: string): AmbientChat | null {
    const c = this.people.get(id)?.chat;
    return c ? (this.chatsById.get(c) ?? null) : null;
  }

  private chatEligible(p: AmbientPerson, pos: AmbientPosition | undefined, now: number): boolean {
    if (!pos || pos.busy || p.chat || now < p.chatReadyAt) return false;
    if (p.phase === "going") return true;
    if (p.phase !== "staying" || !p.poi) return false;
    // Jugando de a dos (o en el lugar que el dueño tomó) no se distraen.
    const poi = this.pois.get(p.poi);
    return !poi?.together && p.poi !== this.reserved;
  }

  private pairKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /**
   * Busca personas que coinciden (mismo piso, a menos de CHAT_RADIUS, libres y
   * sin enfriamiento) y arranca charlas de 2 o, a veces, 3. `length` dice cuánto
   * dura cada una (el mundo la mide por sus turnos). Devuelve las nuevas.
   */
  proposeChats(pos: ReadonlyMap<string, AmbientPosition>, now: number, length: (chat: AmbientChat) => number = () => 10): AmbientChat[] {
    // Las que terminaron se cierran solas.
    for (const c of [...this.chatsById.values()]) if (now >= c.until) this.endChat(c.id, now);
    if (now < this.chatCheckAt) return [];
    this.chatCheckAt = now + CHAT_CHECK_EVERY;
    const free = [...this.people.values()].filter((p) => this.chatEligible(p, pos.get(p.id), now)).sort((a, b) => a.id.localeCompare(b.id));
    const used = new Set<string>();
    const started: AmbientChat[] = [];
    const dist = (a: string, b: string) => {
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      return pa.floor === pb.floor ? Math.hypot(pa.x - pb.x, pa.z - pb.z) : Infinity;
    };
    for (const a of free) {
      if (used.has(a.id)) continue;
      let best: AmbientPerson | null = null;
      for (const b of free) {
        if (b.id === a.id || used.has(b.id)) continue;
        if (dist(a.id, b.id) > CHAT_RADIUS) continue;
        if ((this.pairAt.get(this.pairKey(a.id, b.id)) ?? -Infinity) > now) continue;
        if (!best || dist(a.id, b.id) < dist(a.id, best.id)) best = b;
      }
      if (!best || this.rng() >= CHAT_CHANCE) continue;
      const members = [a, best];
      const third = free.find((c) => !used.has(c.id) && c !== a && c !== best && Math.min(dist(c.id, a.id), dist(c.id, best!.id)) <= CHAT_RADIUS);
      if (third && this.rng() < 0.35) members.push(third);
      const staying = members.find((m) => m.phase === "staying" && m.poi);
      const place = staying && members.every((m) => m.phase === "staying") ? (this.pois.get(staying.poi!)?.activity ?? "walk") : "walk";
      const chat: AmbientChat = { id: `chat-${this.nextChat++}`, members: members.map((m) => m.id), started: now, until: now, place, floor: pos.get(a.id)!.floor };
      chat.until = now + Math.max(4, length(chat));
      this.chatsById.set(chat.id, chat);
      for (const m of members) {
        m.chat = chat.id;
        used.add(m.id);
      }
      started.push(chat);
    }
    return started;
  }

  /** Termina una charla: enfriamiento para cada uno y para cada pareja; quien iba caminando retoma sin perder su plazo. */
  endChat(chatId: string, now: number) {
    const c = this.chatsById.get(chatId);
    if (!c) return;
    this.chatsById.delete(chatId);
    for (const id of c.members) {
      const p = this.people.get(id);
      if (!p || p.chat !== chatId) continue;
      p.chat = null;
      p.chatReadyAt = now + CHAT_PERSON_COOLDOWN;
      if (p.phase === "going") p.since += Math.max(0, now - c.started);
    }
    for (let i = 0; i < c.members.length; i++) for (let j = i + 1; j < c.members.length; j++) this.pairAt.set(this.pairKey(c.members[i], c.members[j]), now + CHAT_PAIR_COOLDOWN);
  }

  private release(p: AmbientPerson, now: number) {
    if (p.chat) this.endChat(p.chat, now);
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
