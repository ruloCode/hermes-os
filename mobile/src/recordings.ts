/**
 * Grabaciones persistentes: ninguna junta se pierde por un fallo de red.
 *
 * expo-audio graba en <cache>/Audio/recording-<uuid>.m4a (Android hardcodea esa
 * ruta en 55.0.15). Al detener, movemos el archivo a <documents>/recordings/
 * ANTES de intentar subirlo: si la subida falla, queda como "pendiente" con
 * reintento manual desde la UI. adoptOrphans() rescata además lo que quedó en
 * el cache de expo-audio (app cerrada a mitad de junta, o versiones viejas de
 * la app que descartaban el URI cuando fallaba la red — así se recupera una
 * junta grabada antes de esta actualización).
 *
 * El índice de pendientes vive en AsyncStorage; el disco es la verdad (una
 * entrada cuyo archivo ya no existe se depura sola al listar).
 */
import { Directory, File, Paths } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface PendingRecording {
  id: string;
  /** null = huérfana rescatada del cache: el proyecto se elige al subirla. */
  project: string | null;
  uri: string;
  filename: string;
  sizeBytes: number;
  durationSec: number | null;
  /** ISO. Para huérfanas, la fecha de modificación del archivo. */
  createdAt: string;
  lastError: string | null;
  /**
   * Job de ingest que ya aceptó este audio. El HTTP 200 solo dice "job
   * aceptado", NO "reunión creada": el análisis puede fallar después. Mientras
   * haya jobId sin confirmar, el audio se queda en el teléfono.
   */
  jobId?: string;
}

const KEY = "hermes.pendingRecordings";

function recordingsDir(): Directory {
  const dir = new Directory(Paths.document, "recordings");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
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

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[:T]/g, "-");

/**
 * Mueve la grabación recién detenida a almacenamiento durable y la registra
 * como pendiente. Se llama ANTES de subir: el archivo ya está a salvo pase lo
 * que pase con la red.
 */
export async function stashRecording(input: {
  uri: string;
  project: string;
  durationSec: number;
}): Promise<PendingRecording> {
  const src = new File(input.uri);
  const filename = `reunion-${input.project}-${stamp(new Date())}${src.extension || ".m4a"}`;
  const dest = new File(recordingsDir(), filename);
  src.move(dest);
  const entry: PendingRecording = {
    id: filename,
    project: input.project,
    uri: dest.uri,
    filename,
    sizeBytes: dest.size,
    durationSec: input.durationSec,
    createdAt: new Date().toISOString(),
    lastError: null,
  };
  await writeIndex([entry, ...(await readIndex()).filter((e) => e.id !== entry.id)]);
  return entry;
}

/** Pendientes vivas (depura las entradas cuyo archivo ya no está en disco). */
export async function listPending(): Promise<PendingRecording[]> {
  const idx = await readIndex();
  const alive = idx.filter((e) => {
    try {
      return new File(e.uri).exists;
    } catch {
      return false;
    }
  });
  if (alive.length !== idx.length) await writeIndex(alive);
  return alive;
}

/** Anota el último error de subida (se muestra en la tarjeta de la pendiente). */
export async function setPendingError(id: string, error: string | null): Promise<void> {
  const idx = await readIndex();
  await writeIndex(idx.map((e) => (e.id === id ? { ...e, lastError: error } : e)));
}

/** Fija el proyecto de una huérfana antes de subirla. */
export async function setPendingProject(id: string, project: string): Promise<void> {
  const idx = await readIndex();
  await writeIndex(idx.map((e) => (e.id === id ? { ...e, project } : e)));
}

/** Marca que el agente aceptó el audio (job en curso); el archivo NO se borra. */
export async function setPendingJob(id: string, jobId: string): Promise<void> {
  const idx = await readIndex();
  await writeIndex(idx.map((e) => (e.id === id ? { ...e, jobId, lastError: null } : e)));
}

/** Saca la pendiente del índice y borra el audio (tras subir OK o descartar). */
export async function removePending(id: string): Promise<void> {
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
}

/**
 * Rescata grabaciones huérfanas del cache de expo-audio (<cache>/Audio/
 * recording-*.m4a) y re-indexa archivos sueltos en recordings/ (índice
 * perdido). Devuelve cuántas adoptó. `excludeUri` protege la grabación en
 * curso del recorder.
 */
export async function adoptOrphans(excludeUri?: string | null): Promise<number> {
  const dir = recordingsDir();
  const idx = await readIndex();
  const known = new Set(idx.map((e) => e.filename));
  const adopted: PendingRecording[] = [];

  // `known` se va llenando: el primer loop mueve huérfanas A `dir`, así que el
  // segundo (que lista `dir`) las volvería a ver — sin esto se adoptan dos
  // veces y quedan dos entradas con el mismo id.
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
    });
  };

  try {
    const cacheAudio = new Directory(Paths.cache, "Audio");
    if (cacheAudio.exists) {
      for (const item of cacheAudio.list()) {
        if (!(item instanceof File)) continue;
        if (!item.name.startsWith("recording-")) continue;
        if (excludeUri && item.uri === excludeUri) continue;
        // <100 KB ≈ menos de ~6s de audio: ruido de pruebas, no una junta.
        if (item.size < 100 * 1024) continue;
        const dest = new File(dir, item.name);
        if (dest.exists) continue;
        item.move(dest);
        adopt(dest, null);
      }
    }
    // recordings/ con índice perdido (reinstalación, storage corrupto).
    for (const item of dir.list()) {
      if (!(item instanceof File) || known.has(item.name)) continue;
      const slug = /^reunion-(.+)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\./.exec(item.name)?.[1] ?? null;
      adopt(item, slug);
    }
  } catch {
    /* un dir ilegible no debe tumbar la pantalla de reuniones */
  }

  if (adopted.length) await writeIndex([...adopted, ...idx]);
  return adopted.length;
}
