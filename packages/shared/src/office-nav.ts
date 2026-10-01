// Navegación de la gente de la Oficina (puro: sin three.js ni DOM). Las
// personas de ambiente caminan entre los tres pisos con esta rejilla.
//
// En vez de una rejilla plana por piso + "portales" escritos a mano para las
// escaleras, cada columna de la rejilla guarda las SUPERFICIES donde se puede
// estar de pie (el suelo, la losa de cada piso, cada escalón), igual que el
// controlador del dueño: una caja es suelo si su tope queda al alcance del paso
// (0,35 m) y estorba si se cruza con la franja del cuerpo (1,7 m). Dos
// superficies vecinas se conectan si el desnivel cabe en un paso. Así la
// escalera es camino porque sus escalones lo son, el hueco de la losa no es
// camino porque ahí no hay nada donde pararse, y si mañana la escalera se mueve
// en room.ts la navegación la sigue sin tocar este archivo.

export interface NavBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Tope de la caja (sobre él se puede estar de pie si se alcanza). */
  top: number;
  /** Base (default 0): una losa del piso de arriba no estorba al caminar debajo. */
  bottom?: number;
}

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

/** Lado de cada celda: menor que la huella de un escalón (0,3 m), así dos vecinas difieren a lo sumo un escalón. */
export const NAV_CELL = 0.25;
/** Desnivel que se sube (o baja) caminando: el del controlador del dueño. */
export const NAV_STEP = 0.35;
/** Alto del cuerpo: una caja estorba solo si se cruza con esta franja. */
export const NAV_BODY = 1.7;
/** Radio de una persona: las cajas se inflan con él. */
export const NAV_RADIUS = 0.3;

export interface NavSpec {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  boxes: readonly NavBox[];
  /** Altura del suelo de cada piso (el primero es el terreno, que existe en toda la planta). */
  floorY: readonly number[];
  cell?: number;
  radius?: number;
}

/** El piso de una altura: a 1,2 m del de llegada ya cuenta ese (el mismo criterio que room.floorAt). */
export function floorOfHeight(y: number, floorY: readonly number[]): number {
  let f = 0;
  for (let i = 1; i < floorY.length; i++) if (y >= floorY[i] - 1.2) f = i;
  return f;
}

/** Montículo binario mínimo sobre (prioridad, nodo), sin objetos por entrada. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  clear() {
    this.keys.length = 0;
    this.vals.length = 0;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class NavGrid {
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly minX: number;
  readonly minZ: number;
  readonly floorY: readonly number[];
  /** Nodos de la columna c: [colStart[c], colStart[c + 1]). */
  private readonly colStart: Int32Array;
  private readonly nodeH: Float64Array;
  private readonly nodeCol: Int32Array;
  private readonly comp: Int32Array;
  /** Vecinos caminables de cada nodo, precalculados (CSR): A* no recalcula nada por expansión. */
  private readonly adjStart: Int32Array;
  private readonly adj: Int32Array;
  private readonly adjCost: Float32Array;
  /** La componente conexa más grande: la oficina caminable (los topes de escritorio quedan como islas). */
  private readonly main: number;
  // Búferes de A* reusados entre búsquedas (sello por búsqueda en vez de borrar).
  private readonly g: Float64Array;
  private readonly from: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Int32Array;
  private search = 0;
  private readonly heap = new MinHeap();

  constructor(spec: NavSpec) {
    const cell = (this.cell = spec.cell ?? NAV_CELL);
    const r = spec.radius ?? NAV_RADIUS;
    const b = spec.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.floorY = spec.floorY;
    const nx = (this.nx = Math.max(1, Math.ceil((b.maxX - b.minX) / cell)));
    const nz = (this.nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell)));
    const cols = nx * nz;
    const ground = spec.floorY[0] ?? 0;

    // Cada caja se registra en las columnas que toca: como estorbo (inflada con
    // el radio) y como suelo candidato (su tope, si el centro de la columna cae dentro).
    const near: number[][] = Array.from({ length: cols }, () => []);
    const tops: number[][] = Array.from({ length: cols }, () => [ground]);
    spec.boxes.forEach((box, bi) => {
      const ix0 = Math.max(0, Math.floor((box.minX - r - b.minX) / cell));
      const ix1 = Math.min(nx - 1, Math.floor((box.maxX + r - b.minX) / cell));
      const iz0 = Math.max(0, Math.floor((box.minZ - r - b.minZ) / cell));
      const iz1 = Math.min(nz - 1, Math.floor((box.maxZ + r - b.minZ) / cell));
      for (let iz = iz0; iz <= iz1; iz++) {
        const cz = b.minZ + (iz + 0.5) * cell;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = b.minX + (ix + 0.5) * cell;
          const qx = Math.max(box.minX, Math.min(cx, box.maxX));
          const qz = Math.max(box.minZ, Math.min(cz, box.maxZ));
          const d2 = (cx - qx) ** 2 + (cz - qz) ** 2;
          if (d2 >= r * r) continue;
          const c = iz * nx + ix;
          near[c].push(bi);
          // Un muro (tope 99) no es suelo; el resto sí, si el centro cae dentro.
          if (d2 === 0 && box.top < 90) tops[c].push(box.top);
        }
      }
    });

    const start = new Int32Array(cols + 1);
    const hs: number[] = [];
    const owner: number[] = [];
    for (let c = 0; c < cols; c++) {
      start[c] = hs.length;
      const cand = tops[c].sort((a, z) => a - z);
      let last = -Infinity;
      for (const h of cand) {
        if (h - last < 0.02) continue;
        last = h;
        let blocked = false;
        for (const bi of near[c]) {
          const box = spec.boxes[bi];
          if (box.top > h + NAV_STEP && (box.bottom ?? 0) < h + NAV_BODY) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        hs.push(h);
        owner.push(c);
      }
    }
    start[cols] = hs.length;
    this.colStart = start;
    this.nodeH = Float64Array.from(hs);
    this.nodeCol = Int32Array.from(owner);
    const n = hs.length;
    this.g = new Float64Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);

    // Vecinos de cada nodo, una sola vez.
    const adjStart = (this.adjStart = new Int32Array(n + 1));
    const adj: number[] = [];
    const adjCost: number[] = [];
    for (let a = 0; a < n; a++) {
      adjStart[a] = adj.length;
      const ha = this.nodeH[a];
      this.eachNeighbor(a, (b, diag) => {
        adj.push(b);
        adjCost.push((diag ? cell * Math.SQRT2 : cell) + Math.abs(this.nodeH[b] - ha) * 0.5);
      });
    }
    adjStart[n] = adj.length;
    this.adj = Int32Array.from(adj);
    this.adjCost = Float32Array.from(adjCost);

    // Componentes conexas (BFS): el destino tiene que estar en la misma que el origen.
    const comp = (this.comp = new Int32Array(n).fill(-1));
    const sizes: number[] = [];
    const queue = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      comp[s] = id;
      while (head < tail) {
        const a = queue[head++];
        for (let k = adjStart[a]; k < adjStart[a + 1]; k++) {
          const bn = this.adj[k];
          if (comp[bn] < 0) {
            comp[bn] = id;
            queue[tail++] = bn;
          }
        }
      }
      sizes.push(tail);
    }
    let main = 0;
    sizes.forEach((sz, i) => {
      if (sz > sizes[main]) main = i;
    });
    this.main = sizes.length ? main : -1;
  }

  get nodes(): number {
    return this.nodeH.length;
  }

  private colOf(x: number, z: number): number {
    const ix = Math.floor((x - this.minX) / this.cell);
    const iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }

  private centerX(c: number) {
    return this.minX + ((c % this.nx) + 0.5) * this.cell;
  }

  private centerZ(c: number) {
    return this.minZ + (Math.floor(c / this.nx) + 0.5) * this.cell;
  }

  /** El nodo de la columna c más cercano en altura a `y`, dentro de `tol`; -1 si no hay. */
  private nodeIn(c: number, y: number, tol: number): number {
    if (c < 0) return -1;
    let best = -1;
    let bd = tol;
    for (let i = this.colStart[c]; i < this.colStart[c + 1]; i++) {
      const d = Math.abs(this.nodeH[i] - y);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Vecinos caminables: desnivel de un paso y, en diagonal, sin cortar esquinas. */
  private eachNeighbor(a: number, fn: (b: number, diag: boolean) => void) {
    const c = this.nodeCol[a];
    const h = this.nodeH[a];
    const ix = c % this.nx;
    const iz = Math.floor(c / this.nx);
    for (const [dx, dz] of DIRS) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
      const b = this.nodeIn(jz * this.nx + jx, h, NAV_STEP);
      if (b < 0) continue;
      const diag = dx !== 0 && dz !== 0;
      if (diag && (this.nodeIn(iz * this.nx + jx, h, NAV_STEP) < 0 || this.nodeIn(jz * this.nx + ix, h, NAV_STEP) < 0)) continue;
      fn(b, diag);
    }
  }

  private point(i: number): NavPoint {
    const c = this.nodeCol[i];
    return { x: this.centerX(c), y: this.nodeH[i], z: this.centerZ(c) };
  }

  /** Nodo de la oficina caminable bajo (x, z) a la altura `y`, o el más cercano en un radio `maxR` sobre ese mismo piso. */
  private nearest(x: number, y: number, z: number, maxR: number, floor?: number): number {
    const want = floor ?? floorOfHeight(y, this.floorY);
    // Con piso explícito, a la altura de ESE suelo (no un escalón alto de la escalera, que ya "cuenta" como el piso de llegada).
    const ok = (i: number) =>
      i >= 0 &&
      this.comp[i] === this.main &&
      (floor === undefined ? floorOfHeight(this.nodeH[i], this.floorY) === want : Math.abs(this.nodeH[i] - (this.floorY[want] ?? 0)) <= NAV_STEP);
    const direct = this.nodeIn(this.colOf(x, z), floor === undefined ? y : (this.floorY[want] ?? y), floor === undefined ? 0.6 : NAV_STEP);
    if (ok(direct)) return direct;
    const ring = Math.ceil(maxR / this.cell);
    const ix0 = Math.floor((x - this.minX) / this.cell);
    const iz0 = Math.floor((z - this.minZ) / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const jx = ix0 + dx;
        const jz = iz0 + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        const c = jz * this.nx + jx;
        const d = Math.hypot(this.centerX(c) - x, this.centerZ(c) - z);
        if (d > maxR || d >= bd) continue;
        for (let i = this.colStart[c]; i < this.colStart[c + 1]; i++) {
          if (!ok(i)) continue;
          bd = d;
          best = i;
          break;
        }
      }
    }
    return best;
  }

  /** El punto caminable más cercano a (x, z) en ese piso (null si no hay ninguno a `maxR`). */
  snap(floor: number, x: number, z: number, maxR = 2): NavPoint | null {
    const i = this.nearest(x, this.floorY[floor] ?? 0, z, maxR, floor);
    return i < 0 ? null : this.point(i);
  }

  /** ¿Una persona cabe parada en (x, z) a la altura `y` (un paso de tolerancia)? */
  walkable(x: number, z: number, y: number): boolean {
    const i = this.nodeIn(this.colOf(x, z), y, NAV_STEP);
    return i >= 0 && this.comp[i] === this.main;
  }

  /** Altura del suelo bajo (x, z) más cercana a `y`: escalón por escalón al subir. */
  heightAt(x: number, z: number, y: number): number {
    const i = this.nodeIn(this.colOf(x, z), y, 0.6);
    return i < 0 ? y : this.nodeH[i];
  }

  /** Piso de un nodo bajo (x, z, y); útil para el QA y el corte de pisos. */
  floorAt(y: number): number {
    return floorOfHeight(y, this.floorY);
  }

  /**
   * Camino de `from` a `to` (destino: ese punto en el piso de `to.y`, con
   * 0,6 m de tolerancia — los lugares ya vienen ajustados con `snap`). Null si
   * no hay. Devuelve puntos ya suavizados por línea de vista: se camina en recta
   * entre ellos y la altura se toma de `heightAt` en cada paso.
   */
  findPath(from: NavPoint, to: NavPoint): NavPoint[] | null {
    const s = this.nearest(from.x, from.y, from.z, 1.5);
    const t = this.nearest(to.x, to.y, to.z, 0.6, floorOfHeight(to.y, this.floorY));
    if (s < 0 || t < 0 || this.comp[s] !== this.comp[t]) return null;
    const nodes = this.astar(s, t);
    if (!nodes) return null;
    return this.smooth(nodes.map((i) => this.point(i)));
  }

  private astar(s: number, t: number): number[] | null {
    const stampId = ++this.search;
    const g = this.g;
    const from = this.from;
    const stamp = this.stamp;
    const closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const tx = this.centerX(this.nodeCol[t]);
    const tz = this.centerZ(this.nodeCol[t]);
    const ty = this.nodeH[t];
    // Heurística ponderada (×1,4): explora mucho menos entre pisos y el camino
    // sale casi igual — el suavizado por línea de vista borra la diferencia.
    const hOf = (i: number) => {
      const c = this.nodeCol[i];
      return (Math.hypot(this.centerX(c) - tx, this.centerZ(c) - tz) + Math.abs(this.nodeH[i] - ty) * 0.5) * 1.4;
    };
    stamp[s] = stampId;
    g[s] = 0;
    from[s] = -1;
    heap.push(hOf(s), s);
    const adjStart = this.adjStart;
    const adj = this.adj;
    const adjCost = this.adjCost;
    while (heap.size) {
      const a = heap.pop();
      if (closed[a] === stampId) continue;
      closed[a] = stampId;
      if (a === t) {
        const out: number[] = [];
        for (let i = t; i >= 0; i = from[i]) out.push(i);
        return out.reverse();
      }
      const ga = g[a];
      for (let k = adjStart[a]; k < adjStart[a + 1]; k++) {
        const b = adj[k];
        if (closed[b] === stampId) continue;
        const cost = ga + adjCost[k];
        if (stamp[b] === stampId && cost >= g[b]) continue;
        stamp[b] = stampId;
        g[b] = cost;
        from[b] = a;
        heap.push(cost + hOf(b), b);
      }
    }
    return null;
  }

  /** ¿Se puede ir en línea recta de a a b? Muestrea cada 0,1 m llevando la altura de un paso al siguiente. */
  clear(a: NavPoint, b: NavPoint): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / 0.1));
    let h = a.y;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const i = this.nodeIn(this.colOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), h, NAV_STEP);
      if (i < 0 || this.comp[i] !== this.main) return false;
      h = this.nodeH[i];
    }
    return Math.abs(h - b.y) <= NAV_STEP;
  }

  /** Suavizado por línea de vista: desde cada ancla, el punto más lejano que se ve en recta. */
  private smooth(pts: NavPoint[]): NavPoint[] {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && this.clear(pts[i], pts[j + 1])) j++;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}
