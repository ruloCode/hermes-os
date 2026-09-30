import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  castLabel,
  parseSalaConfig,
  salaAgentLanguage,
  SalaValidationError,
  type ProjectStatus,
  type SalaAgentConfig,
  type SalaAgentPublic,
  type OfficeCastPublic,
  type SalaCastPublic,
  type SalaConfig,
  type SalaStation,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { env } from "../env.js";

/**
 * Personajes de la Sala de Agentes 3D (~/.hermes-os/sala.json). El JSON lo
 * escribe el humano (y `pnpm setup:elevenlabs` le rellena los agent_id); el
 * agente lo lee en cada request — es un archivo chico y así editarlo se ve
 * sin reiniciar. Sin archivo → la sala está vacía y la UI lo dice con la ruta
 * exacta; JSON inválido → 500 con el motivo del validador, no una sala a medias.
 */

export const SALA_PATH: string = process.env.HERMES_SALA_PATH || join(HERMES_HOME, "sala.json");
export const SALA_PORTRAIT_DIR: string = join(HERMES_HOME, "avatars", "sala");

export function portraitPath(key: string): string {
  return join(SALA_PORTRAIT_DIR, `${key}.png`);
}

/** null = no hay archivo. Lanza SalaValidationError si el JSON no cumple el contrato. */
export async function readSalaConfig(): Promise<SalaConfig | null> {
  let raw: string;
  try {
    raw = await readFile(SALA_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new SalaValidationError(`sala.json: JSON inválido (${(err as Error).message})`);
  }
  return parseSalaConfig(json);
}

/** agent_id de ElevenLabs de un personaje: del .env si reusa, del JSON si es propio. */
export function salaAgentId(agent: SalaAgentConfig): string | null {
  const v = agent.voice;
  if (v.reuse !== undefined) {
    return (v.reuse === "hermes" ? env.ELEVENLABS_AGENT_ID : env.ELEVENLABS_TUTOR_AGENT_ID) || null;
  }
  return v.agent_id ?? null;
}

/**
 * Resuelve `?agent=<key>` del token. `hint` es el mensaje para el 503: dice
 * QUÉ falta (archivo, clave o agente sin crear), porque desde el browser un
 * 503 sin motivo se confunde con "la voz está caída".
 */
export async function resolveSalaAgentId(key: string): Promise<{ agentId: string | null; hint: string }> {
  const config = await readSalaConfig();
  if (!config) return { agentId: null, hint: `No existe ${SALA_PATH} (plantilla en docs/sala.example.json)` };
  if (key === "cast" || key === "office") {
    const cast = key === "cast" ? config.cast : config.office;
    if (!cast) return { agentId: null, hint: `sala.json no define el elenco "${key}"` };
    return {
      agentId: cast.agent_id ?? null,
      hint: cast.agent_id ? "" : "El elenco aún no existe en ElevenLabs — corre pnpm setup:elevenlabs --sala",
    };
  }
  const agent = config.agents.find((a) => a.key === key);
  if (!agent) return { agentId: null, hint: `sala.json no tiene un agente con key "${key}"` };
  const agentId = salaAgentId(agent);
  if (!agentId) {
    return {
      agentId: null,
      hint: agent.voice.reuse
        ? `Falta el agente "${agent.voice.reuse}" en .env (pnpm setup:elevenlabs lo crea)`
        : `El agente "${agent.name}" aún no existe en ElevenLabs — corre pnpm setup:elevenlabs --sala`,
    };
  }
  return { agentId, hint: "" };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Elenco público (o null si sala.json no lo define). */
/**
 * Elenco de la OFICINA tal como lo usa el dashboard: el líder (default, habla
 * por la oficina) y el pool de voces que se reparten entre los runs vivos.
 */
export async function officeCast(): Promise<OfficeCastPublic | null> {
  const config = await readSalaConfig();
  if (!config?.office) return null;
  const voices = config.office.members
    .map((k) => config.agents.find((a) => a.key === k))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({ key: a.key, name: a.name, label: castLabel(a.name) }));
  const leadKey = config.office.default ?? config.office.members[0];
  const lead = voices.find((v) => v.key === leadKey) ?? voices[0];
  return { ready: Boolean(config.office.agent_id), lead, pool: voices.filter((v) => v.key !== lead.key) };
}

export async function salaCast(): Promise<SalaCastPublic | null> {
  const config = await readSalaConfig();
  if (!config?.cast) return null;
  const labels: Record<string, string> = {};
  for (const m of config.cast.members) {
    const a = config.agents.find((x) => x.key === m);
    if (a) labels[m] = castLabel(a.name);
  }
  return {
    ready: Boolean(config.cast.agent_id),
    members: config.cast.members,
    default: config.cast.default ?? config.cast.members[0],
    labels,
  };
}

/** Tema de la tertulia (sala.json.topic), o null. */
export async function salaTopic(): Promise<string | null> {
  return (await readSalaConfig())?.topic ?? null;
}

/** Estación donde está plantado el tótem (sala.json.station), o null = sala normal. */
export async function salaStation(): Promise<SalaStation | null> {
  return (await readSalaConfig())?.station ?? null;
}

/** Lista pública para la escena: sin prompts ni ids, con el estado REAL del proyecto. */
export async function listSalaAgents(projects: ProjectStatus[]): Promise<SalaAgentPublic[]> {
  const config = await readSalaConfig();
  if (!config) return [];
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  return Promise.all(
    config.agents.filter((a) => a.enabled !== false).map(async (a) => {
      const project = bySlug.get(a.project);
      return {
        key: a.key,
        name: a.name,
        project: a.project,
        project_name: project?.name ?? null,
        project_estado: project?.estado ?? null,
        color: a.color,
        head: a.head,
        height: a.height,
        build: a.build,
        language: salaAgentLanguage(a),
        ready: salaAgentId(a) !== null,
        portrait: await exists(portraitPath(a.key)),
        reuse: a.voice.reuse ?? null,
      };
    }),
  );
}
