// Tabla de posiciones de la liga: 3 puntos por victoria, 1 por empate, 0 por derrota.
// Desempate: puntos → diferencia de gol → goles a favor → nombre.
import { readFileSync } from "node:fs";

export function leerPartidos(ruta = new URL("../data/partidos.csv", import.meta.url)) {
  const [, ...lineas] = readFileSync(ruta, "utf8").trim().split("\n");
  return lineas.map((l) => {
    const [fecha, local, visitante, gl, gv] = l.split(",");
    return { fecha, local, visitante, gl: Number(gl), gv: Number(gv) };
  });
}

export function tablaDePosiciones(partidos) {
  const t = new Map();
  const fila = (e) => t.get(e) ?? t.set(e, { equipo: e, pj: 0, pts: 0, gf: 0, gc: 0 }).get(e);
  for (const p of partidos) {
    const l = fila(p.local);
    const v = fila(p.visitante);
    l.pj++; v.pj++;
    l.gf += p.gl; l.gc += p.gv;
    v.gf += p.gv; v.gc += p.gl;
    if (p.gl > p.gv) l.pts += 3;
    else if (p.gl < p.gv) v.pts += 3;
    else l.pts += 3;
  }
  return [...t.values()].map((f) => ({ ...f, dg: f.gf - f.gc })).sort((a, b) => b.pts - a.pts || b.gf - a.gf || b.dg - a.dg || a.equipo.localeCompare(b.equipo));
}
