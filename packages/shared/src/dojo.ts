/**
 * DOJO DE ALGORITMOS (/dojo): aprender a resolver problemas desde cero, en
 * Python, escribiendo cada línea uno mismo. Lógica PURA (sin React ni disco):
 * la comparten el agente (guarda intentos, arma la vista) y la web (corre el
 * código con Pyodide en un Web Worker y pinta la ruta).
 *
 * Regla que manda, heredada de Composición: Hermes NO escribe la solución.
 * Explica, pregunta y revisa; las pistas suben por escalones (reformular →
 * caso a mano → patrón → pseudocódigo) y la solución de referencia solo se ve
 * después de pasar los tests o de rendirse. `stripCode` es la red de seguridad
 * para lo que diga el modelo.
 *
 * El contenido (unidades, lecciones, problemas con sus tests) vive en
 * dojo-catalog.ts.
 */
import { addDays } from "./growth.js";

// ── Contenido ──────────────────────────────────────────────────────────

export type DojoItemKind = "concepto" | "guiado" | "solo" | "prueba";

export const DOJO_KIND_LABEL: Record<DojoItemKind, string> = {
  concepto: "Concepto",
  guiado: "Guiado",
  solo: "Sin ayuda",
  prueba: "Prueba",
};

export type BigO = "O(1)" | "O(log n)" | "O(n)" | "O(n log n)" | "O(n²)";
export const BIG_O: BigO[] = ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n²)"];

/**
 * Un caso de prueba. `args` va como JSON; para entradas enormes (100.000
 * números) se usa `argsExpr`, una expresión de Python que devuelve la lista de
 * argumentos — así no viajan megas de JSON. Lo mismo `expectedExpr` para
 * resultados que JSON no representa bien (enteros de más de 2^53).
 */
export interface DojoCase {
  args?: unknown[];
  argsExpr?: string;
  expected?: unknown;
  expectedExpr?: string;
  /** Texto de la llamada cuando la entrada es demasiado grande para mostrarla. */
  label?: string;
  /** No se muestra en el enunciado; corre al Enviar. */
  hidden?: boolean;
  /** Límite propio en ms (si no, el del problema). */
  timeLimitMs?: number;
}

/**
 * Cómo se compara lo devuelto con lo esperado:
 * - exact: igual, con booleanos estrictos (1 no es True) y tuplas = listas.
 * - unordered: la misma lista en cualquier orden.
 * - groups: lista de grupos; no importa el orden de los grupos ni dentro de ellos.
 */
export type DojoCompare = "exact" | "unordered" | "groups";

export interface DojoProblem {
  fn: string;
  /** Primera línea que ve el editor vacío, p. ej. `def doble(n):`. */
  signature: string;
  /** Párrafos del enunciado. Se permite `código` en línea y **negrita**. */
  statement: string[];
  cases: DojoCase[];
  compare?: DojoCompare;
  /** Límite por caso en ms (solo los problemas donde la complejidad importa). */
  timeLimitMs?: number;
  /** Nombres que el ejercicio pide no usar (max, sorted…): se revisa en el AST. */
  banned?: string[];
  /** Escalera de pistas: reformular · caso a mano · patrón · pseudocódigo. */
  hints: [string, string, string, string];
  solution: string;
  complexity: { time: BigO; space: BigO; why: string };
}

export type DojoBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; code: string; note?: string }
  | {
      /** Pregunta de respuesta ESCRITA (no hay opciones: el Dojo se hace con el teclado). */
      kind: "check";
      question: string;
      code?: string;
      /** Lo que se espera, tal como lo escribiría alguien que sabe (`1`, `None`, `O(n²)`). */
      answer: string;
      /** Otras formas válidas de decir lo mismo (`O(n*n)`, `ninguna`). */
      accept?: string[];
      why: string;
    };

export interface DojoItem {
  id: string;
  unit: string;
  kind: DojoItemKind;
  title: string;
  /** Una línea para la ruta. */
  summary: string;
  blocks?: DojoBlock[];
  problem?: DojoProblem;
}

/** Un capítulo del mundo: un lugar con su historia, un cofre y un jefe. */
export interface DojoUnit {
  key: string;
  /** El lugar ("La clasificadora"). */
  title: string;
  /** La idea que se aprende ahí ("Decidir con if, elif y else"). */
  subtitle: string;
  /** Dos frases que ponen en escena el capítulo. */
  story: string[];
  /** El cofre aparece después de esta cantidad de lecciones. */
  chestAfter: number;
  items: DojoItem[];
}

/**
 * ¿La respuesta escrita es la correcta? Sin mayúsculas forzadas donde no
 * importan (`o(n)` = `O(n)`), pero sí donde Python las exige (`none` ≠ `None`):
 * esas variantes, si valen, van en `accept`. `²` y `**2` cuentan como `^2`
 * porque `²` no está en el teclado.
 */
export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/²/g, "^2")
    .replace(/\*\*2/g, "^2")
    .replace(/^o\(/, "O(")
    .replace(/^`(.*)`$/, "$1");
}

export function checkAnswer(input: string, block: { answer: string; accept?: string[] }): boolean {
  const got = normalizeAnswer(input);
  if (!got) return false;
  return [block.answer, ...(block.accept ?? [])].some((a) => normalizeAnswer(a) === got);
}

// ── Intentos ───────────────────────────────────────────────────────────

export interface DojoAttempt {
  id: string;
  itemId: string;
  /** Día local AAAA-MM-DD (Bogotá). */
  date: string;
  createdAt: string;
  kind: DojoItemKind;
  /** Problema: pasó todos los tests. Concepto: terminó la lección. */
  passed: boolean;
  /** Escalones de la escalera que pidió (0-4). */
  hints: number;
  gaveUp: boolean;
  /** Fue un repaso (reescribirlo desde cero). */
  review: boolean;
  /** Del editor abierto al primer Enviar en verde. */
  ms?: number;
  tests?: { passed: number; total: number };
  code?: string;
  understanding?: string;
  plan?: string;
  learned?: string;
  guessedTime?: BigO;
  /** Concepto: preguntas acertadas al primer intento. */
  checks?: { correct: number; total: number };
}

/** Limpio = lo resolvió solo: sin pistas y sin rendirse. */
export const isClean = (a: Pick<DojoAttempt, "passed" | "hints" | "gaveUp">) =>
  a.passed && a.hints === 0 && !a.gaveUp;

// ── Tecleo ─────────────────────────────────────────────────────────────

/**
 * Una pasada de mecanografía: un ejemplo de lección copiado sobre el texto
 * fantasma o una solución de referencia reescrita (con guía o de memoria).
 * Una tecla equivocada no avanza y cuenta como error; la sangría al empezar
 * cada línea se pone sola y no cuenta como tecleada.
 */
export interface DojoTyping {
  id: string;
  itemId: string;
  date: string;
  createdAt: string;
  source: "ejemplo" | "solucion";
  /** De memoria: sin ver el texto que falta. */
  blind: boolean;
  /** Caracteres tecleados bien (sin la sangría automática). */
  chars: number;
  errors: number;
  ms: number;
  /** Teclas seguidas sin error más larga de la pasada. */
  maxCombo?: number;
}

/** Palabras por minuto con la convención de mecanografía: 5 caracteres = 1 palabra. */
export function typingWpm(chars: number, ms: number): number {
  return ms > 0 ? Math.round(chars / 5 / (ms / 60_000)) : 0;
}

export function typingAccuracy(chars: number, errors: number): number {
  return chars + errors > 0 ? Math.round((chars / (chars + errors)) * 100) : 100;
}

/** Lo que el teclado tiene que escribir: sin espacios al final de línea ni al final. */
export function typingTarget(code: string): string {
  return code
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trimEnd();
}

/** Cuántos caracteres de `target` teclea uno mismo (la sangría al inicio de línea va sola). */
export function typedChars(target: string): number {
  return target.split("\n").reduce((n, l, i) => n + l.trimStart().length + (i > 0 ? 1 : 0), 0);
}

// ── El juego: XP y niveles ─────────────────────────────────────────────
//
// Todo sale de lo que ya está guardado (intentos y pasadas de tecleo): el XP
// no es un contador aparte que se pueda desincronizar, es una cuenta sobre el
// registro real. Para que no se pueda "farmear" repitiendo lo mismo, un
// problema da su XP grande UNA vez; después solo dan XP los repasos. Teclear
// siempre suma: practicar es el punto.

export const DOJO_XP = {
  /** Terminar una lección de concepto. */
  concepto: 20,
  /** Cada pregunta acertada al primer intento. */
  pregunta: 5,
  /** Primer problema pasado. */
  problema: 40,
  /** Extra si fue sin pistas ni ayuda. */
  limpio: 30,
  /** Extra por la prueba de la unidad. */
  prueba: 60,
  /** Un repaso pasado. */
  repaso: 25,
  /** El cofre de un capítulo. */
  cofre: 40,
  /** Meta diaria de caracteres tecleados. */
  metaDiaria: 600,
} as const;

/** XP de una pasada de tecleo: 1 cada 10 caracteres, más si fue precisa o de memoria. */
export function typingXp(t: Pick<DojoTyping, "chars" | "errors" | "blind">): number {
  const acc = typingAccuracy(t.chars, t.errors);
  const mult = acc >= 98 ? 1.5 : acc >= 90 ? 1 : 0.5;
  return Math.round((t.chars / 10) * mult * (t.blind ? 2 : 1));
}

/** XP de un intento, sabiendo si es el primero aprobado de esa lección. */
export function attemptXp(a: DojoAttempt, firstPass: boolean): number {
  if (!a.passed) return 0;
  if (a.kind === "concepto")
    return firstPass ? DOJO_XP.concepto + DOJO_XP.pregunta * (a.checks?.correct ?? 0) : 0;
  if (!firstPass) return a.review ? DOJO_XP.repaso + (isClean(a) ? DOJO_XP.limpio / 2 : 0) : 0;
  return DOJO_XP.problema + (isClean(a) ? DOJO_XP.limpio : 0) + (a.kind === "prueba" ? DOJO_XP.prueba : 0);
}

/** Nivel 1 → 2 pide 100 XP, 2 → 3 pide 200, 3 → 4 pide 300… */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 100;
  let rest = Math.max(0, xp);
  while (rest >= need) {
    rest -= need;
    level++;
    need += 100;
  }
  return { level, into: rest, need };
}

export interface DojoXp {
  total: number;
  today: number;
  level: number;
  into: number;
  need: number;
}

export function dojoXp(
  attempts: DojoAttempt[],
  typing: DojoTyping[],
  today: string,
  units: DojoUnit[] = [],
): DojoXp {
  const seen = new Set<string>();
  let total = 0;
  let todayXp = 0;
  const sorted = [...attempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const a of sorted) {
    const first = a.passed && !seen.has(a.itemId);
    if (a.passed) seen.add(a.itemId);
    const xp = attemptXp(a, first);
    total += xp;
    if (a.date === today) todayXp += xp;
  }
  for (const t of typing) {
    const xp = typingXp(t);
    total += xp;
    if (t.date === today) todayXp += xp;
  }
  // Cofres: un premio fijo por capítulo, el día en que se abrió.
  const byItem = new Map<string, DojoAttempt[]>();
  for (const a of attempts) byItem.set(a.itemId, [...(byItem.get(a.itemId) ?? []), a]);
  for (const unit of units) {
    const day = chestOpenedOn(unit, byItem);
    if (!day) continue;
    total += DOJO_XP.cofre;
    if (day === today) todayXp += DOJO_XP.cofre;
  }
  return { total, today: todayXp, ...levelOf(total) };
}

export interface DojoTypingStats {
  /** Caracteres tecleados hoy. */
  today: number;
  /** Caracteres tecleados en total. */
  total: number;
  /** PPM y precisión de las últimas 10 pasadas (null sin datos). */
  wpm: number | null;
  accuracy: number | null;
  sessions: number;
  bestCombo: number;
}

export function typingStats(records: DojoTyping[], today: string): DojoTypingStats {
  const recent = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-10);
  const chars = recent.reduce((n, r) => n + r.chars, 0);
  const errors = recent.reduce((n, r) => n + r.errors, 0);
  const ms = recent.reduce((n, r) => n + r.ms, 0);
  return {
    today: records.filter((r) => r.date === today).reduce((n, r) => n + r.chars, 0),
    total: records.reduce((n, r) => n + r.chars, 0),
    wpm: recent.length ? typingWpm(chars, ms) : null,
    accuracy: recent.length ? typingAccuracy(chars, errors) : null,
    sessions: records.length,
    bestCombo: records.reduce((m, r) => Math.max(m, r.maxCombo ?? 0), 0),
  };
}

// ── Repaso espaciado ───────────────────────────────────────────────────

/**
 * Lo que costó vuelve para reescribirlo desde cero. Resolverlo con pistas o
 * rendirse lo pone en el escalón 0 (vuelve mañana); cada repaso limpio a partir
 * de su fecha sube un escalón (3 días, luego 7); pasado el último, se gradúa.
 * Un repaso con pistas lo devuelve al principio. Resolver limpio a la primera
 * no agenda nada: ya lo sabías.
 */
export const REVIEW_DAYS = [1, 3, 7];

export interface DojoReview {
  step: number;
  due: string;
}

export function reviewState(attempts: DojoAttempt[]): DojoReview | null {
  let state: DojoReview | null = null;
  const sorted = [...attempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const a of sorted) {
    if (a.kind === "concepto") continue;
    if (!isClean(a)) {
      if (a.passed || a.gaveUp) state = { step: 0, due: addDays(a.date, REVIEW_DAYS[0]) };
      continue;
    }
    if (state && a.date >= state.due) {
      const step = state.step + 1;
      state = step >= REVIEW_DAYS.length ? null : { step, due: addDays(a.date, REVIEW_DAYS[step]) };
    }
  }
  return state;
}

// ── Racha ──────────────────────────────────────────────────────────────

/** Días seguidos con algo aprobado, contando desde hoy (o desde ayer si hoy aún no). */
export function dojoStreak(dates: string[], today: string): number {
  const days = new Set(dates);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

// ── Vista ──────────────────────────────────────────────────────────────

/**
 * done = la pasaste · current = lo que toca · open = abierta (el jefe de un
 * capítulo cerrado queda abierto: vencerlo es "saltar" el capítulo, como en
 * Duolingo) · locked = se abre al terminar la anterior.
 */
export type DojoItemStatus = "done" | "current" | "open" | "locked";

export interface DojoItemView {
  id: string;
  status: DojoItemStatus;
  attempts: number;
  /** Lo pasó alguna vez. */
  solved: boolean;
  /** Lo pasó alguna vez sin pistas ni rendirse. */
  clean: boolean;
  gaveUp: boolean;
  /** Mejor tiempo hasta el primer verde. */
  bestMs: number | null;
  review: DojoReview | null;
}

export interface DojoUnitView {
  key: string;
  done: number;
  total: number;
  /** Pasó el jefe (la prueba) o hizo todo. */
  mastered: boolean;
  /** Se puede entrar: es el primero, el anterior está dominado o ya empezaste aquí. */
  open: boolean;
  /** El cofre se abre al terminar las lecciones que tiene antes. */
  chest: "closed" | "opened";
  problems: number;
  solved: number;
  clean: number;
}

export interface DojoReviewDue {
  itemId: string;
  due: string;
  step: number;
}

export interface DojoPayload {
  today: string;
  /** Lo siguiente que toca en la ruta. */
  current: string | null;
  streak: number;
  doneToday: number;
  items: Record<string, DojoItemView>;
  units: DojoUnitView[];
  /** Repasos que vencen hoy o antes. */
  reviews: DojoReviewDue[];
  /** Repasos agendados para después de hoy. */
  upcoming: number;
  totals: { problems: number; solved: number; clean: number };
  typing: DojoTypingStats;
  xp: DojoXp;
}

export function dojoView(
  units: DojoUnit[],
  attempts: DojoAttempt[],
  today: string,
  typing: DojoTyping[] = [],
): DojoPayload {
  const byItem = new Map<string, DojoAttempt[]>();
  for (const a of attempts) byItem.set(a.itemId, [...(byItem.get(a.itemId) ?? []), a]);

  const items: Record<string, DojoItemView> = {};
  const unitViews: DojoUnitView[] = [];
  const reviews: DojoReviewDue[] = [];
  let upcoming = 0;
  let current: string | null = null;
  let prevMastered = true;

  for (const unit of units) {
    const views = unit.items.map((item) => {
      const list = byItem.get(item.id) ?? [];
      const passed = list.filter((a) => a.passed);
      const times = passed.map((a) => a.ms).filter((m): m is number => typeof m === "number");
      const review = item.kind === "concepto" ? null : reviewState(list);
      const view: DojoItemView = {
        id: item.id,
        status: passed.length ? "done" : "open",
        attempts: list.length,
        solved: passed.length > 0,
        clean: list.some(isClean),
        gaveUp: list.some((a) => a.gaveUp),
        bestMs: times.length ? Math.min(...times) : null,
        review,
      };
      if (review) {
        if (review.due <= today) reviews.push({ itemId: item.id, due: review.due, step: review.step });
        else upcoming++;
      }
      items[item.id] = view;
      return { item, view };
    });
    const prueba = views.find((v) => v.item.kind === "prueba");
    const done = views.filter((v) => v.view.solved).length;
    const mastered = Boolean(prueba?.view.solved) || done === views.length;
    const open = prevMastered || done > 0;
    // Candados: dentro de un capítulo abierto, cada lección se abre al terminar
    // la anterior; el jefe siempre se puede intentar ("saltar"). En un capítulo
    // cerrado solo queda abierto el jefe. Dominado = todo abierto para repasar.
    views.forEach((v, i) => {
      if (v.view.solved) return;
      const isBoss = v.item.kind === "prueba";
      const unlocked = mastered || isBoss || (open && (i === 0 || views[i - 1].view.solved));
      v.view.status = unlocked ? "open" : "locked";
    });
    if (!current && open && !mastered) {
      const next = views.find((v) => !v.view.solved && v.view.status === "open");
      if (next) {
        current = next.item.id;
        next.view.status = "current";
      }
    }
    prevMastered = mastered;
    const problems = views.filter((v) => v.item.kind !== "concepto");
    unitViews.push({
      key: unit.key,
      done,
      total: views.length,
      mastered,
      open,
      chest: chestOpenedOn(unit, byItem) ? "opened" : "closed",
      problems: problems.length,
      solved: problems.filter((v) => v.view.solved).length,
      clean: problems.filter((v) => v.view.clean).length,
    });
  }

  reviews.sort((a, b) => a.due.localeCompare(b.due));
  const passedDates = attempts.filter((a) => a.passed).map((a) => a.date);
  return {
    today,
    current,
    streak: dojoStreak(passedDates, today),
    doneToday: new Set(attempts.filter((a) => a.passed && a.date === today).map((a) => a.itemId)).size,
    items,
    units: unitViews,
    reviews,
    upcoming,
    totals: {
      problems: unitViews.reduce((s, u) => s + u.problems, 0),
      solved: unitViews.reduce((s, u) => s + u.solved, 0),
      clean: unitViews.reduce((s, u) => s + u.clean, 0),
    },
    typing: typingStats(typing, today),
    xp: dojoXp(attempts, typing, today, units),
  };
}

/** Día en que se abrió el cofre de un capítulo (el último de sus requisitos), o null. */
function chestOpenedOn(unit: DojoUnit, byItem: Map<string, DojoAttempt[]>): string | null {
  let last = "";
  for (const item of unit.items.slice(0, unit.chestAfter)) {
    const first = (byItem.get(item.id) ?? [])
      .filter((a) => a.passed)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!first) return null;
    if (first.date > last) last = first.date;
  }
  return last || null;
}

// ── Lo que dice Hermes ─────────────────────────────────────────────────

export type DojoCoachStage = "entender" | "plan" | "debug";

export interface DojoCoachFeedback {
  /** bien = vas bien · casi = falta algo · no = hay un malentendido. */
  verdict: "bien" | "casi" | "no";
  message: string;
  /** Una pregunta para que lo pienses tú (opcional). */
  question?: string;
}

const CODE_LINE =
  /^\s*(?:[-*]\s+)?(def |class |for .+:|while .+:|if .+:|elif .+:|else\s*:|try\s*:|except\b.*:|return\b|import |from \S+ import|[A-Za-z_][\w.\[\]]*\s*(\+|-|\*|\/)?=\s*\S|print\()/;

/**
 * Quita el código que se le cuele al modelo: bloques ``` enteros y líneas que
 * son sentencias de Python. El código en línea corto (`vistos`, `x in s`) se
 * queda: nombrar una herramienta es enseñar, escribir la solución no.
 */
export function stripCode(text: string): { text: string; stripped: boolean } {
  let stripped = false;
  let out = text.replace(/```[\s\S]*?(```|$)/g, () => {
    stripped = true;
    return "";
  });
  out = out
    .split("\n")
    .filter((line) => {
      if (CODE_LINE.test(line)) {
        stripped = true;
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: out, stripped };
}

// ── Errores de Python, en español ──────────────────────────────────────

export const PY_ERROR_HELP: Record<string, string> = {
  SyntaxError:
    "Python no entiende cómo está escrita esa línea. Revisa los dos puntos al final de def/if/for/while y que cierren paréntesis y comillas.",
  IndentationError:
    "La sangría no cuadra: lo que va dentro de un def, if o for lleva 4 espacios más, y todas sus líneas igual.",
  TabError: "Mezclas tabs y espacios en la sangría. Usa solo espacios.",
  NameError: "Usas un nombre que Python no conoce: ¿un typo, o una variable que todavía no creaste?",
  UnboundLocalError: "Lees una variable antes de darle valor dentro de la función.",
  TypeError:
    "Mezclas tipos que no combinan (texto + número) o llamas una función con más o menos valores de los que recibe.",
  IndexError: "Pides una posición que no existe. La última de una lista es len(lista) - 1.",
  KeyError: "Lees una clave que el diccionario no tiene. dic.get(clave, defecto) no se rompe.",
  ZeroDivisionError: "Divides entre cero.",
  AttributeError: "Ese valor no tiene ese método (¿append en un texto? ¿lower en un número?).",
  ValueError: "El tipo está bien pero el valor no sirve, como int(\"hola\").",
  RecursionError: "La función se llama a sí misma sin parar.",
};

export function explainPyError(type: string): string | null {
  return PY_ERROR_HELP[type] ?? null;
}

// ── Correr código: contrato del worker y harness ───────────────────────

export interface PyError {
  type: string;
  message: string;
  line: number | null;
}

export interface DojoCaseResult {
  index: number;
  call: string;
  expected: string;
  got: string | null;
  ok: boolean;
  ms: number;
  slow: boolean;
  error: PyError | null;
  stdout: string;
}

export type DojoTestRun =
  | { phase: "syntax"; error: PyError }
  | { phase: "banned"; banned: string; line: number }
  | { phase: "load"; error: PyError; stdout: string }
  | { phase: "missing"; fn: string; stdout: string }
  | { phase: "done"; results: DojoCaseResult[]; stdout: string };

export interface DojoExecRun {
  stdout: string;
  error: PyError | null;
}

// ── Traza: lo que hizo el código del alumno ──

/** Un valor de Python visto desde JS (listas y dicts recortados a 40 elementos). */
export type TraceValue =
  | { t: "none" }
  | { t: "bool"; v: boolean }
  | { t: "int" | "float"; v: number | null; r: string }
  | { t: "str"; v: string; n: number }
  | { t: "list" | "tuple" | "set"; v: TraceValue[]; n: number }
  | { t: "dict"; v: [TraceValue, TraceValue][]; n: number }
  | { t: "fn" | "obj"; r: string };

/**
 * Un paso: `line` es la línea que VA a correr (como Python Tutor); `locals`
 * es el estado en ese momento. `return` trae lo que devolvió la función;
 * `out` es cuántos caracteres llevaba impresos (para cortar la salida).
 */
export interface PyTraceStep {
  line: number;
  event: "line" | "return" | "exception";
  fn: string;
  locals: Record<string, TraceValue>;
  out: number;
  ret?: TraceValue;
  exc?: string;
}

export type DojoTrace =
  | { phase: "syntax"; error: PyError }
  | { phase: "load"; error: PyError; stdout: string }
  | { phase: "missing"; fn: string; stdout: string }
  | {
      phase: "done";
      call: string | null;
      steps: PyTraceStep[];
      /** Llegó al tope de pasos (600): un bucle que no termina, o demasiado trabajo. */
      truncated: boolean;
      result: TraceValue | null;
      error: PyError | null;
      stdout: string;
    };

/** Python lo escribiría así. */
export function traceRepr(v: TraceValue | undefined): string {
  if (!v) return "";
  switch (v.t) {
    case "none":
      return "None";
    case "bool":
      return v.v ? "True" : "False";
    case "int":
    case "float":
      return v.r;
    case "str":
      return pyRepr(v.v) + (v.n > v.v.length ? "…" : "");
    case "list":
    case "tuple":
    case "set": {
      const inner = v.v.map(traceRepr).join(", ") + (v.n > v.v.length ? ", …" : "");
      if (v.t === "set") return v.n ? `{${inner}}` : "set()";
      return v.t === "list" ? `[${inner}]` : `(${inner}${v.n === 1 ? "," : ""})`;
    }
    case "dict":
      return `{${v.v.map(([k, x]) => `${traceRepr(k)}: ${traceRepr(x)}`).join(", ")}${v.n > v.v.length ? ", …" : ""}}`;
    case "fn":
      return `<función ${v.r}>`;
    case "obj":
      return v.r;
  }
}

/** Número si el valor es int/float representable; si no, null. */
export const traceNum = (v: TraceValue | undefined): number | null =>
  v && (v.t === "int" || v.t === "float") ? v.v : null;

/** Variables que cambiaron (o aparecieron) entre dos pasos. */
export function changedVars(prev: PyTraceStep | undefined, cur: PyTraceStep): string[] {
  if (!prev || prev.fn !== cur.fn) return Object.keys(cur.locals);
  return Object.keys(cur.locals).filter(
    (k) => JSON.stringify(prev.locals[k]) !== JSON.stringify(cur.locals[k]),
  );
}

/** El estado DESPUÉS de correr la línea del paso k: el del paso siguiente (o el último). */
export function stateAfter(steps: PyTraceStep[], k: number): PyTraceStep | undefined {
  return steps[Math.min(k + 1, steps.length - 1)];
}

/**
 * La primera variable local de un tipo que aparece en la traza de la función
 * del ejercicio (p. ej. el dict que arma el alumno, se llame como se llame).
 * Las máquinas la usan para saber qué pintar sin exigir nombres.
 */
export function firstVarOfType(steps: PyTraceStep[], fn: string, types: TraceValue["t"][]): string | null {
  for (const s of steps) {
    if (s.fn !== fn) continue;
    for (const [k, v] of Object.entries(s.locals)) if (types.includes(v.t)) return k;
  }
  return null;
}

/** Un parámetro de la función (no cambia en la traza) no es un acumulador. */
export function paramsOf(steps: PyTraceStep[], fn: string): string[] {
  const first = steps.find((s) => s.fn === fn);
  return first ? Object.keys(first.locals) : [];
}

/** Lo que el harness necesita de un problema para correr sus casos. */
export function testSpec(p: DojoProblem, onlyVisible: boolean) {
  return {
    fn: p.fn,
    compare: p.compare ?? "exact",
    timeLimitMs: p.timeLimitMs ?? null,
    banned: p.banned ?? [],
    cases: p.cases.filter((c) => !onlyVisible || !c.hidden),
  };
}

export const starterCode = (p: DojoProblem) => `${p.signature}\n    pass\n`;

/**
 * El harness de Python: lo cargan el Web Worker (Pyodide) y los tests del
 * agente (CPython), así que el mismo código decide qué es "pasar" en los dos.
 * `report` recibe un JSON por evento (`start` antes de cada caso, `case` al
 * terminarlo): si el worker se cuelga en un bucle infinito, la web sabe en qué
 * caso fue y qué alcanzó a pasar.
 */
export const DOJO_HARNESS = String.raw`
import ast as _ast, copy as _copy, io as _io, json as _json, sys as _sys, time as _time, traceback as _tb

_DOJO_FILE = "solucion.py"
_DOJO_OUT_CAP = 4000

class _DojoOut(_io.StringIO):
    def write(self, s):
        room = _DOJO_OUT_CAP - self.tell()
        if room > 0:
            super().write(s[:room])
        return len(s)

def _dojo_err(e):
    line = None
    if isinstance(e, SyntaxError) and e.filename == _DOJO_FILE:
        line = e.lineno
    else:
        frames = [f for f in _tb.extract_tb(e.__traceback__) if f.filename == _DOJO_FILE]
        if frames:
            line = frames[-1].lineno
    msg = (e.msg or "") if isinstance(e, SyntaxError) else str(e)
    return {"type": type(e).__name__, "message": msg, "line": line}

def _dojo_short(v, cap=300):
    s = repr(v)
    return s if len(s) <= cap else s[: cap - 1] + "…"

def _dojo_norm(v):
    if isinstance(v, (list, tuple)):
        return [_dojo_norm(x) for x in v]
    if isinstance(v, (set, frozenset)):
        items = [_dojo_norm(x) for x in v]
        try:
            return sorted(items)
        except TypeError:
            return items
    if isinstance(v, dict):
        return {k: _dojo_norm(x) for k, x in v.items()}
    return v

def _dojo_eq(got, exp):
    if isinstance(exp, bool) or isinstance(got, bool):
        return isinstance(got, bool) and isinstance(exp, bool) and got == exp
    if isinstance(exp, list):
        return isinstance(got, list) and len(got) == len(exp) and all(_dojo_eq(a, b) for a, b in zip(got, exp))
    if isinstance(exp, dict):
        return isinstance(got, dict) and set(got) == set(exp) and all(_dojo_eq(got[k], exp[k]) for k in exp)
    try:
        return bool(got == exp)
    except Exception:
        return False

def _dojo_key(v):
    return _json.dumps(v, sort_keys=True, ensure_ascii=False, default=repr)

def _dojo_match(got, exp, mode):
    g = _dojo_norm(got)
    if mode == "unordered":
        return isinstance(g, list) and isinstance(exp, list) and sorted(map(_dojo_key, g)) == sorted(map(_dojo_key, exp))
    if mode == "groups":
        if not isinstance(g, list) or not all(isinstance(x, list) for x in g) or not isinstance(exp, list):
            return False
        canon = lambda gs: sorted(_dojo_key(sorted(map(_dojo_key, x))) for x in gs)
        return canon(g) == canon(exp)
    return _dojo_eq(g, exp)

def _dojo_banned(tree, banned):
    for node in _ast.walk(tree):
        name = node.id if isinstance(node, _ast.Name) else node.attr if isinstance(node, _ast.Attribute) else None
        if name in banned:
            return name, node.lineno
    return None

def __dojo_test(code, spec_json, report):
    spec = _json.loads(spec_json)
    fn_name = spec["fn"]
    try:
        tree = _ast.parse(code, _DOJO_FILE)
        compiled = compile(tree, _DOJO_FILE, "exec")
    except SyntaxError as e:
        return _json.dumps({"phase": "syntax", "error": _dojo_err(e)})
    hit = _dojo_banned(tree, spec.get("banned") or [])
    if hit:
        return _json.dumps({"phase": "banned", "banned": hit[0], "line": hit[1]})
    ns = {"__name__": "__dojo__"}
    out = _DojoOut()
    old = _sys.stdout
    _sys.stdout = out
    try:
        exec(compiled, ns)
    except BaseException as e:
        _sys.stdout = old
        return _json.dumps({"phase": "load", "error": _dojo_err(e), "stdout": out.getvalue()})
    finally:
        _sys.stdout = old
    fn = ns.get(fn_name)
    if not callable(fn):
        return _json.dumps({"phase": "missing", "fn": fn_name, "stdout": out.getvalue()})
    results = []
    for i, case in enumerate(spec["cases"]):
        report(_json.dumps({"event": "start", "index": i}))
        args = eval(case["argsExpr"], {}) if "argsExpr" in case else _copy.deepcopy(case.get("args", []))
        expected = eval(case["expectedExpr"], {}) if "expectedExpr" in case else case.get("expected")
        call = case.get("label") or "%s(%s)" % (fn_name, ", ".join(_dojo_short(a, 80) for a in args))
        buf = _DojoOut()
        err = None
        got = None
        _sys.stdout = buf
        t0 = _time.perf_counter()
        try:
            got = fn(*args)
        except BaseException as e:
            err = _dojo_err(e)
        finally:
            ms = (_time.perf_counter() - t0) * 1000
            _sys.stdout = old
        limit = case.get("timeLimitMs") or spec.get("timeLimitMs")
        slow = bool(limit) and ms > limit
        ok = err is None and not slow and _dojo_match(got, expected, spec.get("compare") or "exact")
        r = {
            "index": i,
            "call": call,
            "expected": _dojo_short(expected),
            "got": None if err else _dojo_short(got),
            "ok": ok,
            "ms": round(ms, 1),
            "slow": slow,
            "error": err,
            "stdout": buf.getvalue(),
        }
        results.append(r)
        report(_json.dumps({"event": "case", "result": r}))
    return _json.dumps({"phase": "done", "results": results, "stdout": out.getvalue()})

def __dojo_exec(code):
    try:
        compiled = compile(code, _DOJO_FILE, "exec")
    except SyntaxError as e:
        return _json.dumps({"stdout": "", "error": _dojo_err(e)})
    out = _DojoOut()
    old = _sys.stdout
    _sys.stdout = out
    err = None
    try:
        exec(compiled, {"__name__": "__main__"})
    except BaseException as e:
        err = _dojo_err(e)
    finally:
        _sys.stdout = old
    return _json.dumps({"stdout": out.getvalue(), "error": err})

# ── Trazador: lo que hizo TU código, paso a paso ──

_DOJO_MAX_STEPS = 600
_DOJO_MAX_ITEMS = 40

class _DojoTraceLimit(Exception):
    pass

def _dojo_val(v, depth=0):
    if v is None:
        return {"t": "none"}
    if isinstance(v, bool):
        return {"t": "bool", "v": v}
    if isinstance(v, int):
        return {"t": "int", "v": v if abs(v) < 2 ** 53 else None, "r": repr(v)}
    if isinstance(v, float):
        return {"t": "float", "v": v if v == v and abs(v) != float("inf") else None, "r": repr(v)}
    if isinstance(v, str):
        return {"t": "str", "v": v[:200], "n": len(v)}
    if depth >= 2:
        return {"t": "obj", "r": _dojo_short(v, 60)}
    if isinstance(v, (list, tuple)):
        return {"t": "list" if isinstance(v, list) else "tuple", "v": [_dojo_val(x, depth + 1) for x in v[:_DOJO_MAX_ITEMS]], "n": len(v)}
    if isinstance(v, (set, frozenset)):
        items = list(v)
        try:
            items = sorted(items)
        except TypeError:
            pass
        return {"t": "set", "v": [_dojo_val(x, depth + 1) for x in items[:_DOJO_MAX_ITEMS]], "n": len(v)}
    if isinstance(v, dict):
        pairs = list(v.items())[:_DOJO_MAX_ITEMS]
        return {"t": "dict", "v": [[_dojo_val(k, depth + 1), _dojo_val(x, depth + 1)] for k, x in pairs], "n": len(v)}
    if callable(v):
        return {"t": "fn", "r": getattr(v, "__name__", "función")}
    return {"t": "obj", "r": _dojo_short(v, 60)}

def _dojo_locals(frame):
    out = {}
    for k, v in dict(frame.f_locals).items():
        if k.startswith("__") or k in ("_dojo_args",):
            continue
        if hasattr(v, "__spec__") and hasattr(v, "__name__") and type(v).__name__ == "module":
            continue
        out[k] = _dojo_val(v)
    return out

def _dojo_tracer(steps, out):
    def tracer(frame, event, arg):
        if frame.f_code.co_filename != _DOJO_FILE:
            return None
        if event in ("line", "return", "exception"):
            if len(steps) >= _DOJO_MAX_STEPS:
                raise _DojoTraceLimit()
            step = {
                "line": frame.f_lineno,
                "event": event,
                "fn": frame.f_code.co_name,
                "locals": _dojo_locals(frame),
                "out": len(out.getvalue()),
            }
            if event == "return":
                step["ret"] = _dojo_val(arg)
            if event == "exception":
                step["exc"] = arg[0].__name__
            steps.append(step)
        return tracer
    return tracer

def _dojo_traced(run, out):
    steps = []
    err = None
    result = None
    truncated = False
    old = _sys.stdout
    _sys.stdout = out
    _sys.settrace(_dojo_tracer(steps, out))
    try:
        result = run()
    except _DojoTraceLimit:
        truncated = True
    except BaseException as e:
        err = _dojo_err(e)
    finally:
        _sys.settrace(None)
        _sys.stdout = old
    return steps, result, err, truncated

def __dojo_trace(code, spec_json):
    """Corre la función del ejercicio con UN ejemplo, registrando cada paso."""
    spec = _json.loads(spec_json)
    try:
        compiled = compile(code, _DOJO_FILE, "exec")
    except SyntaxError as e:
        return _json.dumps({"phase": "syntax", "error": _dojo_err(e)})
    ns = {"__name__": "__dojo__"}
    out = _DojoOut()
    old = _sys.stdout
    _sys.stdout = out
    try:
        exec(compiled, ns)
    except BaseException as e:
        _sys.stdout = old
        return _json.dumps({"phase": "load", "error": _dojo_err(e), "stdout": out.getvalue()})
    finally:
        _sys.stdout = old
    fn = ns.get(spec["fn"])
    if not callable(fn):
        return _json.dumps({"phase": "missing", "fn": spec["fn"], "stdout": out.getvalue()})
    args = _copy.deepcopy(spec.get("args", []))
    call = "%s(%s)" % (spec["fn"], ", ".join(_dojo_short(a, 80) for a in args))
    steps, result, err, truncated = _dojo_traced(lambda: fn(*args), out)
    return _json.dumps({
        "phase": "done", "call": call, "steps": steps, "truncated": truncated,
        "result": None if err or truncated else _dojo_val(result),
        "error": err, "stdout": out.getvalue(),
    })

def __dojo_trace_exec(code):
    """Corre un programa suelto (los ejemplos de las lecciones) paso a paso."""
    try:
        compiled = compile(code, _DOJO_FILE, "exec")
    except SyntaxError as e:
        return _json.dumps({"phase": "syntax", "error": _dojo_err(e)})
    out = _DojoOut()
    ns = {"__name__": "__main__"}
    steps, _, err, truncated = _dojo_traced(lambda: exec(compiled, ns), out)
    return _json.dumps({
        "phase": "done", "call": None, "steps": steps, "truncated": truncated,
        "result": None, "error": err, "stdout": out.getvalue(),
    })
`;

/**
 * Un valor JSON escrito como lo muestra Python (`repr`): así los ejemplos del
 * enunciado se ven igual que lo que imprime el harness al fallar un caso.
 */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  // JSON no distingue 5 de 5.0: los números van tal cual.
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    return q + v.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`).replace(/\n/g, "\\n") + q;
  }
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`)
      .join(", ")}}`;
  return String(v);
}

export function pyCall(fn: string, args: unknown[]): string {
  return `${fn}(${args.map(pyRepr).join(", ")})`;
}
