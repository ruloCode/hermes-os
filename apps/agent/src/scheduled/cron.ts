/**
 * Cron mínimo con zona horaria, sin dependencias.
 *
 * Solo necesitamos una cosa: "dado un cron y un ahora, ¿cuándo toca la
 * próxima?". Meter una librería de cron para eso contradice la regla del
 * repo de no engordar dependencias, y las que hay o no manejan tz o traen
 * medio mundo detrás.
 *
 * La tz importa de verdad: "todos los lunes 8am" en Bogotá no es una hora
 * fija en UTC, y el agente puede correr en una máquina con otra tz. Por eso
 * el cálculo se hace sobre la hora LOCAL de la zona pedida (vía Intl) y
 * luego se resuelve a un instante real probando los offsets vecinos.
 *
 * Campos soportados: minuto hora día-del-mes mes día-de-semana
 * con *, listas (1,2), rangos (1-5) y pasos (*∕15, 1-5/2). Alias: @hourly,
 * @daily, @weekly, @monthly. Sin segundos y sin años: una tarea personal no
 * los necesita, y no tenerlos evita errores de lectura.
 */

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

const ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

const DOW_NAMES: Record<string, number> = {
  sun: 0, dom: 0, mon: 1, lun: 1, tue: 2, mar: 2, wed: 3, mie: 3, thu: 4, jue: 4,
  fri: 5, vie: 5, sat: 6, sab: 6,
};

function parseField(raw: string, min: number, max: number, names: Record<string, number> = {}): number[] {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const [rangeRaw, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`paso inválido en "${part}"`);

    let from: number;
    let to: number;
    if (rangeRaw === "*") {
      from = min;
      to = max;
    } else if (rangeRaw.includes("-")) {
      const [a, b] = rangeRaw.split("-");
      from = names[a.toLowerCase()] ?? Number(a);
      to = names[b.toLowerCase()] ?? Number(b);
    } else {
      from = to = names[rangeRaw.toLowerCase()] ?? Number(rangeRaw);
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`valor inválido en "${part}"`);
    if (from < min || to > max || from > to) throw new Error(`"${part}" fuera de rango (${min}-${max})`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(expr: string): CronFields {
  const norm = (ALIASES[expr.trim().toLowerCase()] ?? expr).trim().replace(/\s+/g, " ");
  const parts = norm.split(" ");
  if (parts.length !== 5) {
    throw new Error(`Cron inválido: se esperan 5 campos (min hora dom mes dow) y llegaron ${parts.length}.`);
  }
  const [mi, h, dom, mo, dow] = parts;
  return {
    minutes: parseField(mi, 0, 59),
    hours: parseField(h, 0, 23),
    daysOfMonth: parseField(dom, 1, 31),
    months: parseField(mo, 1, 12),
    // 7 = domingo, como en crontab clásico. El dedup NO es cosmético: con "*"
    // el campo sale 0-7 y sin deduplicar quedan 8 entradas, así que el
    // "¿están todos los días?" (length === 7) daba false y el filtro de
    // día-de-semana dejaba pasar cualquier fecha.
    daysOfWeek: [...new Set(parseField(dow, 0, 7, DOW_NAMES).map((d) => (d === 7 ? 0 : d)))].sort(
      (a, b) => a - b,
    ),
  };
}

/** Valida sin lanzar: devuelve el problema o null. */
export function cronError(expr: string): string | null {
  try {
    parseCron(expr);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

interface LocalParts {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
}

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
    });
    FMT_CACHE.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Descompone un instante en su hora local de `tz`. */
function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // En hour12:false, medianoche puede venir como "24".
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))),
  };
}

/**
 * Instante UTC que corresponde a una hora de pared en `tz`.
 *
 * No hay API directa, así que partimos del UTC ingenuo y corregimos con el
 * offset observado. Dos pasadas bastan incluso cruzando un cambio de horario;
 * en la hora que "no existe" de un salto DST el resultado cae en la siguiente
 * válida, que es el comportamiento que se espera de un scheduler.
 */
function fromLocal(p: Omit<LocalParts, "weekday">, tz: string): Date {
  let ts = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    const seen = localParts(new Date(ts), tz);
    const seenTs = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, 0, 0);
    const drift = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0) - seenTs;
    if (drift === 0) break;
    ts += drift;
  }
  return new Date(ts);
}

function matches(f: CronFields, p: LocalParts): boolean {
  if (!f.minutes.includes(p.minute)) return false;
  if (!f.hours.includes(p.hour)) return false;
  if (!f.months.includes(p.month)) return false;
  // Regla de crontab: con día-del-mes Y día-de-semana ambos restringidos,
  // basta con que UNO coincida (es un OR, no un AND).
  const domAll = f.daysOfMonth.length === 31;
  const dowAll = f.daysOfWeek.length === 7;
  const domHit = f.daysOfMonth.includes(p.day);
  const dowHit = f.daysOfWeek.includes(p.weekday);
  if (domAll && dowAll) return true;
  if (domAll) return dowHit;
  if (dowAll) return domHit;
  return domHit || dowHit;
}

/** Próxima ejecución estrictamente posterior a `from`. null si no hay en 2 años. */
export function nextRun(expr: string, tz: string, from: Date = new Date()): Date | null {
  const fields = parseCron(expr);
  // Avanzamos minuto a minuto desde el siguiente minuto exacto. Dos años de
  // margen cubre incluso "29 de febrero"; más allá, el cron no tiene solución.
  const start = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  const limit = 366 * 2 * 24 * 60;
  let cursor = start;
  for (let i = 0; i < limit; i += 1) {
    const p = localParts(cursor, tz);
    if (matches(fields, p)) {
      // Normalizamos: el instante exacto de esa hora de pared.
      return fromLocal({ year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute }, tz);
    }
    // Saltos grandes cuando el día entero no aplica: 1440 iteraciones menos.
    const dayMatches =
      fields.months.includes(p.month) &&
      (fields.daysOfMonth.length === 31 && fields.daysOfWeek.length === 7
        ? true
        : fields.daysOfMonth.length === 31
          ? fields.daysOfWeek.includes(p.weekday)
          : fields.daysOfWeek.length === 7
            ? fields.daysOfMonth.includes(p.day)
            : fields.daysOfMonth.includes(p.day) || fields.daysOfWeek.includes(p.weekday));
    cursor = new Date(cursor.getTime() + (dayMatches ? 60_000 : 60_000 * 60));
  }
  return null;
}

const DOW_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Descripción en español de un cron, para la UI y la confirmación por voz. */
export function describeCron(expr: string, tz: string): string {
  let f: CronFields;
  try {
    f = parseCron(expr);
  } catch {
    return expr;
  }
  const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const zone = tz.split("/").pop()?.replace(/_/g, " ") ?? tz;

  if (f.minutes.length === 60 && f.hours.length === 24) return "cada minuto";
  if (f.minutes.length > 1 && f.hours.length === 24) {
    const step = f.minutes[1] - f.minutes[0];
    return `cada ${step} minutos`;
  }
  if (f.minutes.length === 1 && f.hours.length > 1 && f.hours.length < 24) {
    const step = f.hours[1] - f.hours[0];
    return `cada ${step} horas (min ${f.minutes[0]})`;
  }
  if (f.minutes.length !== 1 || f.hours.length !== 1) return `${expr} (${zone})`;

  const hora = hhmm(f.hours[0], f.minutes[0]);
  const diario = f.daysOfMonth.length === 31 && f.daysOfWeek.length === 7;
  if (diario) return `todos los días a las ${hora} (${zone})`;
  if (f.daysOfMonth.length === 31) {
    const dias = f.daysOfWeek.map((d) => DOW_ES[d]);
    const lista = dias.length > 1 ? `${dias.slice(0, -1).join(", ")} y ${dias.at(-1)}` : dias[0];
    return `los ${lista} a las ${hora} (${zone})`;
  }
  if (f.daysOfWeek.length === 7) {
    return `el día ${f.daysOfMonth.join(", ")} de cada mes a las ${hora} (${zone})`;
  }
  return `${expr} (${zone})`;
}
