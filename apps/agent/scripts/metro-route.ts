/**
 * Imprime la ruta entre dos estaciones con los datos REALES del GTFS
 * (`~/.hermes-os/gtfs/metro/`): tramos, línea, color, paradas y minutos.
 *
 *   pnpm --filter @hermes/agent exec tsx scripts/metro-route.ts Poblado "Parque Arví"
 *   pnpm --filter @hermes/agent exec tsx scripts/metro-route.ts --next Poblado   (próximas salidas)
 *   pnpm --filter @hermes/agent exec tsx scripts/metro-route.ts --stations       (lista con líneas)
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describePlan, localClock, nextDepartures, planRoute, resolveStation, networkSummary } from "@hermes/shared";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
config({ path: resolve(root, ".env") });
const { loadMetro, GTFS_DIR } = await import("../src/metro/gtfs.js");

const args = process.argv.slice(2);
const loaded = await loadMetro();
if (!loaded) {
  console.error(`No hay GTFS en ${GTFS_DIR} (ver docs/estacion-metro.md)`);
  process.exit(1);
}
const { net, buildMs } = loaded;
console.log(`GTFS: ${loaded.dir} · ${net.stations.size} estaciones · ${net.lines.size} líneas · vigencia ${net.feed.start ?? "?"}–${net.feed.end ?? "?"} · red en ${buildMs} ms\n`);

if (args[0] === "--stations") {
  for (const s of networkSummary(net).stations) console.log(`${s.name.padEnd(34)} ${s.lines.join(" ")}`);
  process.exit(0);
}

if (args[0] === "--next") {
  const m = resolveStation(net, args.slice(1).join(" "));
  if (!m) {
    console.error("Estación no encontrada");
    process.exit(1);
  }
  const tz = process.env.WEATHER_TZ || process.env.TZ || "America/Bogota";
  const clock = localClock(new Date(), tz);
  const r = nextDepartures(net, m.station.key, clock, { limit: 3 });
  console.log(`${m.station.name} · ${clock.date} ${Math.floor(clock.seconds / 3600)}:${String(Math.floor((clock.seconds % 3600) / 60)).padStart(2, "0")} (${tz}) · servicios ${r?.services.join(",")}${r?.stale ? ` · HORARIO DE REFERENCIA (feed vence ${r.feedEnd})` : ""}`);
  for (const d of r?.departures ?? []) console.log(`  ${d.lineName} → ${d.headsign}: ${d.inMinutes.map((x) => `${x} min`).join(", ")}`);
  process.exit(0);
}

const [fromText, toText] = args;
if (!fromText || !toText) {
  console.error('Uso: metro-route.ts "<origen>" "<destino>"');
  process.exit(1);
}
const from = resolveStation(net, fromText);
const to = resolveStation(net, toText);
if (!from || !to) {
  console.error(`No encuentro ${!from ? `"${fromText}"` : `"${toText}"`}`);
  process.exit(1);
}
const plan = planRoute(net, from.station.key, to.station.key);
if (!plan) {
  console.error(`Sin ruta entre ${from.station.name} y ${to.station.name}`);
  process.exit(1);
}
console.log(`${plan.from.name} → ${plan.to.name} · ${plan.minutes} min (${plan.rideMinutes} en tren + ${plan.transferMinutes} de transbordo${plan.transferEstimated ? ", estimado" : ""}) · ${plan.transfers} transbordos\n`);
for (const leg of plan.legs) {
  console.log(`  ${leg.lineName.padEnd(18)} ${leg.color}  ${leg.fromName} → ${leg.toName}${leg.headsign ? `  (sentido ${leg.headsign})` : ""}`);
  console.log(`  ${"".padEnd(18)} ${leg.stopsCount} ${leg.stopsCount === 1 ? "parada" : "paradas"} · ${leg.minutes} min · ${leg.stations.join(" · ")}`);
}
console.log(`\nHablado: ${describePlan(plan)}`);
