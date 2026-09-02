"use client";

/**
 * Tema de la app: "light" | "dark" | "system" (patrón ChatGPT: Apariencia →
 * Sistema/Oscuro/Claro). La preferencia vive en localStorage; el valor
 * RESUELTO se estampa en <html data-theme> y de ahí lo leen los tokens del
 * @theme (globals.css). El script de theme-init.ts hace lo mismo antes del
 * primer paint para que no haya destello.
 *
 * Canvas/three leen los tokens con readToken() (caché por sesión): al
 * cambiar de tema se limpia la caché y se emite `hermes:theme` para que los
 * que dibujan una sola vez se re-monten (ver MemoryView).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resetTokenCache } from "@/components/ui/tones";
import { THEME_STORAGE_KEY } from "./theme-init";

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeCtx {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
  /** Sistema → claro → oscuro → sistema… (para ⌘K y el botón del header). */
  cycle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const readPref = (): ThemePref => {
  if (typeof window === "undefined") return "system";
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};

const systemTheme = (): ResolvedTheme =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // El PRIMER render debe ser idéntico en servidor y cliente (si no, React
  // #418): arranca en system/dark y lee localStorage al montar. No hay
  // destello porque el script inline de theme-init.ts ya estampó data-theme
  // antes del paint; `ready` evita que este efecto lo pise con el default.
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [system, setSystem] = useState<ResolvedTheme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPrefState(readPref());
    setSystem(systemTheme());
    setReady(true);
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setSystem(mq.matches ? "light" : "dark");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = pref === "system" ? system : pref;

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (root.getAttribute("data-theme") === resolved) return;
    // Transición SOLO durante el cambio (si viviera siempre, cada hover
    // animaría colores en toda la app).
    root.setAttribute("data-theme-transition", "");
    root.setAttribute("data-theme", resolved);
    resetTokenCache();
    window.dispatchEvent(new CustomEvent("hermes:theme", { detail: resolved }));
    const t = setTimeout(() => root.removeAttribute("data-theme-transition"), 300);
    return () => clearTimeout(t);
  }, [resolved, ready]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      if (p === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      /* modo privado: la preferencia dura la sesión */
    }
  }, []);

  const cycle = useCallback(() => {
    setPref(pref === "system" ? "light" : pref === "light" ? "dark" : "system");
  }, [pref, setPref]);

  const value = useMemo(() => ({ pref, resolved, setPref, cycle }), [pref, resolved, setPref, cycle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme fuera de ThemeProvider");
  return v;
}
