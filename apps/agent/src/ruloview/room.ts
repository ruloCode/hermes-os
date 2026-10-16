/**
 * El cuarto de RuloView vive en ~/.hermes-os/ruloview/room/: room.json (lo
 * escribe el humano o la página al mover un nodo) y room.glb (el escaneo del
 * celular). Carpeta APARTE a propósito: es la única que se monta en el
 * contenedor de RuView (el Observatorio del fork lee el mismo cuarto), y
 * ~/.hermes-os/ruloview/ también guarda provision/ (con la clave WiFi) y
 * backups/ de flash, que no tienen por qué servirse por HTTP.
 *
 * Sin archivo se sirve un cuarto vacío de 4×4 m y la página lo dice: nada de
 * la distribución de un cuarto real va en el código.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseRoom, RU_EMPTY_ROOM, type RuRoom } from "@hermes/shared";

export const ROOM_DIR = process.env.RULOVIEW_ROOM_DIR || join(homedir(), ".hermes-os/ruloview/room");
export const ROOM_PATH = join(ROOM_DIR, "room.json");
export const SCAN_PATH = join(ROOM_DIR, "room.glb");
/** Un escaneo de cuarto con textura pesa 10-80 MB; 200 MB deja margen sin abrir la puerta a cualquier cosa. */
export const SCAN_MAX_BYTES = 200 * 1024 * 1024;

// Antes el cuarto vivía en ~/.hermes-os/ruloview/room.json: se mueve una vez.
const LEGACY_PATH = join(homedir(), ".hermes-os/ruloview/room.json");
function migrate() {
  if (process.env.RULOVIEW_ROOM_DIR || existsSync(ROOM_PATH) || !existsSync(LEGACY_PATH)) return;
  mkdirSync(ROOM_DIR, { recursive: true });
  renameSync(LEGACY_PATH, ROOM_PATH);
}

export function readRoom(): { room: RuRoom; fromFile: boolean; scanBytes: number | null; error?: string } {
  migrate();
  const scanBytes = existsSync(SCAN_PATH) ? statSync(SCAN_PATH).size : null;
  if (!existsSync(ROOM_PATH)) return { room: RU_EMPTY_ROOM, fromFile: false, scanBytes };
  try {
    const parsed = parseRoom(JSON.parse(readFileSync(ROOM_PATH, "utf8")));
    if (!parsed.ok) return { room: RU_EMPTY_ROOM, fromFile: false, scanBytes, error: `${ROOM_PATH}: ${parsed.error}` };
    // un room.json que apunta a un escaneo borrado no puede prometerlo
    const room = parsed.room.scan && scanBytes == null ? { ...parsed.room, scan: undefined } : parsed.room;
    return { room, fromFile: true, scanBytes };
  } catch (err) {
    return { room: RU_EMPTY_ROOM, fromFile: false, scanBytes, error: `${ROOM_PATH}: ${err instanceof Error ? err.message : err}` };
  }
}

/** Escritura atómica (tmp + rename): el Observatorio puede estar leyendo el archivo. */
function atomicWrite(path: string, data: string | Uint8Array) {
  mkdirSync(ROOM_DIR, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function writeRoom(raw: unknown): { ok: true; room: RuRoom } | { ok: false; error: string } {
  const parsed = parseRoom(raw);
  if (!parsed.ok) return parsed;
  atomicWrite(ROOM_PATH, `${JSON.stringify(parsed.room, null, 2)}\n`);
  return parsed;
}

/** Valida que sea un GLB 2.0 (cabecera "glTF", versión 2, largo coherente) y lo guarda. */
export function writeScan(buf: Uint8Array): { ok: true; bytes: number } | { ok: false; error: string } {
  if (buf.byteLength > SCAN_MAX_BYTES) return { ok: false, error: `el escaneo pesa ${(buf.byteLength / 1e6).toFixed(0)} MB (tope ${SCAN_MAX_BYTES / 1e6} MB)` };
  if (buf.byteLength < 20) return { ok: false, error: "archivo vacío" };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== "glTF") return { ok: false, error: "no es un .glb (exporta el escaneo como GLB, no OBJ/USDZ)" };
  const version = view.getUint32(4, true);
  if (version !== 2) return { ok: false, error: `GLB versión ${version}: se necesita glTF 2.0` };
  if (view.getUint32(8, true) !== buf.byteLength) return { ok: false, error: "el GLB llegó incompleto" };
  atomicWrite(SCAN_PATH, buf);
  return { ok: true, bytes: buf.byteLength };
}

export function deleteScan(): { ok: true } {
  if (existsSync(SCAN_PATH)) unlinkSync(SCAN_PATH);
  const { room, fromFile } = readRoom();
  if (fromFile && room.scan) writeRoom({ ...room, scan: undefined });
  return { ok: true };
}
