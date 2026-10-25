"use client";

// Mostrar/ocultar el riel derecho de contexto de la vista (⌥⌘B o ⌘K "panel
// derecho"; la preferencia vive en WorkspaceContext). Va en el borde derecho
// de la ViewHeader, al lado de lo que esconde, y solo en lg+: debajo de eso el
// riel no es columna lateral sino un bloque más del scroll.
//
// Nació en la topbar de v4; con v5 la topbar se fue y la cabecera de cada
// vista es la única barra superior, así que el botón vive aquí.

import { useWorkspace } from "@/state/WorkspaceContext";

export function RailToggle() {
  const ws = useWorkspace();
  const verb = ws.railOpen ? "Ocultar" : "Mostrar";
  return (
    <button
      type="button"
      onClick={ws.toggleRail}
      title={`${verb} panel derecho (⌥⌘B)`}
      aria-label={`${verb} panel derecho`}
      aria-pressed={ws.railOpen}
      className={`hidden h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-xs transition-colors hover:bg-hover hover:text-text lg:grid ${
        ws.railOpen ? "text-text-dim" : "text-text-faint"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
        {ws.railOpen && <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4z" fill="currentColor" fillOpacity="0.18" stroke="none" />}
      </svg>
    </button>
  );
}
