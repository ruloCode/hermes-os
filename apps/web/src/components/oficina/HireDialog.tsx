"use client";

// Contratar desde un escritorio libre: se escribe la tarea y se lanza un run
// REAL. Con proyecto → claude -p en la carpeta del proyecto (mismo camino que
// la consola, con el modelo y el esfuerzo que tenga configurados); en el pod
// "general" → una tarea de Hermes (POST /tasks, el mismo run_task de la voz).
// El personaje no se dibuja aquí: aparece solo cuando el agente lo anuncia.

import { useEffect, useRef, useState } from "react";
import { GENERAL_PROJECT, type OfficeProject } from "@hermes/shared";
import { claudeStartRun, hermesPost } from "@/lib/hermes";
import { useWorkspace } from "@/state/WorkspaceContext";

export function HireDialog({
  project,
  projects,
  onClose,
  onLaunched,
}: {
  project: string;
  projects: OfficeProject[];
  onClose: () => void;
  onLaunched: (id: string) => void;
}) {
  const { claudeConfig } = useWorkspace();
  const [target, setTarget] = useState(project);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const general = target === GENERAL_PROJECT;

  async function submit() {
    const text = prompt.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      if (general) {
        const r = await hermesPost<{ task_id?: string; id?: string }>("/tasks", { prompt: text });
        onLaunched(r.task_id ?? r.id ?? "");
      } else {
        const r = await claudeStartRun(text, claudeConfig, target);
        onLaunched(r.runId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/40 p-4" onMouseDown={onClose}>
      <form
        className="w-full max-w-lg rounded-lg border border-line bg-panel p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-base font-medium text-text">Contratar un agente</h2>
        <p className="mt-1 text-xs text-text-dim">
          {general
            ? "Tarea de Hermes: corre con sus tools (memoria, vault, Linear…)."
            : `Claude Code en la carpeta del proyecto · ${claudeConfig.model} · esfuerzo ${claudeConfig.effort} · ${claudeConfig.permissionMode}`}
        </p>

        <label className="mt-4 block text-xs text-text-dim" htmlFor="hire-project">
          Proyecto
        </label>
        <select
          id="hire-project"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-text"
        >
          <option value={GENERAL_PROJECT}>General (tarea de Hermes)</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>

        <label className="mt-3 block text-xs text-text-dim" htmlFor="hire-prompt">
          Tarea
        </label>
        <textarea
          id="hire-prompt"
          ref={areaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape") onClose();
          }}
          rows={4}
          placeholder="Lee el README y resume la arquitectura en 5 líneas"
          className="mt-1 w-full resize-none rounded-md border border-line bg-panel-2 px-2.5 py-2 text-sm text-text placeholder:text-text-faint"
        />

        {error ? <p className="mt-2 text-xs text-red">{error}</p> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-text-faint">⌘↵ para contratar</span>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-text-dim hover:text-text">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!prompt.trim() || sending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {sending ? "Contratando…" : "Contratar"}
          </button>
        </div>
      </form>
    </div>
  );
}
