import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeWav, encodeWav16 } from "@hermes/shared";

/**
 * WAV de las tomas y de la guía cantada: ida y vuelta exacta a 16 bits, y la
 * lectura de lo que puede llegar de afuera (24/32 bits, float, estéreo,
 * bloques extra). Datos sintéticos.
 */

const ascii = (b: Uint8Array, off: number, n: number): string => String.fromCharCode(...b.subarray(off, off + n));

/** Arma un WAV a mano: fmt con el formato pedido + bloques extra opcionales antes de los datos. */
function rawWav(opts: {
  format: number;
  channels: number;
  sr: number;
  bits: number;
  data: Uint8Array;
  extra?: { id: string; body: Uint8Array }[];
}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const chunk = (id: string, body: Uint8Array): void => {
    const pad = body.length & 1;
    const c = new Uint8Array(8 + body.length + pad);
    for (let i = 0; i < 4; i++) c[i] = id.charCodeAt(i);
    new DataView(c.buffer).setUint32(4, body.length, true);
    c.set(body, 8);
    chunks.push(c);
  };
  const fmt = new Uint8Array(16);
  const dv = new DataView(fmt.buffer);
  const blockAlign = (opts.bits / 8) * opts.channels;
  dv.setUint16(0, opts.format, true);
  dv.setUint16(2, opts.channels, true);
  dv.setUint32(4, opts.sr, true);
  dv.setUint32(8, opts.sr * blockAlign, true);
  dv.setUint16(12, blockAlign, true);
  dv.setUint16(14, opts.bits, true);
  chunk("fmt ", fmt);
  for (const e of opts.extra ?? []) chunk(e.id, e.body);
  chunk("data", opts.data);
  const bodyLen = 4 + chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(8 + bodyLen);
  out.set([82, 73, 70, 70], 0); // RIFF
  new DataView(out.buffer).setUint32(4, bodyLen, true);
  out.set([87, 65, 86, 69], 8); // WAVE
  let p = 12;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

describe("encodeWav16 / decodeWav", () => {
  it("ida y vuelta: misma frecuencia, mono y error ≤ 1 LSB", () => {
    const sr = 16000;
    const pcm = new Float32Array(1600);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / sr);
    const bytes = encodeWav16(pcm, sr);
    assert.equal(ascii(bytes, 0, 4), "RIFF");
    assert.equal(ascii(bytes, 8, 4), "WAVE");
    assert.equal(bytes.length, 44 + pcm.length * 2);
    const back = decodeWav(bytes);
    assert.equal(back.sr, sr);
    assert.equal(back.channels, 1);
    assert.equal(back.pcm.length, pcm.length);
    let maxErr = 0;
    for (let i = 0; i < pcm.length; i++) maxErr = Math.max(maxErr, Math.abs(back.pcm[i] - pcm[i]));
    assert.ok(maxErr <= 1 / 32767 + 1e-6, `error ${maxErr}`);
  });

  it("recorta lo que pasa de ±1 en vez de dar la vuelta", () => {
    const back = decodeWav(encodeWav16(Float32Array.from([1.5, -1.5, 1, -1]), 8000));
    assert.ok(back.pcm[0] > 0.999);
    assert.equal(back.pcm[1], -1);
    assert.ok(back.pcm[2] > 0.999);
    assert.equal(back.pcm[3], -1);
  });

  it("lee 24 bits estéreo y lo mezcla a mono", () => {
    // Cuadro 0: L = +0,5, R = −0,5 → 0. Cuadro 1: L = R = 0,25 → 0,25.
    const data = new Uint8Array(12);
    const put24 = (off: number, v: number): void => {
      const n = Math.round(v * 8388608) & 0xffffff;
      data[off] = n & 0xff;
      data[off + 1] = (n >> 8) & 0xff;
      data[off + 2] = (n >> 16) & 0xff;
    };
    put24(0, 0.5);
    put24(3, -0.5);
    put24(6, 0.25);
    put24(9, 0.25);
    const back = decodeWav(rawWav({ format: 1, channels: 2, sr: 48000, bits: 24, data }));
    assert.equal(back.sr, 48000);
    assert.equal(back.channels, 2);
    assert.equal(back.pcm.length, 2);
    assert.ok(Math.abs(back.pcm[0]) < 1e-6);
    assert.ok(Math.abs(back.pcm[1] - 0.25) < 1e-6);
  });

  it("lee float32 y PCM de 32 bits, saltando bloques extra de tamaño impar", () => {
    const f = new Float32Array([0.1, -0.7, 0.3]);
    const back = decodeWav(
      rawWav({
        format: 3,
        channels: 1,
        sr: 44100,
        bits: 32,
        data: new Uint8Array(f.buffer),
        extra: [{ id: "LIST", body: new Uint8Array(5) }],
      }),
    );
    assert.deepEqual(Array.from(back.pcm), Array.from(f));

    const i32 = new Int32Array([1 << 30, -(1 << 30)]);
    const b32 = decodeWav(rawWav({ format: 1, channels: 1, sr: 44100, bits: 32, data: new Uint8Array(i32.buffer) }));
    assert.ok(Math.abs(b32.pcm[0] - 0.5) < 1e-6);
    assert.ok(Math.abs(b32.pcm[1] + 0.5) < 1e-6);
  });

  it("respeta el offset de un Buffer de Node (vista sobre un pool compartido)", () => {
    const wav = encodeWav16(Float32Array.from([0.5, -0.25]), 16000);
    const pooled = Buffer.concat([Buffer.alloc(7), Buffer.from(wav)]).subarray(7);
    assert.ok(pooled.byteOffset > 0 || pooled.buffer.byteLength > pooled.byteLength);
    const back = decodeWav(pooled);
    assert.ok(Math.abs(back.pcm[0] - 0.5) < 1e-4);
    assert.ok(Math.abs(back.pcm[1] + 0.25) < 1e-4);
  });

  it("un WAV cortado al grabar (declara más datos de los que trae) se lee hasta donde llega", () => {
    const wav = encodeWav16(new Float32Array(100).fill(0.2), 16000).subarray(0, 44 + 50 * 2);
    const back = decodeWav(wav);
    assert.equal(back.pcm.length, 50);
  });

  it("lanza si no es RIFF/WAVE o si el formato no se soporta", () => {
    assert.throws(() => decodeWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), /RIFF/);
    assert.throws(() => decodeWav(new Uint8Array(4)), /RIFF/);
    const alaw = rawWav({ format: 6, channels: 1, sr: 8000, bits: 8, data: new Uint8Array(4) });
    assert.throws(() => decodeWav(alaw), /no soportado/);
  });
});
