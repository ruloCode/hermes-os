/**
 * Límites del plan de Claude Code (estilo /usage): ventana de sesión de 5h +
 * límites semanales. Solo servidor.
 *
 * Estos datos salen del endpoint privado `/api/oauth/usage` de Anthropic, que
 * exige un token OAuth vivo de la suscripción. No lo refrescamos nosotros (el
 * endpoint de refresh está tras Cloudflare y rota el token → desloguearía a
 * Claude Code). En su lugar TÚ aportas el token y aquí se usa en solo-lectura:
 *
 *   1. env  CLAUDE_OAUTH_TOKEN   (en apps/web/.env)
 *   2. file ~/.hermes-os/claude-token   (lo escribe scripts/hermes-usage-token.mjs)
 *   3. Keychain (opt-in con CLAUDE_USAGE_KEYCHAIN=1; puede pedir permiso)
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface LimitWindow {
  label: string;
  utilization: number; // 0-100
  resetsAt: string | null; // ISO
}

export interface ClaudeLimits {
  available: boolean;
  generatedAt: string;
  plan: string | null; // tier de la suscripción, p.ej. "Max (5x)"
  session: LimitWindow | null; // five_hour
  weekly: LimitWindow[]; // seven_day, seven_day_opus, seven_day_sonnet…
  reason?: string; // motivo cuando available=false
}

// ── Resolución de credencial (token + tier del plan) ─────────────────────

interface Credential {
  token: string | null;
  plan: string | null; // etiqueta del tier, p.ej. "Max (5x)"
}

function tokenFilePath(): string {
  return path.join(os.homedir(), ".hermes-os", "claude-token");
}

// Deriva la etiqueta del plan que muestra la referencia ("Max (20x)") a partir
// de los campos que Claude Code guarda en el Keychain (rateLimitTier tiene la
// forma "default_claude_max_5x"; subscriptionType es "max"/"pro"/"free").
function planLabel(
  subscriptionType?: unknown,
  rateLimitTier?: unknown,
): string | null {
  if (typeof rateLimitTier === "string") {
    const m = rateLimitTier.match(/max[_-]?(\d+)x/i);
    if (m) return `Max (${m[1]}x)`;
  }
  if (typeof subscriptionType === "string" && subscriptionType) {
    const t = subscriptionType.toLowerCase();
    if (t === "max") return "Max";
    if (t === "pro") return "Pro";
    if (t === "free") return "Free";
    return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
  }
  return null;
}

// Fuente primaria del tier: ~/.claude.json (Claude Code lo refresca solo, con
// campos como organizationRateLimitTier: "default_claude_max_20x"). No exige
// Keychain ni flags: es una lectura local igual que la de ~/.claude/projects.
async function readClaudeJsonPlan(): Promise<string | null> {
  try {
    const raw = await fs.readFile(
      path.join(os.homedir(), ".claude.json"),
      "utf8",
    );
    const oa = (JSON.parse(raw) as Record<string, unknown>).oauthAccount as
      | Record<string, unknown>
      | undefined;
    if (!oa) return null;
    return planLabel(
      undefined,
      oa.userRateLimitTier ?? oa.organizationRateLimitTier,
    );
  } catch {
    return null;
  }
}

// El Keychain puede tener dos items "Claude Code-credentials": el CLI moderno
// guarda con account=<usuario> y las instalaciones viejas con account="Claude
// Code" (token muerto). Probamos primero el del usuario y saltamos caducados.
function readKeychainEntry(account: string | null): Promise<Credential> {
  const args = ["find-generic-password", "-s", "Claude Code-credentials"];
  if (account) args.push("-a", account);
  args.push("-w");
  return new Promise((resolve) => {
    execFile("security", args, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ token: null, plan: null });
      try {
        const cred = JSON.parse(stdout).claudeAiOauth;
        const expired =
          typeof cred?.expiresAt === "number" && cred.expiresAt < Date.now();
        resolve({
          token: expired ? null : (cred?.accessToken ?? null),
          plan: planLabel(cred?.subscriptionType, cred?.rateLimitTier),
        });
      } catch {
        resolve({ token: null, plan: null });
      }
    });
  });
}

async function readKeychainCredential(): Promise<Credential> {
  const user = os.userInfo().username;
  const fromUser = await readKeychainEntry(user);
  if (fromUser.token) return fromUser;
  const fallback = await readKeychainEntry(null);
  return {
    token: fallback.token,
    plan: fromUser.plan ?? fallback.plan,
  };
}

async function resolveCredential(): Promise<Credential> {
  // Tier del plan: override manual → ~/.claude.json (fresco) → Keychain.
  const plan =
    process.env.CLAUDE_PLAN?.trim() || (await readClaudeJsonPlan());

  const env = process.env.CLAUDE_OAUTH_TOKEN?.trim();
  if (env) return { token: env, plan };

  try {
    const fromFile = (await fs.readFile(tokenFilePath(), "utf8")).trim();
    if (fromFile) return { token: fromFile, plan };
  } catch {
    /* sin archivo */
  }

  if (process.env.CLAUDE_USAGE_KEYCHAIN === "1") {
    const cred = await readKeychainCredential();
    return { token: cred.token, plan: plan ?? cred.plan };
  }
  return { token: null, plan };
}

// ── Fetch + mapeo ───────────────────────────────────────────────────────

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "Sesión actual",
  seven_day: "Todos los modelos",
  seven_day_opus: "Opus / Fable",
  seven_day_sonnet: "Sonnet",
};
const WEEKLY_KEYS = ["seven_day", "seven_day_opus", "seven_day_sonnet"];

function toWindow(key: string, raw: unknown): LimitWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const util = Number(w.utilization);
  if (Number.isNaN(util)) return null;
  const resets = typeof w.resets_at === "string" ? w.resets_at : null;
  return {
    label: WINDOW_LABELS[key] ?? key,
    // La API entrega utilization como porcentaje 0-100; acotamos por seguridad.
    utilization: Math.max(0, Math.min(100, util)),
    resetsAt: resets,
  };
}

// Cache con TTL variable. El endpoint de usage rate-limita agresivo, así que
// como mucho ~1 request por minuto aunque haya varias pestañas abiertas; los
// fallos se cachean más tiempo para no insistir con un token muerto.
let cache: { at: number; ttl: number; data: ClaudeLimits } | null = null;
// Último resultado bueno: ante un fallo transitorio (429, red) lo seguimos
// mostrando en vez de tumbar el panel.
let lastGood: { at: number; data: ClaudeLimits } | null = null;
const TTL_OK = 60_000;
const TTL_FAIL = 60_000;
const TTL_RATE_LIMITED = 300_000;
const STALE_MAX = 15 * 60_000;

export async function getClaudeLimits(): Promise<ClaudeLimits> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) return cache.data;

  const { token, plan } = await resolveCredential();

  const unavailable = (reason: string, ttl = TTL_FAIL): ClaudeLimits => {
    // Fallo transitorio con dato bueno reciente → servir el dato viejo.
    const data: ClaudeLimits =
      lastGood && now - lastGood.at < STALE_MAX
        ? lastGood.data
        : {
            available: false,
            generatedAt: new Date().toISOString(),
            plan, // el tier se conoce aunque el fetch de uso falle
            session: null,
            weekly: [],
            reason,
          };
    cache = { at: now, ttl, data };
    return data;
  };

  if (!token) {
    return unavailable(
      "Sin token · ejecuta `pnpm --filter @hermes/web usage:token <token>`",
    );
  }

  let res: Response;
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "User-Agent": "claude-cli/2.1.202 (external, hermes-os)",
      },
      cache: "no-store",
    });
  } catch {
    return unavailable("No se pudo contactar api.anthropic.com");
  }

  if (res.status === 401) return unavailable("Token caducado · renueva el token");
  if (res.status === 429)
    return unavailable("Rate limit del endpoint · reintento en 5 min", TTL_RATE_LIMITED);
  if (!res.ok) return unavailable(`Usage HTTP ${res.status}`);

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    return unavailable("Respuesta de usage no válida");
  }

  const session = toWindow("five_hour", json.five_hour);
  const weekly = WEEKLY_KEYS.map((k) => toWindow(k, json[k])).filter(
    (w): w is LimitWindow => w !== null,
  );

  const data: ClaudeLimits = {
    available: true,
    generatedAt: new Date().toISOString(),
    plan,
    session,
    weekly,
  };
  cache = { at: now, ttl: TTL_OK, data };
  lastGood = { at: now, data };
  return data;
}
