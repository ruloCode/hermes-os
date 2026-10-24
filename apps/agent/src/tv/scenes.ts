import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCENES, parseScenes, type SceneDef } from "./plan.js";

/**
 * Escenas del cuarto: las de fábrica + ~/.hermes-os/escenas.json (las del
 * dueño, con su contenido y su tono de luz). Se relee en cada uso: editar el
 * archivo no pide reiniciar el agente. Plantilla: hermes-tv/docs/escenas.example.json.
 */
export const SCENES_PATH = process.env.HERMES_SCENES_PATH || join(homedir(), ".hermes-os", "escenas.json");

export async function readScenes(): Promise<{ scenes: SceneDef[]; errors: string[] }> {
  let text: string;
  try {
    text = await readFile(SCENES_PATH, "utf8");
  } catch {
    return { scenes: DEFAULT_SCENES, errors: [] };
  }
  try {
    return parseScenes(JSON.parse(text));
  } catch (err) {
    return { scenes: DEFAULT_SCENES, errors: [`escenas.json no es JSON válido: ${err instanceof Error ? err.message : err}`] };
  }
}
