"use client";

// Registry ÚNICO de comandos del workspace: alimenta el Command Deck, los
// chips de la consola y la palette (⌘K). Cada comando ejecuta una capacidad
// REAL existente — nada decorativo: si no hay capacidad detrás, no hay botón.

import { useRouter } from "next/navigation";
import { hermesPost } from "@/lib/hermes";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useWorkspace, type CenterTab } from "@/state/WorkspaceContext";
import { useLiveMeeting } from "@/state/LiveMeetingProvider";
import { useGestureControl } from "@/state/GestureControlProvider";
import { useUiHands } from "@/state/UiHandsProvider";
import { useEstudioContext } from "@/state/EstudioProvider";

export interface CommandContext {
  selectedProject: string | null;
  showPanel: (tab: CenterTab) => void;
  focusProject: (slug: string | null) => void;
  launchClaudeRun: (opts: { project: string; prompt: string }) => Promise<{ runId: string } | null>;
  /** POST /tasks (agente SDK) y muestra la actividad en vivo. */
  runTask: (prompt: string) => Promise<void>;
  /** Precarga el input de la consola y salta a ella. */
  insertConsolePrompt: (text: string) => void;
  /** Hay una junta en vivo activa (habilita "terminar junta"). */
  liveMeetingActive: boolean;
  /** Inicia la junta en vivo del proyecto en foco (navega al tab reuniones). */
  startLiveMeeting: () => void;
  /** Abre la confirmación de cierre en la vista EN VIVO — NO corta en seco. */
  stopLiveMeeting: () => void;
  /** Conecta la voz con el tutor de inglés (corta la llamada Hermes si la hay). */
  startEnglishPractice: () => void;
  /** Entrada canónica a la voz: navega a Voz en vivo y conecta si hace falta. */
  startVoiceCall: () => void;
  /** Control por gestos activo (cambia el label del comando a "apagar"). */
  gesturesActive: boolean;
  /** Enciende/apaga el control por gestos (webcam → cursor del sistema). */
  toggleGestures: () => void;
  /** Manos sobre la UI activas (cursor de mano + clic + scroll en la web). */
  uiHandsActive: boolean;
  /** Enciende/apaga las manos sobre la UI. */
  toggleUiHands: () => void;
  /** Navega a una ruta del workspace (/finanzas, /habitos, /ingles…). */
  navigate: (path: string) => void;
  /** Abre el teleprompter de la pieza que toca grabar (o la seleccionada). */
  startRecording: () => void;
}

export interface HermesCommand {
  id: string;
  label: string;
  /** Cómo se muestra como chip bajo la consola (si aplica). */
  slash?: string;
  hint?: string;
  /** Deshabilitado sin proyecto en foco. */
  requiresProject?: boolean;
  /** Deshabilitado sin junta en vivo activa. */
  requiresLiveMeeting?: boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

export const COMMANDS: HermesCommand[] = [
  {
    id: "hablar-hermes",
    label: "Hablar con Hermes",
    hint: "Llamada de voz en tiempo real",
    run: (ctx) => ctx.startVoiceCall(),
  },
  {
    id: "pulse-check",
    label: "Pulse Check",
    hint: "Estado y próximos pasos de cada proyecto activo del vault",
    run: (ctx) =>
      ctx.runTask(
        "Haz el Pulse Check del AIOS: lee el Estado Actual y Tareas Pendientes de cada proyecto activo del vault y dame un resumen de 3-6 líneas por proyecto con próximos pasos.",
      ),
  },
  {
    id: "resumen-dia",
    label: "Resumen del día",
    slash: "/resumen diario",
    hint: "Qué se hizo hoy y qué queda pendiente",
    run: (ctx) =>
      ctx.runTask(
        "Revisa la actividad reciente del agente y las memorias de hoy, y dame un resumen de qué se hizo hoy y qué queda pendiente.",
      ),
  },
  {
    id: "destilar-memorias",
    label: "Destilar memorias",
    hint: "Curar aprendizajes de los daily de la semana",
    run: (ctx) =>
      ctx.runTask(
        "Busca las memorias tipo daily de los últimos 7 días, destila los aprendizajes importantes y guárdalos como memorias curadas (type agent o feedback según corresponda).",
      ),
  },
  {
    id: "sync-proyectos",
    label: "Sync proyectos",
    hint: "Snapshot del estado de cada proyecto activo a memoria",
    run: (ctx) =>
      ctx.runTask(
        "Lee el estado de todos los proyectos del vault y actualiza la memoria con un snapshot del estado actual de cada proyecto activo.",
      ),
  },
  {
    id: "nueva-tarea",
    label: "Nueva tarea",
    slash: "/crear tarea",
    hint: "Abre el tablero de tareas para crear una",
    run: (ctx) => ctx.showPanel("tareas"),
  },
  {
    id: "nueva-reunion",
    label: "Nueva reunión",
    slash: "/nueva reunión",
    hint: "Graba o sube el audio de una junta",
    run: (ctx) => ctx.showPanel("reuniones"),
  },
  {
    id: "junta-en-vivo",
    label: "Iniciar junta en vivo",
    slash: "/junta en vivo",
    hint: "Copiloto en tiempo real de la junta del proyecto en foco",
    requiresProject: true,
    run: (ctx) => ctx.startLiveMeeting(),
  },
  {
    id: "terminar-junta",
    label: "Terminar junta en vivo",
    hint: "Cierra la junta y procesa resumen + accionables",
    requiresLiveMeeting: true,
    run: (ctx) => ctx.stopLiveMeeting(),
  },
  {
    id: "practicar-ingles",
    label: "Practicar inglés",
    slash: "/practicar inglés",
    hint: "Sesión de conversación con el tutor de inglés por voz",
    run: (ctx) => ctx.startEnglishPractice(),
  },
  {
    id: "ver-finanzas",
    label: "Ver finanzas",
    hint: "Saldo, movimientos y asesor financiero",
    run: (ctx) => ctx.navigate("/finanzas"),
  },
  {
    id: "ver-habitos",
    label: "Ver hábitos",
    hint: "Hábitos de hoy, rachas y metas",
    run: (ctx) => ctx.navigate("/habitos"),
  },
  {
    id: "ver-ingles",
    label: "Ver inglés",
    hint: "Progreso de la práctica: reportes, drills, vocabulario y tareas",
    run: (ctx) => ctx.navigate("/ingles"),
  },
  {
    id: "ver-estudio",
    label: "Estudio de contenido",
    hint: "Pipeline de piezas RuloCode: guiones, tomas, edición y publicación",
    run: (ctx) => ctx.navigate("/estudio"),
  },
  {
    id: "modo-grabacion",
    label: "Modo grabación",
    slash: "/grabar",
    hint: "Teleprompter: solo tus frases, el detalle de cada toma y el checklist del guion",
    run: (ctx) => ctx.startRecording(),
  },
  {
    id: "control-gestos",
    label: "Control por gestos",
    slash: "/gestos",
    hint: "Mueve el cursor con la mano vía webcam (pinza = click) — toggle",
    run: (ctx) => ctx.toggleGestures(),
  },
  {
    id: "manos-ui",
    label: "Manos sobre la UI",
    slash: "/manos",
    hint: "Cursor de mano en el dashboard: pinza = clic, agarrar = scroll — toggle",
    run: (ctx) => ctx.toggleUiHands(),
  },
  {
    id: "analizar-proyecto",
    label: "Analizar proyecto",
    slash: "/analizar proyecto",
    hint: "Claude analiza el repo del proyecto en foco",
    requiresProject: true,
    run: (ctx) => {
      if (!ctx.selectedProject) return;
      void ctx.launchClaudeRun({
        project: ctx.selectedProject,
        prompt:
          "Analiza el estado actual de este repo: rama, cambios sin commitear, TODOs recientes y deuda técnica visible. Dame un reporte corto con próximos pasos concretos. No hagas cambios.",
      });
    },
  },
  {
    id: "revisar-codigo",
    label: "Revisar código",
    slash: "/revisar código",
    hint: "Claude revisa el diff sin commitear del repo en foco",
    requiresProject: true,
    run: (ctx) => {
      if (!ctx.selectedProject) return;
      void ctx.launchClaudeRun({
        project: ctx.selectedProject,
        prompt:
          "Revisa el diff sin commitear de este repo (git status + git diff). Reporta bugs, riesgos y mejoras concretas con archivo:línea. No hagas cambios.",
      });
    },
  },
  {
    id: "planificar-dia",
    label: "Planificar día",
    slash: "/planificar día",
    hint: "Precarga un plan del día en la consola",
    run: (ctx) =>
      ctx.insertConsolePrompt(
        "Arma mi plan del día: usa el brief diario, revisa las tareas pendientes del tracker y el estado de los proyectos activos, y proponme un plan priorizado de 3-5 bloques con tiempos.",
      ),
  },
  {
    id: "editar-video-divisual",
    label: "Editar vídeo (Divisual)",
    hint: "Edición real con la skill divisual-edit (deja el vídeo en input/ del kit)",
    // Capacidad ejecutable de Divisual: corre como Claude Code EN el repo del
    // kit (cwd = ruta_local) para tener sus skills a mano — no como /tasks.
    run: (ctx) => {
      void ctx.launchClaudeRun({
        project: "divisual",
        prompt:
          "Edita el vídeo que esté en input/ usando la skill divisual-edit. Detecta el formato (horizontal/vertical/cuadrado), corta silencios, retakes y muletillas, añade motion graphics según styles/triggers.md y subtítulos con el estilo de styles/client-style.md (si no existe, sigue el onboarding de estilo del CLAUDE.md). Deja el vídeo final en output/. Si input/ está vacío, dilo y no hagas nada más.",
      });
    },
  },
];

/** Los 8 del grid 2×4 del Command Deck (orden de la referencia). */
export const DECK_IDS = [
  "pulse-check",
  "resumen-dia",
  "nueva-tarea",
  "nueva-reunion",
  "analizar-proyecto",
  "revisar-codigo",
  "destilar-memorias",
  "editar-video-divisual",
];

/** Chips bajo el input de la consola (solo los que tienen slash). */
export const CHIP_IDS = [
  "resumen-dia",
  "analizar-proyecto",
  "nueva-tarea",
  "revisar-codigo",
  "planificar-dia",
  "nueva-reunion",
];

/** Arma el contexto de ejecución desde el workspace (hook de conveniencia). */
export function useCommandContext(): CommandContext {
  const ws = useWorkspace();
  const live = useLiveMeeting();
  const voice = useVoiceConnect();
  const gestures = useGestureControl();
  const uiHands = useUiHands();
  const estudio = useEstudioContext();
  const router = useRouter();
  return {
    navigate: (path) => router.push(path),
    startRecording: () => {
      // La etapa `grabacion` significa "esto es lo que toca grabar": esa pieza
      // manda sobre la seleccionada. Sin ninguna, solo navega al Estudio.
      router.push("/estudio");
      const target =
        estudio.board.pieces.find((p) => p.status === "grabacion") ?? estudio.selected;
      if (target) estudio.setRecording(target.id);
    },
    gesturesActive: gestures.active,
    toggleGestures: () => {
      if (gestures.active) gestures.stop();
      else void gestures.start();
    },
    uiHandsActive: uiHands.active,
    toggleUiHands: () => {
      if (uiHands.active) uiHands.stop();
      else void uiHands.start();
    },
    selectedProject: ws.selectedProject,
    showPanel: ws.showPanel,
    focusProject: ws.focusProject,
    launchClaudeRun: ws.launchClaudeRun,
    runTask: async (prompt) => {
      try {
        await hermesPost<{ task_id: string }>("/tasks", { prompt });
        ws.showPanel("actividad");
      } catch {
        /* offline: el feed ya lo refleja */
      }
    },
    insertConsolePrompt: (text) => {
      ws.setConsoleDraft(text);
      ws.showPanel("consola");
    },
    liveMeetingActive: live.active,
    startLiveMeeting: () => {
      // Siempre navega al tab reuniones; si ya hay junta, el takeover es la vista.
      ws.showPanel("reuniones");
      if (!live.active && ws.selectedProject) {
        void live.start({ project: ws.selectedProject });
      }
    },
    stopLiveMeeting: () => {
      if (!live.active) return;
      ws.showPanel("reuniones");
      live.requestStopConfirm();
    },
    startEnglishPractice: () => {
      // La práctica vive en /ingles: transcripción en tiempo real en el centro
      // (LivePractice) + drills y vocabulario a la mano.
      router.push("/ingles");
      void voice.switchToTutor();
    },
    startVoiceCall: () => {
      ws.showPanel("voz");
      if (!voice.connected && !voice.connecting) void voice.connect();
    },
  };
}
