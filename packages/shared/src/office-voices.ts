// Elenco de la Oficina: UNA llamada de ElevenLabs multi-voz (como el elenco de
// la Sala) donde cada personaje vivo de la oficina presta una voz. El agente
// de voz tiene un juego FIJO de voces (tts.supported_voices) y los runs
// aparecen y se van, así que el reparto voz ↔ personaje se hace aquí, en el
// cliente, y viaja al modelo por las respuestas de sus tools.
//
// Reglas del reparto (puras, con pruebas):
// - Pegajoso: un personaje conserva su voz mientras exista.
// - Continuar una sesión hereda la voz (el run nuevo `continues` al viejo).
// - Sin voces libres, el personaje no tiene voz: Hermes habla de él.
// - Todo lo que el modelo dice de un agente sale de estos datos, nunca de su memoria.

import { castLabel } from "./sala.js";
import type { OfficeWorker, OfficeWorkerStatus } from "./office.js";

/** Una voz del elenco de la oficina (clave de sala.json, nombre y etiqueta `<Ivan>`). */
export interface OfficeVoice {
  key: string;
  name: string;
  label: string;
}

/** Lo que el dashboard recibe de GET /office/cast. */
export interface OfficeCastPublic {
  /** Hay agent_id: se le puede pedir token con ?agent=office. */
  ready: boolean;
  /** La voz del líder (Hermes): habla por la oficina, no presta voz a un run. */
  lead: OfficeVoice;
  /** Las voces que se reparten entre los personajes, en orden de preferencia. */
  pool: OfficeVoice[];
}

export function assignOfficeVoices(
  prev: ReadonlyMap<string, string>,
  workers: readonly OfficeWorker[],
  labels: readonly string[],
): Map<string, string> {
  const ids = new Set(workers.map((w) => w.id));
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const w of workers) {
    const label = prev.get(w.id);
    if (label && labels.includes(label) && !taken.has(label)) {
      out.set(w.id, label);
      taken.add(label);
    }
  }
  // La sesión continuada se queda con la voz de la que continúa (y esta la
  // suelta: ya es el pasado de la misma conversación, no otro interlocutor).
  const yielded = new Set<string>();
  for (const w of workers) {
    if (out.has(w.id) || !w.continues) continue;
    const label = prev.get(w.continues) ?? out.get(w.continues);
    if (!label || !labels.includes(label)) continue;
    if (out.get(w.continues) === label) {
      out.delete(w.continues);
      yielded.add(w.continues);
    } else if (taken.has(label)) continue;
    out.set(w.id, label);
    taken.add(label);
  }
  for (const w of workers) {
    if (out.has(w.id) || yielded.has(w.id)) continue;
    const free = labels.find((l) => !taken.has(l));
    if (!free) break;
    out.set(w.id, free);
    taken.add(free);
  }
  for (const id of out.keys()) if (!ids.has(id)) out.delete(id);
  return out;
}

const STATUS_WORDS: Record<OfficeWorkerStatus, string> = {
  starting: "arrancando",
  working: "trabajando",
  thinking: "pensando",
  blocked: "bloqueado por un guardrail",
  done: "terminó",
  error: "falló",
};

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Resuelve a quién se refiere el humano: por su voz ("Iván"), por su
 * proyecto ("el de video-edit") o por su tarea. Ambiguo = la lista de opciones,
 * para que el modelo repregunte en vez de elegir.
 */
export function resolveOfficeTarget(
  who: string,
  workers: readonly OfficeWorker[],
  voices: ReadonlyMap<string, string>,
  pool: readonly OfficeVoice[],
  projectName: (slug: string) => string,
): { worker: OfficeWorker } | { error: string; options: string[] } {
  const q = norm(who);
  if (!q) return { error: "No dijiste a quién", options: [] };
  const byLabel = pool.find((v) => norm(v.label) === norm(castLabel(who)) || norm(v.name) === q);
  if (byLabel) {
    const id = [...voices].find(([, l]) => l === byLabel.label)?.[0];
    const w = id ? workers.find((x) => x.id === id) : undefined;
    if (w) return { worker: w };
    return { error: `${byLabel.name} no tiene un agente asignado ahora mismo`, options: [] };
  }
  const hits = workers.filter((w) => {
    const hay = [w.project, projectName(w.project), w.name, w.task.name].map(norm);
    return hay.some((h) => h && (h.includes(q) || q.includes(h)));
  });
  if (hits.length === 1) return { worker: hits[0] };
  if (hits.length > 1) {
    return { error: `Hay ${hits.length} agentes que encajan con "${who}"`, options: hits.map((w) => describeWorker(w, voices, pool, projectName)) };
  }
  return { error: `No hay ningún agente que encaje con "${who}"`, options: [] };
}

function voiceName(id: string, voices: ReadonlyMap<string, string>, pool: readonly OfficeVoice[]): string | null {
  const label = voices.get(id);
  return label ? (pool.find((v) => v.label === label)?.name ?? label) : null;
}

/** Una línea por personaje, con datos reales: voz, proyecto, estado, tarea y lo último que hizo. */
export function describeWorker(
  w: OfficeWorker,
  voices: ReadonlyMap<string, string>,
  pool: readonly OfficeVoice[],
  projectName: (slug: string) => string,
): string {
  const voice = voiceName(w.id, voices, pool);
  const parts = [
    voice ? `${voice} (voz <${voices.get(w.id)}>)` : "sin voz",
    `proyecto ${projectName(w.project)}`,
    STATUS_WORDS[w.status],
    `tarea: «${w.task.name}»`,
  ];
  if (w.status === "working" && w.tool) parts.push(`ahora: ${w.tool.name}${w.tool.target ? ` ${w.tool.target}` : ""}`);
  if ((w.status === "done" || w.status === "error") && w.lastText) parts.push(`resultado: ${w.lastText.slice(0, 280)}`);
  return parts.join(" · ");
}

export function describeOfficeTeam(
  workers: readonly OfficeWorker[],
  voices: ReadonlyMap<string, string>,
  pool: readonly OfficeVoice[],
  projectName: (slug: string) => string,
): string {
  if (!workers.length) return "La oficina está vacía: no hay agentes trabajando ahora mismo.";
  return workers.map((w) => `- ${describeWorker(w, voices, pool, projectName)}`).join("\n");
}
