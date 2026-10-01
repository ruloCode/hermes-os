import { test } from "node:test";
import assert from "node:assert/strict";
import { leerPartidos, tablaDePosiciones } from "../src/tabla.js";

const tabla = tablaDePosiciones(leerPartidos());
const de = (equipo) => tabla.find((f) => f.equipo === equipo);

test("un empate da 1 punto a cada equipo", () => {
  assert.equal(de("Atlético Nacional").pts, 6);
  assert.equal(de("Once Caldas").pts, 2);
});

test("el orden respeta el desempate: puntos, diferencia de gol, goles a favor", () => {
  assert.deepEqual(tabla.map((f) => f.equipo), ["Millonarios", "Junior", "Atlético Nacional", "América de Cali", "Independiente Medellín", "Santa Fe", "Deportes Tolima", "Once Caldas"]);
});
