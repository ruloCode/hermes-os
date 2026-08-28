"use client";

// Shell del workspace: rail de iconos + topbar + vistas + voz.
// Vive en el layout, así que PERSISTE entre navegaciones: las vistas se montan
// una vez y se alternan con CSS — la llamada de voz, los streams de la consola
// y el canvas del grafo sobreviven al cambiar de vista.
// Rutas fuera del workspace (p. ej. /dev/ui) se renderizan sin shell.
//
// Rediseño 2026-07: el header alto (wordmark + 3 rutas + strip de voz + reloj +
// ring) y el strip de métricas se fundieron en una topbar de UNA línea y un
// rail de 60px. El motivo es medido, no estético: la voz es el 88% del uso y
// tenía una cajita del 2%, mientras ~15 paneles con el mismo peso visual
// competían con la consola.

import { usePathname } from "next/navigation";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useHermesData } from "@/hooks/useHermesData";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { useHotkeys } from "@/hooks/useHotkeys";
import { SideRail } from "./SideRail";
import { TopBar } from "./TopBar";
import { Toasts } from "@/components/Toasts";
import { CommandPalette } from "@/components/CommandPalette";
import { VoiceClientTools } from "@/components/VoiceClientTools";
import { ClapToLights } from "@/components/ClapToLights";
import { EnglishTutorTools } from "@/components/EnglishTutorTools";
import { VoiceEventsBridge } from "@/components/VoiceEventsBridge";
import { VoiceSessionBridge } from "@/components/VoiceSessionBridge";
import { VoiceScopeRouter } from "@/components/VoiceScopeRouter";
import { OrquestadorView } from "@/components/views/OrquestadorView";
import { FinanzasView } from "@/components/views/FinanzasView";
import { HabitosView } from "@/components/views/HabitosView";
import { InglesView } from "@/components/views/InglesView";
import { AgendaView } from "@/components/views/AgendaView";
import { EstudioView } from "@/components/views/EstudioView";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ws = useWorkspace();
  const { projects } = useHermesData();
  const { events } = useAgentEvents();
  // Atajos globales: ⌘K palette · ⌘1..7 tabs · ⌘B sidebar · Esc.
  useHotkeys();

  // Fuera del workspace (galería /dev/ui, futuras rutas sueltas): sin shell.
  // /vida vive como redirect a /finanzas (app/vida/page.tsx).
  const WORKSPACE_VIEWS: Record<string, string> = {
    "/": "orquestador",
    "/finanzas": "finanzas",
    "/habitos": "habitos",
    "/ingles": "ingles",
    "/agenda": "agenda",
    "/estudio": "estudio",
  };
  const view = WORKSPACE_VIEWS[pathname];
  if (!view) return <>{children}</>;

  return (
    <>
      {/* Bridges de voz sin render: tools + avisos + transcripción + scope.
          Montados UNA vez para toda la app (antes /vida duplicaba el árbol y
          navegar cortaba la llamada). */}
      <VoiceClientTools
        projects={projects}
        onFocusProject={ws.focusProject}
        onShowPanel={ws.showPanel}
        onWork={ws.launchClaudeRun}
      />
      <EnglishTutorTools />
      <VoiceEventsBridge events={events} />
      {/* onConnected NO navega: la llamada se queda donde estés. Antes saltaba
          al tab "voz" y te sacaba del home justo cuando el orbe —que ES el
          botón de la llamada— vive ahí. Hablar y escribir ocurren en el mismo
          sitio. */}
      <VoiceSessionBridge events={events} />
      <VoiceScopeRouter />
      {/* 👏👏 = toggle de la tira de luces mientras la llamada está activa. */}
      <ClapToLights />

      <div className="relative z-2 flex h-screen">
        <SideRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <div className={`min-h-0 flex-1 ${view === "orquestador" ? "flex flex-col" : "hidden"}`}>
              <OrquestadorView />
            </div>
            <div className={`min-h-0 flex-1 ${view === "finanzas" ? "flex flex-col" : "hidden"}`}>
              <FinanzasView />
            </div>
            <div className={`min-h-0 flex-1 ${view === "habitos" ? "flex flex-col" : "hidden"}`}>
              <HabitosView />
            </div>
            <div className={`min-h-0 flex-1 ${view === "ingles" ? "flex flex-col" : "hidden"}`}>
              <InglesView />
            </div>
            <div className={`min-h-0 flex-1 ${view === "agenda" ? "flex flex-col" : "hidden"}`}>
              <AgendaView />
            </div>
            <div className={`min-h-0 flex-1 ${view === "estudio" ? "flex flex-col" : "hidden"}`}>
              <EstudioView />
            </div>
          </div>
        </main>
      </div>

      {/* Avisos flotantes de tareas/runs terminados (mismo SSE de events) */}
      <Toasts events={events} />
      {/* Palette de comandos (⌘K) */}
      <CommandPalette />
      {/* children = páginas marcador (devuelven null); deja el slot presente */}
      {children}
    </>
  );
}
