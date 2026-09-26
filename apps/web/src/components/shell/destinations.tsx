"use client";

// LOS DESTINOS DEL WORKSPACE, EN UN SOLO SITIO.
//
// Antes esta lista vivía duplicada y descuadrada: `DESTS` en SideRail.tsx tenía
// 10 entradas y `TAB_ORDER` en useHotkeys.ts tenía otras 7, en otro orden y con
// otros miembros. Dos consecuencias reales:
//
//  1. ⌘4 abría Tareas, que en el rail era el SEGUNDO icono. Los números no
//     correspondían a nada que se viera en pantalla.
//  2. Tres superficies no existían en la navegación: la consola de ejecución
//     (`claude`), la voz en vivo (`voz`) y la actividad (`actividad`). La peor
//     es la primera: al ejecutar una tarea el código hace setTab("claude") y
//     aterrizabas donde de verdad está pasando el trabajo SIN ningún ítem del
//     rail encendido — la pantalla más importante era la única sin dirección.
//
// Ahora hay una lista y un orden. El rail la pinta y los atajos la numeran, así
// que ⌘N siempre abre el enésimo icono que ves.
//
// Mezcla rutas y tabs a propósito: para quien lo usa son lo mismo ("a dónde
// voy"), y la distinción es un detalle de implementación — `showPanel` navega
// a "/" solo si hace falta.
//
// PENDIENTE: trece destinos son muchos. `voz` y `actividad` responden la misma
// pregunta que la consola ("qué está haciendo Hermes") y son candidatas a
// plegarse dentro de ella; mientras tanto están aquí, que es mejor que estar
// solo en ⌘K.

import type { CenterTab } from "@/state/WorkspaceContext";

export type Dest =
  | { kind: "route"; href: string; label: string; icon: React.ReactNode }
  | { kind: "tab"; tab: CenterTab; label: string; icon: React.ReactNode };

const I = (d: string, extra?: React.ReactNode) => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    {extra}
  </svg>
);

/** El agente: conversar, ejecutar, y lo que quedó de ello. */
export const DESTS_AGENTE: Dest[] = [
  {
    kind: "route",
    href: "/",
    label: "Orquestador",
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="9" opacity=".45" />
      </svg>
    ),
  },
  // La consola de ejecución: donde streamea el trabajo real del agente.
  {
    kind: "tab",
    tab: "claude",
    label: "Consola",
    icon: I("M5 7.5 9 12l-4 4.5M12.5 16.5H19"),
  },
  {
    kind: "tab",
    tab: "tareas",
    label: "Tareas",
    icon: I("M4 6h16M4 12h16M4 18h9"),
  },
  {
    kind: "tab",
    tab: "reuniones",
    label: "Reuniones",
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    kind: "tab",
    tab: "voz",
    label: "Voz en vivo",
    icon: I(
      "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
      <rect x="9.5" y="3" width="5" height="10" rx="2.5" />,
    ),
  },
  {
    kind: "tab",
    tab: "actividad",
    label: "Actividad",
    icon: I("M3 12h3.5L9 5l4 14 2.5-7H21"),
  },
  {
    kind: "tab",
    tab: "memoria",
    label: "Memoria",
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="2.4" />
        <circle cx="5" cy="7" r="1.7" />
        <circle cx="19" cy="8" r="1.7" />
        <circle cx="7" cy="18" r="1.7" />
        <path d="M10 11 6.4 8.2M14 11.4 17.4 9.3M11 14.2 8.2 16.6" opacity=".5" />
      </svg>
    ),
  },
];

/** La vida y la creación: superficies propias, cada una su ruta. */
export const DESTS_VIDA: Dest[] = [
  {
    kind: "route",
    href: "/agenda",
    label: "Agenda",
    icon: I("M3 10h18M8 3v4M16 3v4", <rect x="3" y="5" width="18" height="16" rx="2" />),
  },
  {
    kind: "route",
    href: "/finanzas",
    label: "Finanzas",
    icon: I(
      "M3 8.5V7a2 2 0 0 1 2-2h11M3 8.5V17a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V10.5a2 2 0 0 0-2-2H3z",
      <circle cx="15.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />,
    ),
  },
  {
    kind: "route",
    href: "/habitos",
    label: "Hábitos",
    icon: I("M8.5 12.5l2.5 2.5 4.5-5", <circle cx="12" cy="12" r="9" opacity=".45" />),
  },
  {
    kind: "route",
    href: "/ingles",
    label: "Inglés",
    icon: I(
      "M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18",
      <circle cx="12" cy="12" r="9" opacity=".45" />,
    ),
  },
  // Estudio de contenido (marca RuloCode): claqueta.
  {
    kind: "route",
    href: "/estudio",
    label: "Estudio",
    icon: I(
      "M4 9.5h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-9zM4 9.5 3 6.8l15.5-2.6 1 2.7L4 9.5z",
      <path d="M7.5 8.9 9.3 5.6M12.4 8.1l1.8-3.3M17.2 7.3 19 4.1" opacity=".5" />,
    ),
  },
  // Composición: escribir canciones (letra + tonalidad + acordes). Clave de sol.
  {
    kind: "route",
    href: "/composicion",
    label: "Composición",
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M9 18V6.5l10-2V16" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6.8" cy="18" r="2.2" />
        <circle cx="16.8" cy="16" r="2.2" />
      </svg>
    ),
  },
];

/** Lista plana en el orden EXACTO en que el rail los pinta. La numeran ⌘1..⌘9. */
export const DESTS: Dest[] = [...DESTS_AGENTE, ...DESTS_VIDA];

/** Cuántos destinos alcanza el teclado: ⌘1..⌘9, los nueve primeros del rail. */
export const HOTKEY_DESTS = 9;
