/**
 * Abre el repo local de un proyecto en un editor externo (Cursor).
 *
 * Seguridad: se usa execFile con array de args (nunca un string de shell), así
 * que la ruta viaja como un único argumento y no hay inyección posible aunque
 * venga del frontmatter del vault.
 *
 * Estrategia en macOS: `open -a "Cursor" <dir>` — no depende de que el shim
 * `cursor` esté en el PATH y abre la carpeta como workspace. Si falla (nombre
 * de app distinto, otro SO), cae al binario `cursor <dir>`.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }));
  });
}

let cachedBin: string | null = null;
function resolveCursorBin(): string {
  if (cachedBin) return cachedBin;
  const candidates = [
    process.env.CURSOR_BIN,
    join(process.env.HOME ?? "", ".local/bin/cursor"),
    "/opt/homebrew/bin/cursor",
    "/usr/local/bin/cursor",
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return (cachedBin = c);
    } catch {
      /* sigue */
    }
  }
  return (cachedBin = "cursor"); // fallback al PATH
}

export async function openInCursor(dir: string): Promise<{ ok: boolean; error?: string }> {
  const path = expandHome((dir ?? "").trim());
  if (!path) return { ok: false, error: "ruta vacía" };
  if (!existsSync(path)) return { ok: false, error: `la ruta no existe: ${path}` };

  // macOS: abrir por nombre de app (no requiere el CLI instalado).
  if (process.platform === "darwin") {
    const viaOpen = await run("open", ["-a", "Cursor", path]);
    if (viaOpen.ok) return viaOpen;
    const viaCli = await run(resolveCursorBin(), [path]);
    if (viaCli.ok) return viaCli;
    return { ok: false, error: `no pude abrir Cursor (${viaOpen.error}; ${viaCli.error})` };
  }

  // Otros SO: el binario `cursor` (Linux/Windows con el CLI en PATH).
  return run(resolveCursorBin(), [path]);
}
