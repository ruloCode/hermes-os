// La pizarra libre de la Oficina: un PNG que se dibuja desde cualquier
// navegador y se guarda en el agente (~/.hermes-os/oficina/pizarra.png), así
// todos los que abren la oficina ven el mismo dibujo. Sin historial: la
// última versión manda, como una pizarra de verdad.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const WHITEBOARD_PATH = process.env.HERMES_WHITEBOARD_PATH || join(homedir(), ".hermes-os", "oficina", "pizarra.png");
/** Tope del PNG: una pizarra de 1600×1000 con trazos pesa ~200 KB. */
export const WHITEBOARD_MAX_BYTES = 3 * 1024 * 1024;

const PREFIX = "data:image/png;base64,";

export async function readWhiteboard(): Promise<{ image: string | null; updatedAt: string | null }> {
  try {
    const [buf, st] = await Promise.all([readFile(WHITEBOARD_PATH), stat(WHITEBOARD_PATH)]);
    return { image: PREFIX + buf.toString("base64"), updatedAt: st.mtime.toISOString() };
  } catch {
    return { image: null, updatedAt: null };
  }
}

/** Guarda la pizarra (data URL PNG). Null o vacío la borra (PNG de 0 bytes = pizarra limpia). */
export async function writeWhiteboard(image: string | null): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  let buf = Buffer.alloc(0);
  if (image) {
    if (!image.startsWith(PREFIX)) return { ok: false, error: "se espera un PNG en data URL" };
    buf = Buffer.from(image.slice(PREFIX.length), "base64");
    // Firma PNG: 89 50 4E 47.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return { ok: false, error: "no es un PNG" };
    if (buf.length > WHITEBOARD_MAX_BYTES) return { ok: false, error: "la pizarra pesa demasiado" };
  }
  await mkdir(dirname(WHITEBOARD_PATH), { recursive: true });
  await writeFile(WHITEBOARD_PATH, buf);
  return { ok: true, updatedAt: new Date().toISOString() };
}
