/**
 * Auth de Supabase por REST puro (sin supabase-js: cero deps nuevas en Metro).
 * Login email+contraseña → access token (JWT, 1h) + refresh token. El agente
 * acepta ese JWT como Bearer (middleware de index.ts), así que la sesión del
 * usuario ES la credencial contra el agente — la key estática de la casa ya no
 * viaja en el APK.
 *
 * Igual que config.ts: estado a nivel de módulo hidratado al arrancar
 * (loadSession) para que hermes.ts pueda leer el token de forma síncrona.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const KEY_SESSION = "hermes.session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** epoch ms en que expira el access token. */
  expiresAt: number;
  email: string;
}

let session: Session | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeAuth(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

export const authConfigured = (): boolean => !!(SUPABASE_URL && SUPABASE_ANON);
export const getSession = (): Session | null => session;
export const getAccessToken = (): string | null => session?.accessToken ?? null;

async function persist(): Promise<void> {
  try {
    if (session) await AsyncStorage.setItem(KEY_SESSION, JSON.stringify(session));
    else await AsyncStorage.removeItem(KEY_SESSION);
  } catch {
    /* sin storage la sesión vive solo en memoria */
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { email?: string };
  error_description?: string;
  msg?: string;
  error?: string;
}

async function tokenRequest(grant: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

function applyToken(data: TokenResponse, emailFallback: string): boolean {
  if (!data.access_token || !data.refresh_token) return false;
  session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    email: data.user?.email ?? emailFallback,
  };
  return true;
}

/** Hidrata la sesión guardada al arrancar. No refresca aquí: eso es perezoso. */
export async function loadSession(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SESSION);
    if (raw) session = JSON.parse(raw) as Session;
  } catch {
    session = null;
  }
  notify();
}

/** Login email+contraseña. Devuelve null si ok, o el mensaje de error. */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (!authConfigured()) return "La app se compiló sin Supabase (EXPO_PUBLIC_SUPABASE_*).";
  try {
    const data = await tokenRequest("password", { email: email.trim(), password });
    if (!applyToken(data, email.trim())) {
      return data.error_description ?? data.msg ?? "Email o contraseña incorrectos.";
    }
    await persist();
    notify();
    return null;
  } catch {
    return "Sin conexión con el servidor de login.";
  }
}

export async function signOut(): Promise<void> {
  session = null;
  await persist();
  notify();
}

// Single-flight: si varios requests chocan con el token vencido a la vez,
// comparten UN refresh en vez de quemar el refresh token en paralelo.
let refreshing: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (!session?.refreshToken) return false;
  if (!refreshing) {
    const current = session;
    refreshing = (async () => {
      try {
        const data = await tokenRequest("refresh_token", { refresh_token: current.refreshToken });
        if (applyToken(data, current.email)) {
          await persist();
          notify();
          return true;
        }
        // Refresh token rechazado (revocado/rotado): la sesión murió de verdad.
        if (data.error === "invalid_grant" || data.error_description || data.msg) {
          session = null;
          await persist();
          notify();
        }
        return false;
      } catch {
        return false; // offline: conserva la sesión, ya reintentará
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** Garantiza un access token vigente antes de un request (no-op si aún vive). */
export async function ensureFreshToken(): Promise<void> {
  if (!session) return;
  if (Date.now() < session.expiresAt) return;
  await refreshSession();
}

/**
 * Descubrimiento del túnel: lee remote_config.agent_public_url con la sesión
 * del usuario (RLS: solo autenticados). Devuelve la URL o null.
 */
export async function fetchRemoteAgentUrl(): Promise<string | null> {
  if (!authConfigured() || !session) return null;
  await ensureFreshToken();
  if (!session) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/remote_config?key=eq.agent_public_url&select=value`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.accessToken}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { value?: string }[];
    const url = rows[0]?.value?.trim();
    return url ? url.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}
