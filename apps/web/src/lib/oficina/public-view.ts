// Vista pública en el navegador: la redacción pura de @hermes/shared aplicada a
// TODO lo que se pinta — la traza, el system prompt, las tools, y también lo
// que la escena 3D dibuja en texturas (laptops, monitores, sala de control,
// tableros, TV, pods). Se aplica a los datos ANTES de entregarlos a React o a
// three.js: lo oculto nunca llega al DOM ni a un canvas.

import { useEffect, useMemo, useState } from "react";
import {
  CLIENT_LABEL,
  GENERAL_PROJECT,
  HIDDEN,
  redactText,
  type OfficeBoards,
  type OfficeWorker,
  type PublicViewContext,
  type QueueState,
  type UpcomingCalendar,
} from "@hermes/shared";
import { hermesGet } from "@/lib/hermes";
import type { FeedLine } from "@/lib/oficina/room";

export interface PublicViewInfo {
  publicProjects: string[];
  hiddenTerms: string[];
  /** Nombres de proyectos públicos: se protegen de los términos ocultos. */
  publicTerms?: string[];
  configured: boolean;
  path: string;
  /** El agente no respondió: se oculta todo proyecto que no sea general (mejor de más que de menos). */
  unknown?: boolean;
}

/** Lista pública y términos a ocultar, del agente (una vez por visita). */
export function usePublicViewInfo(): PublicViewInfo | null {
  const [info, setInfo] = useState<PublicViewInfo | null>(null);
  useEffect(() => {
    let alive = true;
    hermesGet<PublicViewInfo>("/office/public-view")
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo({ publicProjects: [GENERAL_PROJECT], hiddenTerms: [], configured: false, path: "", unknown: true }));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

export type Redact = (s: string) => string;

/** Un redactor con caché (los mismos textos se repintan muchas veces). Apagado = identidad. */
export function useRedactor(on: boolean, info: PublicViewInfo | null): Redact {
  return useMemo(() => {
    if (!on) return (s: string) => s;
    const ctx: PublicViewContext = { hiddenTerms: info?.hiddenTerms ?? [], publicTerms: info?.publicTerms ?? [] };
    const cache = new Map<string, string>();
    return (s: string) => {
      if (!s) return s;
      const hit = cache.get(s);
      if (hit !== undefined) return hit;
      const out = redactText(s, ctx);
      if (cache.size > 4000) cache.clear();
      cache.set(s, out);
      return out;
    };
  }, [on, info]);
}

/** ¿Este proyecto se puede nombrar en pantalla? */
export function projectIsPublic(slug: string, info: PublicViewInfo | null): boolean {
  if (slug === GENERAL_PROJECT) return true;
  if (!info || info.unknown) return false;
  return info.publicProjects.some((p) => p.toLowerCase() === slug.toLowerCase());
}

export const CLIENT_PROJECT_NAME = "Proyecto de cliente";

/** Un personaje como se puede mostrar: sus textos redactados (el id, el estado y el asiento no cambian). */
export function redactWorker(w: OfficeWorker, r: Redact): OfficeWorker {
  return {
    ...w,
    name: r(w.name),
    task: { name: r(w.task.name), summary: r(w.task.summary) },
    tool: w.tool ? { name: w.tool.name, target: r(w.tool.target) } : undefined,
    lastText: w.lastText ? r(w.lastText) : w.lastText,
    lines: w.lines.map(r),
    approval: w.approval ? { ...w.approval, summary: r(w.approval.summary), detail: r(w.approval.detail) } : undefined,
  };
}

export function redactFeed(lines: FeedLine[], r: Redact): FeedLine[] {
  return lines.map((l) => ({ ...l, text: r(l.text) }));
}

export function redactBoards(b: OfficeBoards | null, r: Redact): OfficeBoards | null {
  if (!b) return b;
  const items = <T extends { items: unknown[] }>(src: T): T => ({
    ...src,
    items: (src.items as Record<string, unknown>[]).map((it) => {
      const out: Record<string, unknown> = { ...it };
      for (const [k, v] of Object.entries(out)) if (typeof v === "string" && k !== "id" && k !== "url") out[k] = r(v);
      return out;
    }),
  });
  return { ...b, issues: items(b.issues), prs: items(b.prs), services: items(b.services) };
}

export function redactQueue(q: QueueState | null | undefined, r: Redact): QueueState | null | undefined {
  if (!q) return q;
  return { ...q, items: q.items.map((i) => ({ ...i, title: r(i.title), prompt: r(i.prompt), ...(i.error ? { error: r(i.error) } : {}) })) };
}

/** La agenda en un proyector: se ve que hay eventos y cuándo, no de qué son. */
export function redactCalendar(c: UpcomingCalendar | null): UpcomingCalendar | null {
  if (!c) return c;
  const events = (c as unknown as { events?: Record<string, unknown>[] }).events;
  if (!Array.isArray(events)) return c;
  return { ...c, events: events.map((e) => ({ ...e, title: `(${HIDDEN})`, ...(e.location ? { location: "" } : {}), ...(e.description ? { description: "" } : {}) })) } as UpcomingCalendar;
}

export { CLIENT_LABEL, HIDDEN };
