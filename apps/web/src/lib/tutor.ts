// Cliente del tutor de proyecto (Entender): API REST + el SSE de cada turno.
// El SSE va por fetch (POST con cuerpo y Bearer); EventSource no sirve.

import type {
  TutorConversation,
  TutorConversationSummary,
  TutorProject,
  TutorStreamEvent,
} from "@hermes/shared";
import { hermesFetch } from "./hermes";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listTutorProjects(): Promise<TutorProject[]> {
  return json(await hermesFetch("/tutor/projects"));
}

export async function listTutorConversations(project: string): Promise<TutorConversationSummary[]> {
  return json(await hermesFetch(`/tutor/${encodeURIComponent(project)}/conversations`));
}

export async function getTutorConversation(project: string, id: string): Promise<TutorConversation> {
  return json(
    await hermesFetch(
      `/tutor/${encodeURIComponent(project)}/conversations/${encodeURIComponent(id)}`,
    ),
  );
}

export async function deleteTutorConversation(project: string, id: string): Promise<void> {
  await json(
    await hermesFetch(
      `/tutor/${encodeURIComponent(project)}/conversations/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  );
}

/**
 * Un turno del tutor. Resuelve al cerrar el stream; cada evento llega por
 * `onEvent` en orden. Abortar el signal corta el turno en el agente también.
 */
export async function streamTutor(
  project: string,
  body: { message: string; conversationId?: string; voice?: boolean },
  onEvent: (ev: TutorStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await hermesFetch(`/tutor/${encodeURIComponent(project)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as TutorStreamEvent);
      } catch {
        /* frame a medias o ruido */
      }
    }
  }
}
