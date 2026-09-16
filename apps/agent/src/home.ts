import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Carpeta de estado personal de Hermes FUERA del repo (SOUL.md, USER.md,
 * skills aprendidas, logs, audio de juntas…). Override por HERMES_HOME —
 * los tests apuntan a un directorio temporal y nunca tocan el real.
 */
export const HERMES_HOME: string = process.env.HERMES_HOME || join(homedir(), ".hermes-os");
