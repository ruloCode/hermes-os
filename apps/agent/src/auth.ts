import { env } from "./env.js";
import { supabase } from "./supabase.js";

/**
 * Verificación de JWTs de Supabase Auth (login email+contraseña del móvil).
 * El middleware de index.ts acepta DOS credenciales: el HERMES_API_KEY estático
 * (dashboard web / LAN) o un access token de Supabase — así la app móvil entra
 * por el túnel con la sesión del usuario, sin compartir la key de la casa.
 *
 * getUser() pega a la API de Supabase → cache en memoria por token con TTL
 * corto para no pagar una llamada de red por cada request del móvil.
 *
 * Un JWT válido NO basta: Supabase deja registrarse a cualquiera por defecto y
 * la anon key viaja dentro del APK, así que "tiene sesión en el proyecto" no
 * es "es el dueño". Solo entran los usuarios de HERMES_ALLOWED_USERS (ids o
 * emails); con la lista vacía ningún JWT entra.
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

/** "id1, Email@x.com" → ["id1", "email@x.com"]. */
export function parseAllowedUsers(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** El usuario pasa si su id o su email está en la lista. Lista vacía = nadie. */
export function isAllowedUser(
  user: { id: string; email?: string | null },
  allowed: readonly string[],
): boolean {
  if (allowed.length === 0) return false;
  const email = user.email?.trim().toLowerCase();
  return allowed.includes(user.id.toLowerCase()) || (!!email && allowed.includes(email));
}

const allowedUsers = parseAllowedUsers(env.HERMES_ALLOWED_USERS);
if (supabase && allowedUsers.length === 0) {
  console.warn(
    "[auth] HERMES_ALLOWED_USERS vacío: ningún login de Supabase entra (la app móvil queda fuera). Pon tu email o user id en el .env.",
  );
}

/** Devuelve el user id si el token es un JWT válido de un usuario permitido; null si no. */
export async function verifySupabaseToken(token: string): Promise<string | null> {
  if (!supabase || !looksLikeJwt(token)) return null;

  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expiresAt > now) return hit.userId;

  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    const user = error ? null : data.user;
    userId = user && isAllowedUser(user, allowedUsers) ? user.id : null;
    if (user && !userId) console.warn(`[auth] JWT válido pero usuario fuera de HERMES_ALLOWED_USERS: ${user.id}`);
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
