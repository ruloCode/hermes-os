/**
 * Configuración de conexión al agente Hermes (URL base + Bearer). Los valores
 * por defecto se bakean en el APK vía EXPO_PUBLIC_* (mobile/.env) y el usuario
 * los puede editar en Ajustes; los cambios persisten en AsyncStorage.
 *
 * hermes.ts lee `getBase()`/`getKey()` de forma síncrona, así que mantenemos un
 * estado a nivel de módulo que se hidrata al arrancar (loadConfig).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_URL = "hermes.url";
const KEY_KEY = "hermes.key";

const DEFAULT_URL = (process.env.EXPO_PUBLIC_HERMES_URL || "http://192.168.0.92:8650").replace(
  /\/$/,
  "",
);
const DEFAULT_KEY = process.env.EXPO_PUBLIC_HERMES_KEY || "";

let baseUrl = DEFAULT_URL;
let apiKey = DEFAULT_KEY;

type Listener = () => void;
const listeners = new Set<Listener>();

export function getBase(): string {
  return baseUrl;
}
export function getKey(): string {
  return apiKey;
}

export function subscribeConfig(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hidrata desde AsyncStorage al arrancar la app. */
export async function loadConfig(): Promise<void> {
  try {
    const [u, k] = await Promise.all([
      AsyncStorage.getItem(KEY_URL),
      AsyncStorage.getItem(KEY_KEY),
    ]);
    if (u) baseUrl = u.replace(/\/$/, "");
    if (k !== null) apiKey = k;
  } catch {
    /* primer arranque / storage no disponible: quedan los defaults */
  }
  listeners.forEach((fn) => fn());
}

/** Guarda y notifica (Ajustes). */
export async function saveConfig(url: string, key: string): Promise<void> {
  baseUrl = url.trim().replace(/\/$/, "");
  apiKey = key.trim();
  try {
    await AsyncStorage.setItem(KEY_URL, baseUrl);
    await AsyncStorage.setItem(KEY_KEY, apiKey);
  } catch {
    /* noop */
  }
  listeners.forEach((fn) => fn());
}

export const DEFAULTS = { url: DEFAULT_URL, key: DEFAULT_KEY };
