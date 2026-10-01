// npm run tabla
import { leerPartidos, tablaDePosiciones } from "./tabla.js";
const tabla = tablaDePosiciones(leerPartidos());
console.log("#  Equipo                   PJ  Pts  DG  GF");
tabla.forEach((f, i) => console.log(`${String(i + 1).padStart(2)} ${f.equipo.padEnd(24)} ${String(f.pj).padStart(2)} ${String(f.pts).padStart(4)} ${String(f.dg).padStart(3)} ${String(f.gf).padStart(3)}${i === 3 ? "\n   ── clasifican los 4 primeros ──" : ""}`));
