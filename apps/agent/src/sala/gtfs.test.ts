import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  activeServices,
  buildNetwork,
  cleanStopName,
  describePlan,
  gtfsTimeToSeconds,
  localClock,
  matchStations,
  nextDepartures,
  normalizeName,
  planRoute,
  resolveStation,
  type GtfsFiles,
} from "@hermes/shared";

/**
 * GTFS → red + planificador (Tótem de estación). Contratos sobre un feed
 * SINTÉTICO (3 líneas, 2 transbordos) y, si está descargado, el feed real
 * del sistema en ~/.hermes-os/gtfs/metro (Poblado → Arví pasa por Acevedo con
 * las líneas A, K y L y los colores vienen de routes.txt).
 */

// Red sintética:
//   Línea A (metro):  Norte — Centro — Sur — Puerto     (andenes "Centro A" y "Puerto")
//   Línea B (tranvía): Centro B — Este — Fin            ("Centro B" a 40 m de "Centro A" → misma estación)
//   Línea C (cable):  Muelle — Cerro                    (Muelle ↔ Puerto en transfers.txt, nombres distintos)
//   Línea D (bus):    Norte — Fin, directa pero lenta   (0 transbordos gana aunque tarde más)
//   Parada "Centro" de bus (Línea D) a 900 m: NO se fusiona (mismo nombre, lejos).
function synthetic(): GtfsFiles {
  const stops = [
    "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
    "N,Norte Cra.50 #10-20 Ciudad,6.3000,-75.5600,,",
    "CA,Centro A Cra.51 #40-1,6.2500,-75.5600,,",
    "CB,Centro B_Cll. 46 con Cra. 50,6.2503,-75.5601,,",
    "S,Sur Cll.30 #20-2,6.2000,-75.5600,,",
    "P,Puerto Cra.60 #3-3,6.1500,-75.5600,,",
    "E,Este Cra.20 #46-1,6.2500,-75.5000,,",
    "F,Fin Cra.10 #46-1,6.2500,-75.4500,,",
    "M,Muelle Buses Cra.60,6.1504,-75.5605,,",
    "C,CERRO ALTO Corregimiento de Arriba,6.1000,-75.6000,,",
    "CD,Centro Cll. 30 con Cra. 70,6.2500,-75.5680,,",
  ].join("\r\n");
  const routes = [
    "route_id,route_short_name,route_long_name,route_type,route_color,route_text_color",
    "LA,A,Línea A,2,0960A7,",
    "LB,T-B,Tranvía B_,0,00933E,",
    "LC,C,Línea c_,6,CBD308,000000",
    "LD,D,Línea D,3,777777,",
  ].join("\r\n");
  const trips = [
    "route_id,service_id,trip_id,trip_headsign,direction_id",
    "LA,Laboral,A1,Puerto,0",
    "LA,Laboral,A2,Puerto,0",
    "LA,Laboral,A3,Norte,1",
    "LA,Sabado,A4,Puerto,0",
    "LB,Laboral,B1,Fin,0",
    "LB,Laboral,B2,Centro,1",
    "LC,Laboral,C1,Cerro,0",
    "LC,Laboral,C2,Muelle,1",
    "LD,Laboral,D1,Fin,0",
    "LD,Laboral,D2,Norte,1",
  ].join("\r\n");
  const st = (trip: string, seq: number, stop: string, t: string) => `${trip},${t},${t},${stop},${seq}`;
  const stop_times = [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
    // A: 3 min entre paradas (dos viajes iguales + uno con 5 min: la mediana manda = 3)
    st("A1", 1, "N", "05:00:00"), st("A1", 2, "CA", "05:03:00"), st("A1", 3, "S", "05:06:00"), st("A1", 4, "P", "05:09:00"),
    st("A2", 1, "N", "05:10:00"), st("A2", 2, "CA", "05:13:00"), st("A2", 3, "S", "05:16:00"), st("A2", 4, "P", "05:19:00"),
    st("A3", 1, "P", "05:00:00"), st("A3", 2, "S", "05:05:00"), st("A3", 3, "CA", "05:10:00"), st("A3", 4, "N", "05:15:00"),
    st("A4", 1, "N", "06:00:00"), st("A4", 2, "CA", "06:03:00"), st("A4", 3, "S", "06:06:00"), st("A4", 4, "P", "06:09:00"),
    // B: 4 min por tramo
    st("B1", 1, "CB", "05:00:00"), st("B1", 2, "E", "05:04:00"), st("B1", 3, "F", "05:08:00"),
    st("B2", 1, "F", "05:00:00"), st("B2", 2, "E", "05:04:00"), st("B2", 3, "CB", "05:08:00"),
    // C: 10 min
    st("C1", 1, "M", "05:00:00"), st("C1", 2, "C", "05:10:00"),
    st("C2", 1, "C", "05:00:00"), st("C2", 2, "M", "05:10:00"),
    // D: directa Norte→Centro(bus)→Fin, 40 min (más lenta que A+B = 3+4+4+2 = 13)
    st("D1", 1, "N", "05:00:00"), st("D1", 2, "CD", "05:20:00"), st("D1", 3, "F", "05:40:00"),
    st("D2", 1, "F", "05:00:00"), st("D2", 2, "CD", "05:20:00"), st("D2", 3, "N", "05:40:00"),
  ].join("\r\n");
  const transfers = ["from_stop_id,to_stop_id,transfer_type,min_transfer_time", "P,M,2,120", "CA,CB,2,180"].join("\r\n");
  const calendar = [
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
    "Laboral,1,1,1,1,1,0,0,20250101,20251231",
    "Sabado,0,0,0,0,0,1,0,20250101,20251231",
  ].join("\r\n");
  const calendar_dates = ["service_id,date,exception_type", "Laboral,20250101,2", "Sabado,20250101,1", "Sabado,20250727,1"].join("\r\n");
  return { stops, routes, trips, stop_times, transfers, calendar, calendar_dates };
}

describe("cleanStopName / normalizeName", () => {
  it("corta la dirección pegada al nombre y el sufijo de andén", () => {
    assert.equal(cleanStopName("Poblado Cra.49 #9-69 Medellin"), "Poblado");
    assert.equal(cleanStopName("San Antonio A Cra.51a #46-08 Medellin"), "San Antonio");
    assert.equal(cleanStopName("San José_Cll. 49 con Cra. 46"), "San José");
    assert.equal(cleanStopName("Acevedo K Cra.63 # 103g-202 Medellin"), "Acevedo");
    assert.equal(cleanStopName("Parque Arvi Corregimiento de Santa Elena-Vereda"), "Parque Arvi");
    assert.equal(cleanStopName("Juan XXXIIICra.99dd #48F-26 Medellin"), "Juan XXXIII");
    assert.equal(cleanStopName("Alejandro Echavarría_Cll. 51 con Cra. 16"), "Alejandro Echavarría");
    assert.equal(cleanStopName("San Javier J Cll.45 #98-80 Medellin"), "San Javier");
    assert.equal(cleanStopName("Cementerio Universal-A"), "Cementerio Universal");
    assert.equal(cleanStopName("BARRIO COLON Cra. 46 con Cll. 40-31"), "Barrio Colon");
  });
  it("normaliza tildes, mayúsculas y puntuación", () => {
    assert.equal(normalizeName("  Estación  Berrío! "), "estacion berrio");
    assert.equal(gtfsTimeToSeconds("25:10:05"), 25 * 3600 + 10 * 60 + 5);
  });
});

describe("buildNetwork (sintético)", () => {
  const net = buildNetwork(synthetic(), { aliases: { "el fin del mundo": "Fin" }, display: { Puerto: "El Puerto" } });

  it("fusiona andenes con el mismo nombre cerca y los pares de transfers.txt; separa los lejanos", () => {
    const centro = net.stations.get("centro");
    assert.ok(centro, "Centro existe");
    assert.deepEqual([...centro.stopIds].sort(), ["CA", "CB"]);
    assert.deepEqual([...centro.lines].sort(), ["LA", "LB"]);
    // Puerto (metro) absorbe a "Muelle Buses" por transfers.txt y manda el nombre del metro.
    const puerto = net.stations.get("puerto");
    assert.ok(puerto);
    assert.deepEqual([...puerto.stopIds].sort(), ["M", "P"]);
    assert.equal(puerto.name, "El Puerto", "display de la config");
    assert.equal(net.stopStation.get("M"), "puerto");
    // La parada de bus "Centro" está a 900 m: estación aparte con sufijo de línea.
    const centroBus = [...net.stations.values()].find((s) => s.stopIds.includes("CD"));
    assert.ok(centroBus);
    assert.notEqual(centroBus.key, "centro");
    assert.equal(centroBus.name, "Centro (D)");
    assert.equal(net.stations.size, 8);
  });

  it("líneas con color del feed, nombre limpio, tipo y secuencia de estaciones", () => {
    const a = net.lines.get("LA")!;
    assert.equal(a.color, "#0960A7");
    assert.equal(a.kind, "metro");
    assert.deepEqual(a.stations, ["norte", "centro", "sur", "puerto"]);
    assert.equal(a.headsigns["0"], "Puerto");
    const c = net.lines.get("LC")!;
    assert.equal(c.name, "Línea C");
    assert.equal(c.kind, "cable");
    assert.equal(c.textColor, "#000000");
    assert.equal(net.lines.get("LB")!.name, "Tranvía B");
    assert.equal(net.lines.get("LB")!.kind, "tranvia");
  });

  it("los segundos por tramo son la mediana de los viajes", () => {
    const fromNorte = net.rides.get("norte")!.filter((e) => e.line === "LA");
    assert.equal(fromNorte.length, 1);
    assert.equal(fromNorte[0].seconds, 180);
    const back = net.rides.get("sur")!.find((e) => e.line === "LA" && e.to === "centro")!;
    assert.equal(back.seconds, 300, "sentido 1 tiene sus propios tiempos");
  });

  it("resuelve nombres con tildes, 'estación', artículos y alias de la config", () => {
    assert.equal(resolveStation(net, "Estación Céntro")!.station.key, "centro");
    assert.equal(resolveStation(net, "el puerto")!.station.key, "puerto");
    assert.equal(resolveStation(net, "PUERTO")!.station.key, "puerto");
    assert.equal(resolveStation(net, "el fin del mundo")!.station.key, "fin");
    assert.equal(resolveStation(net, "cerro")!.station.key, "cerro alto", "parcial");
    assert.equal(resolveStation(net, "xyz"), null);
    assert.equal(matchStations(net, "centro")[0].station.key, "centro", "exacto antes que 'Centro (D)'");
  });

  it("planRoute: menos transbordos primero, luego menos tiempo", () => {
    // Norte → Fin: A+B (13 min, 1 transbordo) vs D directa (40 min, 0) → gana D.
    const p = planRoute(net, "norte", "fin")!;
    assert.equal(p.transfers, 0);
    assert.equal(p.legs.length, 1);
    assert.equal(p.legs[0].lineShort, "D");
    assert.equal(p.minutes, 40);
    // Sin buses: A hasta Centro, transbordo de 180 s (transfers.txt), tranvía hasta Fin.
    const q = planRoute(net, "norte", "fin", { excludeKinds: ["bus"] })!;
    assert.equal(q.transfers, 1);
    assert.deepEqual(q.legs.map((l) => l.lineShort), ["A", "T-B"]);
    assert.deepEqual(q.legs.map((l) => l.toName), ["Centro", "Fin"]);
    assert.equal(q.legs[0].stopsCount, 1);
    assert.equal(q.legs[1].stopsCount, 2);
    assert.equal(q.transferMinutes, 3);
    assert.equal(q.transferEstimated, false);
    assert.equal(q.minutes, 3 + 8 + 3);
    assert.equal(q.legs[0].headsign, "Puerto");
  });

  it("planRoute: dos transbordos, transbordo estimado cuando transfers.txt no lo trae, y sin ruta", () => {
    // Este → Cerro: T-B a Centro (transbordo oficial), A a Puerto, C a Cerro (transbordo oficial P↔M).
    const p = planRoute(net, "este", "cerro alto")!;
    assert.deepEqual(p.legs.map((l) => l.lineShort), ["T-B", "A", "C"]);
    assert.equal(p.transfers, 2);
    assert.equal(p.transferEstimated, false);
    assert.equal(p.legs[2].color, "#CBD308");
    // Centro (D) → Sur exige cambiar de bus a metro sin par en transfers.txt → default estimado.
    const bus = [...net.stations.values()].find((s) => s.stopIds.includes("CD"))!;
    const r = planRoute(net, bus.key, "sur")!;
    assert.equal(r.transfers, 1);
    assert.equal(r.transferEstimated, true);
    assert.equal(planRoute(net, "norte", "norte"), null);
    assert.equal(planRoute(net, "norte", "no-existe"), null);
    assert.match(describePlan(p), /Toma la Tranvía B sentido Centro en Este hasta Centro \(1 parada, 4 min\); cambia a la Línea A/);
    assert.match(describePlan(p), /2 transbordos\.$/);
  });

  it("calendario: servicios por fecha, excepciones y patrón de respaldo cuando el feed venció", () => {
    // Martes 2025-03-04 → Laboral.
    assert.deepEqual(activeServices(net, { date: "20250304", weekday: 2, seconds: 0 }), { services: ["Laboral"], stale: false });
    // 2025-01-01 (miércoles): Laboral quitado, Sabado agregado.
    assert.deepEqual(activeServices(net, { date: "20250101", weekday: 3, seconds: 0 }), { services: ["Sabado"], stale: false });
    // 2026 fuera de vigencia → patrón del día de la semana, marcado stale.
    assert.deepEqual(activeServices(net, { date: "20260918", weekday: 5, seconds: 0 }), { services: ["Laboral"], stale: true });
    assert.deepEqual(activeServices(net, { date: "20260918", weekday: 5, seconds: 0 }, false), { services: [], stale: false });
    // Domingo: solo aparece en calendar_dates (agregado en domingo 2025-07-27) → ese servicio.
    assert.deepEqual(activeServices(net, { date: "20260920", weekday: 0, seconds: 0 }), { services: ["Sabado"], stale: true });
  });

  it("nextDepartures: próximas salidas por línea y sentido, sin la última parada del viaje", () => {
    const r = nextDepartures(net, "norte", { date: "20250304", weekday: 2, seconds: 5 * 3600 + 60 }, { limit: 2 })!;
    assert.equal(r.stale, false);
    const a = r.departures.find((d) => d.line === "LA" && d.dir === "0")!;
    assert.deepEqual(a.secs, [5 * 3600 + 600]);
    assert.deepEqual(a.inMinutes, [9]);
    assert.equal(a.headsign, "Puerto");
    // En Norte no hay salidas de la A sentido 1 (ahí termina).
    assert.equal(r.departures.some((d) => d.line === "LA" && d.dir === "1"), false);
    const s = nextDepartures(net, "norte", { date: "20260918", weekday: 5, seconds: 4 * 3600 }, { limit: 2 })!;
    assert.equal(s.stale, true);
    assert.equal(s.feedEnd, "20251231");
    assert.deepEqual(s.departures.find((d) => d.line === "LA")!.secs, [5 * 3600, 5 * 3600 + 600]);
  });

  it("localClock respeta la zona horaria", () => {
    const c = localClock(new Date("2026-09-18T03:30:00Z"), "America/Bogota");
    assert.deepEqual(c, { date: "20260917", weekday: 4, seconds: 22 * 3600 + 30 * 60 });
  });
});

// ── Feed real, si está descargado (docs/estacion-metro.md) ──────────────
const REAL_DIR = process.env.HERMES_GTFS_DIR || join(homedir(), ".hermes-os", "gtfs", "metro");
const hasReal = existsSync(join(REAL_DIR, "stop_times.txt"));

describe("GTFS real del sistema", { skip: !hasReal && `no hay feed en ${REAL_DIR}` }, () => {
  const read = (n: string) => readFileSync(join(REAL_DIR, `${n}.txt`), "utf8");
  const optional = (n: string) => (existsSync(join(REAL_DIR, `${n}.txt`)) ? read(n) : undefined);
  const net = buildNetwork({
    stops: read("stops"),
    routes: read("routes"),
    trips: read("trips"),
    stop_times: read("stop_times"),
    transfers: optional("transfers"),
    calendar: optional("calendar"),
    calendar_dates: optional("calendar_dates"),
  });

  it("Poblado → Arví pasa por Acevedo con las líneas A, K y L y los colores de routes.txt", () => {
    const from = resolveStation(net, "Poblado");
    const to = resolveStation(net, "Parque Arví");
    assert.ok(from && to, "resuelve las dos estaciones");
    const plan = planRoute(net, from.station.key, to.station.key);
    assert.ok(plan, "hay ruta");
    assert.deepEqual(plan.legs.map((l) => l.lineShort), ["A", "K", "L"]);
    assert.deepEqual(plan.legs.map((l) => l.toName), ["Acevedo", "Santo Domingo", "Parque Arvi"]);
    assert.equal(plan.transfers, 2);
    assert.equal(plan.transferEstimated, false, "los dos transbordos vienen en transfers.txt");
    const colors = Object.fromEntries(plan.legs.map((l) => [l.lineShort, l.color]));
    assert.deepEqual(colors, { A: "#0960A7", K: "#CBD308", L: "#A36A18" });
    assert.ok(plan.minutes >= 25 && plan.minutes <= 80, `minutos sanos: ${plan.minutes}`);
    assert.ok(plan.legs[0].stopsCount >= 8, `Poblado→Acevedo son varias paradas: ${plan.legs[0].stopsCount}`);
  });

  it("resuelve nombres como los dice la gente", () => {
    assert.equal(resolveStation(net, "Estación Parque Berrío")!.station.key, "parque berrio");
    assert.equal(resolveStation(net, "el poblado")!.station.key, "poblado");
    assert.equal(resolveStation(net, "Arví")!.station.key, "parque arvi");
    assert.equal(resolveStation(net, "san antonio")!.station.lines.length, 3, "San Antonio une A, B y tranvía");
  });

  it("estaciones de transbordo reales: Acevedo une A, K y P; San Antonio A, B y T-A", () => {
    const ace = net.stations.get("acevedo")!;
    assert.deepEqual(ace.lines.map((l) => net.lines.get(l)!.short).sort(), ["A", "K", "P"]);
    const sa = net.stations.get("san antonio")!;
    assert.deepEqual(sa.lines.map((l) => net.lines.get(l)!.short).sort(), ["A", "B", "T-A"]);
  });
});
