// Modelo puro de la máquina "casilleros" (Fig 7): un gabinete de 6 casilleros
// con una rueda en la entrada. Cada clave pasa por la rueda, la rueda da el
// número de su casillero y el brazo la lleva DIRECTO ahí: nunca recorre la
// pared. De aquí salen los pasos, el readout y la caption; la vista solo pinta.
//
// La rueda es un hash propio (FNV con mezcla final), no el de Python: Python
// cambia el hash de los textos en cada arranque. La semilla está elegida para
// que los ejemplos reales del catálogo no choquen (sin colisiones que explicar)
// y para que cada búsqueda de una clave que no está caiga en un casillero vacío.

import { dojoItem, type DojoCase } from "@hermes/shared";

export const SLOTS = 6;
export const COLUMNS = 3;
const SEED = 31191;

/** El casillero de una clave: lo que calcula la rueda. */
export function slotOf(key: string): number {
  let x = SEED >>> 0;
  for (const char of key) x = Math.imul(x ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x ^= x >>> 12;
  return (x >>> 0) % SLOTS;
}

/** Lo que guarda un casillero: la placa con la clave, fichas (conteo) o tarjetas (valor). */
export interface Box {
  key: string;
  /** Fichas apiladas: [palabra a, palabra b] (la segunda solo en anagramas). */
  chips: [number, number];
  cards: string[];
  /** Orden de llegada: un dict de Python recuerda en qué orden entraron las claves. */
  at: number;
}

export type Table = (Box | null)[];

/** Lo que el brazo mete al casillero además de la etiqueta. */
export type Payload = { kind: "chip"; side: 0 | 1 } | { kind: "card"; text: string } | { kind: "none" };

export type StepKind = "put" | "look" | "reset" | "show";

export interface Step {
  kind: StepKind;
  /** A dónde va el brazo (null = no viaja). */
  slot: number | null;
  /** Texto de la etiqueta que lleva el brazo. */
  key: string | null;
  payload: Payload;
  /** Clave nueva: la etiqueta se encaja en el portaetiquetas del casillero. */
  dock: boolean;
  /** La placa del casillero coincide con la etiqueta (se enciende). */
  found: boolean;
  /** La carga entra al casillero (false = rebota: ya estaba, o solo se miró). */
  delivered: boolean;
  table: Table;
  readout: string;
  /** Tiques del riel de pedidos: lo que entra y lo que sale. */
  ticketIn: string;
  ticketOut: string;
  /** Etiquetas que aún esperan en el cargador de la estación. */
  queue: number;
  /** Casillero que queda encendido al terminar el paso. */
  lit: number | null;
}

export interface Variant {
  title: string;
  steps: Step[];
  caption: string;
  /** Descripción accesible del objeto. */
  label: string;
  locked: boolean;
}

const EMPTY: Table = Array.from({ length: SLOTS }, () => null);
const copy = (table: Table): Table => table.map((box) => (box ? { key: box.key, chips: [box.chips[0], box.chips[1]], cards: [...box.cards], at: box.at } : null));

/** Un texto de Python: "café" → "café" con comillas dobles, números tal cual. */
const py = (key: string) => (/^-?\d+$/.test(key) ? key : `"${key}"`);

/** Arma la secuencia de pasos de un caso, llevando la tabla como la llevaría Python. */
class Run {
  steps: Step[] = [];
  table: Table = copy(EMPTY);
  ticketIn = "";
  ticketOut = "";
  queue = 0;

  begin(ticketIn: string, queue: number, readout: string) {
    this.table = copy(EMPTY);
    this.ticketIn = ticketIn;
    this.ticketOut = "";
    this.queue = queue;
    this.push({ kind: "reset", slot: null, key: null, payload: { kind: "none" }, dock: false, found: false, delivered: false, readout, lit: null });
  }

  private push(step: Omit<Step, "table" | "ticketIn" | "ticketOut" | "queue">) {
    this.steps.push({ ...step, table: copy(this.table), ticketIn: this.ticketIn, ticketOut: this.ticketOut, queue: this.queue });
  }

  /** Guarda (o suma) en el casillero de `key`. */
  put(key: string, payload: Payload, readout: string, { bounce = false } = {}) {
    const slot = slotOf(key);
    const box = this.table[slot];
    if (box && box.key !== key) throw new Error(`casilleros: colisión ${key} / ${box.key}`);
    const dock = !box;
    const next: Box = box ?? { key, chips: [0, 0], cards: [], at: this.table.filter(Boolean).length };
    if (!bounce) {
      if (payload.kind === "chip") next.chips[payload.side] += 1;
      if (payload.kind === "card") next.cards.push(payload.text);
    }
    this.table[slot] = next;
    this.queue = Math.max(0, this.queue - 1);
    this.push({ kind: "put", slot, key, payload, dock, found: !dock, delivered: !bounce, readout, lit: slot });
  }

  /** Mira el casillero de `key` sin guardar nada. */
  look(key: string, readout: string, { count = true, out }: { count?: boolean; out?: string } = {}) {
    const slot = slotOf(key);
    const box = this.table[slot];
    if (box && box.key !== key) throw new Error(`casilleros: búsqueda de ${key} cae en ${box.key}`);
    if (count) this.queue = Math.max(0, this.queue - 1);
    if (out !== undefined) this.ticketOut = out;
    this.push({ kind: "look", slot, key, payload: { kind: "none" }, dock: false, found: Boolean(box), delivered: false, readout, lit: slot });
  }

  /** Paso sin viaje: se lee el resultado. */
  show(readout: string, ticketOut: string, lit: number | null = null) {
    this.ticketOut = ticketOut;
    this.push({ kind: "show", slot: null, key: null, payload: { kind: "none" }, dock: false, found: false, delivered: false, readout, lit });
  }

  has(key: string) {
    return this.table[slotOf(key)]?.key === key;
  }

  count(key: string, side: 0 | 1 = 0) {
    const box = this.table[slotOf(key)];
    return box && box.key === key ? box.chips[side] : 0;
  }
}

// ── Formato de Python para tiques y readouts ─────────────────────────────

function pyValue(value: unknown): string {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) return `[${value.map(pyValue).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `"${k}": ${pyValue(v)}`)
      .join(", ")}}`;
  }
  return String(value);
}

const callOf = (fn: string, args: unknown[]) => `${fn}(${args.map(pyValue).join(", ")})`;

/** Los casos que el enunciado deja ver (los ocultos jamás salen en la figura). */
function shownCases(id: string): DojoCase[] {
  return (dojoItem(id)?.problem?.cases ?? []).filter((c) => !c.hidden && c.args);
}

function fnOf(id: string) {
  return dojoItem(id)?.problem?.fn ?? id;
}

// ── Los pedidos con el gabinete cerrado (reveal = false) ─────────────────

function orders(
  id: string,
  lineOf: (c: DojoCase) => string = (c) => (c.args ?? []).map(pyValue).join(", "),
  outOf?: (c: DojoCase) => string,
): Step[] {
  const fn = fnOf(id);
  const steps: Step[] = [];
  for (const c of shownCases(id)) {
    const args = c.args ?? [];
    const base = {
      slot: null,
      key: null,
      payload: { kind: "none" } as Payload,
      dock: false,
      found: false,
      delivered: false,
      table: copy(EMPTY),
      ticketIn: lineOf(c),
      queue: 0,
      lit: null,
    };
    const call = callOf(fn, args);
    steps.push({ ...base, kind: "reset", readout: call.length > 32 ? `${fn}(…)` : call, ticketOut: "" });
    const out = outOf ? outOf(c) : pyValue(c.expected);
    const said = `→ ${pyValue(c.expected)}`;
    const groups = Array.isArray(c.expected) ? c.expected.length : 0;
    steps.push({ ...base, kind: "show", readout: said.length > 36 ? `→ ${groups} grupos` : said, ticketOut: out });
  }
  return steps;
}

// ── Las ocho lecciones ───────────────────────────────────────────────────

function dicts(): Step[] {
  const run = new Run();
  const precios: [string, number][] = [
    ["café", 4500],
    ["arepa", 3000],
  ];
  run.begin("café arepa empanada", 3, "precios = {}");
  for (const [k, v] of precios) run.put(k, { kind: "card", text: String(v) }, `precios[${py(k)}] = ${v}`);
  run.put("empanada", { kind: "card", text: "2500" }, `precios["empanada"] = 2500`);
  run.look("café", `precios["café"] → 4500`, { count: false, out: "4500" });
  run.look("arepa", `"arepa" in precios → True`, { count: false, out: "True" });
  run.look("buñuelo", `precios.get("buñuelo", 0) → 0`, { count: false, out: "0" });
  run.look("buñuelo", `precios["buñuelo"] → KeyError`, { count: false, out: "KeyError" });

  run.begin(`"banana"`, 6, "conteo = {}");
  [..."banana"].forEach((letra, at) => {
    const n = run.count(letra) + 1;
    run.put(letra, { kind: "chip", side: 0 }, `conteo["${letra}"] = ${n} · letra ${at + 1}/6`);
  });
  run.show(`→ {"b": 1, "a": 3, "n": 2}`, `{"b": 1, "a": 3, "n": 2}`);
  return run.steps;
}

function sets(): Step[] {
  const run = new Run();
  const nums = [3, 1, 3, 2, 1];
  run.begin("[3, 1, 3, 2, 1]", nums.length, "vistos = set()");
  for (const x of nums) {
    const key = String(x);
    const dup = run.has(key);
    run.put(key, { kind: "none" }, `vistos.add(${x}) · ${dup ? "ya estaba" : "nuevo"}`, { bounce: dup });
  }
  run.show("vistos → {3, 1, 2}", "{3, 1, 2}");
  run.look("2", "2 in vistos → True", { count: false, out: "True" });
  run.look("9", "9 in vistos → False", { count: false, out: "False" });
  return run.steps;
}

function contarPalabras(): Step[] {
  const run = new Run();
  for (const c of shownCases("h-contar-palabras")) {
    const texto = String(c.args?.[0] ?? "");
    const palabras = texto.toLowerCase().split(/\s+/).filter(Boolean);
    if (!palabras.length) continue;
    run.begin(`"${texto}"`, palabras.length, "conteo = {}");
    palabras.forEach((p, at) => {
      const n = run.count(p) + 1;
      run.put(p, { kind: "chip", side: 0 }, `conteo["${p}"] = ${n} · palabra ${at + 1}/${palabras.length}`);
    });
    run.show(`→ ${pyValue(c.expected)}`, pyValue(c.expected));
  }
  return run.steps;
}

function repetidos(): Step[] {
  const run = new Run();
  for (const c of shownCases("h-repetidos")) {
    const nums = (c.args?.[0] as number[]) ?? [];
    if (!nums.length) continue;
    run.begin(pyValue(nums), nums.length, "vistos = set()");
    let hit = false;
    for (const x of nums) {
      const key = String(x);
      if (run.has(key)) {
        run.look(key, `${x} in vistos → True`, { out: "True" });
        hit = true;
        break;
      }
      run.put(key, { kind: "none" }, `vistos.add(${x})`);
    }
    if (!hit) run.show("→ False · ninguno se repite", "False");
  }
  return run.steps;
}

function anagramas(): Step[] {
  const run = new Run();
  for (const c of shownCases("h-anagramas")) {
    const [a, b] = (c.args as string[]) ?? ["", ""];
    run.begin(`"${a}", "${b}"`, a.length + b.length, "conteo_a, conteo_b = {}, {}");
    [a, b].forEach((word, side) => {
      [...word].forEach((letra, at) => {
        const n = run.count(letra, side as 0 | 1) + 1;
        run.put(letra, { kind: "chip", side: side as 0 | 1 }, `conteo_${side ? "b" : "a"}["${letra}"] = ${n} · ${at + 1}/${word.length}`);
      });
    });
    // Se compara casillero por casillero: dos pilas iguales en cada uno.
    const differs = run.table.findIndex((box) => box && box.chips[0] !== box.chips[1]);
    if (differs >= 0) {
      const box = run.table[differs]!;
      run.show(`"${box.key}": ${box.chips[0]} ≠ ${box.chips[1]} → False`, "False", differs);
    } else run.show("conteo_a == conteo_b → True", "True");
  }
  return run.steps;
}

function primeraUnica(): Step[] {
  const run = new Run();
  for (const c of shownCases("h-primera-unica")) {
    const texto = String(c.args?.[0] ?? "");
    if (!texto) continue;
    run.begin(`"${texto}"`, texto.length, "conteo = {}");
    [...texto].forEach((letra, at) => {
      const n = run.count(letra) + 1;
      run.put(letra, { kind: "chip", side: 0 }, `conteo["${letra}"] = ${n} · ${at + 1}/${texto.length}`);
    });
    // Segunda pasada: en orden, la primera cuya pila tiene una sola ficha.
    let found = -1;
    for (let i = 0; i < texto.length; i++) {
      const letra = texto[i]!;
      const n = run.count(letra);
      run.look(letra, `i=${i} · conteo["${letra}"] = ${n}${n === 1 ? " → " + i : ""}`, { count: false });
      if (n === 1) {
        found = i;
        break;
      }
    }
    run.show(found >= 0 ? `→ ${found}` : "→ -1 · todas se repiten", String(found), found >= 0 ? slotOf(texto[found]!) : null);
  }
  return run.steps;
}

function dosSuma(): Step[] {
  const run = new Run();
  for (const c of shownCases("h-dos-suma")) {
    const [nums, objetivo] = (c.args as [number[], number]) ?? [[], 0];
    run.begin(`${pyValue(nums)}, ${objetivo}`, nums.length, "posiciones = {}");
    for (let i = 0; i < nums.length; i++) {
      const x = nums[i]!;
      const falta = objetivo - x;
      const key = String(falta);
      if (run.has(key)) {
        const j = Number(run.table[slotOf(key)]!.cards[0]);
        run.look(key, `i=${i} · falta ${falta} → [${j}, ${i}]`, { out: `[${j}, ${i}]` });
        break;
      }
      run.look(key, `i=${i} · falta ${falta} → no está`, { count: false });
      run.put(String(x), { kind: "card", text: String(i) }, `posiciones[${x}] = ${i}`);
    }
  }
  return run.steps;
}

function agrupar(): Step[] {
  const run = new Run();
  const c = shownCases("h-agrupar").find((k) => ((k.args?.[0] as string[]) ?? []).length > 1);
  const palabras = (c?.args?.[0] as string[]) ?? [];
  run.begin(palabras.join(" "), palabras.length, "grupos = {}");
  for (const p of palabras) {
    const firma = [...p].sort().join("");
    run.put(firma, { kind: "card", text: p }, `grupos["${firma}"] ← "${p}"`);
  }
  const groups = run.table
    .filter((b): b is Box => Boolean(b))
    .sort((a, b) => a.at - b.at)
    .map((b) => `[${b.cards.join(" ")}]`);
  run.show(`→ ${groups.length} grupos`, groups.join(" "));
  return run.steps;
}

// ── Variantes por lección ────────────────────────────────────────────────

const LABEL_BASE =
  "Un gabinete de seis casilleros de madera sobre una base con patas, con una estación a la izquierda que tiene una rueda numerada y un brazo que corre por un riel sobre el frente.";

interface Spec {
  title: string;
  build: () => Step[];
  /** Caption cuando el mecanismo está a la vista. */
  open: string;
  /** Caption del pedido, con el gabinete cerrado. */
  closed?: string;
  /** Texto del tique de entrada en el pedido. */
  line?: (c: DojoCase) => string;
  /** Texto del tique de salida en el pedido (si el repr de Python no cabe). */
  out?: (c: DojoCase) => string;
}

const SPECS: Record<string, Spec> = {
  "h-dicts": {
    title: "Clave → valor",
    build: dicts,
    open: "Cada clave pasa por la rueda, que da el número de su casillero, y el brazo va directo ahí: no recorre la pared. «café», «arepa» y «empanada» dejan su tarjeta de precio; get(\"buñuelo\", 0) llega a un casillero vacío y devuelve el 0. Después cuenta las letras de «banana»: una ficha por letra en su casillero.",
  },
  "h-sets": {
    title: "Un set",
    build: sets,
    open: "Un set es el gabinete sin tarjetas: solo la etiqueta en la placa. Al agregar [3, 1, 3, 2, 1] el segundo 3 y el segundo 1 rebotan porque su casillero ya tiene esa placa. Preguntar 2 in vistos es ir a un solo casillero, haya 6 o un millón.",
  },
  "h-contar-palabras": {
    title: "Contar palabras",
    build: contarPalabras,
    open: "Cada palabra, ya en minúsculas, va a su casillero y suma una ficha a la pila: «hola mundo hola» deja dos fichas en hola y una en mundo, y «Café café CAFÉ» tres en café.",
    closed: "El pedido: entra un texto y sale un diccionario palabra → cuántas veces. El gabinete sigue cerrado hasta que lo resuelvas o te rindas.",
  },
  "h-repetidos": {
    title: "¿Hay repetidos?",
    build: repetidos,
    open: "Cada número deja su placa en un casillero; antes de dejarla, el brazo mira si esa placa ya está. En [1, 2, 3, 1] el segundo 1 encuentra su casillero ocupado: True sin mirar el resto. En [1, 2, 3, 4] nadie se repite: False.",
    closed: "El pedido: entra una lista de números y sale True si alguno aparece dos veces. El gabinete sigue cerrado hasta que lo resuelvas o te rindas.",
  },
  "h-anagramas": {
    title: "¿Son anagramas?",
    build: anagramas,
    open: "Cada casillero es una letra y lleva dos pilas: la izquierda cuenta la primera palabra y la derecha la segunda. «roma» y «amor» dejan pilas iguales en todos; en «perro» y «pero» el casillero de la r queda con 2 contra 1.",
    closed: "El pedido: entran dos palabras y sale True si usan las mismas letras la misma cantidad de veces. El gabinete sigue cerrado hasta que lo resuelvas o te rindas.",
  },
  "h-primera-unica": {
    title: "Primera única",
    build: primeraUnica,
    open: "Dos pasadas: la primera deja una ficha por letra en su casillero; la segunda recorre el texto en orden y para en la primera letra cuya pila tiene una sola ficha. En «lulo» es la u, posición 1.",
    closed: "El pedido: entra un texto y sale la posición de la primera letra que aparece una sola vez, o -1. El gabinete sigue cerrado hasta que lo resuelvas o te rindas.",
  },
  "h-dos-suma": {
    title: "Dos que suman",
    build: dosSuma,
    open: "Por cada número el brazo va primero al casillero de lo que le falta para el objetivo; si está vacío, deja ese número con su posición en una tarjeta. En [2, 7, 11, 15] con 9, al llegar el 7 el casillero del 2 ya tiene la tarjeta 0: [0, 1].",
    closed: "El pedido: entra una lista y un objetivo, y salen las posiciones de los dos números que suman el objetivo. Cómo se usa el gabinete es lo que tienes que descubrir: se abre al resolverlo o al rendirte.",
  },
  "h-agrupar": {
    title: "Agrupar anagramas",
    build: agrupar,
    open: "La clave de cada casillero es la firma de la palabra: sus letras ordenadas. «amor», «roma» y «mora» tienen la misma firma y caen juntas; «sol» y «los» en otra; «luz» sola. Los grupos son las tarjetas de cada casillero.",
    closed: "El pedido: entran palabras y salen agrupadas las que son anagramas entre sí. Qué clave usar es la prueba: el gabinete se abre al resolverla o al rendirte.",
    line: (c) => ((c.args?.[0] as string[]) ?? []).join(" "),
    out: (c) => ((c.expected as string[][]) ?? []).map((g) => `[${g.join(" ")}]`).join(" "),
  },
};

export const FIGURE_IDS = Object.keys(SPECS);

/** El título corto de la tarjeta (el mismo en guion y en vivo). */
export const titleOf = (id: string) => SPECS[id]?.title ?? id;

const cache = new Map<string, Variant>();

export function variantOf(id: string, reveal: boolean): Variant {
  const spec = SPECS[id]!;
  const concept = dojoItem(id)?.kind === "concepto";
  const locked = !reveal && !concept;
  const cacheKey = `${id}:${locked}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const steps = locked ? orders(id, spec.line, spec.out) : spec.build();
  const variant: Variant = {
    title: spec.title,
    steps,
    locked,
    caption: locked ? (spec.closed ?? spec.open) : spec.open,
    label: locked
      ? `${LABEL_BASE} Los casilleros están cerrados con persianas y un candado: solo se ve lo que entra y lo que debe salir.`
      : `${LABEL_BASE} Cada clave pasa por la rueda, que marca su casillero, y el brazo la lleva directo ahí.`,
  };
  cache.set(cacheKey, variant);
  return variant;
}

/** El paso que se muestra quieto: el último del primer caso (la máquina con todo guardado). */
export function restIndexOf(variant: Variant) {
  const resets = variant.steps.map((s, i) => (s.kind === "reset" ? i : -1)).filter((i) => i > 0);
  return resets.length ? resets[0]! - 1 : variant.steps.length - 1;
}

/** Cuántas cosas guarda la tabla (para el texto accesible). */
export function filled(table: Table) {
  return table.filter(Boolean).length;
}
