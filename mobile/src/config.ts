/**
 * Conexión al agente Hermes desde cualquier red. La app maneja hasta tres
 * candidatos de base URL y elige sola:
 *
 *   1. URL manual (Ajustes) — si el usuario la fijó, manda.
 *   2. LAN bakeada en el APK (EXPO_PUBLIC_HERMES_URL) — rápida en la casa.
 *   3. Túnel público (remote_config de Supabase) — desde cualquier lugar.
 *
 * resolveBase() sondea /health en paralelo y activa el candidato vivo de mayor
 * prioridad. hermes.ts lee getBase()/getKey() síncronos (estado de módulo
 * hidratado al arrancar), igual que antes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchRemoteAgentUrl } from "./auth";

const KEY_URL = "hermes.url";
const KEY_KEY = "hermes.key";
const KEY_REMOTE = "hermes.remoteUrl";

const clean = (u: string) => u.trim().replace(/\/$/, "");
const DEFAULT_URL = clean(process.env.EXPO_PUBLIC_HERMES_URL || "http://192.168.0.92:8650");
const DEFAULT_KEY = process.env.EXPO_PUBLIC_HERMES_KEY || "";

let baseUrl = DEFAULT_URL; // base activa (la que usan los requests)
let manualUrl = ""; // override de Ajustes ("" = automático)
let remoteUrl = ""; // último túnel conocido (cache de remote_config)
let apiKey = DEFAULT_KEY; // fallback manual; lo normal es entrar con el JWT

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((fn) => fn());

export function getBase(): string {
  return baseUrl;
}
export function getKey(): string {
  return apiKey;
}
export function getManualUrl(): string {
  return manualUrl;
}
export function getRemoteUrl(): string {
  return remoteUrl;
}

export function subscribeConfig(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hidrata desde AsyncStorage al arrancar la app. */
export async function loadConfig(): Promise<void> {
  try {
    const [u, k, r] = await Promise.all([
      AsyncStorage.getItem(KEY_URL),
      AsyncStorage.getItem(KEY_KEY),
      AsyncStorage.getItem(KEY_REMOTE),
    ]);
    if (u) manualUrl = clean(u);
    if (k !== null) apiKey = k;
    if (r) remoteUrl = clean(r);
  } catch {
    /* primer arranque: quedan los defaults */
  }
  baseUrl = manualUrl || remoteUrl || DEFAULT_URL;
  notify();
}

/** Guarda Ajustes. url vacía = modo automático (LAN + túnel). */
export async function saveConfig(url: string, key: string): Promise<void> {
  manualUrl = clean(url);
  apiKey = key.trim();
  if (manualUrl) baseUrl = manualUrl;
  try {
    await AsyncStorage.setItem(KEY_URL, manualUrl);
    await AsyncStorage.setItem(KEY_KEY, apiKey);
  } catch {
    /* noop */
  }
  notify();
}

/** Sondea /health (sin auth) con timeout corto. */
async function probe(url: string, timeoutMs = 4000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresca el túnel desde Supabase (si hay sesión) y activa el candidato vivo
 * de mayor prioridad: manual > LAN > túnel. Devuelve true si alguno respondió.
 */
export async function resolveBase(): Promise<boolean> {
  const fresh = await fetchRemoteAgentUrl();
  if (fresh && fresh !== remoteUrl) {
    remoteUrl = fresh;
    try {
      await AsyncStorage.setItem(KEY_REMOTE, remoteUrl);
    } catch {
      /* noop */
    }
  }

  const candidates = [...new Set([manualUrl, DEFAULT_URL, remoteUrl].filter(Boolean))];
  const alive = await Promise.all(candidates.map((c) => probe(c)));
  const winner = candidates.find((_, i) => alive[i]);
  if (winner && winner !== baseUrl) {
    baseUrl = winner;
    notify();
  }
  return !!winner;
}

export const DEFAULTS = { url: DEFAULT_URL, key: DEFAULT_KEY };
