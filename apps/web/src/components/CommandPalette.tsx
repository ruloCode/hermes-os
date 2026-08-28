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
  label: string;
  hint?: string;
  group: "comando" | "proyecto" | "tab";
  disabled?: boolean;
  run: () => void;
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
        run: () => {
          close();
          void c.run(ctx);
        },
      })),
      ...projects.map((p) => ({
        id: `proj:${p.slug}`,
        label: `Enfocar: ${p.name}`,
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

  if (!ws.paletteOpen) return null;

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
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[14vh] backdrop-blur-[2px]"
      onClick={() => ws.setPaletteOpen(false)}
      role="dialog"
      aria-label="Paleta de comandos"
    >
      <div
        className="hud-panel elev-2 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span aria-hidden className="text-violet">
            ⌘
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Comando, proyecto o panel…"
            className="min-w-0 flex-1 bg-transparent text-sm text-text placeholder:text-text-faint focus:outline-none"
            aria-label="Buscar comando"
          />
          <span className="text-2xs tracking-label text-text-faint uppercase">esc</span>
        </div>
        <div className="max-h-[46vh] overflow-y-auto overscroll-contain p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-text-dim">Sin coincidencias</p>
          )}
          {items.slice(0, 40).map((item, i) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={item.run}
              onMouseEnter={() => setCursor(i)}
              className={`flex w-full items-baseline justify-between gap-3 rounded-xs px-2.5 py-1.5 text-left transition-colors ${
                i === cursor ? "bg-violet/10" : ""
              } ${item.disabled ? "opacity-40" : ""}`}
            >
              <span className={`text-sm ${i === cursor ? "text-violet-hot" : "text-text"}`}>
                {item.label}
              </span>
              <span className="shrink-0 text-2xs tracking-label text-text-dim uppercase">
                {item.hint ?? item.group}
              </span>
            </button>
          ))}
        </div>
        {/* Cheat-sheet permanente (patrón Vapi/Linear): el footer enseña los
            atajos globales cada vez que se abre la palette. */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-2xs tracking-label text-text-faint uppercase">
          <span>↑↓ navegar · ↵ ejecutar · esc cerrar</span>
          <span className="hidden sm:inline">⌘1..7 tabs · ⌘B panel lateral</span>
        </div>
      </div>
    </div>
  );
}
