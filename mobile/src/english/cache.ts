/**
 * Caché local de inglés: las clases se repasan en el bus, en el metro o sin
 * señal. Lo último que llegó del agente queda en AsyncStorage y se muestra
 * apenas abre la pantalla; la red solo lo refresca.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EnglishSession, EnglishSessionFull, VocabEntry } from "../types";

const LIST = "hermes.english.sessions";
const VOCAB = "hermes.english.vocab";
const DETAIL = (id: number) => `hermes.english.session.${id}`;

interface Stamped<T> {
  at: string;
  data: T;
}

async function read<T>(key: string): Promise<Stamped<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Stamped<T>) : null;
  } catch {
    return null;
  }
}

async function write<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), data }));
  } catch {
    /* sin espacio: la pantalla sigue funcionando con red */
  }
}

export const cachedSessions = () => read<EnglishSession[]>(LIST);
export const saveSessions = (d: EnglishSession[]) => write(LIST, d);
export const cachedVocab = () => read<VocabEntry[]>(VOCAB);
export const saveVocabCache = (d: VocabEntry[]) => write(VOCAB, d);
export const cachedSession = (id: number) => read<EnglishSessionFull>(DETAIL(id));
export const saveSession = (d: EnglishSessionFull) => write(DETAIL(d.id), d);

/**
 * Descarga en segundo plano el detalle (transcripción incluida) de cada sesión
 * que aún no está guardada o cambió de estado de reporte: así CUALQUIER clase
 * se repasa sin señal, no solo las que ya abriste. Secuencial y best-effort.
 */
export async function prefetchSessions(
  list: EnglishSession[],
  fetchOne: (id: number) => Promise<EnglishSessionFull>,
  max = 40,
): Promise<void> {
  for (const s of list.slice(0, max)) {
    const have = await cachedSession(s.id);
    if (have && have.data.report_status === s.report_status && have.data.errors.length === s.errors.length) continue;
    try {
      await saveSession(await fetchOne(s.id));
    } catch {
      return; // sin red: se reintenta en la próxima carga
    }
  }
}
