"use client";

// Cliente de la bandeja del pulso (/pulse/*). UN solo poll para toda la app:
// la barra lateral (contador) y la bandeja leen el mismo store. Se pide al
// montar el primer suscriptor, cada 60 s SOLO con la pestaña visible, y de
// nuevo al volver a ella. Las rutas responden `{ ok, … | error }` con 200.

import { useSyncExternalStore } from "react";
import type { PulseCard, PulseKind } from "@hermes/shared";
import { hermesFetch, hermesPost } from "./hermes";

export interface PulseRun {
  at: string;
  model: boolean;
  reason?: string;
  added: number;
  cards: number;
}

export interface PulseInboxData {
  mode: "off" | "inbox" | "notify";
  cards: PulseCard[];
  counts: { live: number; urgent: number; byKind: Partial<Record<PulseKind, number>> };
  never: PulseKind[];
  lastRun: PulseRun | null;
  calls: { today: number; max: number };
}

export type PulseSnapshot =
  | { status: "loading" }
  | { status: "ok"; data: PulseInboxData }
  | { status: "error"; error: string }
  | { status: "offline" };

const POLL_MS = 60_000;
let snapshot: PulseSnapshot = { status: "loading" };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function set(next: PulseSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

export async function refreshPulse(): Promise<void> {
  try {
    const res = await hermesFetch("/pulse/inbox");
    // 404 = un agente anterior a v6: la bandeja simplemente no existe.
    if (res.status === 404) return set({ status: "error", error: "Este agente aún no tiene el pulso." });
    if (!res.ok) return set({ status: "offline" });
    const j = (await res.json()) as ({ ok: true } & PulseInboxData) | { ok: false; error: string };
    set(j.ok ? { status: "ok", data: j } : { status: "error", error: j.error });
  } catch {
    set({ status: "offline" });
  }
}

function onVisible() {
  if (document.visibilityState === "visible") void refreshPulse();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    void refreshPulse();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshPulse();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

const SERVER: PulseSnapshot = { status: "loading" };

export function usePulseInbox(): PulseSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER);
}

/** Quita la tarjeta al instante (optimista) y confirma con el agente. */
function dropLocal(pred: (c: PulseCard) => boolean, never?: PulseKind) {
  if (snapshot.status !== "ok") return;
  const cards = snapshot.data.cards.filter((c) => !pred(c));
  set({
    status: "ok",
    data: {
      ...snapshot.data,
      cards,
      counts: { ...snapshot.data.counts, live: cards.length, urgent: cards.filter((c) => c.urgent).length },
      never: never && !snapshot.data.never.includes(never) ? [...snapshot.data.never, never] : snapshot.data.never,
    },
  });
}

export async function dismissPulseCard(id: string): Promise<{ ok: boolean; error?: string }> {
  dropLocal((c) => c.id === id);
  try {
    const r = await hermesPost<{ ok: boolean; error?: string }>(`/pulse/cards/${encodeURIComponent(id)}/dismiss`);
    if (!r.ok) void refreshPulse();
    return r;
  } catch (e) {
    void refreshPulse();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function neverPulseKind(card: PulseCard): Promise<{ ok: boolean; error?: string }> {
  dropLocal((c) => c.kind === card.kind, card.kind);
  try {
    const r = await hermesPost<{ ok: boolean; error?: string }>(`/pulse/cards/${encodeURIComponent(card.id)}/never`);
    if (!r.ok) void refreshPulse();
    return r;
  } catch (e) {
    void refreshPulse();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function undoNeverPulseKind(kind: PulseKind): Promise<void> {
  try {
    await hermesPost(`/pulse/never/${encodeURIComponent(kind)}/undo`);
  } finally {
    void refreshPulse();
  }
}

/** Evento global para abrir la bandeja desde cualquier lado (⌘K, contador). */
export const PULSE_OPEN_EVENT = "hermes:pulse-open";
export function openPulseInbox(): void {
  window.dispatchEvent(new Event(PULSE_OPEN_EVENT));
}
