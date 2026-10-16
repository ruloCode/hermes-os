"use client";

// LOS DESTINOS DEL WORKSPACE, EN UN SOLO SITIO.
//
// Antes esta lista vivía duplicada y descuadrada: `DESTS` en SideRail.tsx tenía
// 10 entradas y `TAB_ORDER` en useHotkeys.ts tenía otras 7, en otro orden y con
// otros miembros. Ahora hay una lista y un orden: la barra lateral la pinta y
// los atajos la numeran, así que ⌘N siempre abre el enésimo destino que ves.
//
// v5 (2026-10): los destinos van en CUATRO GRUPOS con nombre y con etiqueta
// visible. El rail de iconos de v4 pedía memorizar 15 dibujos sin texto — dos
// de ellos eran el mismo calendario (Reuniones y Agenda) — y la única forma de
// saber a dónde ibas era pasar el mouse. Con etiquetas, la navegación se LEE.
// El orden dentro de cada grupo va de lo más usado a lo menos.
//
// Mezcla rutas y tabs a propósito: para quien lo usa son lo mismo ("a dónde
// voy"), y la distinción es un detalle de implementación — `showPanel` navega
// a "/" solo si hace falta.

import type { CenterTab } from "@/state/WorkspaceContext";

export type Dest =
  | { kind: "route"; href: string; label: string; icon: React.ReactNode }
  | { kind: "tab"; tab: CenterTab; label: string; icon: React.ReactNode };

/** Icono de línea del set de navegación: 16px, trazo 1.6, mismas puntas. */
const I = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

const AGENTE: Dest[] = [
  {
    kind: "route",
    href: "/",
    label: "Inicio",
    icon: (
      <I>
        <path d="M3.5 10.5 12 3.8l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z" />
      </I>
    ),
  },
  // La consola de ejecución: donde streamea el trabajo real del agente.
  {
    kind: "tab",
    tab: "claude",
    label: "Consola",
    icon: (
      <I>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <path d="m7.5 9.5 2.8 2.5-2.8 2.5M13 15h3.5" />
      </I>
    ),
  },
  {
    kind: "tab",
    tab: "tareas",
    label: "Tareas",
    icon: (
      <I>
        <path d="m3.5 6.5 1.8 1.8L8.5 5M3.5 16.5l1.8 1.8 3.2-3.3M12 7h8.5M12 17h8.5M12 12h8.5" />
      </I>
    ),
  },
  {
    kind: "tab",
    tab: "reuniones",
    label: "Reuniones",
    icon: (
      <I>
        <circle cx="9" cy="8.5" r="3.3" />
        <path d="M3 19.5a6 6 0 0 1 12 0M15.8 5.4a3.3 3.3 0 0 1 0 6.2M17.8 14.2a6 6 0 0 1 3.2 5.3" />
      </I>
    ),
  },
  {
    kind: "tab",
    tab: "memoria",
    label: "Memoria",
    icon: (
      <I>
        <circle cx="12" cy="12" r="2.4" />
        <circle cx="5" cy="6.5" r="1.8" />
        <circle cx="19" cy="7.5" r="1.8" />
        <circle cx="7" cy="18.5" r="1.8" />
        <path d="M10.1 10.6 6.4 7.7M13.9 11.2l3.5-2.4M10.8 14.1l-2.6 3" />
      </I>
    ),
  },
  {
    kind: "tab",
    tab: "actividad",
    label: "Actividad",
    icon: (
      <I>
        <path d="M3 12h3.5L9 5l4 14 2.5-7H21" />
      </I>
    ),
  },
  {
    kind: "tab",
    tab: "voz",
    label: "Voz en vivo",
    icon: (
      <I>
        <path d="M3 10.5v3M7 7v10M11 4v16M15 8v8M19 10.5v3" />
      </I>
    ),
  },
];

const VIDA: Dest[] = [
  {
    kind: "route",
    href: "/agenda",
    label: "Agenda",
    icon: (
      <I>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </I>
    ),
  },
  {
    kind: "route",
    href: "/finanzas",
    label: "Finanzas",
    icon: (
      <I>
        <path d="M4 8.5V7a2 2 0 0 1 2-2h10.5M4 8.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2z" />
        <circle cx="15.5" cy="14" r="1" fill="currentColor" stroke="none" />
      </I>
    ),
  },
  {
    kind: "route",
    href: "/habitos",
    label: "Hábitos",
    icon: (
      <I>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
      </I>
    ),
  },
];

const APRENDER: Dest[] = [
  {
    kind: "route",
    href: "/ingles",
    label: "Inglés",
    icon: (
      <I>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.3 2.4 14.7 0 17M12 3.5c-2.4 2.3-2.4 14.7 0 17" />
      </I>
    ),
  },
  // Gimnasio de articulación: hablar con el punto primero. Mancuerna.
  {
    kind: "route",
    href: "/gimnasio",
    label: "Gimnasio",
    icon: (
      <I>
        <path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11" />
      </I>
    ),
  },
  // Entender: el tutor de proyecto (repos + actas, explica dibujando).
  {
    kind: "route",
    href: "/entender",
    label: "Entender",
    icon: (
      <I>
        <path d="M12 6.5C10.2 5 7.6 4.5 4 4.8v13.4c3.6-.3 6.2.2 8 1.7 1.8-1.5 4.4-2 8-1.7V4.8c-3.6-.3-6.2.2-8 1.7zM12 6.5v13.4" />
      </I>
    ),
  },
];

const CREAR: Dest[] = [
  // Estudio de contenido: claqueta.
  {
    kind: "route",
    href: "/estudio",
    label: "Estudio",
    icon: (
      <I>
        <path d="M4 9.5h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 9.5 3 6.8l15.5-2.6 1 2.7z" />
      </I>
    ),
  },
  // Composición: escribir canciones.
  {
    kind: "route",
    href: "/composicion",
    label: "Composición",
    icon: (
      <I>
        <path d="M9 18V6.5l10-2V16" />
        <circle cx="6.8" cy="18" r="2.2" />
        <circle cx="16.8" cy="16" r="2.2" />
      </I>
    ),
  },
];

/** Los grupos en el orden en que la barra lateral los pinta. */
export const NAV_GROUPS: { label: string; items: Dest[] }[] = [
  { label: "Agente", items: AGENTE },
  { label: "Vida", items: VIDA },
  { label: "Aprender", items: APRENDER },
  { label: "Crear", items: CREAR },
];

/** Lista plana en el orden EXACTO en que se ven. La numeran ⌘1..⌘9. */
export const DESTS: Dest[] = NAV_GROUPS.flatMap((g) => g.items);

/** Cuántos destinos alcanza el teclado: ⌘1..⌘9, los nueve primeros. */
export const HOTKEY_DESTS = 9;

/** Clave estable de un destino (para keys de React y comparaciones). */
export const destKey = (d: Dest) => (d.kind === "route" ? d.href : `tab:${d.tab}`);
