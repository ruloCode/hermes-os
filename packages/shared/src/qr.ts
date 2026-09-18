/**
 * Códigos QR sin dependencias. El tótem muestra un QR para seguir la
 * conversación en el celular, y meter una librería de QR al dashboard por una
 * pantalla sería pagar peso (y una dependencia más que auditar) por algo que
 * son doscientas líneas de aritmética conocida.
 *
 * Alcance deliberado: modo BYTE (UTF-8), versiones 1-10, los cuatro niveles de
 * corrección, máscara elegida por penalización como manda la norma. Con eso
 * caben hasta ~270 caracteres, y una URL de handoff son ~45. Si el texto no
 * cabe, se lanza — nunca se emite un QR "a medias" que no escanee.
 *
 * Implementa ISO/IEC 18004 en lo que usa: bloques Reed-Solomon sobre GF(256),
 * patrones de posición/alineación/tiempo, información de formato y versión.
 * La salida es una matriz de booleanos (true = módulo oscuro); pintar es
 * cosa de quien llame (`qrSvgPath` da un path listo para un <svg>).
 */

export type QrEcc = "L" | "M" | "Q" | "H";

export interface QrCode {
  /** Módulos por lado. */
  size: number;
  version: number;
  ecc: QrEcc;
  /** matrix[y][x] — true = oscuro. */
  matrix: boolean[][];
  mask: number;
}

// ── GF(256) ──────────────────────────────────────────────────────────────
// Campo de Galois del QR: polinomio 0x11D, generador 2.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Polinomio generador de grado `degree` para Reed-Solomon. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Bytes de corrección de un bloque de datos. */
function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const out = new Uint8Array(degree);
  for (const b of data) {
    const factor = b ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i++) out[i] ^= gfMul(gen[i + 1], factor);
  }
  return out;
}

// ── Tablas de la norma (versiones 1-10) ─────────────────────────────────
// Por versión: [códigos de EC por bloque, bloques grupo 1, bloques grupo 2]
// en el orden L, M, Q, H. Los datos por bloque se derivan del total.

const ECC_ORDER: QrEcc[] = ["L", "M", "Q", "H"];

/** Total de codewords (datos + corrección) por versión. */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** [ecCodewordsPerBlock, numBlocksGroup1, numBlocksGroup2] por versión y nivel. */
const ECC_TABLE: Record<QrEcc, [number, number, number][]> = {
  L: [
    [0, 0, 0],
    [7, 1, 0],
    [10, 1, 0],
    [15, 1, 0],
    [20, 1, 0],
    [26, 1, 0],
    [18, 2, 0],
    [20, 2, 0],
    [24, 2, 0],
    [30, 2, 0],
    [18, 2, 2],
  ],
  M: [
    [0, 0, 0],
    [10, 1, 0],
    [16, 1, 0],
    [26, 1, 0],
    [18, 2, 0],
    [24, 2, 0],
    [16, 4, 0],
    [18, 4, 0],
    [22, 2, 2],
    [22, 3, 2],
    [26, 4, 1],
  ],
  Q: [
    [0, 0, 0],
    [13, 1, 0],
    [22, 1, 0],
    [18, 2, 0],
    [26, 2, 0],
    [18, 2, 2],
    [24, 4, 0],
    [18, 2, 4],
    [22, 4, 2],
    [20, 4, 4],
    [24, 6, 2],
  ],
  H: [
    [0, 0, 0],
    [17, 1, 0],
    [28, 1, 0],
    [22, 2, 0],
    [16, 4, 0],
    [22, 2, 2],
    [28, 4, 0],
    [26, 4, 1],
    [26, 4, 2],
    [24, 4, 4],
    [28, 6, 2],
  ],
};

/** Centros de los patrones de alineación por versión. */
const ALIGN_POS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function eccParams(version: number, ecc: QrEcc): { ecPerBlock: number; blocks: number[] } {
  const [ecPerBlock, g1, g2] = ECC_TABLE[ecc][version];
  const total = TOTAL_CODEWORDS[version];
  const numBlocks = g1 + g2;
  const dataTotal = total - ecPerBlock * numBlocks;
  // Los bloques del grupo 2 llevan un byte más que los del grupo 1.
  const short = Math.floor(dataTotal / numBlocks);
  const blocks: number[] = [];
  for (let i = 0; i < numBlocks; i++) blocks.push(i < g1 ? short : short + 1);
  const sum = blocks.reduce((a, b) => a + b, 0);
  if (sum !== dataTotal) throw new Error(`tabla QR inconsistente v${version}${ecc}: ${sum} ≠ ${dataTotal}`);
  return { ecPerBlock, blocks };
}

function dataCapacityBits(version: number, ecc: QrEcc): number {
  const { ecPerBlock, blocks } = eccParams(version, ecc);
  const numBlocks = blocks.length;
  return (TOTAL_CODEWORDS[version] - ecPerBlock * numBlocks) * 8;
}

// ── Bits ────────────────────────────────────────────────────────────────

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length(): number {
    return this.bits.length;
  }
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ── Construcción ────────────────────────────────────────────────────────

export interface QrOptions {
  ecc?: QrEcc;
  /** Fuerza una versión (1-10); por defecto la más chica que aguante el texto. */
  version?: number;
  /** Fuerza una máscara (0-7); por defecto la de menor penalización. */
  mask?: number;
}

export function encodeQr(text: string, opts: QrOptions = {}): QrCode {
  const ecc = opts.ecc ?? "M";
  const bytes = utf8Bytes(text);
  // Byte mode: 4 bits de modo + contador (8 bits en versiones 1-9, 16 en 10+).
  const version =
    opts.version ??
    (() => {
      for (let v = 1; v <= 10; v++) {
        const countBits = v < 10 ? 8 : 16;
        if (4 + countBits + bytes.length * 8 <= dataCapacityBits(v, ecc)) return v;
      }
      throw new Error(`el texto no cabe en un QR versión 10 con corrección ${ecc} (${bytes.length} bytes)`);
    })();
  const capacity = dataCapacityBits(version, ecc);
  const countBits = version < 10 ? 8 : 16;
  if (4 + countBits + bytes.length * 8 > capacity) {
    throw new Error(`el texto no cabe en la versión ${version} con corrección ${ecc}`);
  }

  // 1. Bits de datos: modo, longitud, bytes, terminador y relleno.
  const bb = new BitBuffer();
  bb.push(0b0100, 4);
  bb.push(bytes.length, countBits);
  for (const b of bytes) bb.push(b, 8);
  bb.push(0, Math.min(4, capacity - bb.length));
  while (bb.length % 8 !== 0) bb.push(0, 1);
  const padBytes = [0xec, 0x11];
  for (let i = 0; bb.length < capacity; i++) bb.push(padBytes[i % 2], 8);

  const dataCodewords = new Uint8Array(bb.length / 8);
  for (let i = 0; i < dataCodewords.length; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bb.bits[i * 8 + j];
    dataCodewords[i] = v;
  }

  // 2. Bloques + corrección, intercalados como manda la norma.
  const { ecPerBlock, blocks } = eccParams(version, ecc);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const len of blocks) {
    const block = dataCodewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, ecPerBlock));
  }
  const interleaved: number[] = [];
  const maxData = Math.max(...blocks);
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) interleaved.push(b[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of ecBlocks) interleaved.push(b[i]);

  // 3. Matriz: patrones fijos, datos en zigzag, máscara y formato.
  const size = version * 4 + 17;
  const matrix: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setFn = (x: number, y: number, dark: boolean) => {
    matrix[y][x] = dark;
    reserved[y][x] = true;
  };

  // Patrones de posición + separadores.
  const finder = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark = inRing && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setFn(x, y, dark);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  // Patrones de tiempo.
  for (let i = 8; i < size - 8; i++) {
    setFn(i, 6, i % 2 === 0);
    setFn(6, i, i % 2 === 0);
  }

  // Patrones de alineación (no pisan los de posición).
  const aligns = ALIGN_POS[version];
  for (const cy of aligns) {
    for (const cx of aligns) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Módulo oscuro fijo + reserva de la información de formato.
  setFn(8, size - 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[i][8]) reserved[i][8] = true;
    if (!reserved[8][i]) reserved[8][i] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  // Información de versión (7+): dos bloques de 3×6.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      setFn(size - 11 + b, a, dark);
      setFn(a, size - 11 + b, dark);
    }
  }

  // Datos en zigzag desde abajo a la derecha, saltando la columna 6.
  let bitIndex = 0;
  const totalBits = interleaved.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        if (reserved[y][x]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((interleaved[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
        matrix[y][x] = dark;
      }
    }
    upward = !upward;
  }

  // Máscara: la que menos penalización saca (o la pedida).
  const candidates = opts.mask !== undefined ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  let best = { mask: candidates[0], penalty: Infinity, matrix };
  for (const mask of candidates) {
    const m = matrix.map((row) => [...row]);
    applyMask(m, reserved, mask, size);
    drawFormat(m, ecc, mask, size);
    const p = penalty(m, size);
    if (p < best.penalty) best = { mask, penalty: p, matrix: m };
  }

  return { size, version, ecc, matrix: best.matrix, mask: best.mask };
}

function applyMask(m: boolean[][], reserved: boolean[][], mask: number, size: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (reserved[y][x]) continue;
      let invert = false;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) m[y][x] = !m[y][x];
    }
  }
}

const ECC_BITS: Record<QrEcc, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function drawFormat(m: boolean[][], ecc: QrEcc, mask: number, size: number): void {
  const bits = formatBits(ecc, mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  // OJO con el orden: la norma da estas posiciones como (columna, fila) y la
  // matriz aquí es [fila][columna]. Tenerlas cruzadas produce un QR que se ve
  // perfecto y que ningún lector acepta, porque el formato dice otra máscara.
  const set = (x: number, y: number, v: boolean) => {
    m[y][x] = v;
  };
  // Copia 1: la cruz del patrón superior izquierdo.
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  // Copia 2: partida entre las otras dos esquinas.
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // módulo oscuro fijo
}

/** Penalización de la norma: 4 reglas, menor es mejor. */
function penalty(m: boolean[][], size: number): number {
  let score = 0;
  // Regla 1: corridas de 5+ del mismo color.
  for (let y = 0; y < size; y++) {
    for (const line of [m[y], m.map((row) => row[y])]) {
      let run = 1;
      for (let i = 1; i < size; i++) {
        if (line[i] === line[i - 1]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }
  // Regla 2: bloques 2×2.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }
  // Regla 3: patrón 1:1:3:1:1 con cuatro claros a un lado.
  const pattern = [true, false, true, true, true, false, true];
  const hasAt = (line: boolean[], i: number, arr: boolean[]) => arr.every((v, k) => line[i + k] === v);
  const four = [false, false, false, false];
  for (let y = 0; y < size; y++) {
    for (const line of [m[y], m.map((row) => row[y])]) {
      for (let i = 0; i + 7 <= size; i++) {
        if (!hasAt(line, i, pattern)) continue;
        const before = i - 4 >= 0 && hasAt(line, i - 4, four);
        const after = i + 11 <= size && hasAt(line, i + 7, four);
        if (before || after) score += 40;
      }
    }
  }
  // Regla 4: desbalance de oscuros.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Path SVG de los módulos oscuros, en una caja de `size` unidades (sin margen:
 * el quiet zone de 4 módulos lo pone quien dibuja, con el viewBox).
 */
export function qrSvgPath(code: QrCode): string {
  const parts: string[] = [];
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.matrix[y][x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}

/** Texto → { path, viewBox } con la zona de silencio ya incluida. */
export function qrSvg(text: string, opts: QrOptions & { quietZone?: number } = {}): { path: string; viewBox: string; size: number } {
  const code = encodeQr(text, opts);
  const quiet = opts.quietZone ?? 4;
  const total = code.size + quiet * 2;
  const parts: string[] = [];
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.matrix[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }
  return { path: parts.join(""), viewBox: `0 0 ${total} ${total}`, size: total };
}
