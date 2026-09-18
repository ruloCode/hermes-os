import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeQr, qrSvg, type QrCode, type QrEcc } from "@hermes/shared";

/**
 * QR del "sigue en tu celular". Como el generador es nuestro, lo que se prueba
 * no es la pinta de la matriz (un snapshot no diría nada el día que falle)
 * sino que un LECTOR pueda sacar de vuelta el texto: aquí abajo hay un
 * decodificador mínimo —quitar la máscara, des-intercalar los bloques y leer
 * los bytes— que hace el viaje de ida y vuelta.
 *
 * La otra mitad de la verificación no cabe en `node --test` y quedó
 * documentada: las mismas matrices se decodifican con OpenCV
 * (docs/estacion-metro.md), que es un lector de verdad y no comparte código
 * con el generador.
 */

// ── Decodificador mínimo (solo para el test) ────────────────────────────

const ALIGN_POS: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ECC_TABLE: Record<QrEcc, [number, number, number][]> = {
  L: [[0,0,0],[7,1,0],[10,1,0],[15,1,0],[20,1,0],[26,1,0],[18,2,0],[20,2,0],[24,2,0],[30,2,0],[18,2,2]],
  M: [[0,0,0],[10,1,0],[16,1,0],[26,1,0],[18,2,0],[24,2,0],[16,4,0],[18,4,0],[22,2,2],[22,3,2],[26,4,1]],
  Q: [[0,0,0],[13,1,0],[22,1,0],[18,2,0],[26,2,0],[18,2,2],[24,4,0],[18,2,4],[22,4,2],[20,4,4],[24,6,2]],
  H: [[0,0,0],[17,1,0],[28,1,0],[22,2,0],[16,4,0],[22,2,2],[28,4,0],[26,4,1],[26,4,2],[24,4,4],[28,6,2]],
};

/** Mapa de módulos reservados (patrones fijos), igual que al construir. */
function reservedMap(version: number, size: number): boolean[][] {
  const r: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const block = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (y >= 0 && x >= 0 && y < size && x < size) r[y][x] = true;
  };
  block(0, 0, 9, 9);
  block(size - 8, 0, 8, 9);
  block(0, size - 8, 9, 8);
  for (let i = 0; i < size; i++) {
    r[6][i] = true;
    r[i][6] = true;
  }
  const aligns = ALIGN_POS[version];
  for (const cy of aligns) {
    for (const cx of aligns) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      block(cx - 2, cy - 2, 5, 5);
    }
  }
  if (version >= 7) {
    block(size - 11, 0, 3, 6);
    block(0, size - 11, 6, 3);
  }
  return r;
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Lee la información de formato de la copia 1 (posiciones (x,y) de la norma). */
function readFormat(code: QrCode): { ecc: QrEcc; mask: number } | null {
  const at = (x: number, y: number) => (code.matrix[y][x] ? 1 : 0);
  let bits = 0;
  const put = (i: number, v: number) => (bits |= v << i);
  for (let i = 0; i <= 5; i++) put(i, at(8, i));
  put(6, at(8, 7));
  put(7, at(8, 8));
  put(8, at(7, 8));
  for (let i = 9; i < 15; i++) put(i, at(14 - i, 8));
  const eccBits: Record<QrEcc, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
  const expect = (ecc: QrEcc, mask: number) => {
    const data = (eccBits[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  };
  for (const ecc of ["L", "M", "Q", "H"] as QrEcc[]) {
    for (let mask = 0; mask < 8; mask++) if (expect(ecc, mask) === bits) return { ecc, mask };
  }
  return null;
}

/** Matriz → texto (sin corrección de errores: aquí no hay ruido). */
function decodeQr(code: QrCode): string {
  const { size, version } = code;
  const fmt = readFormat(code);
  assert.ok(fmt, "la información de formato debe ser válida");
  const reserved = reservedMap(version, size);

  // 1. Bits en zigzag, quitando la máscara.
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        if (reserved[y][x]) continue;
        const dark = code.matrix[y][x] !== maskBit(fmt.mask, x, y);
        bits.push(dark ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }

  // 2. Des-intercalar los bloques de datos.
  const [ecPerBlock, g1, g2] = ECC_TABLE[fmt.ecc][version];
  const numBlocks = g1 + g2;
  const dataTotal = TOTAL_CODEWORDS[version] - ecPerBlock * numBlocks;
  const short = Math.floor(dataTotal / numBlocks);
  const lengths = Array.from({ length: numBlocks }, (_, i) => (i < g1 ? short : short + 1));
  const blocks: number[][] = lengths.map(() => []);
  let idx = 0;
  for (let i = 0; i < Math.max(...lengths); i++) {
    for (let b = 0; b < numBlocks; b++) if (i < lengths[b]) blocks[b].push(codewords[idx++]);
  }
  const data = blocks.flat();

  // 3. Cabecera byte-mode + bytes.
  const mode = data[0] >> 4;
  assert.equal(mode, 0b0100, "modo byte");
  const countBits = version < 10 ? 8 : 16;
  let bitPos = 4;
  const readBits = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = data[(bitPos + i) >> 3];
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += n;
    return v;
  };
  const len = readBits(countBits);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = readBits(8);
  return new TextDecoder().decode(bytes);
}

// ── Contratos ───────────────────────────────────────────────────────────

const CASES: { text: string; ecc: QrEcc }[] = [
  { text: "http://192.168.0.171:31415/m/abc23xyz", ecc: "M" },
  { text: "hola", ecc: "L" },
  { text: "Estación Parque Berrío · sigue en tu celular", ecc: "Q" },
  { text: "https://ejemplo.local/m/" + "z".repeat(60), ecc: "H" },
  { text: "áéíóú ñ ü ¿? ·", ecc: "M" },
];

describe("encodeQr", () => {
  it("un lector saca de vuelta el texto exacto, con acentos y en los cuatro niveles", () => {
    for (const c of CASES) {
      const code = encodeQr(c.text, { ecc: c.ecc });
      assert.equal(decodeQr(code), c.text, `round-trip de ${JSON.stringify(c.text.slice(0, 24))} (${c.ecc})`);
      assert.equal(code.ecc, c.ecc);
      assert.equal(readFormat(code)?.ecc, c.ecc, "el formato declara el nivel real");
      assert.equal(readFormat(code)?.mask, code.mask, "el formato declara la máscara aplicada");
    }
  });

  it("elige la versión más chica que aguanta el texto", () => {
    assert.equal(encodeQr("hola", { ecc: "L" }).version, 1);
    assert.equal(encodeQr("hola", { ecc: "L" }).size, 21);
    // Más corrección = menos datos por versión: el mismo texto sube de versión.
    const l = encodeQr("x".repeat(100), { ecc: "L" }).version;
    const h = encodeQr("x".repeat(100), { ecc: "H" }).version;
    assert.ok(h > l, `H (${h}) debe necesitar más versión que L (${l})`);
  });

  it("los patrones fijos están donde manda la norma", () => {
    const code = encodeQr("https://ejemplo.local/m/abc23xyz", { ecc: "M" });
    const m = code.matrix;
    const n = code.size;
    for (const [ox, oy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      assert.equal(m[oy][ox], true, "esquina del patrón de posición");
      assert.equal(m[oy + 1][ox + 1], false, "anillo claro");
      assert.equal(m[oy + 3][ox + 3], true, "centro oscuro");
    }
    // Patrón de tiempo: alterna desde la fila/columna 6.
    for (let i = 8; i < n - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, `tiempo horizontal en ${i}`);
      assert.equal(m[i][6], i % 2 === 0, `tiempo vertical en ${i}`);
    }
    assert.equal(m[n - 8][8], true, "módulo oscuro fijo");
  });

  it("todas las máscaras producen un código legible (la elegida es solo la menos penalizada)", () => {
    const text = "http://192.168.0.171:31415/m/abc23xyz";
    for (let mask = 0; mask < 8; mask++) {
      const code = encodeQr(text, { ecc: "M", mask });
      assert.equal(code.mask, mask);
      assert.equal(decodeQr(code), text, `máscara ${mask}`);
    }
  });

  it("lo que no cabe se rechaza en vez de emitir un código a medias", () => {
    assert.throws(() => encodeQr("x".repeat(400), { ecc: "H" }), /no cabe/);
    assert.throws(() => encodeQr("x".repeat(200), { ecc: "M", version: 2 }), /no cabe/);
  });

  it("qrSvg entrega un path y un viewBox con la zona de silencio", () => {
    const { path, viewBox, size } = qrSvg("hola", { ecc: "L" });
    assert.equal(viewBox, "0 0 29 29", "21 módulos + 4 de silencio por lado");
    assert.equal(size, 29);
    assert.ok(path.startsWith("M"), "es un path SVG");
    // Los módulos vienen desplazados por la zona de silencio: nada en 0..3.
    assert.equal(/M[0-3] /.test(path), false);
  });
});
