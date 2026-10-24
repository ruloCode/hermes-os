// Modelo puro de la máquina "tipos" (Fig 4): un componedor de imprenta con
// fichas. Cada lección es una lista de ESCENAS (un ejemplo real del catálogo) y
// cada escena una lista de PASOS: dónde está cada ficha, cuál se lee, dónde
// están los dos carros, dónde cierra el tope (len) y qué dice la lectura. Todo
// lo que la figura muestra sale de aquí; la vista solo lo dibuja.
//
// Los datos se leen del catálogo (bloques de código de las lecciones de
// concepto, casos visibles de los problemas) y los resultados se CALCULAN con
// las mismas reglas de Python (índices, rebanadas, in). Nada está escrito a mano.

import { dojoItem, type DojoItem } from "@hermes/shared";

/** Una ficha del componedor: un elemento de la lista o una letra del texto. */
export interface Piece {
  label: string;
  /** Un espacio: en imprenta es una pieza ciega, más baja que el tipo. */
  space?: boolean;
  /** Juego de fichas: 0 = letras (una por casilla), 1 = palabras (fichas anchas). */
  group?: number;
}

export interface Step {
  /** Segundos que dura el paso en el recorrido. */
  dur: number;
  /** Casilla de cada ficha (puede ser intermedia mientras se mueve); null = fuera. */
  slots: (number | null)[];
  /** Cuánto sube cada ficha (unidades de mundo): las marcadas quedan arriba. */
  lift: number[];
  /** Fichas que se están leyendo (el acento). */
  lit: number[];
  /** Texto de cada ficha (lower() cambia la cara de la A en el palíndromo). */
  faces: string[];
  /** Dónde cierra el tope: len, en casillas. */
  len: number;
  /** Carro A y carro B, en casillas (x.5 = centro de una casilla, x = el borde); null = estacionado. */
  a: number | null;
  b: number | null;
  /** El tope es lo que se mira (len). */
  knee: boolean;
  /** Lo que muestra la ventana de salida. */
  out: string;
  /** Qué regla está puesta (el juego de fichas en la cama); 0 si no se dice. */
  group?: number;
  /** La lectura de la tarjeta, en Python. */
  say: string;
}

export interface Scene {
  key: string;
  pieces: Piece[];
  steps: Step[];
  /** Descripción hablada de la escena (aria). */
  spoken: string;
}

export interface Lesson {
  id: string;
  /** Casillas del componedor: la escena más larga de la lección. */
  cap: number;
  /** Juegos de fichas con su propia regla (letras y palabras). Sin él, uno solo con `cap`. */
  groups?: { cap: number; chars: number }[];
  scenes: Scene[];
  /** Hay carros (el mecanismo). En un problema sin resolver, no. */
  mechanism: boolean;
  title: string;
  hint: string;
  keys: { mark: "raised" | "lit" | "edge" | "dotted"; label: string }[];
  caption: string;
}

// ── Python en miniatura ─────────────────────────────────────────────────────

/** repr() de Python para lo que aparece en la lectura. */
export function py(value: unknown): string {
  if (typeof value === "string") return value.includes("'") ? JSON.stringify(value) : `'${value}'`;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map(py).join(", ")}]`;
  return String(value);
}

/** lista[i] con índices negativos, como en Python. */
export const at = <T,>(list: readonly T[], index: number): T => list[index < 0 ? list.length + index : index] as T;

const VOWELS = "aeiouáéíóú";
export const isVowel = (letter: string) => VOWELS.includes(letter.toLowerCase());

// ── Lectura del catálogo ────────────────────────────────────────────────────

function codeOf(item: DojoItem | undefined): string {
  return (item?.blocks ?? []).map((block) => (block.kind === "code" ? block.code : block.kind === "check" ? (block.code ?? "") : "")).join("\n");
}

function grab(code: string, pattern: RegExp, fallback: string): string {
  return pattern.exec(code)?.[1] ?? fallback;
}

function listOf(code: string, name: string, fallback: unknown[]): unknown[] {
  try {
    const parsed: unknown = JSON.parse(grab(code, new RegExp(`${name} = (\\[[^\\]]*\\])`), ""));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Casos que el enunciado muestra (los ocultos corren al Enviar y no se enseñan). */
function shownCases(id: string): { input: string; expected: unknown }[] {
  return (dojoItem(id)?.problem?.cases ?? [])
    .filter((c) => !c.hidden && Array.isArray(c.args))
    .map((c) => ({ input: String(c.args![0]), expected: c.expected }));
}

// ── Guion: cada paso hereda del anterior ────────────────────────────────────

class Script {
  steps: Step[] = [];
  private last: Step;
  constructor(pieces: Piece[], len: number) {
    this.last = {
      dur: 1.4,
      slots: pieces.map((_, index) => (index < len ? index : null)),
      lift: pieces.map(() => 0),
      lit: [],
      faces: pieces.map((piece) => piece.label),
      len,
      a: null,
      b: null,
      knee: false,
      out: "",
      say: "",
    };
  }
  /** Agrega un paso. Lo efímero (lit, knee) no se hereda; la posición sí. */
  step(change: Partial<Step>) {
    const next: Step = { ...this.last, lit: [], knee: false, ...change };
    this.steps.push(next);
    this.last = next;
    return this;
  }
}

const seated = (count: number) => Array.from({ length: count }, (_, index) => index);

// ── f-listas ────────────────────────────────────────────────────────────────

function listas(): Lesson {
  const code = codeOf(dojoItem("f-listas"));
  const frutas = listOf(code, "frutas", ["mango", "lulo", "uva"]).map(String);
  const nueva = grab(code, /append\("([^"]*)"\)/, "feijoa");
  const a = listOf(code, "a", [10, 20, 30, 40]).map(Number);
  const numeros = listOf(code, "numeros", [5, 8, 2]).map(Number);
  const cap = Math.max(frutas.length + 1, a.length, numeros.length + 1);

  // Escena 1: frutas, len, append e in.
  const f = [...frutas, nueva];
  const fruit = new Script(f.map((label) => ({ label })), frutas.length);
  const last = frutas.length - 1;
  const busca = frutas[1] ?? frutas[0]!;
  const donde = frutas.indexOf(busca);
  fruit
    .step({ say: `frutas = ${py(frutas)}`, dur: 1.8 })
    .step({ a: 0.5, lit: [0], lift: liftOf(f.length, [0], 3), out: py(at(frutas, 0)), say: `frutas[0] → ${py(at(frutas, 0))}` })
    .step({ a: last + 0.5, lit: [last], lift: liftOf(f.length, [last], 3), out: py(at(frutas, -1)), say: `frutas[-1] → ${py(at(frutas, -1))}` })
    .step({ a: null, lift: liftOf(f.length, [], 0), knee: true, out: String(frutas.length), say: `len(frutas) → ${frutas.length}` })
    .step({ len: f.length, slots: seated(f.length), lit: [f.length - 1], out: "", say: `frutas.append(${py(nueva)})`, dur: 1.8 })
    .step({ knee: true, out: String(f.length), say: `len(frutas) → ${f.length}` });
  for (let index = 0; index <= donde; index++) {
    const found = index === donde;
    fruit.step({
      a: index + 0.5,
      lit: [index],
      lift: liftOf(f.length, found ? [index] : [], 3),
      out: found ? "True" : "",
      say: found ? `${py(busca)} in frutas → True` : `${py(busca)} in frutas · [${index}] ${py(f[index])}`,
      dur: found ? 1.8 : 0.8,
    });
  }
  fruit.step({ a: null, lift: liftOf(f.length, [], 0), out: "", say: `frutas = ${py(f)}`, dur: 1.6 });

  // Escena 2: a[1] + a[-1].
  const nums = new Script(a.map((value) => ({ label: String(value) })), a.length);
  const one = at(a, 1);
  const end = at(a, -1);
  nums
    .step({ say: `a = ${py(a)}`, dur: 1.6 })
    .step({ a: 1.5, lit: [1], lift: liftOf(a.length, [1], 3), out: String(one), say: `a[1] → ${one}` })
    .step({ b: a.length - 0.5, lit: [a.length - 1], lift: liftOf(a.length, [1, a.length - 1], 3), out: String(end), say: `a[-1] → ${end}` })
    .step({ lit: [1, a.length - 1], out: String(one + end), say: `a[1] + a[-1] → ${one + end}`, dur: 2.2 })
    .step({ a: null, b: null, lift: liftOf(a.length, [], 0), out: "", say: `a = ${py(a)}`, dur: 1 });

  // Escena 3: recorrer con enumerate y el IndexError.
  const walk = new Script(numeros.map((value) => ({ label: String(value) })), numeros.length);
  walk.step({ say: `numeros = ${py(numeros)}`, dur: 1.4 });
  numeros.forEach((value, index) =>
    walk.step({ a: index + 0.5, lit: [index], lift: liftOf(numeros.length, [index], 3), out: String(value), say: `for i, x in enumerate(numeros) · ${index}, ${value}`, dur: 1.1 }),
  );
  walk
    .step({ a: numeros.length + 0.5, lift: liftOf(numeros.length, [], 0), out: "IndexError", say: `numeros[${numeros.length}] → IndexError`, dur: 2.2 })
    .step({ a: null, out: "", say: `numeros[len(numeros) - 1] → ${at(numeros, -1)}`, lit: [numeros.length - 1], dur: 1.6 });

  return {
    id: "f-listas",
    cap,
    mechanism: true,
    scenes: [
      { key: "frutas", pieces: f.map((label) => ({ label })), steps: fruit.steps, spoken: `La lista frutas con ${frutas.length} fichas; luego append agrega ${nueva}.` },
      { key: "a", pieces: a.map((value) => ({ label: String(value) })), steps: nums.steps, spoken: `La lista a: a[1] más a[-1] da ${one + end}.` },
      { key: "numeros", pieces: numeros.map((value) => ({ label: String(value) })), steps: walk.steps, spoken: `Recorrer numeros posición por posición; la posición ${numeros.length} no existe.` },
    ],
    title: "Posiciones",
    hint: "← → ejemplo · espacio",
    keys: [
      { mark: "lit", label: "La ficha que se lee" },
      { mark: "raised", label: "Las fichas: los elementos, en orden" },
      { mark: "edge", label: "El tope: cierra en len" },
    ],
    caption: `Un componedor de imprenta con ${cap} casillas. La regla de arriba es fija y empieza en 0; la de abajo viaja con el tope, así -1 siempre cae en la última ficha. El tope cierra donde termina la lista: eso es len. a[1] + a[-1] = ${one} + ${end} = ${one + end}.`,
  };
}

function liftOf(count: number, raised: number[], by: number) {
  return Array.from({ length: count }, (_, index) => (raised.includes(index) ? by : 0));
}

// ── f-textos ────────────────────────────────────────────────────────────────

function textos(): Lesson {
  const code = codeOf(dojoItem("f-textos"));
  const palabra = grab(code, /palabra = "([^"]*)"/, "Hermes");
  const t = grab(code, /\bt = "([^"]*)"/, "teclado");
  const from = Number(grab(code, /t\[(\d+):\d+\]/, "0"));
  const to = Number(grab(code, /t\[\d+:(\d+)\]/, "3"));
  const rest = Number(grab(code, /t\[(\d+):\]/, "3"));
  const cap = Math.max(palabra.length, t.length);

  const letters = (text: string) => [...text].map((label) => ({ label }));

  // Escena 1: índices, len, lower() y el for.
  const w = new Script(letters(palabra), palabra.length);
  const n = palabra.length;
  w.step({ say: `palabra = ${py(palabra)}`, dur: 1.6 })
    .step({ a: 0.5, lit: [0], lift: liftOf(n, [0], 3), out: py(palabra[0]), say: `palabra[0] → ${py(palabra[0])}` })
    .step({ a: n - 0.5, lit: [n - 1], lift: liftOf(n, [n - 1], 3), out: py(at([...palabra], -1)), say: `palabra[-1] → ${py(at([...palabra], -1))}` })
    .step({ a: null, lift: liftOf(n, [], 0), knee: true, out: String(n), say: `len(palabra) → ${n}` })
    .step({ out: py(palabra.toLowerCase()), say: `palabra.lower() → ${py(palabra.toLowerCase())}`, dur: 1.8 });
  [...palabra].forEach((letter, index) =>
    w.step({ a: index + 0.5, lit: [index], lift: liftOf(n, [index], 3), out: py(letter), say: `for letra in palabra · ${py(letter)}`, dur: 0.7 }),
  );
  w.step({ a: null, lift: liftOf(n, [], 0), out: "", say: `palabra = ${py(palabra)} · no cambió`, dur: 1.4 });

  // Escena 2: rebanadas y [::-1].
  const m = t.length;
  const tramo = (a: number, b: number) => seated(m).filter((index) => index >= a && index < b);
  const s = new Script(letters(t), m);
  s.step({ say: `t = ${py(t)}`, dur: 1.5 })
    .step({ a: from, b: to, lit: tramo(from, to), lift: liftOf(m, tramo(from, to), 5), out: py(t.slice(from, to)), say: `t[${from}:${to}] → ${py(t.slice(from, to))}`, dur: 2 })
    .step({ a: rest, b: m, lit: tramo(rest, m), lift: liftOf(m, tramo(rest, m), 5), out: py(t.slice(rest)), say: `t[${rest}:] → ${py(t.slice(rest))}`, dur: 2 })
    .step({ a: null, b: null, lift: liftOf(m, [], 0), out: "", say: `t[::-1]`, dur: 0.6 });
  // Invertir: las que van a la derecha suben, las otras se corren por abajo y
  // las de arriba bajan en su nueva casilla. Así ninguna atraviesa a otra.
  const target = seated(m).map((index) => m - 1 - index);
  const up = seated(m).map((index) => (target[index]! > index ? HIGH : 0));
  const reversed = [...t].reverse().join("");
  s.step({ lift: up, say: `t[::-1]`, dur: 0.7 })
    .step({ slots: target, say: `t[::-1]`, dur: 1 })
    .step({ lift: liftOf(m, [], 0), lit: seated(m), out: py(reversed), say: `t[::-1] → ${py(reversed)}`, dur: 2.2 })
    .step({ lift: up, out: "", say: `t → ${py(t)} · no cambió`, dur: 0.7 })
    .step({ slots: seated(m), say: `t → ${py(t)} · no cambió`, dur: 1 })
    .step({ lift: liftOf(m, [], 0), say: `t → ${py(t)} · no cambió`, dur: 1.4 });

  return {
    id: "f-textos",
    cap,
    mechanism: true,
    scenes: [
      { key: "palabra", pieces: letters(palabra), steps: w.steps, spoken: `El texto ${palabra}, letra por letra.` },
      { key: "t", pieces: letters(t), steps: s.steps, spoken: `El texto ${t}: rebanadas y al revés.` },
    ],
    title: "Rebanadas",
    hint: "← → ejemplo · espacio",
    keys: [
      { mark: "lit", label: "El tramo que sale" },
      { mark: "edge", label: "Los dos carros: desde a hasta b, sin b" },
      { mark: "raised", label: "Una letra por ficha" },
    ],
    caption: `Un texto es una fila de fichas, una letra por casilla. Los dos carros marcan la rebanada: t[${from}:${to}] toma las casillas ${from} a ${to - 1} (la ${to} queda fuera) y da ${py(t.slice(from, to))}; t[${rest}:] va hasta el tope y da ${py(t.slice(rest))}. Al revés, ${py(reversed)}, es un texto nuevo: t no cambia.`,
  };
}

/** Altura a la que suben las fichas que pasan por encima de las demás. */
export const HIGH = 22;

// ── f-vocales ───────────────────────────────────────────────────────────────

function vocales(reveal: boolean): Lesson {
  const cases = shownCases("f-vocales");
  const cap = Math.max(1, ...cases.map((c) => [...c.input].length));
  const scenes: Scene[] = cases.map((c, number) => {
    const letters = [...c.input];
    const pieces = letters.map((label) => ({ label }));
    const s = new Script(pieces, letters.length);
    const call = `contar_vocales(${py(c.input)})`;
    const tag = `${number + 1}/${cases.length}`;
    const expected = String(c.expected);
    if (!reveal) {
      s.step({ out: expected, say: `${call} → ${expected} · ${tag}`, dur: 3.2 });
    } else {
      s.step({ out: "0", say: `${call}`, dur: 1.2 });
      const marked: number[] = [];
      letters.forEach((letter, index) => {
        const hit = isVowel(letter);
        if (hit) marked.push(index);
        s.step({
          a: index + 0.5,
          lit: [index],
          lift: liftOf(letters.length, marked, 4),
          out: String(marked.length),
          say: `letra ${py(letter)} · ${hit ? "vocal" : "no"} · cuenta ${marked.length}`,
          dur: 0.75,
        });
      });
      s.step({ a: null, lit: marked, out: String(marked.length), say: `${call} → ${marked.length} · ${tag}`, dur: 2.4 });
    }
    return { key: `v${number}`, pieces, steps: s.steps, spoken: `${call} devuelve ${expected}.` };
  });
  const sample = cases.find((c) => [...c.input].length === cap) ?? cases[0];
  return {
    id: "f-vocales",
    cap,
    mechanism: reveal,
    scenes,
    title: "Contar vocales",
    hint: "← → caso · espacio",
    keys: reveal
      ? [
          { mark: "lit", label: "La letra que se lee" },
          { mark: "raised", label: "Vocal: la ficha queda arriba" },
          { mark: "edge", label: "La ventana: la cuenta" },
        ]
      : [
          { mark: "raised", label: "El texto que entra" },
          { mark: "edge", label: "La ventana: lo que debe salir" },
        ],
    caption: reveal
      ? `El carro pasa por cada ficha una vez, de izquierda a derecha; si la letra (en minúscula) es una de a e i o u á é í ó ú, la ficha sube y la ventana suma uno. ${sample ? `${py(sample.input)} deja ${String(sample.expected)} fichas arriba.` : ""} Un texto vacío no tiene fichas: el carro no entra y sale 0.`
      : `El problema: entra un texto y sale cuántas vocales tiene. ${cases.map((c) => `${py(c.input)} → ${String(c.expected)}`).join(" · ")}. Cómo se cuentan aparece cuando lo resuelvas.`,
  };
}

// ── f-palindromo ────────────────────────────────────────────────────────────

function palindromo(reveal: boolean): Lesson {
  const cases = shownCases("f-palindromo");
  const cap = Math.max(1, ...cases.map((c) => [...c.input].length));
  const scenes: Scene[] = cases.map((c, number) => {
    const letters = [...c.input];
    const pieces = letters.map((label) => ({ label, space: label === " " }));
    const count = letters.length;
    const s = new Script(pieces, count);
    const call = `es_palindromo(${py(c.input)})`;
    const tag = `${number + 1}/${cases.length}`;
    const expected = py(c.expected);
    if (!reveal) {
      s.step({ out: expected, say: `${call} → ${expected} · ${tag}`, dur: 3.2 });
      return { key: `p${number}`, pieces, steps: s.steps, spoken: `${call} devuelve ${expected}.` };
    }
    const clean = c.input.toLowerCase().replace(/ /g, "");
    const lower = letters.map((letter) => letter.toLowerCase());
    const kept = seated(count).filter((index) => !pieces[index]!.space);
    const changed = letters.some((letter, index) => letter !== lower[index]);
    s.step({ say: call, dur: 1.2 });
    if (changed) s.step({ faces: lower, lit: seated(count).filter((index) => letters[index] !== lower[index]), say: `${py(c.input)}.lower()`, dur: 1.2 });
    if (kept.length < count) {
      // Los espacios suben y se van; las letras se corren a llenar los huecos.
      s.step({ lift: seated(count).map((index) => (pieces[index]!.space ? HIGH + 8 : 0)), say: `sin espacios`, dur: 0.8 });
      const slots: (number | null)[] = seated(count).map((index) => (pieces[index]!.space ? null : kept.indexOf(index)));
      s.step({ slots, len: kept.length, lift: liftOf(count, [], 0), say: `limpio = ${py(clean)}`, dur: 1.4 });
    } else {
      s.step({ say: `limpio = ${py(clean)}`, dur: 1 });
    }
    // Dos carros desde los extremos hacia el centro, comparando.
    const n = kept.length;
    const marked: number[] = [];
    let verdict = true;
    for (let i = 0, j = n - 1; i < j; i++, j--) {
      const same = clean[i] === clean[j];
      const pair = [kept[i]!, kept[j]!];
      s.step({
        a: i + 0.5,
        b: j + 0.5,
        lit: pair,
        lift: liftOf(count, same ? [...marked, ...pair] : marked, 4),
        out: same ? "" : "False",
        say: `limpio[${i}] == limpio[${j - n}] → ${py(same)}`,
        dur: same ? 0.8 : 2,
      });
      if (!same) {
        verdict = false;
        break;
      }
      marked.push(...pair);
    }
    s.step({ a: null, b: null, lit: verdict ? marked : [], out: py(verdict), say: `${call} → ${py(verdict)} · ${tag}`, dur: 2.4 });
    return { key: `p${number}`, pieces, steps: s.steps, spoken: `${call} devuelve ${py(verdict)}.` };
  });
  return {
    id: "f-palindromo",
    cap,
    mechanism: reveal,
    scenes,
    title: "¿Palíndromo?",
    hint: "← → caso · espacio",
    keys: reveal
      ? [
          { mark: "lit", label: "El par que se compara" },
          { mark: "edge", label: "Dos carros, desde los extremos" },
          { mark: "raised", label: "Par igual: las fichas quedan arriba" },
        ]
      : [
          { mark: "raised", label: "El texto que entra (los espacios son fichas ciegas)" },
          { mark: "edge", label: "La ventana: lo que debe salir" },
        ],
    caption: reveal
      ? "Primero se limpia: la A pasa a minúscula, los espacios (fichas ciegas, más bajas que el tipo) se van y las letras se corren. Luego dos carros salen de los extremos y comparan par por par hacia el centro; el primer par distinto da False, y si se encuentran en el medio es True."
      : `El problema: entra un texto y sale True si se lee igual al derecho y al revés, sin contar espacios ni mayúsculas. ${cases.map((c) => `${py(c.input)} → ${py(c.expected)}`).join(" · ")}. El mecanismo aparece cuando lo resuelvas.`,
  };
}

// ── f-invertir-palabras (el jefe de la imprenta) ───────────────────────────

function invertir(reveal: boolean): Lesson {
  const cases = shownCases("f-invertir-palabras");
  const letterCap = Math.max(4, ...cases.map((c) => [...c.input].length));
  const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);
  const wordCap = Math.max(3, ...cases.map((c) => wordsOf(c.input).length));
  const wordChars = Math.max(4, ...cases.flatMap((c) => wordsOf(c.input).map((word) => word.length)));
  const scenes: Scene[] = cases.map((c, number) => {
    const letters = [...c.input];
    const words = wordsOf(c.input);
    // Las letras son el juego 0; las palabras (fichas anchas) el juego 1, fuera hasta que se parte.
    const pieces: Piece[] = [
      ...letters.map((label) => ({ label, space: label === " " })),
      ...words.map((label) => ({ label, group: 1 })),
    ];
    const n = letters.length;
    const m = words.length;
    const wordIndex = (k: number) => n + k;
    const s = new Script(pieces, n);
    const call = `invertir_palabras(${py(c.input)})`;
    const tag = `${number + 1}/${cases.length}`;
    const expected = py(c.expected);
    if (!reveal) {
      s.step({ out: expected, say: `${call} → ${expected} · ${tag}`, dur: 3.2 });
      return { key: `w${number}`, pieces, steps: s.steps, spoken: `${call} devuelve ${expected}.` };
    }
    const none = (count: number) => Array.from({ length: count }, () => null as number | null);
    const zero = () => pieces.map(() => 0);
    s.step({ say: call, dur: 1.2 });
    // split(): las letras se van y entran las palabras, una ficha ancha cada una.
    s.step({ lift: pieces.map((_, index) => (index < n ? HIGH + 8 : 0)), say: `${py(c.input)}.split()`, dur: 0.7 });
    s.step({
      slots: [...none(n), ...seated(m)],
      lift: zero(),
      len: m,
      group: 1,
      say: `palabras = ${py(words)}`,
      dur: 1.6,
    });
    // [::-1]: las que van a la derecha pasan por encima.
    const target = seated(m).map((index) => m - 1 - index);
    if (m > 1) {
      s.step({ lift: pieces.map((_, index) => (index >= n && target[index - n]! > index - n ? HIGH : 0)), say: `palabras[::-1]`, dur: 0.7 });
      s.step({ slots: [...none(n), ...target], say: `palabras[::-1]`, dur: 1 });
      s.step({ lift: zero(), say: `palabras[::-1] → ${py([...words].reverse())}`, dur: 1.3 });
    }
    const joined = [...words].reverse().join(" ");
    s.step({ lit: seated(m).map(wordIndex), out: py(joined), say: `' '.join(…) → ${py(joined)}`, dur: 1.4 });
    s.step({ lit: [], say: `${call} → ${py(joined)} · ${tag}`, dur: 2.2 });
    return { key: `w${number}`, pieces, steps: s.steps, spoken: `${call} devuelve ${py(joined)}.` };
  });
  return {
    id: "f-invertir-palabras",
    cap: letterCap,
    groups: [
      { cap: letterCap, chars: 1 },
      { cap: wordCap, chars: wordChars },
    ],
    mechanism: reveal,
    scenes,
    title: "Palabras al revés",
    hint: "← → caso · espacio",
    keys: reveal
      ? [
          { mark: "raised", label: "Una ficha por letra; al partir, una por palabra" },
          { mark: "lit", label: "Lo que sale unido" },
          { mark: "edge", label: "La ventana: la frase nueva" },
        ]
      : [
          { mark: "raised", label: "La frase que entra (los espacios son fichas ciegas)" },
          { mark: "edge", label: "La ventana: lo que debe salir" },
        ],
    caption: reveal
      ? "Partir cambia de fichas: las letras salen y entran palabras, una ficha ancha por palabra (los espacios, sobren o falten, desaparecen). Las palabras pasan al revés por encima y se unen con un solo espacio. Las letras de cada palabra no se tocan."
      : `El problema: entra una frase y sale con las palabras en orden inverso, separadas por un espacio. ${cases.map((c) => `${py(c.input)} → ${py(c.expected)}`).join(" · ")}. El mecanismo aparece cuando lo resuelvas.`,
  };
}

const lessons = new Map<string, Lesson>();

/** La lección de cada id, según si ya se ve el mecanismo (se arma una vez). */
export function lessonOf(id: string, reveal: boolean): Lesson {
  const key = `${id}:${reveal ? 1 : 0}`;
  let lesson = lessons.get(key);
  if (!lesson) {
    lesson =
      id === "f-listas"
        ? listas()
        : id === "f-textos"
          ? textos()
          : id === "f-vocales"
            ? vocales(reveal)
            : id === "f-invertir-palabras"
              ? invertir(reveal)
              : palindromo(reveal);
    lessons.set(key, lesson);
  }
  return lesson;
}

export const LESSON_IDS = ["f-listas", "f-textos", "f-vocales", "f-palindromo", "f-invertir-palabras"] as const;
