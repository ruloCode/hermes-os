"use client";

// Contratar desde un escritorio libre, con la VOZ primero: al abrirse ya está
// escuchando (el micrófono lo abre la página); dices la tarea, la ves en vivo
// y la envías (A, Enter o el botón). Lanza un run REAL: con proyecto →
// claude -p en la carpeta del proyecto con el modelo de la consola y el MODO
// que elijas aquí (Auto por defecto, como Claude Code); en
// "General" → una tarea de Hermes (POST /tasks, el mismo run_task de la voz).
// El personaje aparece cuando el agente lo anuncia, no antes.

import { forwardRef, useImperativeHandle, useState } from "react";
import { GENERAL_PROJECT, type OfficeMode, type OfficeProject } from "@hermes/shared";
import { claudeStartRun, hermesPost } from "@/lib/hermes";
import { useWorkspace } from "@/state/WorkspaceContext";
import type { OfficeDictation } from "@/hooks/useOfficeDictation";
import { VoiceComposer } from "./VoiceComposer";
import { ModePicker, modeNote } from "./ModePicker";

export interface HireDialogHandle {
  submit: () => void;
}

export const HireDialog = forwardRef<
  HireDialogHandle,
  {
    project: string;
    projects: OfficeProject[];
    voice: OfficeDictation;
    padConnected: boolean;
    mode: OfficeMode;
    onModeChange: (mode: OfficeMode) => void;
    onClose: () => void;
    onLaunched: (id: string) => void;
  }
>(function HireDialog({ project, projects, voice, padConnected, mode, onModeChange, onClose, onLaunched }, ref) {
  const { claudeConfig } = useWorkspace();
  const [target, setTarget] = useState(project);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const general = target === GENERAL_PROJECT;

  async function submit() {
    const text = voice.text.trim();
    if (!text || sending || voice.state !== "ready") return;
    setSending(true);
    setError(null);
    try {
      if (general) {
        const r = await hermesPost<{ task_id?: string }>("/tasks", { prompt: text });
        onLaunched(r.task_id ?? "");
      } else {
        const r = await claudeStartRun(text, { ...claudeConfig, permissionMode: mode }, target);
        onLaunched(r.runId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  useImperativeHandle(ref, () => ({ submit: () => void submit() }));

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/40 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <section
        className="w-full max-w-lg rounded-2xl border border-line bg-panel p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Contratar un agente"
      >
        <h2 className="text-lg font-semibold text-text">Contratar un agente</h2>
        <p className="mt-1 text-xs text-text-dim">
          {general
            ? "Tarea de Hermes: corre con sus tools (memoria, vault, Linear…)."
            : `Claude Code en la carpeta del proyecto · ${claudeConfig.model} · esfuerzo ${claudeConfig.effort}`}
        </p>

        <label className="mt-4 block text-xs text-text-dim" htmlFor="hire-project">
          Proyecto
        </label>
        <select
          id="hire-project"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-1 mb-4 w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-text"
        >
          <option value={GENERAL_PROJECT}>General (tarea de Hermes)</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>

        {general ? (
          <p className="mb-4 text-xs text-text-dim">Las tareas de Hermes no tienen modo: las cuida su guardrail y, si miras la oficina, te piden permiso para los comandos con efectos.</p>
        ) : (
          <div className="mb-4">
            <ModePicker value={mode} onChange={onModeChange} padConnected={padConnected} note={modeNote(mode, claudeConfig.model)} />
          </div>
        )}

        <VoiceComposer
          voice={voice}
          padConnected={padConnected}
          sendLabel="Contratar"
          sending={sending}
          placeholder="Lee el README y resume la arquitectura en 5 líneas"
          onSend={() => void submit()}
        />
        {error ? <p className="mt-2 text-xs text-red">{error}</p> : null}
      </section>
    </div>
  );
});
