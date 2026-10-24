// Sólidos convexos en cualquier orientación, sombreados con las mismas reglas
// del kit (cuatro tonos por orientación, tapa clara, contorno = silueta). El kit
// solo extruye hacia arriba; la ficha rueda de canto, las paredes de los cajones
// van en rampa y las trampillas giran sobre su bisagra, así que hace falta esto.

import { cameraOf, iso, pathOf, SHADES, type Flat, type Point3, type Projection, type SolidPaths } from "../../iso/iso-kit";

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function hull(points: Flat[]): Flat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Flat[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Flat[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Normal de Newell (robusta con caras de muchos lados). */
function normalOf(points: V3[]): V3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export interface PolyOptions {
  /** Caras que se pintan como tapa (claras) aunque no miren arriba: la cara de la ficha. */
  caps?: number[];
  /** Ángulo mínimo entre caras vecinas para dibujar el pliegue (grados). */
  crease?: number;
}

/**
 * Un poliedro convexo: vértices y caras (índices). Devuelve las mismas capas que
 * `extrude` del kit para usarlo con `<Solid>`.
 */
export function polyhedron(P: Projection, verts: Point3[], faces: number[][], options: PolyOptions = {}): SolidPaths {
  const { sinA, cosA, sinE, cosE } = cameraOf(P);
  const view: V3 = [cosA * cosE, sinA * cosE, sinE];
  const light: [number, number] = [-sinA, cosA];
  const center = verts.reduce<V3>((s, v) => [s[0] + v[0] / verts.length, s[1] + v[1] / verts.length, s[2] + v[2] / verts.length], [0, 0, 0]);
  const flat = verts.map((v) => iso(v, P));
  const info = faces.map((face) => {
    let pts = face.map((i) => verts[i] as V3);
    let n = normalOf(pts);
    const mid = pts.reduce<V3>((s, v) => [s[0] + v[0] / pts.length, s[1] + v[1] / pts.length, s[2] + v[2] / pts.length], [0, 0, 0]);
    let idx = face;
    if (dot(n, sub(mid, center)) < 0) {
      n = [-n[0], -n[1], -n[2]];
      idx = [...face].reverse();
      pts = idx.map((i) => verts[i] as V3);
    }
    return { idx, n, visible: dot(n, view) > 1e-6 };
  });
  const buckets: string[][] = Array.from({ length: SHADES }, () => []);
  const tops: string[] = [];
  info.forEach((f, fi) => {
    if (!f.visible) return;
    const d = pathOf(
      f.idx.map((i) => flat[i]),
      true,
    );
    const horizontal = Math.hypot(f.n[0], f.n[1]);
    if (options.caps?.includes(fi) || f.n[2] > 0.6 || horizontal < 1e-6) {
      tops.push(d);
      return;
    }
    const lit = ((f.n[0] * light[0] + f.n[1] * light[1]) / horizontal + 1) / 2;
    buckets[Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)))].push(d);
  });
  // Pliegues: aristas entre dos caras visibles que doblan más que el umbral.
  const limit = Math.cos(((options.crease ?? 35) * Math.PI) / 180);
  const edges = new Map<string, number[]>();
  info.forEach((f, fi) => {
    f.idx.forEach((a, k) => {
      const b = f.idx[(k + 1) % f.idx.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = edges.get(key) ?? [];
      list.push(fi);
      edges.set(key, list);
    });
  });
  const crease: string[] = [];
  for (const [key, owners] of edges) {
    if (owners.length !== 2) continue;
    const [f0, f1] = owners.map((o) => info[o]);
    if (!f0.visible || !f1.visible) continue;
    if (dot(f0.n, f1.n) > limit) continue;
    const [a, b] = key.split("-").map(Number);
    crease.push(pathOf([flat[a], flat[b]]));
  }
  const outline = hull(flat);
  return {
    fill: pathOf(outline, true),
    outline: pathOf(outline, true),
    crease: crease.join(""),
    top: tops.join(""),
    shades: buckets.map((b) => b.join("")),
  };
}

/** Prisma de un polígono en el plano x–z, extruido a lo largo de y (ficha, lámpara, hoja). */
export function prismY(P: Projection, polygon: [number, number][], y0: number, y1: number, options: PolyOptions = {}): SolidPaths {
  const n = polygon.length;
  const verts: Point3[] = [...polygon.map(([x, z]): Point3 => [x, y0, z]), ...polygon.map(([x, z]): Point3 => [x, y1, z])];
  const faces = [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => n + i)];
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  return polyhedron(P, verts, faces, options);
}

/** Prisma de un polígono en el plano y–z, extruido a lo largo de x (paredes en rampa, escuadras). */
export function prismX(P: Projection, polygon: [number, number][], x0: number, x1: number, options: PolyOptions = {}): SolidPaths {
  const n = polygon.length;
  const verts: Point3[] = [...polygon.map(([y, z]): Point3 => [x0, y, z]), ...polygon.map(([y, z]): Point3 => [x1, y, z])];
  const faces = [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => n + i)];
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  return polyhedron(P, verts, faces, options);
}

/** Caja girada un ángulo alrededor de un eje paralelo a y (la trampilla en su bisagra). */
export function hingedBox(
  P: Projection,
  hinge: [number, number],
  length: number,
  thickness: number,
  y0: number,
  y1: number,
  angle: number,
): SolidPaths {
  // Sección en x–z antes de girar: la hoja va de la bisagra hacia `length` (con signo)
  // y la bisagra está en su arista de ABAJO, del lado exterior: al abrir, la arista de
  // arriba gira hacia el hueco y nunca se mete en el tramo de piso vecino.
  const local: [number, number][] = [
    [0, 0],
    [length, 0],
    [length, thickness],
    [0, thickness],
  ];
  const c = Math.cos(angle);
  const s = Math.sin(angle) * Math.sign(length);
  const turned = local.map(([x, z]): [number, number] => [hinge[0] + x * c + z * s, hinge[1] - x * s + z * c]);
  return prismY(P, turned, y0, y1);
}

export function circle(cx: number, cz: number, r: number, steps = 32): [number, number][] {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
  });
}
