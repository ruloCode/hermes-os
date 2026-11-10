// Cliente de la preparación de junta (`/meetings/prep*`, paquete «juntas» de v6).
// Contrato JSON en openspec/changes/v6-nucleo/specs/juntas (notas de implementación).

import type { MeetingPrep } from "@hermes/shared";
import { hermesFetch } from "./hermes";

type Reply<T> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<Reply<T>> {
  try {
    const res = await hermesFetch(path, init);
    if (!res.ok) return { ok: false, error: `El agente respondió ${res.status}` };
    const data = (await res.json()) as unknown;
    // Un objeto sin `ok` es otra ruta respondiendo (p. ej. /meetings/:project
    // registrada antes que /meetings/prep): se trata como falla, no como hoja.
    if (!data || typeof data !== "object" || Array.isArray(data) || typeof (data as { ok?: unknown }).ok !== "boolean") {
      return { ok: false, error: "Respuesta inesperada del agente" };
    }
    return data as Reply<T>;
  } catch {
    return { ok: false, error: "El agente no responde" };
  }
}

/** La hoja de hoy del proyecto (o `prep: null`). `stale` = entró un acta o cambió un pendiente desde que se armó. */
export function getMeetingPrep(project: string) {
  return call<{ prep: MeetingPrep | null; stale?: boolean }>(
    `/meetings/prep?project=${encodeURIComponent(project)}`,
  );
}

/** Genera la hoja (~10 s). Sin fuentes nuevas devuelve la guardada (`cached`). */
export function generateMeetingPrep(project: string, force = false) {
  return call<{ prep: MeetingPrep; cached: boolean }>("/meetings/prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, force }),
  });
}

/** Próximo evento del calendario con proyecto reconocido, y su hoja si ya existe. */
export function getNextMeetingPrep() {
  return call<{
    event: { title: string; startsAt: string } | null;
    project: string | null;
    projectName?: string;
    prep: MeetingPrep | null;
  }>("/meetings/prep/next");
}
