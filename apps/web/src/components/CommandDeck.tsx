"use client";

import { Panel } from "./Panel";
import { hermesPost } from "@/lib/hermes";

const COMMANDS: { label: string; prompt: string }[] = [
  {
    label: "Pulse Check",
    prompt:
      "Haz el Pulse Check del AIOS: lee el Estado Actual y Tareas Pendientes de cada proyecto activo del vault y dame un resumen de 3-6 líneas por proyecto con próximos pasos.",
  },
  {
    label: "Resumen del día",
    prompt:
      "Revisa la actividad reciente del agente y las memorias de hoy, y dame un resumen de qué se hizo hoy y qué queda pendiente.",
  },
  {
    label: "Destilar memorias",
    prompt:
      "Busca las memorias tipo daily de los últimos 7 días, destila los aprendizajes importantes y guárdalos como memorias curadas (type agent o feedback según corresponda).",
  },
  {
    label: "Sync proyectos",
    prompt:
      "Lee el estado de todos los proyectos del vault y actualiza la memoria con un snapshot del estado actual de cada proyecto activo.",
  },
];

// Capacidad ejecutable de Divisual: edición de vídeo real. NO es /divisual-create
// (ese es la génesis de demo en vivo). Se lanza como run de Claude Code EN el repo
// del kit (cwd = ruta_local de divisual) para que tenga sus skills a mano.
const DIVISUAL_EDIT_PROMPT =
  "Edita el vídeo que esté en input/ usando la skill divisual-edit. Detecta el formato (horizontal/vertical/cuadrado), corta silencios, retakes y muletillas, añade motion graphics según styles/triggers.md y subtítulos con el estilo de styles/client-style.md (si no existe, sigue el onboarding de estilo del CLAUDE.md). Deja el vídeo final en output/. Si input/ está vacío, dilo y no hagas nada más.";

export function CommandDeck({
  onLaunched,
  onLaunchClaude,
}: {
  onLaunched?: (taskId: string) => void;
  /** Lanza un run de Claude Code en el repo de un proyecto (capacidad ejecutable). */
  onLaunchClaude?: (opts: { project: string; prompt: string }) => void;
}) {
  const launch = async (prompt: string) => {
    try {
      const res = await hermesPost<{ task_id: string }>("/tasks", { prompt });
      onLaunched?.(res.task_id);
    } catch {
      /* offline: el feed ya lo muestra */
    }
  };

  return (
    <Panel title="Command Deck" delay={180}>
      <div className="space-y-2">
        {COMMANDS.map((cmd) => (
          <button key={cmd.label} className="cmd-btn" onClick={() => void launch(cmd.prompt)}>
            {cmd.label}
          </button>
        ))}
        {/* Divisual: corre como Claude Code en su repo, no como /tasks (que
            correría en el vault, sin las skills del kit). */}
        <button
          className="cmd-btn"
          style={{ borderColor: "var(--cyan)", color: "var(--cyan)" }}
          title="Lanza una edición de vídeo con la skill divisual-edit (deja el vídeo en input/ del kit)"
          onClick={() => onLaunchClaude?.({ project: "divisual", prompt: DIVISUAL_EDIT_PROMPT })}
        >
          Editar vídeo (Divisual)
        </button>
      </div>
    </Panel>
  );
}
