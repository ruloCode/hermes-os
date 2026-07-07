#!/usr/bin/env node
/**
 * Guarda (y valida) el token OAuth de Claude Code que usa el panel "Plan ·
 * límites" del dashboard. El token va a ~/.hermes/claude-token (modo 600) y el
 * API route /api/claude-limits lo lee en solo-lectura.
 *
 * Uso:
 *   pnpm --filter @hermes/web usage:token <access-token>
 *   pnpm --filter @hermes/web usage:token --keychain   # intenta el Keychain
 *   echo "<token>" | pnpm --filter @hermes/web usage:token -
 *
 * ¿De dónde sacar el token?  De tu login activo de Claude Code:
 *   security find-generic-password -s "Claude Code-credentials" -w \
 *     | python3 -c 'import sys,json;print(json.load(sys.stdin)["claudeAiOauth"]["accessToken"])'
 *   (si sale caducado: abre `claude`, corre /usage una vez y reintenta —
 *    eso refresca el token en el Keychain).
 *
 * No refrescamos el token automáticamente: el endpoint de refresh está tras
 * Cloudflare y rota el refresh_token, lo que te desactivaría Claude Code.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TOKEN_PATH = join(homedir(), ".hermes", "claude-token");

function die(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

function fromKeychain() {
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8" },
    );
    return JSON.parse(raw).claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function resolveArg() {
  const arg = process.argv[2];
  if (!arg) {
    die(
      "Falta el token. Uso: usage:token <access-token> | --keychain | - (stdin)",
    );
  }
  if (arg === "--keychain") {
    const t = fromKeychain();
    if (!t) die("No pude leer el token del Keychain.");
    return t;
  }
  if (arg === "-") {
    const t = await readStdin();
    if (!t) die("No llegó token por stdin.");
    return t;
  }
  return arg.trim();
}

function pct(w) {
  return w && typeof w.utilization === "number"
    ? `${Math.round(w.utilization)}%`
    : "—";
}

async function main() {
  const token = await resolveArg();

  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "User-Agent": "claude-cli/2.1.202 (external, hermes-os)",
    },
  });

  if (res.status === 401) {
    die(
      "El token no es válido o caducó (401). Renuévalo: abre `claude`, corre /usage y vuelve a intentarlo.",
    );
  }
  if (!res.ok) die(`El endpoint de usage devolvió HTTP ${res.status}.`);

  const data = await res.json();

  mkdirSync(join(homedir(), ".hermes"), { recursive: true });
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });

  console.log(`\x1b[32m✓ Token válido y guardado en ${TOKEN_PATH}\x1b[0m`);
  console.log(`  Sesión (5h):      ${pct(data.five_hour)}`);
  console.log(`  Semanal (todos):  ${pct(data.seven_day)}`);
  console.log(`  Semanal (premium):${pct(data.seven_day_opus)}`);
  if (data.seven_day_sonnet)
    console.log(`  Semanal (sonnet): ${pct(data.seven_day_sonnet)}`);
  console.log("\n  El panel del dashboard ya puede mostrar las barras.");
}

main().catch((e) => die(e?.message ?? String(e)));
