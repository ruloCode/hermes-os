import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * "Aprender IA": la curaduría verificada (~/.hermes-os/youtube/curaduria-ia.json,
 * cada video confirmado con yt-dlp) + lo ya visto (visto.json). El teléfono la
 * muestra con miniaturas; "pon el siguiente de mi plan" pone el primero sin ver.
 */

const DIR = join(homedir(), ".hermes-os", "youtube");
const SEEN = join(DIR, "visto.json");

export interface LearnVideo {
  id: string;
  title: string;
  channel: string;
  duration: string;
  topic: string;
  why: string;
  thumbnail: string;
  week: number | null;
  seen: boolean;
}

interface Curation {
  topics: Array<{ id: string; name: string; videos: Array<{ id: string; title: string; channel: string; duration: string; why?: string }> }>;
  plan: Array<{ week: number; focus: string; videos: string[] }>;
}

/** Miniatura pública de YouTube (320×180): la sirve i.ytimg.com sin API key. */
export const thumbnailOf = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

async function readSeen(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(SEEN, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function markSeen(id: string): Promise<void> {
  const seen = await readSeen();
  seen[id] = new Date().toISOString();
  await mkdir(DIR, { recursive: true });
  await writeFile(SEEN, JSON.stringify(seen));
}

/** El plan en orden (semana 1 → 4) y después el resto por tema; null si no hay curaduría. */
export async function learnAi(): Promise<{ weeks: Array<{ week: number; focus: string }>; videos: LearnVideo[] } | null> {
  let c: Curation;
  try {
    c = JSON.parse(await readFile(join(DIR, "curaduria-ia.json"), "utf8")) as Curation;
  } catch {
    return null;
  }
  const seen = await readSeen();
  const weekOf = new Map<string, number>();
  for (const w of c.plan) for (const id of w.videos) if (!weekOf.has(id)) weekOf.set(id, w.week);
  const all: LearnVideo[] = c.topics.flatMap((t) =>
    t.videos.map((v) => ({
      id: v.id, title: v.title, channel: v.channel, duration: v.duration, topic: t.name, why: v.why ?? "",
      thumbnail: thumbnailOf(v.id), week: weekOf.get(v.id) ?? null, seen: !!seen[v.id],
    })),
  );
  const order = (v: LearnVideo) => (v.week ?? 99) * 100 + (v.week ? c.plan.find((w) => w.week === v.week)!.videos.indexOf(v.id) : 0);
  const unique = [...new Map(all.map((v) => [v.id, v])).values()].sort((a, b) => order(a) - order(b));
  return { weeks: c.plan.map((w) => ({ week: w.week, focus: w.focus })), videos: unique };
}

/** El siguiente sin ver del plan (o del resto si el plan ya se terminó). */
export async function nextToLearn(): Promise<LearnVideo | null> {
  return (await learnAi())?.videos.find((v) => !v.seen) ?? null;
}
