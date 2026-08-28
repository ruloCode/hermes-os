"use client";

// Rail de iconos: la navegación deja de gritar.
//
// Reemplaza al header con NavTabs (3 rutas) + la TabBar de 7 tabs en mayúsculas
// que competían con la consola. Aquí el destino activo se marca con LUZ, no con
// una caja, y las etiquetas viven en tooltips: el rail cuesta 60px y devuelve
// ~200px de ancho al contenido.
//
// Mezcla rutas (Orquestador · Vida · Agenda) y tabs del workspace (Tareas,
// Reuniones, Memoria) en una sola lista porque para quien lo usa son lo mismo:
// "a dónde voy". La distinción ruta/tab es un detalle de implementación.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace, type CenterTab } from "@/state/WorkspaceContext";

type Dest =
  | { kind: "route"; href: string; label: string; icon: React.ReactNode }
  | { kind: "tab"; tab: CenterTab; label: string; icon: React.ReactNode };

const I = (d: string, extra?: React.ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    {extra}
  </svg>
);

const DESTS: Dest[] = [
  {
    kind: "route",
    href: "/",
    label: "Orquestador",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="9" opacity=".45" />
      </svg>
    ),
  },
  { kind: "tab", tab: "tareas", label: "Tareas", icon: I("M4 6h16M4 12h16M4 18h9") },
  {
    kind: "tab",
    tab: "reuniones",
    label: "Reuniones",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    kind: "tab",
    tab: "memoria",
    label: "Memoria",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="2.4" />
        <circle cx="5" cy="7" r="1.7" />
        <circle cx="19" cy="8" r="1.7" />
        <circle cx="7" cy="18" r="1.7" />
        <path d="M10 11 6.4 8.2M14 11.4 17.4 9.3M11 14.2 8.2 16.6" opacity=".5" />
      </svg>
    ),
  },
  { kind: "route", href: "/agenda", label: "Agenda", icon: I("M3 10h18M8 3v4M16 3v4", <rect x="3" y="5" width="18" height="16" rx="2" />) },
  // Vida se separó en tres secciones (2026-07): finanzas · hábitos · inglés.
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
];

export function SideRail() {
  const pathname = usePathname();
  const ws = useWorkspace();
  const inHome = pathname === "/";

  return (
    <nav aria-label="Navegación" className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-line py-4">
      <span aria-hidden className="mb-5 grid h-6.5 w-6.5 place-items-center drop-shadow-[0_0_7px_rgb(167_139_250_/_0.55)]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 2 21.5 7v10L12 22 2.5 17V7z" stroke="currentColor" strokeWidth="1.2" className="text-violet" fill="rgb(167 139 250 / 0.09)" />
          <circle cx="12" cy="12" r="3.1" className="fill-violet-hot" />
        </svg>
      </span>

      <div className="flex flex-1 flex-col gap-1">
        {DESTS.map((d) => {
          const active =
            d.kind === "route"
              ? d.kind === "route" && pathname === d.href && (d.href !== "/" || ws.tab === "consola" || ws.tab === "voz")
              : inHome && ws.tab === d.tab;

          const cls = `group relative grid h-9.5 w-9.5 cursor-pointer place-items-center rounded-sm transition-colors ${
            active ? "bg-violet/9 text-violet" : "text-text-faint hover:bg-violet/5 hover:text-text-dim"
          }`;

          const inner = (
            <>
              {d.icon}
              {/* El activo se marca con luz, no con una caja */}
              {active && (
                <span aria-hidden className="absolute -left-2.5 h-4 w-0.5 rounded-xs bg-violet shadow-[0_0_10px_var(--color-violet)]" />
              )}
              <span className="pointer-events-none absolute left-11 z-40 -translate-x-1 rounded-sm border border-line bg-panel-2 px-2 py-1 text-2xs tracking-label whitespace-nowrap text-text-dim uppercase opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100">
                {d.label}
              </span>
            </>
          );

          return d.kind === "route" ? (
            <Link key={d.href} href={d.href} className={cls} aria-current={active ? "page" : undefined} title={d.label}>
              {inner}
            </Link>
          ) : (
            <button key={d.tab} type="button" onClick={() => ws.showPanel(d.tab)} className={cls} title={d.label}>
              {inner}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
