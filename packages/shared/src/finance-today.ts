/**
 * Finanzas de hoy (v6 «Núcleo», openspec/changes/v6-nucleo/specs/finanzas).
 *
 * La pregunta de todos los días —«¿cuánto puedo gastar hoy?»— y tres detectores
 * que nadie mira: cargos repetidos, gastos hormiga y desvíos por categoría.
 * Regla que manda: el número lo calcula este código, con un método que se puede
 * decir en una frase (`method`), y lo que no tiene datos no se muestra (null o
 * lista vacía, nunca un cero inventado).
 *
 * Puro y determinista: «hoy» (YYYY-MM-DD en la zona del dueño) y la tasa llegan
 * de afuera. Las transferencias entre cuentas propias y los movimientos
 * anulados no cuentan en NINGÚN cálculo.
 */
import { isTransfer, type Currency } from "./types.js";

// ── Entradas ───────────────────────────────────────────────────────────

/** Lo mínimo de una transacción que necesitan estos cálculos (Transaction lo cumple). */
export interface TodayTx {
  kind: "expense" | "income";
  amount: number;
  currency: Currency;
  category: string;
  note?: string | null;
  /** YYYY-MM-DD en la zona del dueño. */
  occurred_on: string;
  voided_at?: string | null;
}

/** Partida del plan mensual (la forma de `finance/plan.ts` en el agente). */
export interface TodayPlanItem {
  kind: "income" | "expense";
  label: string;
  amount: number;
  currency: Currency;
  category: string;
}

export interface TodayPlan {
  items: readonly TodayPlanItem[];
  /** null = el dueño nunca lo confirmó: no hay número. */
  confirmed_at: string | null;
}

/** Tasa del día: COP por 1 USD y de cuándo es. */
export interface TodayFx {
  usdCop: number;
  asOf: string;
}

// ── Salidas ────────────────────────────────────────────────────────────

export interface FxUsed extends TodayFx {
  /** Cuántas partidas del plan y movimientos se convirtieron con ella. */
  converted: number;
}

export interface AvailableToday {
  /** Lo que se puede gastar hoy (redondeado hacia abajo). 0 si ya se pasó. */
  available: number;
  /** Gasto de hoy que cuenta contra el disponible (redondeado hacia arriba). */
  spentToday: number;
  /** Gasto de hoy que cubrió una reserva del plan (no resta del disponible). */
  spentTodayPlanned: number;
  /** available − spentToday. Puede ser negativo: no se recorta a favor. */
  remaining: number;
  /** Días que quedan del mes, incluido hoy. */
  daysLeft: number;
  currency: Currency;
  /** Presente solo si el gasto variable del mes ya superó lo que el plan dejaba libre. */
  overBy?: number;
  /** La base del cálculo, para mostrarla o decirla. */
  plan: { income: number; fixed: number; variable: number };
  method: string;
  /** Presente solo si hubo conversión de moneda. */
  fx?: FxUsed;
  /** El día al que corresponde (YYYY-MM-DD). */
  asOf: string;
}

export type TodayMissing = "plan" | "income" | "fx";

export type AvailableResult =
  | { ok: true; today: AvailableToday }
  | { ok: false; missing: TodayMissing; reason: string };

export interface RecurringCharge {
  /** Nombre como lo trae el último movimiento. */
  merchant: string;
  /** Llave normalizada con la que se agrupó. */
  key: string;
  currency: Currency;
  /** Mediana de los cobros parecidos. */
  monthly: number;
  months: number;
  lastDate: string;
  /** Lo cobrado en el año de «hoy». */
  yearTotal: number;
  method: string;
}

export interface AntExpense {
  merchant: string;
  key: string;
  currency: Currency;
  count: number;
  total: number;
  /** Umbral de compra pequeña usado. */
  threshold: number;
  method: string;
}

export interface CategoryDrift {
  category: string;
  currency: Currency;
  /** Lo gastado en el mes hasta hoy. */
  spent: number;
  /** Mediana de los 3 meses anteriores × (día ÷ días del mes). */
  expected: number;
  /** spent − expected. */
  over: number;
  /** Mediana mensual completa de los 3 meses anteriores. */
  median: number;
  /** Los tres meses comparados (YYYY-MM). */
  baseMonths: string[];
  method: string;
}

// ── Utilidades de calendario y formato (puras) ─────────────────────────

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "2026-01" − 1 → "2025-12". */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Percentil por rango más cercano (p en 0..1): siempre es una compra REAL del dueño. */
export function nearestRankPercentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * s.length));
  return s[rank - 1];
}

/** Unidades por peso/dólar al redondear: pesos enteros, centavos de dólar. */
const UNITS: Record<Currency, number> = { COP: 1, USD: 100 };
// Dividir (no multiplicar por 0,01) evita 47,610000000000006; «+ 0» evita −0.
const down = (n: number, c: Currency) => Math.floor(n * UNITS[c] + 1e-9) / UNITS[c] + 0;
const up = (n: number, c: Currency) => Math.ceil(n * UNITS[c] - 1e-9) / UNITS[c] + 0;
const fix = (n: number, c: Currency) => Number(n.toFixed(c === "USD" ? 2 : 0)) + 0;

/** Formato colombiano: $2.450.000 / US$120,50. */
export function moneyText(amount: number, currency: Currency): string {
  const s = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(Math.abs(amount));
  return `${amount < 0 ? "−" : ""}${currency === "USD" ? "US$" : "$"}${s}`;
}

/** "Mon, 09 Nov 2026 00:02:31 +0000" (RFC 1123 de la fuente) → "del 2026-11-09"; si no se entiende, tal cual. */
function fxDate(asOf: string): string {
  const d = new Date(asOf);
  return Number.isNaN(d.getTime()) ? asOf : `del ${d.toISOString().slice(0, 10)}`;
}

/** Lo que cuenta en cualquier cálculo: no anulado y no transferencia propia. */
export function countable(tx: TodayTx): boolean {
  return !tx.voided_at && !isTransfer(tx);
}

/**
 * Convierte a la moneda destino con la tasa del día. Sin tasa y con monedas
 * distintas devuelve null: un cambio inventado es peor que no tener número.
 */
function converter(target: Currency, fx: TodayFx | null | undefined) {
  let converted = 0;
  const to = (amount: number, from: Currency): number | null => {
    if (from === target) return amount;
    if (!fx || !(fx.usdCop > 0)) return null;
    converted++;
    return target === "COP" ? amount * fx.usdCop : amount / fx.usdCop;
  };
  return { to, count: () => converted };
}

// ── Disponible hoy ─────────────────────────────────────────────────────

/**
 * La moneda del plan es la de sus GASTOS: un plan con el sueldo en dólares y
 * los gastos en pesos se vive en pesos. Si los gastos mezclan monedas (o no
 * hay gastos), COP, la del proyecto.
 */
export function planCurrency(items: readonly TodayPlanItem[]): Currency {
  const cur = new Set(items.filter((i) => i.kind === "expense").map((i) => i.currency));
  return cur.size === 1 ? [...cur][0] : "COP";
}

/**
 * Gasto variable de un conjunto de gastos ya convertidos, con la regla que
 * evita restar dos veces: el plan RESERVA un monto por categoría (la suma de
 * sus partidas de gasto en esa categoría); un gasto real en esa categoría
 * consume la reserva y solo lo que la pasa es variable. Lo que cae en una
 * categoría que el plan no tiene es variable entero.
 */
function variableOf(byCategory: ReadonlyMap<string, number>, reserve: ReadonlyMap<string, number>): number {
  let v = 0;
  for (const [cat, spent] of byCategory) v += Math.max(0, spent - (reserve.get(cat) ?? 0));
  return v;
}

/**
 * ¿Cuánto puedo gastar hoy?
 *
 *   disponible = (ingresos del plan − gastos del plan − gasto variable del mes antes de hoy) ÷ días que quedan, incluido hoy
 *
 * - Ingresos y gastos son los del PLAN confirmado (no lo que entró de verdad:
 *   el plan es la promesa con la que se vive el mes).
 * - «Fijo» = toda partida de gasto del plan; queda reservada por su categoría.
 *   «Variable» = gasto real que no cubre esa reserva (ver `variableOf`). Así el
 *   arriendo del plan, ya pagado, no se resta dos veces.
 * - El gasto de HOY no achica el disponible de hoy: se muestra contra él
 *   (`spentToday`, `remaining`). Mañana ya entra en el gasto del mes.
 * - Pasado del plan → disponible 0 y `overBy` (por cuánto, contando hoy).
 */
export function availableToday(
  plan: TodayPlan | null | undefined,
  txs: readonly TodayTx[],
  today: string,
  fx: TodayFx | null | undefined,
): AvailableResult {
  if (!plan || !plan.confirmed_at || plan.items.length === 0) {
    return {
      ok: false,
      missing: "plan",
      reason: "Falta confirmar el plan mensual: sin él no hay con qué calcular cuánto puedes gastar hoy.",
    };
  }
  const currency = planCurrency(plan.items);
  const conv = converter(currency, fx);

  let income = 0;
  let fixed = 0;
  const reserve = new Map<string, number>();
  for (const it of plan.items) {
    const v = conv.to(it.amount, it.currency);
    if (v == null) {
      return {
        ok: false,
        missing: "fx",
        reason: `No hay tasa del día para pasar «${it.label}» a ${currency}: sin ella no se suma.`,
      };
    }
    if (it.kind === "income") income += v;
    else {
      fixed += v;
      reserve.set(it.category, (reserve.get(it.category) ?? 0) + v);
    }
  }
  if (income <= 0) {
    return {
      ok: false,
      missing: "income",
      reason: "El plan no tiene ingresos: no hay de dónde repartir un disponible.",
    };
  }

  const month = today.slice(0, 7);
  const before = new Map<string, number>();
  const through = new Map<string, number>();
  for (const tx of txs) {
    if (tx.kind !== "expense" || !countable(tx)) continue;
    if (!tx.occurred_on.startsWith(month) || tx.occurred_on > today) continue;
    const v = conv.to(tx.amount, tx.currency);
    if (v == null) {
      return {
        ok: false,
        missing: "fx",
        reason: `Hay gastos en ${tx.currency} y no hay tasa del día para pasarlos a ${currency}.`,
      };
    }
    through.set(tx.category, (through.get(tx.category) ?? 0) + v);
    if (tx.occurred_on < today) before.set(tx.category, (before.get(tx.category) ?? 0) + v);
  }
  let spentTotalToday = 0;
  for (const [cat, v] of through) spentTotalToday += v - (before.get(cat) ?? 0);

  const variableBefore = variableOf(before, reserve);
  const variableThrough = variableOf(through, reserve);
  const daysLeft = daysInMonth(month) - Number(today.slice(8, 10)) + 1;
  const free = income - fixed; // lo que el plan deja libre en el mes
  const leftAtStart = free - variableBefore;

  const available = leftAtStart > 0 ? down(leftAtStart / daysLeft, currency) : 0;
  const spentToday = up(variableThrough - variableBefore, currency);
  const spentTodayPlanned = Math.max(0, fix(spentTotalToday - (variableThrough - variableBefore), currency));
  const remaining = fix(available - spentToday, currency);
  const overRaw = variableThrough - free;
  const overBy = overRaw > 0 ? up(overRaw, currency) : undefined;

  const m = (n: number) => moneyText(fix(n, currency), currency);
  const usedFx = conv.count() > 0 && fx ? { ...fx, converted: conv.count() } : undefined;
  const fxText = usedFx
    ? ` Lo que no estaba en ${currency} se pasó con la tasa de ${moneyText(fix(usedFx.usdCop, "COP"), "COP")} por dólar (${fxDate(usedFx.asOf)}).`
    : "";
  const base =
    `(ingresos del plan ${m(income)} − gastos del plan ${m(fixed)} − gasto variable del mes antes de hoy ${m(variableBefore)})` +
    ` ÷ ${daysLeft} día${daysLeft === 1 ? "" : "s"} que quedan, incluido hoy.`;
  const rule =
    " Un gasto en una categoría del plan se descuenta de lo que el plan ya le reservó; solo lo que pasa de esa reserva o cae fuera del plan es variable. Las transferencias entre tus cuentas no cuentan.";
  const method =
    overBy != null
      ? `Disponible 0: el gasto variable del mes (${m(variableThrough)}) ya pasó lo que el plan deja libre (${m(free)}) por ${m(overBy)}. Base: ${base}${rule}${fxText}`
      : `Disponible hoy = ${base}${rule}${fxText}`;

  return {
    ok: true,
    today: {
      available,
      spentToday,
      spentTodayPlanned,
      remaining,
      daysLeft,
      currency,
      ...(overBy != null ? { overBy } : {}),
      plan: { income: fix(income, currency), fixed: fix(fixed, currency), variable: fix(variableBefore, currency) },
      method,
      ...(usedFx ? { fx: usedFx } : {}),
      asOf: today,
    },
  };
}

// ── Comercios ──────────────────────────────────────────────────────────

const SUFFIXES = new Set(["sas", "sa", "ltda", "ltd", "inc", "llc", "co", "cia", "ca", "spa", "eu", "mensual", "mensuales"]);

/**
 * Notas que no nombran un comercio: el aviso dice desde dónde salió la plata,
 * no a quién. Agruparlas juntaría pagos a personas distintas como si fueran
 * un solo «comercio».
 */
// (la «a» de «transferencia a cuenta» ya se cayó como letra suelta)
const GENERIC = /^(envio desde \w+|aviso del banco|transferencia( cuenta)?|pago|compra|retiro)$/;

/**
 * Llave de comercio: minúsculas sin tildes; fuera lo que va entre paréntesis
 * (el banco de destino de los avisos), los números de sucursal (1-4 dígitos;
 * un número largo de cuenta sí distingue), los asteriscos de enmascarado, las
 * letras sueltas y los sufijos societarios. null = la nota no nombra a nadie.
 */
export function merchantKey(note: string | null | undefined): string | null {
  if (!note) return null;
  const tokens = note
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^\d{1,4}$/.test(t) && !(t.length === 1 && /[a-z]/.test(t)) && !SUFFIXES.has(t));
  const key = tokens.join(" ").trim();
  if (!key || GENERIC.test(key)) return null;
  return key;
}

interface Merchanted {
  tx: TodayTx;
  key: string;
}

function byMerchant(txs: readonly TodayTx[]): Map<string, Merchanted[]> {
  const out = new Map<string, Merchanted[]>();
  for (const tx of txs) {
    if (tx.kind !== "expense" || !countable(tx)) continue;
    const key = merchantKey(tx.note);
    if (!key) continue;
    const k = `${tx.currency}|${key}`;
    const list = out.get(k);
    if (list) list.push({ tx, key });
    else out.set(k, [{ tx, key }]);
  }
  return out;
}

function lastNote(list: readonly Merchanted[]): string {
  const last = [...list].sort((a, b) => b.tx.occurred_on.localeCompare(a.tx.occurred_on))[0];
  return (last.tx.note ?? last.key).trim();
}

// ── Cargos repetidos ───────────────────────────────────────────────────

/** Tolerancia de «monto parecido». */
export const RECURRING_TOLERANCE = 0.1;

/**
 * Cargos repetidos: mismo comercio con un monto parecido (±10 % de la mediana
 * del grupo) cobrado en dos o más meses distintos, una vez por mes. Lo de
 * «una vez por mes» separa una suscripción del café de todos los días que
 * cuesta siempre lo mismo (eso es un gasto hormiga, no un cargo repetido).
 * Varias compras en el mismo comercio con montos muy distintos no forman grupo.
 */
export function recurringCharges(txs: readonly TodayTx[], today: string): RecurringCharge[] {
  const year = today.slice(0, 4);
  const out: RecurringCharge[] = [];
  for (const list of byMerchant(txs).values()) {
    if (list.length < 2) continue;
    // Grupos de montos parecidos: ordenados, se corta donde el siguiente se aleja >10 % de la mediana del grupo.
    const sorted = [...list].sort((a, b) => a.tx.amount - b.tx.amount);
    const clusters: Merchanted[][] = [];
    for (const m of sorted) {
      const cur = clusters[clusters.length - 1];
      if (cur) {
        const med = median(cur.map((c) => c.tx.amount));
        if (Math.abs(m.tx.amount - med) <= med * RECURRING_TOLERANCE) {
          cur.push(m);
          continue;
        }
      }
      clusters.push([m]);
    }
    for (const c of clusters) {
      const perMonth = new Map<string, number>();
      for (const m of c) perMonth.set(m.tx.occurred_on.slice(0, 7), (perMonth.get(m.tx.occurred_on.slice(0, 7)) ?? 0) + 1);
      if (perMonth.size < 2 || [...perMonth.values()].some((n) => n > 1)) continue;
      const amounts = c.map((m) => m.tx.amount);
      const med = median(amounts);
      // La mediana debe seguir siendo el centro de todos (un grupo que se estiró no es «parecido»).
      if (amounts.some((a) => Math.abs(a - med) > med * RECURRING_TOLERANCE)) continue;
      const cur = c[0].tx.currency;
      const dates = c.map((m) => m.tx.occurred_on).sort();
      const lastDate = dates[dates.length - 1];
      const yearTotal = fix(c.filter((m) => m.tx.occurred_on.startsWith(year)).reduce((a, m) => a + m.tx.amount, 0), cur);
      const monthly = fix(med, cur);
      out.push({
        merchant: lastNote(c),
        key: c[0].key,
        currency: cur,
        monthly,
        months: perMonth.size,
        lastDate,
        yearTotal,
        method: `Cobró un monto parecido (±10 % de ${moneyText(monthly, cur)}) una vez al mes en ${perMonth.size} meses distintos; el total de ${year} suma esos cobros (${moneyText(yearTotal, cur)}).`,
      });
    }
  }
  return out.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.monthly - a.monthly);
}

// ── Gastos hormiga ─────────────────────────────────────────────────────

/** Compras mínimas en el mes para ser gasto hormiga. */
export const ANT_MIN_PURCHASES = 5;
/** Compras de referencia mínimas para que exista un umbral (con menos, el percentil no dice nada). */
export const ANT_MIN_SAMPLE = 20;
/** Días de historia con los que se mide «compra pequeña». */
export const ANT_WINDOW_DAYS = 90;

function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Umbral de compra pequeña por moneda = la mediana (percentil 50, rango más
 * cercano) de los gastos del dueño en los 90 días hasta `today`. Es SU compra
 * típica: «pequeña» es la mitad de abajo de lo que él gasta, no un número fijo
 * que valdría distinto para cada persona. Sin 20 compras no hay umbral.
 */
export function smallPurchaseThreshold(txs: readonly TodayTx[], today: string, currency: Currency): number | null {
  const from = addDaysIso(today, -ANT_WINDOW_DAYS);
  const amounts = txs
    .filter((t) => t.kind === "expense" && countable(t) && t.currency === currency && t.occurred_on > from && t.occurred_on <= today)
    .map((t) => t.amount);
  return amounts.length >= ANT_MIN_SAMPLE ? nearestRankPercentile(amounts, 0.5) : null;
}

/**
 * Gastos hormiga del mes (`month` = YYYY-MM): comercios con 5 o más compras en
 * el mes por debajo del umbral de compra pequeña. `today` fija la ventana del
 * umbral (el último día del mes si es un mes pasado).
 */
export function antExpenses(txs: readonly TodayTx[], month: string, today?: string): AntExpense[] {
  const ref = today && today.startsWith(month) ? today : `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const thresholds = new Map<Currency, number | null>();
  const out: AntExpense[] = [];
  for (const list of byMerchant(txs).values()) {
    const cur = list[0].tx.currency;
    if (!thresholds.has(cur)) thresholds.set(cur, smallPurchaseThreshold(txs, ref, cur));
    const threshold = thresholds.get(cur);
    if (threshold == null) continue;
    const small = list.filter((m) => m.tx.occurred_on.startsWith(month) && m.tx.amount < threshold);
    if (small.length < ANT_MIN_PURCHASES) continue;
    const total = fix(small.reduce((a, m) => a + m.tx.amount, 0), cur);
    out.push({
      merchant: lastNote(small),
      key: small[0].key,
      currency: cur,
      count: small.length,
      total,
      threshold,
      method: `${small.length} compras en el mes por debajo de ${moneyText(threshold, cur)}, que es la mediana de tus gastos de los últimos ${ANT_WINDOW_DAYS} días; suman ${moneyText(total, cur)}.`,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

// ── Desvíos por categoría ──────────────────────────────────────────────

/**
 * Desvíos: categoría cuyo gasto del mes hasta hoy supera su mediana mensual de
 * los tres meses anteriores ajustada al día (mediana × día de hoy ÷ días del
 * mes). Solo se evalúa una categoría con gasto en CADA uno de esos tres meses:
 * con menos historia no hay «lo habitual» contra qué comparar. Por moneda (los
 * gastos en dólares se comparan con dólares).
 */
export function categoryDrift(txs: readonly TodayTx[], today: string): CategoryDrift[] {
  const month = today.slice(0, 7);
  const base = [shiftMonth(month, -3), shiftMonth(month, -2), shiftMonth(month, -1)];
  const totals = new Map<string, Map<string, number>>(); // "cur|cat" → mes → total
  for (const tx of txs) {
    if (tx.kind !== "expense" || !countable(tx)) continue;
    const m = tx.occurred_on.slice(0, 7);
    if (m !== month && !base.includes(m)) continue;
    if (m === month && tx.occurred_on > today) continue;
    const k = `${tx.currency}|${tx.category}`;
    const per = totals.get(k) ?? new Map<string, number>();
    per.set(m, (per.get(m) ?? 0) + tx.amount);
    totals.set(k, per);
  }
  const fraction = Number(today.slice(8, 10)) / daysInMonth(month);
  const out: CategoryDrift[] = [];
  for (const [k, per] of totals) {
    if (!base.every((m) => (per.get(m) ?? 0) > 0)) continue;
    const spent = per.get(month) ?? 0;
    const med = median(base.map((m) => per.get(m)!));
    const expected = med * fraction;
    if (spent <= expected) continue;
    const [cur, category] = k.split("|") as [Currency, string];
    const day = Number(today.slice(8, 10));
    out.push({
      category,
      currency: cur,
      spent: fix(spent, cur),
      expected: fix(expected, cur),
      over: fix(spent - expected, cur),
      median: fix(med, cur),
      baseMonths: base,
      method: `Llevas ${moneyText(fix(spent, cur), cur)} contra ${moneyText(fix(expected, cur), cur)} esperados: la mediana de ${base.join(", ")} (${moneyText(fix(med, cur), cur)} al mes) × ${day} de ${daysInMonth(month)} días.`,
    });
  }
  return out.sort((a, b) => b.over - a.over);
}
