import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HERMES_HOME } from "../home.js";
import type { PhoneDeviceInfo } from "./protocol.js";

/**
 * Registro de teléfonos que alguna vez se conectaron (~/.hermes-os/phone/
 * devices.json). Es diminuto a propósito: id estable, modelo, versión de
 * Android y cuándo se vio por primera y última vez. `first_seen` alimenta el
 * `welcome` (el teléfono sabe desde cuándo lo conoce Hermes).
 *
 * Los helpers de lista son puros (testeables); solo load/save tocan disco.
 */

export interface PhoneDeviceRecord {
  id: string;
  model: string;
  android: string;
  first_seen: string;
  last_seen: string;
}

export const DEVICES_PATH = join(HERMES_HOME, "phone", "devices.json");

/** Inserta o refresca un dispositivo. `first_seen` NUNCA se pisa. */
export function upsertDevice(
  devices: readonly PhoneDeviceRecord[],
  device: Pick<PhoneDeviceInfo, "id" | "model" | "android">,
  nowIso: string,
): { devices: PhoneDeviceRecord[]; record: PhoneDeviceRecord } {
  const prev = devices.find((d) => d.id === device.id);
  const record: PhoneDeviceRecord = {
    id: device.id,
    model: device.model || prev?.model || "",
    android: device.android || prev?.android || "",
    first_seen: prev?.first_seen ?? nowIso,
    last_seen: nowIso,
  };
  return { devices: [...devices.filter((d) => d.id !== device.id), record], record };
}

/** Marca la última vez que se vio un dispositivo (desconocido = sin cambios). */
export function touchDevice(
  devices: readonly PhoneDeviceRecord[],
  id: string,
  nowIso: string,
): PhoneDeviceRecord[] {
  return devices.map((d) => (d.id === id ? { ...d, last_seen: nowIso } : d));
}

/** El visto más recientemente (para /phone/status cuando no hay conexión). */
export function lastSeenDevice(devices: readonly PhoneDeviceRecord[]): PhoneDeviceRecord | null {
  let best: PhoneDeviceRecord | null = null;
  for (const d of devices) if (!best || d.last_seen > best.last_seen) best = d;
  return best;
}

/** Valida lo leído del disco: una fila rota se descarta, no tumba el registro. */
export function parseDevices(raw: unknown): PhoneDeviceRecord[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { devices?: unknown })?.devices) ? (raw as { devices: unknown[] }).devices : [];
  const out: PhoneDeviceRecord[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (typeof x.id !== "string" || !x.id || typeof x.first_seen !== "string") continue;
    out.push({
      id: x.id,
      model: typeof x.model === "string" ? x.model : "",
      android: typeof x.android === "string" ? x.android : "",
      first_seen: x.first_seen,
      last_seen: typeof x.last_seen === "string" ? x.last_seen : x.first_seen,
    });
  }
  return out;
}

export interface DeviceStore {
  load(): Promise<PhoneDeviceRecord[]>;
  save(devices: PhoneDeviceRecord[]): Promise<void>;
}

/** Store en disco (escritura atómica: tmp + rename). */
export function fileDeviceStore(path = DEVICES_PATH): DeviceStore {
  return {
    async load() {
      try {
        return parseDevices(JSON.parse(await readFile(path, "utf8")));
      } catch {
        return [];
      }
    },
    async save(devices) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ devices }, null, 2) + "\n");
      await rename(tmp, path);
    },
  };
}

/** ¿El dueño tiene un teléfono configurado? (el system prompt decide con esto). */
export async function hasKnownPhone(store: DeviceStore = fileDeviceStore()): Promise<boolean> {
  return (await store.load()).length > 0;
}
