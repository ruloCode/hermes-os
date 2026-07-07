import { homedir } from "node:os";
import { resolve } from "node:path";
import { env } from "../env.js";

/**
 * Guardrail canUseTool: las tareas disparadas por voz/chat corren SIN humano
 * en el loop, así que esto es la última línea de defensa.
 *
 * - Bash: deny-list de comandos destructivos.
 * - Write/Edit: solo dentro del vault, ~/dev y el repo hermes-os.
 */
const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, // rm -rf / -fr
  /\bsudo\b/i,
  /\bgit\s+push\s+.*--force/i,
  /\bgit\s+reset\s+--hard/i,
  /\bmkfs\b|\bdiskutil\s+erase/i,
  /\bshutdown\b|\breboot\b/i,
  /:\s*\(\)\s*\{.*\};\s*:/, // fork bomb
  /\bchmod\s+-R\s+777\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /\bcurl\b.*\|\s*(ba)?sh/i, // pipe a shell
  /\bdrop\s+(table|database)\b/i,
];

const HOME = homedir();
const ALLOWED_WRITE_ROOTS = [
  env.VAULT_PATH,
  resolve(HOME, "dev"),
  resolve(HOME, "Documents"),
].filter(Boolean);

function pathAllowed(p: string): boolean {
  const abs = resolve(p.startsWith("~") ? p.replace("~", HOME) : p);
  return ALLOWED_WRITE_ROOTS.some((root) => abs.startsWith(root + "/") || abs === root);
}

export interface GuardrailVerdict {
  allowed: boolean;
  reason?: string;
}

export function checkTool(
  toolName: string,
  input: Record<string, unknown>,
): GuardrailVerdict {
  if (toolName === "Bash") {
    const command = String(input.command ?? "");
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: `Comando bloqueado por guardrail (patrón peligroso): ${pattern}`,
        };
      }
    }
    return { allowed: true };
  }

  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
    const filePath = String(input.file_path ?? input.notebook_path ?? "");
    if (filePath && !pathAllowed(filePath)) {
      return {
        allowed: false,
        reason: `Escritura fuera de las rutas permitidas (${ALLOWED_WRITE_ROOTS.join(", ")}): ${filePath}`,
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}
