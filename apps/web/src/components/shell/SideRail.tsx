"use client";

// Rail de iconos: la navegación deja de gritar.
//
// Reemplaza al header con NavTabs (3 rutas) + la TabBar de 7 tabs en mayúsculas
// que competían con la consola. Aquí el destino activo se marca con LUZ, no con
// una caja, y las etiquetas viven en tooltips: el rail cuesta 60px y devuelve
// ~200px de ancho al contenido.
//
// La LISTA vive en destinations.tsx, compartida con los atajos de teclado: el
// rail la pinta en ese orden y ⌘1..⌘9 numeran lo que se ve (ver la nota de ese
// archivo — antes ⌘4 abría el segundo icono).
//
// Se divide en dos grupos con una hairline: arriba el AGENTE (conversar,
// ejecutar y lo que quedó), abajo la VIDA y la creación. Trece destinos sin
// agrupar eran una lista para leer entera cada vez.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/state/WorkspaceContext";
import { DESTS_AGENTE, DESTS_VIDA, DESTS, HOTKEY_DESTS, type Dest } from "./destinations";

export function SideRail() {
  const pathname = usePathname();
  const ws = useWorkspace();
  const inHome = pathname === "/";

  const item = (d: Dest) => {
    // Una ruta está activa si es la actual. "/" además exige que el centro esté
    // en la consola: si estás en un tab del workspace, el encendido es de ESE
    // tab, no del Orquestador.
    const active =
      d.kind === "route"
        ? pathname === d.href && (d.href !== "/" || ws.tab === "consola")
        : inHome && ws.tab === d.tab;

    // El índice del atajo sale de la lista plana, que es el orden que se ve.
    const idx = DESTS.indexOf(d);
    const hotkey = idx > -1 && idx < HOTKEY_DESTS ? `⌘${idx + 1}` : null;

    const cls = `group relative grid h-9.5 w-9.5 cursor-pointer place-items-center rounded-sm transition-colors ${
      active ? "bg-panel-2 text-text" : "text-text-dim hover:bg-panel-2/70 hover:text-text"
    }`;

    const inner = (
      <>
        {d.icon}
        {/* El activo se marca con luz, no con una caja */}
        {active && (
          <span aria-hidden className="absolute -left-2.5 h-4 w-0.5 rounded-full bg-accent" />
        )}
        <span className="pointer-events-none absolute left-11 z-40 flex -translate-x-1 items-center gap-2 rounded-sm border border-line bg-panel px-2 py-1 text-xs whitespace-nowrap text-text opacity-0 shadow-[var(--shadow-pop)] transition group-hover:translate-x-0 group-hover:opacity-100">
          {d.label}
          {hotkey && (
            <kbd className="rounded-xs border border-line px-1 font-sans text-2xs text-text-faint">
              {hotkey}
            </kbd>
          )}
        </span>
      </>
    );

    const title = hotkey ? `${d.label} (${hotkey})` : d.label;

    return d.kind === "route" ? (
      <Link
        key={d.href}
        href={d.href}
        className={cls}
        aria-current={active ? "page" : undefined}
        title={title}
      >
        {inner}
      </Link>
    ) : (
      <button
        key={d.tab}
        type="button"
        onClick={() => ws.showPanel(d.tab)}
        className={cls}
        title={title}
      >
        {inner}
      </button>
    );
  };

  return (
    <nav
      aria-label="Navegación"
      className="flex w-[60px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-bg py-4"
    >
      <span aria-hidden className="mb-5 grid h-6.5 w-6.5 shrink-0 place-items-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2 21.5 7v10L12 22 2.5 17V7z"
            stroke="currentColor"
            strokeWidth="1.4"
            className="text-accent"
            fill="color-mix(in srgb, var(--color-accent) 12%, transparent)"
          />
          <circle cx="12" cy="12" r="3.1" className="fill-accent-hot" />
        </svg>
      </span>

      <div className="flex shrink-0 flex-col gap-1">{DESTS_AGENTE.map(item)}</div>
      <span aria-hidden className="my-2 h-px w-5 shrink-0 bg-line" />
      <div className="flex shrink-0 flex-col gap-1">{DESTS_VIDA.map(item)}</div>
    </nav>
  );
}
