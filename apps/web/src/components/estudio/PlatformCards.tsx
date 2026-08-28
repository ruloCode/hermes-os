"use client";

/**
 * A qué redes va la pieza — en tarjetas con icono, no en un desplegable.
 *
 * El desplegable de plataforma + "＋ Variante" obligaba a saber de memoria qué
 * redes existían, cuál se sube sola y qué formato pedía cada una. Aquí las
 * cuatro cosas se ven de un vistazo: icono, nombre, formato real y si Hermes
 * la sube o la subes tú. Encender una red ES elegirla: no hay paso extra.
 *
 * Iconos SVG inline (currentColor, sin dependencias ni red) — el branding del
 * dashboard manda sobre el color de marca de cada plataforma.
 */
import type { ContentPublication, PublishState } from "@hermes/shared";
import { PLATFORM_PROVIDER } from "@hermes/shared";
import { PUBLISH_STATES } from "./labels";

export type Platform = ContentPublication["platform"];

/** Ficha de cada red: cómo se llama, qué formato pide y con qué icono se lee. */
export const PLATFORM_INFO: Record<
  Platform,
  { label: string; format: string; icon: React.ReactNode }
> = {
  shorts: {
    label: "YouTube Shorts",
    format: "9:16 · hasta 3 min",
    icon: <YouTubeIcon />,
  },
  youtube: {
    label: "YouTube",
    format: "16:9 o 9:16 · sin tope",
    icon: <YouTubeIcon />,
  },
  tiktok: { label: "TikTok", format: "9:16 · hasta 10 min", icon: <TikTokIcon /> },
  reels: { label: "Instagram Reels", format: "9:16 · hasta 90 s", icon: <InstagramIcon /> },
  linkedin: { label: "LinkedIn", format: "9:16 o 1:1 · hasta 10 min", icon: <LinkedInIcon /> },
  x: { label: "X", format: "16:9 o 9:16 · hasta 2:20", icon: <XIcon /> },
};

/** Orden de presentación: primero las que Hermes sube solo. */
export const ALL_PLATFORMS: Platform[] = ["shorts", "tiktok", "reels", "linkedin", "x", "youtube"];

export function PlatformCard({
  platform,
  active,
  state,
  onToggle,
}: {
  platform: Platform;
  active: boolean;
  /** Estado real si la red ya está encendida (null = todavía nada). */
  state: PublishState | null;
  onToggle: () => void;
}) {
  const info = PLATFORM_INFO[platform];
  const auto = PLATFORM_PROVIDER[platform] !== "manual";
  const pill = state ? PUBLISH_STATES[state] : null;

  return (
    <button
      onClick={onToggle}
      aria-pressed={active}
      className={`flex min-w-0 flex-col items-start gap-1 rounded-sm border px-2.5 py-2 text-left transition-colors ${
        active
          ? "border-violet/60 bg-violet/8"
          : "border-line bg-transparent opacity-55 hover:opacity-100"
      }`}
    >
      <div className="flex w-full items-center gap-1.5">
        <span className={`shrink-0 ${active ? "text-violet" : "text-text-faint"}`}>
          {info.icon}
        </span>
        <span className={`min-w-0 flex-1 truncate text-xs ${active ? "text-text" : "text-text-dim"}`}>
          {info.label}
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-2xs ${active ? "text-violet" : "text-text-faint"}`}
        >
          {active ? "✓" : "＋"}
        </span>
      </div>

      <span className="text-2xs text-text-faint tabular-nums">{info.format}</span>

      <div className="flex w-full items-center gap-1">
        <span
          className={`rounded-xs px-1 py-px text-[9px] tracking-label uppercase ${
            auto ? "bg-green/15 text-green" : "bg-panel-2 text-text-faint"
          }`}
        >
          {auto ? "automática" : "la subes tú"}
        </span>
        {active && pill && (
          <span className={`text-[9px] tracking-label uppercase ${TONE_TEXT[pill.tone]}`}>
            {pill.label}
          </span>
        )}
      </div>
    </button>
  );
}

/** Clases ESTÁTICAS por tono (Tailwind purga las interpoladas). */
const TONE_TEXT: Record<string, string> = {
  violet: "text-violet",
  cyan: "text-cyan",
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  neutral: "text-text-faint",
};

// ── Iconos (trazo simple, currentColor, 14px) ──────────────────────────

function YouTubeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M23 12s0-3.9-.5-5.8a3 3 0 0 0-2.1-2.1C18.5 3.5 12 3.5 12 3.5s-6.5 0-8.4.6A3 3 0 0 0 1.5 6.2C1 8.1 1 12 1 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 8.4.6 8.4.6s6.5 0 8.4-.6a3 3 0 0 0 2.1-2.1C23 15.9 23 12 23 12ZM9.8 15.5v-7l6.1 3.5-6.1 3.5Z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.6 5.8a5.4 5.4 0 0 1-1.3-3.3h-3.3v13.2a2.8 2.8 0 1 1-2-2.7V9.6a6.1 6.1 0 1 0 5.3 6V9.4a8.7 8.7 0 0 0 5 1.6V7.7a5.3 5.3 0 0 1-3.7-1.9Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM2.9 21h4.2V10H2.9v11ZM9.5 10v11h4.2v-6a2.1 2.1 0 0 1 4.2 0v6H22v-6.7c0-3-1.9-4.6-4.3-4.6-1.6 0-2.9.8-3.5 1.7V10H9.5Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.5 3h3.2l-7 8 8.3 10h-6.5l-5-6.1L4.6 21H1.4l7.5-8.6L1 3h6.7l4.6 5.6L17.5 3Zm-1.1 16.1h1.8L7.7 4.8H5.8l10.6 14.3Z" />
    </svg>
  );
}
