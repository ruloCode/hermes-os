"use client";

// Modo avión: estado del modelo local (llama.cpp) que el agente levanta a
// pedido. Un store de módulo fuera de React —lo comparten el chat y el
// comando de ⌘K— con UN sondeo mientras alguien lo mira: rápido mientras
// carga el modelo, lento cuando ya está listo.

import { useEffect, useSyncExternalStore } from "react";
import { hermesGet, hermesPost } from "@/lib/hermes";

export interface LocalLlmStatus {
  enabled: boolean;
  phase: "off" | "starting" | "ready" | "error";
  error?: string;
  model: { id: string; label: string; path: string; sizeGb: number | null };
  /** Rápido (2B) / Mejor (4B): los que se pueden elegir en esta Mac. */
  models: { id: string; label: string; hint: string; sizeGb: number | null; available: boolean }[];
  port: number;
  ctx: number;
}

let status: LocalLlmStatus | null = null;
let busy = false;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let watchers = 0;

const emit = () => listeners.forEach((l) => l());

function set(next: LocalLlmStatus | null) {
  status = next;
  emit();
}

async function refresh(): Promise<void> {
  try {
    set(await hermesGet<LocalLlmStatus>("/local-llm/status"));
  } catch {
    // Agente viejo sin la ruta o caído: el interruptor no se muestra.
    set(null);
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (!watchers) return;
  const ms = status?.phase === "starting" ? 1000 : 15_000;
  timer = setTimeout(() => void refresh().then(schedule), ms);
}

/** Prende/apaga el modo avión. Prender no espera a que cargue el modelo. */
export async function toggleLocalLlm(): Promise<void> {
  if (busy) return;
  busy = true;
  emit();
  try {
    const path = status?.enabled ? "/local-llm/off" : "/local-llm/on";
    set(await hermesPost<LocalLlmStatus>(path));
  } catch {
    await refresh();
  } finally {
    busy = false;
    emit();
    schedule();
  }
}

/** Cambia de modelo; con el modo prendido el agente recarga el servidor (~10 s). */
export async function setLocalLlmModel(id: string): Promise<void> {
  if (busy || status?.model.id === id) return;
  busy = true;
  emit();
  try {
    set(await hermesPost<LocalLlmStatus>("/local-llm/model", { model: id }));
  } catch {
    await refresh();
  } finally {
    busy = false;
    emit();
    schedule();
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let snapshot: { status: LocalLlmStatus | null; busy: boolean } = { status, busy };
const getSnapshot = () => {
  if (snapshot.status !== status || snapshot.busy !== busy) snapshot = { status, busy };
  return snapshot;
};
const getServerSnapshot = () => snapshot;

export function useLocalLlm() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    watchers++;
    void refresh().then(schedule);
    return () => {
      watchers--;
      if (!watchers && timer) clearTimeout(timer);
    };
  }, []);
  return { ...snap, toggle: toggleLocalLlm, setModel: setLocalLlmModel };
}
