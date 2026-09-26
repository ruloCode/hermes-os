"use client";

// Atajos globales del workspace: ⌘K palette · ⌘1..9 destinos · ⌘B sidebar · Esc.
// En inputs/textareas solo funciona ⌘K (no robamos el teclado al escribir).
//
// ⌘1..⌘9 numeran los NUEVE PRIMEROS ICONOS DEL RAIL, en el orden en que se ven.
// Antes numeraban un `TAB_ORDER` propio que no existía en pantalla: ⌘4 abría
// Tareas, que en el rail era el segundo icono. Una lista, un orden
// (destinations.tsx).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/state/WorkspaceContext";
import { DESTS, HOTKEY_DESTS } from "@/components/shell/destinations";

export function useHotkeys() {
  const ws = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

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

      // ⌘1..⌘9 y ⌘B van ANTES de la guarda de escritura, igual que ⌘K.
      //
      // Estaban debajo, y eso los dejaba muertos en el estado por defecto de la
      // app: el home enfoca el composer al cargar, así que `typing` era true y
      // la guarda cortaba antes de llegar aquí. Los atajos solo respondían si
      // primero hacías clic fuera del campo — o sea, casi nunca.
      //
      // La guarda existe para no robarle teclas SUELTAS a quien escribe. Un
      // acorde con ⌘/Ctrl no es escribir: nadie teclea "⌘3" dentro de una
      // frase, y el navegador ya lo trata como comando.
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= String(HOTKEY_DESTS)) {
        const dest = DESTS[Number(e.key) - 1];
        if (!dest) return;
        e.preventDefault();
        if (dest.kind === "tab") ws.showPanel(dest.tab);
        else {
          // Una ruta también tiene que dejar el centro en la consola: si venías
          // de un tab, "/" sin eso te devuelve al tab y el atajo no hace nada.
          if (dest.href === "/") ws.showPanel("consola");
          else router.push(dest.href);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        ws.toggleSidebar();
        return;
      }

      if (typing) {
        // Esc dentro de un input: primero suelta el campo; el siguiente Esc
        // ya actúa sobre el workspace (quitar foco de proyecto).
        if (e.key === "Escape") (target as HTMLElement).blur();
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
