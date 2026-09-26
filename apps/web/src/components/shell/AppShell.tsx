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

import { useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "@/state/ThemeProvider";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useOrbState } from "@/components/voice/orbState";
import { VoiceOrb3D } from "@/components/voice/VoiceOrb3D";
import { PresenceBar } from "./PresenceBar";
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
import { ComposicionView } from "@/components/views/ComposicionView";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const ws = useWorkspace();
  const { projects } = useHermesData();
  const { events } = useAgentEvents();
  const { state: orbState, getVolume } = useOrbState();
  // Atajos globales: ⌘K palette · ⌘1..7 tabs · ⌘B sidebar · Esc.
  useHotkeys();

  // El orbe 3D vive en el SHELL, no en el home: su ancla es el botón de la
  // PresenceBar, que existe en todas las rutas. `simplified` va siempre en
  // true porque a ~19px de radio el relieve del ruido se lee como suciedad.
  const orbAnchorRef = useRef<HTMLButtonElement>(null);
  const getOrbAnchor = useCallback(() => orbAnchorRef.current, []);

  // Fuera del workspace (galería /dev/ui, futuras rutas sueltas): sin shell.
  // /vida vive como redirect a /finanzas (app/vida/page.tsx).
  const WORKSPACE_VIEWS: Record<string, string> = {
    "/": "orquestador",
    "/finanzas": "finanzas",
    "/habitos": "habitos",
    "/ingles": "ingles",
    "/agenda": "agenda",
    "/estudio": "estudio",
    "/composicion": "composicion",
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

      {/* Canvas fijo a toda la ventana, detrás de la UI (pointer-events:none).
          En una caja del tamaño del orbe, anillos y partículas se recortan. */}
      <VoiceOrb3D
        key={theme.resolved}
        getAnchor={getOrbAnchor}
        simplified
        state={orbState}
        getVolume={getVolume}
      />

      <div className="relative z-2 flex h-screen">
        <SideRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {/* pb-20 deja sitio a la PresenceBar fija: sin él, el último elemento
              de cada vista queda debajo del orbe. */}
          <div className="flex min-h-0 flex-1 flex-col p-3 pb-20">
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
            <div className={`min-h-0 flex-1 ${view === "composicion" ? "flex flex-col" : "hidden"}`}>
              <ComposicionView />
            </div>
          </div>
        </main>
      </div>

      {/* La voz, anclada al pie de todas las rutas: orbe + estado + hilo. */}
      <PresenceBar anchorRef={orbAnchorRef} />

      {/* Avisos flotantes de tareas/runs terminados (mismo SSE de events) */}
      <Toasts events={events} />
      {/* Palette de comandos (⌘K) */}
      <CommandPalette />
      {/* children = páginas marcador (devuelven null); deja el slot presente */}
      {children}
    </>
  );
}
