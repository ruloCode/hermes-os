import { supabase } from "./supabase.js";

/**
 * Verificación de JWTs de Supabase Auth (login email+contraseña del móvil).
 * El middleware de index.ts acepta DOS credenciales: el HERMES_API_KEY estático
 * (dashboard web / LAN) o un access token de Supabase — así la app móvil entra
 * por el túnel con la sesión del usuario, sin compartir la key de la casa.
 *
 * getUser() pega a la API de Supabase → cache en memoria por token con TTL
 * corto para no pagar una llamada de red por cada request del móvil.
 */

interface CacheEntry {
  userId: string | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

/** Los tokens de Supabase son JWT (tres segmentos); el API key estático no. */
export function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

/** Devuelve el user id si el token es un JWT válido de Supabase; null si no. */
export async function verifySupabaseToken(token: string): Promise<string | null> {
  if (!supabase || !looksLikeJwt(token)) return null;

  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expiresAt > now) return hit.userId;

  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    userId = error ? null : (data.user?.id ?? null);
  } catch {
    userId = null;
  }

  // Los rechazos también se cachean (TTL corto) para no dejar que un token
  // inválido repetido convierta cada request en una llamada a Supabase.
  cache.set(token, { userId, expiresAt: now + (userId ? CACHE_TTL_MS : 30_000) });
  if (cache.size > 500) {
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
  }
  return userId;
}
