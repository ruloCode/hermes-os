/**
 * Índice local de grabaciones que todavía no son una junta en el agente.
 *
 * Desde 2026-10-08 graba el módulo nativo `hermes-recorder` (foreground
 * service, AAC ADTS) directo a <documents>/recordings/. Al detener —desde la
 * app, desde la notificación o porque la app murió— deja la grabación en un
 * DIARIO nativo; `ingestNativeFinished()` la pasa a este índice y la confirma.
 * Ya no hay que mover nada al detener: el bug de 2026-10-08 (el rescate de
 * huérfanas movió el archivo de la junta EN CURSO y el stop falló con
 * NoSuchFileException) no tiene dónde volver a pasar, porque el archivo vivo
 * está en `recordings-live/`, carpeta que el JS no toca.
 *
 * `adoptOrphans()` queda para lo heredado: archivos que expo-audio dejó en
 * <cache>/Audio/ y archivos sueltos en recordings/ sin índice.
 *
 * El índice vive en AsyncStorage; el disco es la verdad (una entrada cuyo
 * archivo ya no existe se depura sola al listar).
 */
import { Directory, File, Paths } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FinishedRecording } from "../modules/hermes-recorder";

export interface PendingRecording {
  id: string;
  /** null = rescatada sin proyecto: se elige al subirla. */
  project: string | null;
  uri: string;
  filename: string;
  sizeBytes: number;
  durationSec: number | null;
  /** ISO de cuando EMPEZÓ la grabación (para huérfanas, la mtime del archivo). */
  createdAt: string;
  lastError: string | null;
  /**
   * Job de ingest que ya aceptó este audio. El HTTP 200 solo dice "job
   * aceptado", NO "reunión creada": el análisis puede fallar después. Mientras
   * haya jobId sin confirmar, el audio se queda en el teléfono.
   */
  jobId?: string;
  /** La app murió o el grabador falló: se guardó hasta ese momento. */
  interrupted?: boolean;
  /** El agente confirmó que tiene copia del audio (job viejo sin estado). */
  serverHasAudio?: boolean;
  /** El job es de antes de que el agente los guardara: no sabe cómo terminó. */
  jobUnknown?: boolean;
  /** El usuario pidió subirla (cuenta para el atraso viejo, que no se sube solo). */
  approved?: boolean;
}

const KEY = "hermes.pendingRecordings";

export function recordingsDir(): Directory {
  const dir = new Directory(Paths.document, "recordings");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Mime real según la extensión (el ADTS NO es un m4a). */
export function mimeOf(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "aac") return "audio/aac";
  if (ext === "webm") return "audio/webm";
  if (ext === "mp3") return "audio/mpeg";
  return "audio/mp4";
}

// Escrituras serializadas: el motor de subida, el diario nativo y la UI
// tocan el índice a la vez; leer-modificar-escribir en paralelo perdía cambios.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function readIndex(): Promise<PendingRecording[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingRecording[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: PendingRecording[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sin storage el disco sigue siendo la verdad: adoptOrphans lo re-indexa */
  }
}

const alive = (e: PendingRecording) => {
  try {
    return new File(e.uri).exists;
  } catch {
    return false;
  }
};

/** Grabaciones vivas, la más nueva primero (depura las que ya no están en disco). */
export function listPending(): Promise<PendingRecording[]> {
  return locked(async () => {
    const idx = await readIndex();
    const live = idx.filter(alive);
    if (live.length !== idx.length) await writeIndex(live);
    return live.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  });
}

/** Cambia campos de una entrada. */
export function patchPending(id: string, patch: Partial<PendingRecording>): Promise<void> {
  return locked(async () => {
    const idx = await readIndex();
    await writeIndex(idx.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  });
}

/** Saca la entrada del índice y borra el audio (junta confirmada o descarte). */
export function removePending(id: string): Promise<void> {
  return locked(async () => {
    const idx = await readIndex();
    const entry = idx.find((e) => e.id === id);
    if (entry) {
      try {
        const f = new File(entry.uri);
        if (f.exists) f.delete();
      } catch {
        /* el índice se depura igual; listPending ignora archivos muertos */
      }
    }
    await writeIndex(idx.filter((e) => e.id !== id));
  });
}

/**
 * Pasa las grabaciones terminadas del diario nativo al índice. Idempotente
 * (por id y por nombre de archivo): devuelve los ids a confirmar con `ack`.
 */
export function ingestNativeFinished(list: FinishedRecording[]): Promise<string[]> {
  return locked(async () => {
    if (!list.length) return [];
    const idx = await readIndex();
    const out = [...idx];
    for (const f of list) {
      const entry: PendingRecording = {
        id: f.id,
        // "sin-proyecto" = se grabó sin elegir (sin señal): se pide al subir.
        project: f.project && f.project !== "sin-proyecto" ? f.project : null,
        uri: f.uri,
        filename: f.filename,
        sizeBytes: f.sizeBytes,
        durationSec: Math.max(1, Math.round(f.durationMs / 1000)),
        createdAt: new Date(f.startedAt).toISOString(),
        lastError: f.reason === "interrupted" || f.reason === "error" ? (f.error ?? null) : null,
        interrupted: f.reason === "interrupted" || f.reason === "error",
      };
      const at = out.findIndex((e) => e.id === f.id || e.filename === f.filename);
      if (at >= 0) out[at] = { ...out[at], ...entry, jobId: out[at].jobId };
      else out.unshift(entry);
    }
    await writeIndex(out);
    return list.map((f) => f.id);
  });
}

/**
 * Rescata lo heredado: grabaciones que expo-audio dejó en <cache>/Audio/ (las
 * versiones anteriores grababan ahí) y archivos sueltos en recordings/ sin
 * índice (reinstalación, storage corrupto). Devuelve cuántas adoptó.
 */
export function adoptOrphans(): Promise<number> {
  return locked(async () => {
    const dir = recordingsDir();
    const idx = await readIndex();
    const known = new Set(idx.map((e) => e.filename));
    const adopted: PendingRecording[] = [];

    // `known` se va llenando: el primer loop mueve huérfanas A `dir`, así que el
    // segundo (que lista `dir`) las volvería a ver.
    const adopt = (file: File, project: string | null) => {
      if (known.has(file.name)) return;
      known.add(file.name);
      const info = file.info();
      const when = info.modificationTime ?? info.creationTime ?? Date.now();
      adopted.push({
        id: file.name,
        project,
        uri: file.uri,
        filename: file.name,
        sizeBytes: file.size,
        durationSec: null,
        createdAt: new Date(when).toISOString(),
        lastError: null,
        interrupted: true,
      });
    };

    try {
      const cacheAudio = new Directory(Paths.cache, "Audio");
      if (cacheAudio.exists) {
        for (const item of cacheAudio.list()) {
          if (!(item instanceof File)) continue;
          if (!item.name.startsWith("recording-")) continue;
          // <100 KB ≈ menos de ~6s de audio: ruido de pruebas, no una junta.
          if (item.size < 100 * 1024) continue;
          const dest = new File(dir, item.name);
          if (dest.exists) continue;
          item.move(dest);
          adopt(dest, null);
        }
      }
      for (const item of dir.list()) {
        if (!(item instanceof File) || known.has(item.name)) continue;
        const found =
          /^reunion-(.+)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d+)?\./.exec(item.name)?.[1] ?? null;
        const slug = found === "sin-proyecto" ? null : found;
        adopt(item, slug);
      }
    } catch {
      /* un dir ilegible no debe tumbar la pantalla de reuniones */
    }

    if (adopted.length) await writeIndex([...adopted, ...idx]);
    return adopted.length;
  });
}
