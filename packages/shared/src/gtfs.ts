/**
 * GTFS → red de transporte + planificador de rutas. PURO: sin fs, sin red,
 * sin nombres de ciudad. El agente le pasa el TEXTO de los archivos del feed
 * (`~/.hermes-os/gtfs/<sistema>/`) y una config opcional (`metro.json`: alias
 * de estaciones, nombres para mostrar, fusiones manuales, minutos de
 * transbordo por defecto), y de aquí salen:
 *
 *  - `buildNetwork(files, config)`: estaciones (andenes fusionados por nombre
 *    normalizado + distancia, más los pares de transfers.txt), líneas con su
 *    color OFICIAL (route_color), aristas dirigidas por línea con los segundos
 *    reales de stop_times (mediana entre todos los viajes) e índice de salidas
 *    por parada/línea/servicio para "próximo tren".
 *  - `planRoute(net, from, to)`: Dijkstra sobre (estación, línea) con costo
 *    lexicográfico: primero menos transbordos, luego menos minutos.
 *  - `resolveStation(net, texto)`: "Estación Berrío", "el poblado", "Arví" →
 *    la estación, tolerando tildes, mayúsculas y la palabra "estación".
 *  - `nextDepartures(net, estación, reloj)`: próximas salidas por línea y
 *    sentido según calendar/calendar_dates; si la fecha cae fuera de la
 *    vigencia del feed, usa el patrón del día de la semana y lo marca `stale`
 *    (el dato es real, pero de la versión del feed — la UI lo dice).
 *
 * Regla del repo: todo lo que sale de aquí es dato del feed o de la config;
 * lo único estimado es el tiempo de transbordo cuando transfers.txt no lo
 * trae, y va marcado (`transferEstimated`).
 */

// ── Tipos ────────────────────────────────────────────────────────────────

export interface GtfsFiles {
  stops: string;
  routes: string;
  trips: string;
  stop_times: string;
  transfers?: string;
  calendar?: string;
  calendar_dates?: string;
}

export interface MetroConfig {
  /** alias (como lo dice la gente) → nombre de estación del feed. */
  aliases?: Record<string, string>;
  /** nombre del feed → nombre para mostrar (tildes, mayúsculas). */
  display?: Record<string, string>;
  /** Grupos de stop_id que son la MISMA estación aunque el feed no lo diga. */
  merges?: string[][];
  /** Minutos de transbordo cuando transfers.txt no trae el par (estimado). */
  transfer_minutes?: number;
  /** Radio para fusionar andenes con el mismo nombre (metros). */
  merge_radius_m?: number;
}

export type LineKind = "metro" | "tranvia" | "cable" | "bus" | "otro";

export interface MetroLine {
  id: string;
  /** route_short_name ("A", "K", "T-A"). */
  short: string;
  /** Nombre limpio ("Línea A", "Tranvía Ayacucho"). */
  name: string;
  /** "#rrggbb" de route_color. */
  color: string;
  textColor: string | null;
  kind: LineKind;
  routeType: number;
  /** Estaciones en orden (sentido 0), claves. */
  stations: string[];
  /** sentido → letrero más común ("La Estrella"). */
  headsigns: Record<string, string>;
}

export interface MetroStation {
  key: string;
  name: string;
  stopIds: string[];
  lat: number;
  lon: number;
  /** ids de línea que pasan por aquí. */
  lines: string[];
}

export interface RideEdge {
  to: string;
  line: string;
  dir: string;
  seconds: number;
}

export interface CalendarRow {
  service: string;
  days: boolean[]; // 0=domingo … 6=sábado (como Date#getDay)
  start: string;
  end: string;
}

export interface CalendarDate {
  service: string;
  date: string;
  /** 1 = agrega, 2 = quita. */
  type: number;
}

export interface DepartureIndex {
  secs: number[];
  headsign: string;
}

export interface MetroNetwork {
  stations: Map<string, MetroStation>;
  lines: Map<string, MetroLine>;
  /** estación → aristas de viaje (dirigidas, por línea y sentido). */
  rides: Map<string, RideEdge[]>;
  /** `${estación}|${líneaA}|${líneaB}` (ordenadas) → segundos de transfers.txt. */
  transferSeconds: Map<string, number>;
  transferDefaultSeconds: number;
  stopStation: Map<string, string>;
  /** stopId → `${línea}|${sentido}|${servicio}` → salidas ordenadas (segundos del día). */
  departures: Map<string, Map<string, DepartureIndex>>;
  calendar: CalendarRow[];
  calendarDates: CalendarDate[];
  /** Vigencia declarada en calendar.txt (YYYYMMDD) — null si no hay calendario. */
  feed: { start: string | null; end: string | null };
  /** alias normalizado → clave de estación. */
  aliases: Map<string, string>;
}

export interface RouteLeg {
  line: string;
  lineShort: string;
  lineName: string;
  color: string;
  kind: LineKind;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  /** Sentido (0/1) y letrero del tren ("→ La Estrella"). */
  dir: string;
  headsign: string | null;
  /** Estaciones del tramo incluyendo origen y destino (nombres). */
  stations: string[];
  /** Paradas que se recorren (destino incluido, origen no). */
  stopsCount: number;
  minutes: number;
  seconds: number;
}

export interface RoutePlan {
  from: MetroStation;
  to: MetroStation;
  legs: RouteLeg[];
  transfers: number;
  /** Total = viaje + transbordos. */
  minutes: number;
  rideMinutes: number;
  transferMinutes: number;
  /** Algún transbordo usó el default de la config (no venía en transfers.txt). */
  transferEstimated: boolean;
}

export interface LocalClock {
  /** YYYYMMDD en la zona del sistema. */
  date: string;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** Segundos desde la medianoche local. */
  seconds: number;
}

export interface NextDeparture {
  line: string;
  lineShort: string;
  lineName: string;
  color: string;
  dir: string;
  headsign: string;
  /** Segundos del día de las próximas salidas. */
  secs: number[];
  /** Minutos que faltan para cada una. */
  inMinutes: number[];
}

export interface DeparturesResult {
  services: string[];
  /** true = la fecha cae fuera de la vigencia del feed; se usó el patrón del día. */
  stale: boolean;
  feedEnd: string | null;
  departures: NextDeparture[];
}

// ── CSV ──────────────────────────────────────────────────────────────────

/** Recorre un CSV GTFS (BOM, CRLF, líneas vacías; comillas solo si aparecen). */
export function eachCsvRow(text: string, fn: (col: (name: string) => string, cols: string[]) => void): string[] {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const lines = t.split(/\r?\n/);
  let header: string[] = [];
  let index: Map<string, number> = new Map();
  let first = true;
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const cols = line.includes('"') ? splitQuoted(line) : line.split(",");
    if (first) {
      header = cols.map((h) => h.trim());
      index = new Map(header.map((h, i) => [h, i]));
      first = false;
      continue;
    }
    const col = (name: string) => {
      const i = index.get(name);
      return i === undefined ? "" : (cols[i] ?? "").trim();
    };
    fn(col, cols);
  }
  return header;
}

function splitQuoted(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "HH:MM:SS" (puede pasar de 24 h) → segundos; NaN si no parsea. */
export function gtfsTimeToSeconds(t: string): number {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t.trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ── Nombres ──────────────────────────────────────────────────────────────

/** minúsculas, sin tildes, sin puntuación, espacios colapsados. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Los stop_name del feed traen la dirección pegada ("Poblado Cra.49 #9-69
// Medellin", "San José_Cll. 49 con Cra. 46"): se corta en la primera palabra
// de vía y se quita el sufijo de andén (A/B/K/P/J/H/M/L/BN/T).
const ADDRESS_CUT = /\s+(?:cra|cll|crr|dg|av|travs|calle|carrera|diagonal|transversal|corregimiento)\b\.?/i;
const ADDRESS_GLUED = /[A-Za-zÀ-ÿ](?:Cra|Cll)\./;
const PLATFORM_SUFFIX = /(?:\s+|-)(?:A|B|K|P|J|H|M|L|BN|T|TA)$/;

/** Nombre limpio de una parada del feed (sin dirección ni sufijo de andén). */
export function cleanStopName(raw: string): string {
  let n = raw.replace(/\s+/g, " ").trim();
  const us = n.indexOf("_");
  if (us > 0) n = n.slice(0, us);
  const cut = ADDRESS_CUT.exec(n);
  if (cut && cut.index > 0) n = n.slice(0, cut.index);
  const glued = ADDRESS_GLUED.exec(n);
  if (glued) n = n.slice(0, glued.index + 1);
  n = n.trim();
  // El sufijo de andén se quita solo si deja algo con sentido (≥ 3 letras).
  const noSuffix = n.replace(PLATFORM_SUFFIX, "").trim();
  if (noSuffix.length >= 3) n = noSuffix;
  // Nombres en MAYÚSCULAS del feed → Capitalizadas.
  if (n === n.toUpperCase() && /[A-ZÀ-Ý]{4,}/.test(n)) {
    n = n
      .toLowerCase()
      .split(" ")
      .map((w) => (w.length > 2 || w === "13" ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return n;
}

function cleanLineName(short: string, long: string): string {
  const l = long.replace(/_+\s*$/, "").replace(/\s+/g, " ").trim();
  if (/^l[ií]nea\b/i.test(l)) return `Línea ${short}`;
  return l || `Línea ${short}`;
}

function lineKind(routeType: number): LineKind {
  switch (routeType) {
    case 0:
    case 5:
      return "tranvia";
    case 1:
    case 2:
      return "metro";
    case 3:
    case 11:
    case 700:
      return "bus";
    case 6:
    case 7:
      return "cable";
    default:
      return "otro";
  }
}

/** Prioridad al elegir el andén "principal" de una estación (metro primero). */
const KIND_RANK: Record<LineKind, number> = { metro: 0, cable: 1, tranvia: 2, bus: 3, otro: 4 };

function hexColor(c: string, fallback: string): string {
  const v = c.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toUpperCase()}` : fallback;
}

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Construcción de la red ───────────────────────────────────────────────

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let cur = x;
    let parent = this.parent.get(cur);
    if (parent === undefined) {
      this.parent.set(cur, cur);
      return cur;
    }
    while (parent !== cur) {
      const grand: string = this.parent.get(parent) ?? parent;
      this.parent.set(cur, grand);
      cur = parent;
      parent = grand;
    }
    return cur;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

interface RawStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export function buildNetwork(files: GtfsFiles, config: MetroConfig = {}): MetroNetwork {
  const mergeRadius = config.merge_radius_m ?? 300;
  const transferDefaultSeconds = Math.round((config.transfer_minutes ?? 3) * 60);

  // stops
  const stops = new Map<string, RawStop>();
  eachCsvRow(files.stops, (col) => {
    const id = col("stop_id");
    if (!id) return;
    // Solo paradas/andenes (location_type vacío o 0); estaciones padre no.
    const lt = col("location_type");
    if (lt && lt !== "0") return;
    stops.set(id, { id, name: cleanStopName(col("stop_name")), lat: Number(col("stop_lat")), lon: Number(col("stop_lon")) });
  });

  // routes
  const lines = new Map<string, MetroLine>();
  eachCsvRow(files.routes, (col) => {
    const id = col("route_id");
    if (!id) return;
    const short = col("route_short_name") || id;
    const routeType = Number(col("route_type"));
    lines.set(id, {
      id,
      short,
      name: cleanLineName(short, col("route_long_name")),
      color: hexColor(col("route_color"), "#888888"),
      textColor: col("route_text_color") ? hexColor(col("route_text_color"), "#FFFFFF") : null,
      kind: lineKind(routeType),
      routeType,
      stations: [],
      headsigns: {},
    });
  });

  // trips
  const trips = new Map<string, { line: string; dir: string; service: string; headsign: string }>();
  eachCsvRow(files.trips, (col) => {
    const id = col("trip_id");
    const line = col("route_id");
    if (!id || !lines.has(line)) return;
    trips.set(id, { line, dir: col("direction_id") || "0", service: col("service_id"), headsign: col("trip_headsign").replace(/\s+/g, " ").trim() });
  });

  // stop_times → por viaje
  const byTrip = new Map<string, { seq: number; stop: string; arr: number; dep: number }[]>();
  eachCsvRow(files.stop_times, (col) => {
    const trip = col("trip_id");
    if (!trips.has(trip)) return;
    const stop = col("stop_id");
    if (!stops.has(stop)) return;
    const arr = gtfsTimeToSeconds(col("arrival_time"));
    const dep = gtfsTimeToSeconds(col("departure_time"));
    let rows = byTrip.get(trip);
    if (!rows) byTrip.set(trip, (rows = []));
    rows.push({ seq: Number(col("stop_sequence")), stop, arr: Number.isNaN(arr) ? dep : arr, dep: Number.isNaN(dep) ? arr : dep });
  });
  for (const rows of byTrip.values()) rows.sort((a, b) => a.seq - b.seq);

  // Líneas por parada (para decidir el andén principal de cada estación).
  const stopLines = new Map<string, Set<string>>();
  for (const [trip, rows] of byTrip) {
    const t = trips.get(trip)!;
    for (const r of rows) {
      let s = stopLines.get(r.stop);
      if (!s) stopLines.set(r.stop, (s = new Set()));
      s.add(t.line);
    }
  }

  // ── Fusión de andenes en estaciones ──
  const uf = new UnionFind();
  const byName = new Map<string, RawStop[]>();
  for (const s of stops.values()) {
    const k = normalizeName(s.name);
    let g = byName.get(k);
    if (!g) byName.set(k, (g = []));
    g.push(s);
  }
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (haversineMeters(a.lat, a.lon, b.lat, b.lon) <= mergeRadius) uf.union(a.id, b.id);
      }
    }
  }
  // transfers.txt: pares oficiales (aunque se llamen distinto: "Caribe" ↔ "Parada Caribe Buses").
  const transferPairs: { a: string; b: string; seconds: number }[] = [];
  if (files.transfers) {
    eachCsvRow(files.transfers, (col) => {
      const a = col("from_stop_id");
      const b = col("to_stop_id");
      if (!stops.has(a) || !stops.has(b) || a === b) return;
      const secs = Number(col("min_transfer_time"));
      transferPairs.push({ a, b, seconds: Number.isFinite(secs) && secs > 0 ? secs : transferDefaultSeconds });
      uf.union(a, b);
    });
  }
  for (const group of config.merges ?? []) {
    for (let i = 1; i < group.length; i++) if (stops.has(group[0]) && stops.has(group[i])) uf.union(group[0], group[i]);
  }

  // Componentes → estaciones. Andén principal = el de la línea "más pesada"
  // (metro > cable > tranvía > bus); empate → stop_id alfabético.
  const comps = new Map<string, RawStop[]>();
  for (const s of stops.values()) {
    const r = uf.find(s.id);
    let g = comps.get(r);
    if (!g) comps.set(r, (g = []));
    g.push(s);
  }
  const rankOf = (s: RawStop): number => {
    let best = 9;
    for (const l of stopLines.get(s.id) ?? []) best = Math.min(best, KIND_RANK[lines.get(l)!.kind]);
    return best;
  };
  const stationList: { key: string; name: string; stopIds: string[]; lat: number; lon: number; rank: number }[] = [];
  for (const group of comps.values()) {
    const sorted = [...group].sort((a, b) => rankOf(a) - rankOf(b) || a.id.localeCompare(b.id));
    const primary = sorted[0];
    // Sin viajes en ninguna de sus paradas = no está en la red (se omite).
    if (!group.some((s) => stopLines.has(s.id))) continue;
    stationList.push({
      key: normalizeName(primary.name),
      name: config.display?.[primary.name] ?? primary.name,
      stopIds: sorted.map((s) => s.id),
      lat: group.reduce((a, s) => a + s.lat, 0) / group.length,
      lon: group.reduce((a, s) => a + s.lon, 0) / group.length,
      rank: rankOf(primary),
    });
  }
  // Claves repetidas (mismo nombre, lejos: p.ej. una parada de bus "Prado" a
  // 700 m del Metro Prado): la de mayor peso se queda con el nombre y las
  // otras llevan sus líneas como sufijo.
  stationList.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  const stations = new Map<string, MetroStation>();
  const stopStation = new Map<string, string>();
  for (const st of stationList) {
    let key = st.key;
    let name = st.name;
    if (stations.has(key)) {
      const shorts = [...new Set(st.stopIds.flatMap((id) => [...(stopLines.get(id) ?? [])]))].map((l) => lines.get(l)!.short).sort();
      key = `${st.key} ${shorts.join(" ").toLowerCase()}`.trim();
      name = `${st.name} (${shorts.join("/")})`;
    }
    const linesHere = [...new Set(st.stopIds.flatMap((id) => [...(stopLines.get(id) ?? [])]))];
    stations.set(key, { key, name, stopIds: st.stopIds, lat: st.lat, lon: st.lon, lines: linesHere });
    for (const id of st.stopIds) stopStation.set(id, key);
  }

  // ── Secuencias por línea/sentido (el viaje con más paradas) y letreros ──
  const bestTrip = new Map<string, string>();
  const headsignCount = new Map<string, Map<string, number>>();
  for (const [trip, rows] of byTrip) {
    const t = trips.get(trip)!;
    const k = `${t.line}|${t.dir}`;
    const cur = bestTrip.get(k);
    if (!cur || rows.length > byTrip.get(cur)!.length) bestTrip.set(k, trip);
    if (t.headsign) {
      let m = headsignCount.get(k);
      if (!m) headsignCount.set(k, (m = new Map()));
      m.set(t.headsign, (m.get(t.headsign) ?? 0) + 1);
    }
  }
  for (const [k, m] of headsignCount) {
    const [line, dir] = k.split("|");
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) lines.get(line)!.headsigns[dir] = top[0];
  }
  for (const line of lines.values()) {
    const trip = bestTrip.get(`${line.id}|0`) ?? bestTrip.get(`${line.id}|1`);
    if (!trip) continue;
    const seq: string[] = [];
    for (const r of byTrip.get(trip)!) {
      const k = stopStation.get(r.stop);
      if (k && seq[seq.length - 1] !== k) seq.push(k);
    }
    line.stations = seq;
  }

  // ── Aristas: mediana de segundos entre paradas consecutivas, por línea/sentido ──
  const samples = new Map<string, number[]>();
  for (const [trip, rows] of byTrip) {
    const t = trips.get(trip)!;
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = stopStation.get(rows[i].stop);
      const b = stopStation.get(rows[i + 1].stop);
      if (!a || !b || a === b) continue;
      const secs = rows[i + 1].arr - rows[i].dep;
      if (!(secs >= 0 && secs < 3 * 3600)) continue;
      const k = `${t.line}|${t.dir}|${a}|${b}`;
      let arr = samples.get(k);
      if (!arr) samples.set(k, (arr = []));
      arr.push(secs);
    }
  }
  const rides = new Map<string, RideEdge[]>();
  for (const [k, xs] of samples) {
    const [line, dir, a, b] = k.split("|");
    let list = rides.get(a);
    if (!list) rides.set(a, (list = []));
    list.push({ to: b, line, dir, seconds: Math.round(median(xs)) });
  }

  // ── Transbordos con tiempo oficial (transfers.txt) ──
  const transferSeconds = new Map<string, number>();
  for (const p of transferPairs) {
    const st = stopStation.get(p.a);
    if (!st || st !== stopStation.get(p.b)) continue;
    for (const la of stopLines.get(p.a) ?? []) {
      for (const lb of stopLines.get(p.b) ?? []) {
        if (la === lb) continue;
        const key = transferKey(st, la, lb);
        transferSeconds.set(key, Math.min(transferSeconds.get(key) ?? Infinity, p.seconds));
      }
    }
  }

  // ── Índice de salidas (sin la última parada de cada viaje: ahí no se sube) ──
  const departures = new Map<string, Map<string, DepartureIndex>>();
  for (const [trip, rows] of byTrip) {
    const t = trips.get(trip)!;
    const k = `${t.line}|${t.dir}|${t.service}`;
    for (let i = 0; i + 1 < rows.length; i++) {
      let m = departures.get(rows[i].stop);
      if (!m) departures.set(rows[i].stop, (m = new Map()));
      let d = m.get(k);
      if (!d) m.set(k, (d = { secs: [], headsign: t.headsign || lines.get(t.line)!.headsigns[t.dir] || "" }));
      d.secs.push(rows[i].dep);
    }
  }
  for (const m of departures.values()) for (const d of m.values()) d.secs.sort((a, b) => a - b);

  // ── Calendario ──
  const calendar: CalendarRow[] = [];
  let feedStart: string | null = null;
  let feedEnd: string | null = null;
  if (files.calendar) {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    eachCsvRow(files.calendar, (col) => {
      const service = col("service_id");
      if (!service) return;
      const row: CalendarRow = { service, days: names.map((n) => col(n) === "1"), start: col("start_date"), end: col("end_date") };
      calendar.push(row);
      if (row.start && (!feedStart || row.start < feedStart)) feedStart = row.start;
      if (row.end && (!feedEnd || row.end > feedEnd)) feedEnd = row.end;
    });
  }
  const calendarDates: CalendarDate[] = [];
  if (files.calendar_dates) {
    eachCsvRow(files.calendar_dates, (col) => {
      const service = col("service_id");
      const date = col("date");
      if (!service || !date) return;
      calendarDates.push({ service, date, type: Number(col("exception_type")) });
      if (!feedEnd || date > feedEnd) feedEnd = date;
    });
  }

  // ── Alias de la config ──
  const aliases = new Map<string, string>();
  const byStationName = new Map<string, string>();
  for (const s of stations.values()) byStationName.set(normalizeName(s.name), s.key);
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    const key = stations.has(target) ? target : byStationName.get(normalizeName(target)) ?? stations.get(normalizeName(target))?.key;
    if (key) aliases.set(normalizeName(alias), key);
  }

  return {
    stations,
    lines,
    rides,
    transferSeconds,
    transferDefaultSeconds,
    stopStation,
    departures,
    calendar,
    calendarDates,
    feed: { start: feedStart, end: feedEnd },
    aliases,
  };
}

function transferKey(station: string, a: string, b: string): string {
  return a < b ? `${station}|${a}|${b}` : `${station}|${b}|${a}`;
}

/** Segundos de transbordo entre dos líneas en una estación (+ si es estimado). */
export function transferTime(net: MetroNetwork, station: string, a: string, b: string): { seconds: number; estimated: boolean } {
  const s = net.transferSeconds.get(transferKey(station, a, b));
  return s === undefined ? { seconds: net.transferDefaultSeconds, estimated: true } : { seconds: s, estimated: false };
}

// ── Resolver estaciones ──────────────────────────────────────────────────

const QUERY_FILLER = /^(?:la\s+|el\s+)?(?:estacion|parada|metro|estacion del metro|estacion de metro)\s+(?:de\s+|del\s+)?/;

export interface StationMatch {
  station: MetroStation;
  /** 1 = exacto o alias; menos = aproximado. */
  score: number;
}

/** "Estación Berrío", "el poblado", "Arví" → la estación. null si nada pasa el umbral. */
export function resolveStation(net: MetroNetwork, text: string): StationMatch | null {
  const matches = matchStations(net, text);
  return matches.length ? matches[0] : null;
}

/** Candidatas ordenadas por puntaje (para sugerir cuando hay ambigüedad). */
export function matchStations(net: MetroNetwork, text: string, limit = 5): StationMatch[] {
  let q = normalizeName(text).replace(QUERY_FILLER, "").trim();
  if (!q) return [];
  const exact = net.stations.get(q);
  if (exact) return [{ station: exact, score: 1 }];
  const alias = net.aliases.get(q);
  if (alias && net.stations.has(alias)) return [{ station: net.stations.get(alias)!, score: 1 }];
  // "el poblado" → "poblado": artículo inicial fuera.
  q = q.replace(/^(?:el|la|los|las)\s+/, "");
  const exact2 = net.stations.get(q);
  if (exact2) return [{ station: exact2, score: 1 }];
  const qTokens = q.split(" ").filter(Boolean);
  const out: StationMatch[] = [];
  for (const s of net.stations.values()) {
    const key = normalizeName(s.name);
    let score = 0;
    if (key === q) score = 1;
    else if (key.startsWith(q + " ") || key.endsWith(" " + q) || key.includes(" " + q + " ")) score = 0.9 - Math.min(0.2, (key.length - q.length) / 100);
    else if (q.includes(" " + key + " ") || q.startsWith(key + " ") || q.endsWith(" " + key)) score = 0.85;
    else {
      const kTokens = key.split(" ");
      const shared = qTokens.filter((t) => kTokens.includes(t)).length;
      if (shared) {
        const jac = shared / new Set([...qTokens, ...kTokens]).size;
        // Compartir solo un artículo o "san" no identifica una estación.
        const meaningful = qTokens.filter((t) => kTokens.includes(t) && t.length > 3).length;
        score = meaningful ? 0.5 + 0.3 * jac : 0;
      } else if (key.includes(q) && q.length >= 4) score = 0.6;
      else if (q.length >= 5 && key.replace(/\s/g, "").includes(q.replace(/\s/g, ""))) score = 0.55;
    }
    if (score >= 0.5) out.push({ station: s, score });
  }
  out.sort((a, b) => b.score - a.score || a.station.name.localeCompare(b.station.name));
  return out.slice(0, limit);
}

// ── Planificador ─────────────────────────────────────────────────────────

class MinHeap<T> {
  private a: { k: number; v: T }[] = [];
  get size(): number {
    return this.a.length;
  }
  push(k: number, v: T): void {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { k: number; v: T } | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Peso de un transbordo en el costo: 100 000 s ≫ cualquier viaje → primero menos transbordos, luego menos tiempo. */
const TRANSFER_WEIGHT = 100_000;

export interface PlanOptions {
  /** Excluir tipos de línea (p. ej. buses) del plan. */
  excludeKinds?: LineKind[];
}

/**
 * Ruta de menos transbordos y luego menos tiempo entre dos estaciones
 * (claves). null si no hay camino o si origen = destino.
 */
export function planRoute(net: MetroNetwork, fromKey: string, toKey: string, opts: PlanOptions = {}): RoutePlan | null {
  const from = net.stations.get(fromKey);
  const to = net.stations.get(toKey);
  if (!from || !to || fromKey === toKey) return null;
  const excluded = new Set(opts.excludeKinds ?? []);
  const allowed = (line: string) => !excluded.has(net.lines.get(line)!.kind);

  type Node = { station: string; line: string };
  const id = (n: Node) => `${n.station}|${n.line}`;
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: Node; edge: RideEdge | null; seconds: number; estimated: boolean }>();
  const heap = new MinHeap<Node>();
  for (const line of from.lines) {
    if (!allowed(line)) continue;
    const n = { station: fromKey, line };
    dist.set(id(n), 0);
    heap.push(0, n);
  }
  const done = new Set<string>();
  let goal: Node | null = null;
  while (heap.size) {
    const { k, v } = heap.pop()!;
    const vid = id(v);
    if (done.has(vid)) continue;
    done.add(vid);
    if (v.station === toKey) {
      goal = v;
      break;
    }
    // Viajar por la línea actual.
    for (const e of net.rides.get(v.station) ?? []) {
      if (e.line !== v.line) continue;
      const n = { station: e.to, line: e.line };
      const nk = k + e.seconds;
      const nid = id(n);
      if (nk < (dist.get(nid) ?? Infinity)) {
        dist.set(nid, nk);
        prev.set(nid, { node: v, edge: e, seconds: e.seconds, estimated: false });
        heap.push(nk, n);
      }
    }
    // Cambiar de línea en la estación.
    for (const line of net.stations.get(v.station)!.lines) {
      if (line === v.line || !allowed(line)) continue;
      const t = transferTime(net, v.station, v.line, line);
      const n = { station: v.station, line };
      const nk = k + TRANSFER_WEIGHT + t.seconds;
      const nid = id(n);
      if (nk < (dist.get(nid) ?? Infinity)) {
        dist.set(nid, nk);
        prev.set(nid, { node: v, edge: null, seconds: t.seconds, estimated: t.estimated });
        heap.push(nk, n);
      }
    }
  }
  if (!goal) return null;

  // Reconstruir: lista de pasos desde el origen.
  const steps: { node: Node; edge: RideEdge | null; seconds: number; estimated: boolean }[] = [];
  let cur: Node = goal;
  while (true) {
    const p = prev.get(id(cur));
    if (!p) break;
    steps.push({ node: cur, edge: p.edge, seconds: p.seconds, estimated: p.estimated });
    cur = p.node;
  }
  steps.reverse();

  const legs: RouteLeg[] = [];
  let transferSeconds = 0;
  let transferEstimated = false;
  let transfers = 0;
  let leg: { line: string; dir: string; from: string; stations: string[]; seconds: number } | null = null;
  const flush = () => {
    if (!leg) return;
    const line = net.lines.get(leg.line)!;
    const last = leg.stations[leg.stations.length - 1];
    legs.push({
      line: line.id,
      lineShort: line.short,
      lineName: line.name,
      color: line.color,
      kind: line.kind,
      from: leg.from,
      fromName: net.stations.get(leg.from)!.name,
      to: last,
      toName: net.stations.get(last)!.name,
      dir: leg.dir,
      headsign: line.headsigns[leg.dir] ?? null,
      stations: leg.stations.map((k) => net.stations.get(k)!.name),
      stopsCount: leg.stations.length - 1,
      seconds: leg.seconds,
      minutes: Math.round(leg.seconds / 60),
    });
    leg = null;
  };
  let station = fromKey;
  for (const s of steps) {
    if (s.edge) {
      if (!leg) leg = { line: s.edge.line, dir: s.edge.dir, from: station, stations: [station], seconds: 0 };
      leg.stations.push(s.edge.to);
      leg.seconds += s.seconds;
      station = s.edge.to;
    } else {
      flush();
      transfers++;
      transferSeconds += s.seconds;
      transferEstimated ||= s.estimated;
    }
  }
  flush();
  // Un cambio de línea sin viaje después (no debería pasar) no cuenta.
  transfers = Math.max(0, legs.length - 1);
  const rideSeconds = legs.reduce((a, l) => a + l.seconds, 0);
  return {
    from,
    to,
    legs,
    transfers,
    rideMinutes: Math.round(rideSeconds / 60),
    transferMinutes: Math.round(transferSeconds / 60),
    minutes: Math.round((rideSeconds + transferSeconds) / 60),
    transferEstimated,
  };
}

/** Texto hablado del plan, en español: lo que Hermes dice tal cual. */
export function describePlan(plan: RoutePlan): string {
  const parts = plan.legs.map((l, i) => {
    const dest = l.headsign ? ` sentido ${l.headsign}` : "";
    const head = i === 0 ? `Toma la ${l.lineName}${dest} en ${l.fromName}` : `cambia a la ${l.lineName}${dest}`;
    return `${head} hasta ${l.toName} (${l.stopsCount} ${l.stopsCount === 1 ? "parada" : "paradas"}, ${l.minutes} min)`;
  });
  const tr = plan.transfers === 0 ? "sin transbordos" : plan.transfers === 1 ? "1 transbordo" : `${plan.transfers} transbordos`;
  return `${parts.join("; ")}. Total ${plan.minutes} minutos, ${tr}.`;
}

// ── Próximas salidas ─────────────────────────────────────────────────────

/** Reloj local (fecha YYYYMMDD, día de la semana y segundos del día) en una zona horaria. */
export function localClock(now: Date, timeZone: string): LocalClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    weekday: Math.max(0, weekdays.indexOf(parts.weekday)),
    seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

function weekdayOf(yyyymmdd: string): number {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Servicios activos en una fecha según calendar + calendar_dates. Si ninguno
 * aplica (feed vencido) y `fallback`, usa el patrón del día de la semana:
 * los servicios de calendar.txt con ese día marcado y, si no hay, el servicio
 * que calendar_dates más veces agregó en ese día de la semana. `stale` lo dice.
 */
export function activeServices(net: MetroNetwork, clock: LocalClock, fallback = true): { services: string[]; stale: boolean } {
  const set = new Set<string>();
  for (const row of net.calendar) {
    if (row.days[clock.weekday] && (!row.start || row.start <= clock.date) && (!row.end || clock.date <= row.end)) set.add(row.service);
  }
  for (const cd of net.calendarDates) {
    if (cd.date !== clock.date) continue;
    if (cd.type === 1) set.add(cd.service);
    else if (cd.type === 2) set.delete(cd.service);
  }
  if (set.size || !fallback) return { services: [...set], stale: false };
  for (const row of net.calendar) if (row.days[clock.weekday]) set.add(row.service);
  if (!set.size) {
    const count = new Map<string, number>();
    for (const cd of net.calendarDates) {
      if (cd.type === 1 && weekdayOf(cd.date) === clock.weekday) count.set(cd.service, (count.get(cd.service) ?? 0) + 1);
    }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) set.add(top[0]);
  }
  return { services: [...set], stale: true };
}

/** Próximas `limit` salidas por línea y sentido desde una estación. */
export function nextDepartures(net: MetroNetwork, stationKey: string, clock: LocalClock, opts: { limit?: number; fallback?: boolean } = {}): DeparturesResult | null {
  const station = net.stations.get(stationKey);
  if (!station) return null;
  const limit = opts.limit ?? 2;
  const { services, stale } = activeServices(net, clock, opts.fallback ?? true);
  const byLineDir = new Map<string, NextDeparture>();
  for (const stopId of station.stopIds) {
    const m = net.departures.get(stopId);
    if (!m) continue;
    for (const [k, d] of m) {
      const [line, dir, service] = k.split("|");
      if (!services.includes(service)) continue;
      const l = net.lines.get(line);
      if (!l) continue;
      const key = `${line}|${dir}`;
      let entry = byLineDir.get(key);
      if (!entry) {
        byLineDir.set(key, (entry = { line, lineShort: l.short, lineName: l.name, color: l.color, dir, headsign: d.headsign || l.headsigns[dir] || "", secs: [], inMinutes: [] }));
      }
      // Primera salida ≥ ahora (búsqueda binaria).
      let lo = 0;
      let hi = d.secs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (d.secs[mid] < clock.seconds) lo = mid + 1;
        else hi = mid;
      }
      entry.secs.push(...d.secs.slice(lo, lo + limit));
    }
  }
  const departures = [...byLineDir.values()]
    .map((e) => {
      const secs = [...new Set(e.secs)].sort((a, b) => a - b).slice(0, limit);
      return { ...e, secs, inMinutes: secs.map((s) => Math.max(0, Math.floor((s - clock.seconds) / 60))) };
    })
    .filter((e) => e.secs.length)
    .sort((a, b) => a.lineShort.localeCompare(b.lineShort) || a.dir.localeCompare(b.dir));
  return { services, stale, feedEnd: net.feed.end, departures };
}

/** Resumen compacto de la red (para /metro/stations y la UI). */
export function networkSummary(net: MetroNetwork): {
  stations: { key: string; name: string; lines: string[] }[];
  lines: { id: string; short: string; name: string; color: string; kind: LineKind; stations: string[] }[];
  feed: { start: string | null; end: string | null };
} {
  return {
    stations: [...net.stations.values()]
      .map((s) => ({ key: s.key, name: s.name, lines: s.lines.map((l) => net.lines.get(l)!.short).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    lines: [...net.lines.values()].map((l) => ({ id: l.id, short: l.short, name: l.name, color: l.color, kind: l.kind, stations: l.stations.map((k) => net.stations.get(k)!.name) })),
    feed: net.feed,
  };
}
