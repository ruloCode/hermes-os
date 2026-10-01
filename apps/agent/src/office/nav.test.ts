import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NAV_STEP, NavGrid, largestOpenRects, type NavBox, type NavPoint } from "@hermes/shared";

const FLOORS = [0, 3.6] as const;
const ROOM = { minX: 0, maxX: 12, minZ: 0, maxZ: 10 };

/** Cuatro muros perimetrales de 99 m (como los de room.ts). */
function walls(b = ROOM): NavBox[] {
  const t = 0.24;
  return [
    { minX: b.minX - t, maxX: b.maxX + t, minZ: b.minZ - t / 2, maxZ: b.minZ + t / 2, top: 99 },
    { minX: b.minX - t, maxX: b.maxX + t, minZ: b.maxZ - t / 2, maxZ: b.maxZ + t / 2, top: 99 },
    { minX: b.minX - t / 2, maxX: b.minX + t / 2, minZ: b.minZ, maxZ: b.maxZ, top: 99 },
    { minX: b.maxX - t / 2, maxX: b.maxX + t / 2, minZ: b.minZ, maxZ: b.maxZ, top: 99 },
  ];
}

/** Recorre el camino en pasos de 5 cm y devuelve cada muestra con la altura del suelo. */
function walk(grid: NavGrid, path: NavPoint[]): NavPoint[] {
  const out: NavPoint[] = [path[0]];
  let y = path[0].y;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let k = 1; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const z = a.z + ((b.z - a.z) * k) / n;
      y = grid.heightAt(x, z, y);
      out.push({ x, y, z });
    }
  }
  return out;
}

function inside(p: { x: number; z: number }, b: NavBox, pad = 0) {
  return p.x > b.minX - pad && p.x < b.maxX + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad;
}

/**
 * Dos pisos: losa a 3,6 m con un hueco en el oeste (x 0..2, z 2..8) y, dentro
 * del hueco, una escalera maciza de 18 escalones que sube hacia -z (como la
 * escalera 1 de la oficina). Con `rail`, la baranda del lado abierto.
 */
function twoFloors(withStairs: boolean): { boxes: NavBox[]; hole: NavBox; stair: NavBox } {
  const hole = { minX: ROOM.minX, maxX: 2, minZ: 2, maxZ: 8, top: 0 };
  const y = FLOORS[1];
  const slab = (minX: number, maxX: number, minZ: number, maxZ: number): NavBox => ({ minX, maxX, minZ, maxZ, bottom: y - 0.2, top: y });
  const boxes: NavBox[] = [
    ...walls(),
    slab(ROOM.minX, ROOM.maxX, ROOM.minZ, hole.minZ),
    slab(ROOM.minX, ROOM.maxX, hole.maxZ, ROOM.maxZ),
    slab(hole.maxX, ROOM.maxX, hole.minZ, hole.maxZ),
    // Guarda del hueco en el piso de arriba (lado este), como las barandas de la oficina.
    { minX: hole.maxX - 0.05, maxX: hole.maxX + 0.05, minZ: hole.minZ, maxZ: hole.maxZ, bottom: 0, top: y + 1.1 },
  ];
  const stair = { minX: 0.12, maxX: 1.9, minZ: hole.minZ, maxZ: hole.maxZ, top: y };
  if (withStairs) {
    const N = 18;
    const tread = (hole.maxZ - hole.minZ) / N;
    for (let i = 0; i < N; i++) {
      const z1 = hole.maxZ - i * tread;
      boxes.push({ minX: stair.minX, maxX: stair.maxX, minZ: z1 - tread, maxZ: z1, top: ((i + 1) * y) / N });
    }
  }
  return { boxes, hole, stair };
}

describe("NavGrid", () => {
  it("en una sala vacía va en línea recta (el suavizado deja dos puntos)", () => {
    const grid = new NavGrid({ bounds: ROOM, boxes: walls(), floorY: FLOORS });
    const path = grid.findPath({ x: 1, y: 0, z: 1 }, { x: 10, y: 0, z: 9 });
    assert.ok(path);
    assert.equal(path.length, 2);
  });

  it("rodea un obstáculo y nunca lo atraviesa", () => {
    const block: NavBox = { minX: 4, maxX: 8, minZ: 2, maxZ: 8, top: 1 };
    const grid = new NavGrid({ bounds: ROOM, boxes: [...walls(), block], floorY: FLOORS });
    const path = grid.findPath({ x: 2, y: 0, z: 5 }, { x: 10, y: 0, z: 5 });
    assert.ok(path);
    assert.ok(path.length > 2, "no puede ser recto: hay una caja en medio");
    for (const p of walk(grid, path)) assert.ok(!inside(p, block, 0.25), `pisa la caja en ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
  });

  it("no atraviesa un muro: pasa por su puerta", () => {
    const left: NavBox = { minX: 5.9, maxX: 6.1, minZ: 0, maxZ: 7, top: 99 };
    const right: NavBox = { minX: 5.9, maxX: 6.1, minZ: 8.5, maxZ: 10, top: 99 };
    const grid = new NavGrid({ bounds: ROOM, boxes: [...walls(), left, right], floorY: FLOORS });
    const path = grid.findPath({ x: 2, y: 0, z: 2 }, { x: 10, y: 0, z: 2 });
    assert.ok(path);
    const samples = walk(grid, path);
    for (const p of samples) assert.ok(!inside(p, left, 0.25) && !inside(p, right, 0.25), "cruza el muro");
    assert.ok(samples.some((p) => Math.abs(p.x - 6) < 0.2 && p.z > 7 && p.z < 8.5), "pasa por la puerta");
  });

  it("sube al otro piso por la escalera, escalón por escalón, nunca por el hueco", () => {
    const { boxes, stair } = twoFloors(true);
    const grid = new NavGrid({ bounds: ROOM, boxes, floorY: FLOORS });
    const path = grid.findPath({ x: 8, y: 0, z: 9 }, { x: 8, y: FLOORS[1], z: 5 });
    assert.ok(path, "hay camino por la escalera");
    assert.equal(path[path.length - 1].y, FLOORS[1], "termina en el piso de arriba");
    const samples = walk(grid, path);
    for (let i = 1; i < samples.length; i++) {
      const dy = Math.abs(samples[i].y - samples[i - 1].y);
      assert.ok(dy <= NAV_STEP + 1e-6, `salto de ${dy.toFixed(2)} m: no se cae ni se teletransporta`);
      // Entre pisos solo se está sobre la escalera.
      if (samples[i].y > 0.05 && samples[i].y < FLOORS[1] - 0.05) assert.ok(inside(samples[i], stair, 0.01), "a media altura fuera de la escalera");
    }
    assert.ok(samples.some((p) => p.y > 1.5 && p.y < 2.1), "pasa por la mitad de la escalera");
  });

  it("baja también por la escalera", () => {
    const { boxes } = twoFloors(true);
    const grid = new NavGrid({ bounds: ROOM, boxes, floorY: FLOORS });
    const path = grid.findPath({ x: 10, y: FLOORS[1], z: 1 }, { x: 10, y: 0, z: 9 });
    assert.ok(path);
    assert.equal(path[path.length - 1].y, 0);
  });

  it("sin escalera no hay camino entre pisos (null), aunque haya hueco", () => {
    const { boxes } = twoFloors(false);
    const grid = new NavGrid({ bounds: ROOM, boxes, floorY: FLOORS });
    assert.equal(grid.findPath({ x: 8, y: 0, z: 9 }, { x: 8, y: FLOORS[1], z: 5 }), null);
  });

  it("un destino encerrado devuelve null", () => {
    const pen: NavBox[] = [
      { minX: 8, maxX: 11, minZ: 6, maxZ: 6.2, top: 99 },
      { minX: 8, maxX: 11, minZ: 8.8, maxZ: 9, top: 99 },
      { minX: 8, maxX: 8.2, minZ: 6, maxZ: 9, top: 99 },
      { minX: 10.8, maxX: 11, minZ: 6, maxZ: 9, top: 99 },
    ];
    const grid = new NavGrid({ bounds: ROOM, boxes: [...walls(), ...pen], floorY: FLOORS });
    assert.equal(grid.findPath({ x: 1, y: 0, z: 1 }, { x: 9.5, y: 0, z: 7.5 }), null);
  });

  it("snap en el piso de arriba nunca cae en el hueco", () => {
    const { boxes, hole } = twoFloors(true);
    const grid = new NavGrid({ bounds: ROOM, boxes, floorY: FLOORS });
    const p = grid.snap(1, 1, 5);
    assert.ok(p);
    assert.equal(p.y, FLOORS[1]);
    assert.ok(!inside(p, hole) || p.z < hole.minZ + 0.6, "quedó parado sobre el vacío");
    assert.equal(grid.walkable(1, 5, FLOORS[1]), false, "sobre el hueco no se camina");
  });

  it("los topes de los muebles son islas: nadie camina por encima de un escritorio", () => {
    const desk: NavBox = { minX: 5, maxX: 7, minZ: 4, maxZ: 5, top: 0.78 };
    const grid = new NavGrid({ bounds: ROOM, boxes: [...walls(), desk], floorY: FLOORS });
    assert.equal(grid.walkable(6, 4.5, 0.78), false);
    assert.equal(grid.walkable(6, 4.5, 0), false);
  });

  it("encuentra los rectángulos vacíos más grandes de un piso, sin solaparse", () => {
    // 5×4 celdas; un mueble ocupa la columna 2 de las filas 0-1.
    const nx = 5;
    const nz = 4;
    const mask = new Uint8Array(nx * nz).fill(1);
    mask[0 * nx + 2] = 0;
    mask[1 * nx + 2] = 0;
    const [a, b] = largestOpenRects(mask, nx, nz, 2);
    assert.deepEqual(a, { ix: 0, iz: 2, w: 5, h: 2 }, "la franja libre de abajo, entera (10 celdas)");
    assert.equal(b.w * b.h, 4, "luego uno de los bloques de arriba (2×2), sin pisar la franja");
    assert.ok(b.iz + b.h <= 2);
    assert.deepEqual(largestOpenRects(new Uint8Array(4), 2, 2, 3), [], "sin suelo libre no hay zonas");
  });
});

