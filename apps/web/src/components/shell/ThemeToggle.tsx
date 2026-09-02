"use client";

/**
 * Apariencia: Sistema · Claro · Oscuro (patrón ChatGPT/Claude). Un botón en
 * el header que cicla; el tooltip dice qué hay y qué sigue. También existe
 * como comando ⌘K "Cambiar apariencia".
 */
import { useTheme, type ThemePref } from "@/state/ThemeProvider";

const LABEL: Record<ThemePref, string> = { system: "Sistema", light: "Claro", dark: "Oscuro" };

function Icon({ pref, resolved }: { pref: ThemePref; resolved: "light" | "dark" }) {
  if (pref === "system")
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    );
  if (resolved === "light")
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function ThemeToggle() {
  const { pref, resolved, cycle } = useTheme();
  const next: ThemePref = pref === "system" ? "light" : pref === "light" ? "dark" : "system";
  return (
    <button
      type="button"
      onClick={cycle}
      title={`Apariencia: ${LABEL[pref]} · clic → ${LABEL[next]}`}
      aria-label={`Apariencia: ${LABEL[pref]}`}
      className="grid h-8 w-8 cursor-pointer place-items-center rounded-sm text-text-dim transition-colors hover:bg-panel-2 hover:text-text"
    >
      <Icon pref={pref} resolved={resolved} />
    </button>
  );
}
