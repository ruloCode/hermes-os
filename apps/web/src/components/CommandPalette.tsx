"use client";

// Command palette (⌘K): comandos del registry + enfocar proyecto + ir a tab.
// Navegación con ↑↓ + Enter, filtro por texto, Esc cierra (lo maneja
// useHotkeys). Todo son capacidades reales del workspace.

import { useEffect, useMemo, useRef, useState } from "react";
import { useHermesData } from "@/hooks/useHermesData";
import { useWorkspace, type CenterTab } from "@/state/WorkspaceContext";
import { COMMANDS, useCommandContext } from "@/lib/commands";

interface Item {
  id: string;
  /** Texto contra el que se filtra (incluye el verbo: "Enfocar: X"). */
  label: string;
  /** Lo que se MUESTRA (sin el verbo repetido: el grupo ya lo dice). */
  title?: string;
  hint?: string;
  group: "comando" | "proyecto" | "tab";
  disabled?: boolean;
  /** Por qué está apagada (antes solo bajaba la opacidad y se leía rota). */
  disabledReason?: string;
  run: () => void;
}

// Grupos con nombre (patrón Raycast/Linear): el orden del registry se respeta.
const GROUP_LABEL: Record<Item["group"], string> = {
  comando: "Comandos",
  proyecto: "Enfocar proyecto",
  tab: "Ir a",
};

/** Cuántas filas se pintan a la vez (el filtro trae el resto). */
const MAX_ITEMS = 80;

const GROUP_ICON: Record<Item["group"], React.ReactNode> = {
  comando: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
    </svg>
  ),
  proyecto: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </svg>
  ),
  tab: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-panel-2 px-1 font-sans text-2xs text-text-dim">
      {children}
    </kbd>
  );
}

const TABS: { id: CenterTab; label: string }[] = [
  { id: "voz", label: "Voz en vivo" },
  { id: "consola", label: "Consola" },
  { id: "actividad", label: "Actividad" },
  { id: "tareas", label: "Tareas" },
  { id: "reuniones", label: "Reuniones" },
  { id: "memoria", label: "Memoria" },
  { id: "claude", label: "Claude Code" },
];

export function CommandPalette() {
  const ws = useWorkspace();
  const ctx = useCommandContext();
  const { projects } = useHermesData();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Al abrir: foco al input y filtro limpio.
  useEffect(() => {
    if (ws.paletteOpen) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [ws.paletteOpen]);

  const items = useMemo<Item[]>(() => {
    const close = () => ws.setPaletteOpen(false);
    const all: Item[] = [
      ...COMMANDS.map((c) => ({
        id: `cmd:${c.id}`,
        label: c.label,
        hint: c.hint,
        group: "comando" as const,
        disabled: Boolean(
          (c.requiresProject && !ws.selectedProject) ||
            (c.requiresLiveMeeting && !ctx.liveMeetingActive),
        ),
        disabledReason:
          c.requiresLiveMeeting && !ctx.liveMeetingActive
            ? "Sin junta en vivo"
            : c.requiresProject && !ws.selectedProject
              ? "Requiere proyecto"
              : undefined,
        run: () => {
          close();
          void c.run(ctx);
        },
      })),
      ...projects.map((p) => ({
        id: `proj:${p.slug}`,
        label: `Enfocar: ${p.name}`,
        title: p.name,
        hint: p.estado,
        group: "proyecto" as const,
        run: () => {
          close();
          ws.focusProject(p.slug);
        },
      })),
      ...TABS.map((t) => ({
        id: `tab:${t.id}`,
        label: `Ir a: ${t.label}`,
        title: t.label,
        group: "tab" as const,
        run: () => {
          close();
          ws.showPanel(t.id);
        },
      })),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) => i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, projects, ws.selectedProject, ws.paletteOpen, ctx.liveMeetingActive]);

  useEffect(() => setCursor(0), [query]);

  // El cursor siempre visible: con flechas no se puede perder fuera del scroll.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!ws.paletteOpen) return null;

  const shown = items.slice(0, MAX_ITEMS);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[cursor];
      if (item && !item.disabled) item.run();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
      onClick={() => ws.setPaletteOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
    >
      <div
        className="hud-in flex w-full max-w-[640px] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="hud-field flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
            className="shrink-0 text-text-faint"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca un comando, proyecto o vista…"
            className="min-w-0 flex-1 bg-transparent text-md text-text placeholder:text-text-faint focus:outline-none"
            aria-label="Buscar comando"
            role="combobox"
            aria-expanded="true"
            aria-controls="hermes-palette-list"
            aria-activedescendant={shown[cursor] ? `pal-${cursor}` : undefined}
          />
          <Kbd>esc</Kbd>
        </div>
        <div
          ref={listRef}
          id="hermes-palette-list"
          role="listbox"
          className="max-h-[min(52vh,440px)] overflow-y-auto overscroll-contain p-1.5"
        >
          {shown.length === 0 && (
            <div className="px-3 py-10 text-center">
              <p className="text-sm text-text">Sin coincidencias</p>
              <p className="mt-1 text-xs text-text-faint">Prueba con otra palabra.</p>
            </div>
          )}
          {shown.map((item, i) => {
            const newGroup = i === 0 || shown[i - 1].group !== item.group;
            const on = i === cursor;
            return (
              <div key={item.id}>
                {newGroup && (
                  <p
                    className={`px-3 pb-1 text-2xs font-medium text-text-faint ${i === 0 ? "pt-1.5" : "pt-3"}`}
                  >
                    {GROUP_LABEL[item.group]}
                  </p>
                )}
                <button
                  id={`pal-${i}`}
                  data-idx={i}
                  type="button"
                  role="option"
                  aria-selected={on}
                  aria-disabled={item.disabled || undefined}
                  disabled={item.disabled}
                  onClick={item.run}
                  onMouseMove={() => cursor !== i && setCursor(i)}
                  className={`flex h-9 w-full min-w-0 cursor-pointer items-center gap-3 rounded-sm px-3 text-left transition-colors disabled:cursor-default ${
                    on ? "bg-selected" : ""
                  } ${item.disabled ? "opacity-45" : ""}`}
                >
                  <span className={`shrink-0 ${on ? "text-text" : "text-text-faint"}`}>
                    {GROUP_ICON[item.group]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
                    {item.title ?? item.label}
                  </span>
                  {item.disabled ? (
                    <span className="shrink-0 text-xs text-text-faint">
                      {item.disabledReason}
                    </span>
                  ) : (
                    item.hint && (
                      <span className="max-w-[46%] shrink-0 truncate text-right text-xs text-text-faint">
                        {item.hint}
                      </span>
                    )
                  )}
                  {on && !item.disabled && <Kbd>↵</Kbd>}
                </button>
              </div>
            );
          })}
        </div>
        {/* Cheat-sheet permanente (patrón Vapi/Linear): el footer enseña los
            atajos globales cada vez que se abre la palette. */}
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-line px-3.5 text-2xs text-text-faint">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              navegar
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              ejecutar
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              cerrar
            </span>
          </span>
          <span className="hidden items-center gap-3 sm:flex">
            <span className="flex items-center gap-1.5">
              <Kbd>⌘1–9</Kbd>
              vistas
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>⌘B</Kbd>
              barra lateral
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
