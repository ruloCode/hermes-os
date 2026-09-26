/**
 * WAV mínimo (PCM 16 bits) sin dependencias: el browser sube las tomas en WAV
 * (no webm: el webm de MediaRecorder sale sin duración y comprimido; una toma
 * de fonemas es corta y la queremos intacta), y el agente escribe la guía
 * cantada en WAV. Lógica pura, sirve en ambos lados.
 *
 * Sin TextDecoder ni Buffer a propósito: el agente compila este archivo con
 * `lib: ES2022` (sin DOM) y la web sin tipos de Node.
 */

const HEADER_BYTES = 44;

/** Float32 mono (−1..1) → WAV PCM 16 bits mono. */
export function encodeWav16(pcm: Float32Array, sr: number): Uint8Array {
  if (!Number.isFinite(sr) || sr <= 0) throw new Error("encodeWav16: frecuencia de muestreo inválida");
  const rate = Math.round(sr);
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  const dv = new DataView(out.buffer);
  writeAscii(out, 0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  writeAscii(out, 8, "WAVE");
  writeAscii(out, 12, "fmt ");
  dv.setUint32(16, 16, true); // tamaño del bloque fmt (PCM)
  dv.setUint16(20, 1, true); // PCM entero
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true); // bytes por segundo
  dv.setUint16(32, 2, true); // bytes por cuadro
  dv.setUint16(34, 16, true);
  writeAscii(out, 36, "data");
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) {
    // Recorte duro: un pico de 1,02 no debe dar la vuelta a −32768.
    const x = Math.max(-1, Math.min(1, Number.isFinite(pcm[i]) ? pcm[i] : 0));
    dv.setInt16(HEADER_BYTES + i * 2, Math.round(x < 0 ? x * 32768 : x * 32767), true);
  }
  return out;
}

/** WAV PCM 16/24/32 bits o float32 → mono float32 (mezcla de canales). Lanza si no es RIFF/WAVE. */
export function decodeWav(bytes: Uint8Array): { sr: number; channels: number; pcm: Float32Array } {
  // Un Buffer de Node puede ser una vista sobre un pool compartido: se respeta su offset.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE")
    throw new Error("No es un WAV (falta la cabecera RIFF/WAVE)");

  let fmt: { format: number; channels: number; sr: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  let p = 12;
  while (p + 8 <= bytes.byteLength) {
    const id = readAscii(bytes, p, 4);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength) throw new Error("WAV con bloque fmt incompleto");
      let format = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sr = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: el formato real son los 2 primeros bytes del GUID.
      if (format === 0xfffe && size >= 26 && body + 26 <= bytes.byteLength) format = dv.getUint16(body + 24, true);
      fmt = { format, channels, sr, bits };
    } else if (id === "data") {
      dataOff = body;
      // Un WAV que se cortó al grabar (o escrito en streaming) declara más de lo que trae.
      dataLen = Math.min(size, bytes.byteLength - body);
      if (fmt) break;
    }
    // Los bloques se rellenan a tamaño par.
    p = body + size + (size & 1);
  }
  if (!fmt) throw new Error("WAV sin bloque fmt");
  if (dataOff < 0) throw new Error("WAV sin bloque de datos");
  const { format, channels, sr, bits } = fmt;
  if (channels < 1) throw new Error("WAV sin canales");
  if (sr <= 0) throw new Error("WAV con frecuencia de muestreo inválida");

  const bps = bits / 8;
  let read: (off: number) => number;
  // 16 bits con la MISMA escala asimétrica del codificador (−32768..32767): la
  // ida y vuelta de una toma queda a ½ LSB, no corrida 1/32768 en los positivos.
  if (format === 1 && bits === 16)
    read = (o) => {
      const v = dv.getInt16(o, true);
      return v < 0 ? v / 32768 : v / 32767;
    };
  else if (format === 1 && bits === 24)
    read = (o) => {
      const v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16);
      return v / 8388608;
    };
  else if (format === 1 && bits === 32) read = (o) => dv.getInt32(o, true) / 2147483648;
  else if (format === 1 && bits === 8) read = (o) => (dv.getUint8(o) - 128) / 128;
  else if (format === 3 && bits === 32) read = (o) => dv.getFloat32(o, true);
  else if (format === 3 && bits === 64) read = (o) => dv.getFloat64(o, true);
  else throw new Error(`WAV no soportado (formato ${format}, ${bits} bits)`);

  const frameBytes = bps * channels;
  const frames = Math.floor(dataLen / frameBytes);
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const base = dataOff + i * frameBytes;
    let s = 0;
    for (let c = 0; c < channels; c++) s += read(base + c * bps);
    pcm[i] = s / channels;
  }
  return { sr, channels, pcm };
}

function writeAscii(out: Uint8Array, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
}

function readAscii(b: Uint8Array, off: number, n: number): string {
  let s = "";
  for (let i = 0; i < n && off + i < b.byteLength; i++) s += String.fromCharCode(b[off + i]);
  return s;
}
