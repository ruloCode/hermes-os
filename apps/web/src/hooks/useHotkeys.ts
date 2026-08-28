"use client";

// Atajos globales del workspace: ⌘K palette · ⌘1..7 tabs · ⌘B sidebar · Esc.
// En inputs/textareas solo funciona ⌘K (no robamos el teclado al escribir).

import { useEffect } from "react";
import { useWorkspace, type CenterTab } from "@/state/WorkspaceContext";

const TAB_ORDER: CenterTab[] = [
  "voz",
  "consola",
  "actividad",
  "tareas",
  "reuniones",
  "memoria",
  "claude",
];

export function useHotkeys() {
  const ws = useWorkspace();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      // ⌘K / Ctrl+K: palette (funciona incluso escribiendo).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ws.setPaletteOpen(!ws.paletteOpen);
        return;
      }
      // Esc cierra la palette AUNQUE el foco esté en su input.
      if (e.key === "Escape" && ws.paletteOpen) {
        e.preventDefault();
        ws.setPaletteOpen(false);
        return;
      }
      if (typing) {
        // Esc dentro de un input: primero suelta el campo; el siguiente Esc
        // ya actúa sobre el workspace (quitar foco de proyecto).
        if (e.key === "Escape") (target as HTMLElement).blur();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "7") {
        e.preventDefault();
        ws.showPanel(TAB_ORDER[Number(e.key) - 1]);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        ws.toggleSidebar();
        return;
      }
      if (e.key === "Escape") {
        if (ws.paletteOpen) ws.setPaletteOpen(false);
        else if (ws.selectedProject) ws.focusProject(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.paletteOpen, ws.selectedProject, ws]);
}
