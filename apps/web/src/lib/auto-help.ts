"use client";

// Preferencia "ayuda automática" de inglés: qué sale SOLO cuando te preguntan
// algo, en la práctica con la tutora y en la clase por Meet. Por defecto la
// frase completa (Rulo: "siempre voy a necesitar esa ayuda"). Vive en
// localStorage (conveniencia por navegador) y se sincroniza entre los
// componentes que la muestran (riel de práctica, riel de clase, ventanita).

import { useEffect, useState } from "react";
import type { AutoHelpMode } from "@hermes/shared";

const KEY = "hermes-english-autohelp";
const EVENT = "hermes:autohelp";
const DEFAULT: AutoHelpMode = "full";

export const AUTO_HELP_OPTIONS: { mode: AutoHelpMode; label: string; title: string }[] = [
  { mode: "full", label: "Frase", title: "Cuando te preguntan, la respuesta completa para decirla" },
  { mode: "scaffold", label: "Pistas", title: "Cuando te preguntan, palabras clave + cómo arrancar" },
  { mode: "off", label: "No", title: "Nada automático: solo los botones" },
];

export function readAutoHelp(): AutoHelpMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "full" || v === "scaffold" || v === "off" ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function writeAutoHelp(mode: AutoHelpMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* sin storage: vale para esta pestaña igual */
  }
  window.dispatchEvent(new CustomEvent<AutoHelpMode>(EVENT, { detail: mode }));
}

export function useAutoHelp(): [AutoHelpMode, (mode: AutoHelpMode) => void] {
  const [mode, setMode] = useState<AutoHelpMode>(DEFAULT);
  useEffect(() => {
    setMode(readAutoHelp());
    const on = (e: Event) => setMode((e as CustomEvent<AutoHelpMode>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [mode, writeAutoHelp];
}
