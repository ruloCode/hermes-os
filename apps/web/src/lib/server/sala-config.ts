import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSalaConfig, type SalaAgentConfig } from "@hermes/shared";

/**
 * Lector SERVER-SIDE (route handlers de Next) de ~/.hermes-os/sala.json: la
 * ruta del token de ElevenLabs necesita el mapa clave → agent_id sin pasar por
 * el agente (la key de ElevenLabs vive aquí, en el server del dashboard). Misma
 * ruta y mismo validador que el agente (HERMES_HOME / HERMES_SALA_PATH).
 */
const SALA_PATH =
  process.env.HERMES_SALA_PATH ||
  join(process.env.HERMES_HOME || join(homedir(), ".hermes-os"), "sala.json");

export async function readSalaAgent(key: string): Promise<SalaAgentConfig | null> {
  const raw = await readFile(SALA_PATH, "utf8").catch(() => null);
  if (raw === null) return null;
  return parseSalaConfig(JSON.parse(raw)).agents.find((a) => a.key === key) ?? null;
}

/** agent_id resoluble de un personaje (o el motivo de que no lo sea). */
export async function resolveSalaAgentId(key: string): Promise<{ agentId: string | null; hint: string }> {
  let agent: SalaAgentConfig | null;
  try {
    agent = await readSalaAgent(key);
  } catch (err) {
    return { agentId: null, hint: `sala.json inválido: ${(err as Error).message}` };
  }
  if (!agent) return { agentId: null, hint: `No hay un agente "${key}" en ${SALA_PATH}` };
  const v = agent.voice;
  if (v.reuse !== undefined) {
    const envName =
      v.reuse === "hermes" ? "NEXT_PUBLIC_ELEVENLABS_AGENT_ID" : "NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID";
    return { agentId: process.env[envName] || null, hint: `Falta ${envName} en .env` };
  }
  return {
    agentId: v.agent_id ?? null,
    hint: `El agente "${agent.name}" aún no existe en ElevenLabs — corre pnpm setup:elevenlabs --sala`,
  };
}
