"use client";

/**
 * Lo que el TRANSPORTE decide (qué suena: acordes, batería, clic; la cuenta de
 * entrada) como un store pequeño, para que haya UN solo lugar de control: la
 * barra de abajo lo cambia y las etapas lo LEEN (Grabar muestra "metrónomo on"
 * y graba con ese clic, sin un segundo interruptor que se contradiga).
 *
 * Son preferencias del espectador, no del tema: viven en este navegador.
 * También lleva el CANDADO de grabación (`tempoLock`: Grabar lo cierra mientras
 * graba y fija el bpm Y la sección — cambiar cualquiera a mitad de una toma la
 * dejaría fuera de su rejilla) y el pedido de foco ("clic en los chips de
 * Grabar = ir al transporte").
 */
import { useSyncExternalStore } from "react";

export interface TransportSettings {
  chords: boolean;
  groove: boolean;
  metronome: boolean;
  countIn: 0 | 1 | 2;
}

export const TRANSPORT_DEFAULTS: TransportSettings = { chords: true, groove: true, metronome: true, countIn: 0 };

const KEY = "hermes-tema-transport";

function load(): TransportSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return TRANSPORT_DEFAULTS;
    const s = JSON.parse(raw) as Partial<TransportSettings>;
    return {
      chords: s.chords ?? TRANSPORT_DEFAULTS.chords,
      groove: s.groove ?? TRANSPORT_DEFAULTS.groove,
      metronome: s.metronome ?? TRANSPORT_DEFAULTS.metronome,
      countIn: s.countIn === 1 || s.countIn === 2 ? s.countIn : 0,
    };
  } catch {
    return TRANSPORT_DEFAULTS;
  }
}

interface State {
  settings: TransportSettings;
  /** Motivo por el que el tempo y la sección no se pueden tocar ahora (null = libres). */
  tempoLock: string | null;
}

let state: State | null = null;
const listeners = new Set<() => void>();
const SERVER: State = { settings: TRANSPORT_DEFAULTS, tempoLock: null };

function current(): State {
  if (!state) state = { settings: load(), tempoLock: null };
  return state;
}

function emit() {
  listeners.forEach((f) => f());
}

export const transportStore = {
  get: current,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  set(patch: Partial<TransportSettings>) {
    const s = current();
    state = { ...s, settings: { ...s.settings, ...patch } };
    try {
      localStorage.setItem(KEY, JSON.stringify(state.settings));
    } catch {
      /* sin almacenamiento: vive hasta recargar */
    }
    emit();
  },
  /** Cierra (motivo) o abre (null) el tempo y la sección. */
  lockTempo(reason: string | null) {
    const s = current();
    if (s.tempoLock === reason) return;
    state = { ...s, tempoLock: reason };
    emit();
  },
};

export function useTransport(): State {
  return useSyncExternalStore(transportStore.subscribe, current, () => SERVER);
}

/**
 * Lleva el foco al transporte (el campo de bpm o el interruptor de clic) y lo
 * hace destellar un instante. false = no hay transporte montado (QA aislada).
 */
export function focusTransport(target: "bpm" | "clic" = "bpm"): boolean {
  if (typeof document === "undefined") return false;
  const root = document.querySelector<HTMLElement>("[data-tema-transport]");
  if (!root) return false;
  const el = root.querySelector<HTMLElement>(`[data-transport-focus="${target}"]`);
  root.scrollIntoView({ block: "nearest", behavior: "smooth" });
  el?.focus({ preventScroll: true });
  root.dataset.flash = "1";
  window.setTimeout(() => {
    if (root.dataset.flash === "1") delete root.dataset.flash;
  }, 900);
  return true;
}
