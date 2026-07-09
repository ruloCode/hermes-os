"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MeetingSummary } from "@hermes/shared";
import { listMeetings, uploadMeeting, getMeetingJob } from "@/lib/hermes";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { MeetingDetail } from "./MeetingDetail";

/**
 * Panel de Reuniones de un proyecto: graba en vivo, sube un archivo de audio,
 * sube un .txt/.md/.vtt/.srt con la transcripción, o pega el texto directo.
 * Hermes transcribe (si es audio), resume y saca 2 accionables. Debajo, el
 * historial. Se renderiza como contenido del tab central (page.tsx lo envuelve).
 */
export function MeetingsPanel({
  project,
  projectName,
  onExecute,
}: {
  project: string | null;
  projectName?: string;
  onExecute: (r: { slug: string; runId: string; sessionId: string }) => void;
}) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const rec = useMediaRecorder();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textFileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refresh = useCallback(() => {
    if (!project) {
      setMeetings([]);
      return;
    }
    void listMeetings(project).then(setMeetings);
  }, [project]);

  // Cambiar de proyecto reinicia la vista (y corta cualquier poll pegado).
  useEffect(() => {
    setSelected(null);
    setError(null);
    setBusy(false);
    stopPoll();
    refresh();
  }, [project, refresh, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  /**
   * Sigue el job de ingest. Robusto: si el endpoint devuelve null (404/red)
   * reintenta unas veces; si termina (done/error) o se pasa de tiempo, SIEMPRE
   * limpia `busy` (antes se quedaba pegado y deshabilitaba todos los botones).
   */
  const trackJob = (jobId: string) => {
    setError(null);
    setBusy(true);
    stopPoll();
    let ticks = 0;
    let misses = 0;
    pollRef.current = setInterval(async () => {
      ticks += 1;
      if (ticks > 180) {
        // ~6 min: corta el spinner; la reunión puede completarse igual → historial.
        stopPoll();
        setBusy(false);
        setError("Está tardando más de lo normal. Revisa el historial en un momento y refresca.");
        return;
      }
      const job = await getMeetingJob(jobId);
      if (job?.status === "running") {
        misses = 0;
        return;
      }
      if (!job) {
        if (++misses < 6) return; // 404/red transitorio: reintenta
        stopPoll();
        setBusy(false);
        setError("Perdí el rastro del procesamiento (¿reinició el agente?). Mira el historial en un momento.");
        return;
      }
      stopPoll();
      setBusy(false);
      if (job.status === "done") {
        refresh();
        if (job.meetingId) setSelected(job.meetingId);
      } else {
        setError(job.error ?? "El procesamiento de la reunión falló.");
      }
    }, 2000);
  };

  const submitAudio = async (blob: Blob, source: "audio" | "upload", durationSec?: number) => {
    if (!project || busy) return;
    setError(null);
    try {
      const { meeting_job_id } = await uploadMeeting({
        project,
        audioBlob: blob,
        title: title.trim() || undefined,
        source,
        durationSec,
      });
      setTitle("");
      trackJob(meeting_job_id);
    } catch {
      setError("No se pudo subir el audio. ¿Está el agente en línea?");
    }
  };

  const submitTranscript = async (text: string) => {
    if (!project || busy) return;
    const clean = cleanTranscript(text);
    if (!clean) {
      setError("La transcripción está vacía.");
      return;
    }
    setError(null);
    try {
      const { meeting_job_id } = await uploadMeeting({
        project,
        transcript: clean,
        title: title.trim() || undefined,
        source: "paste",
      });
      setTitle("");
      trackJob(meeting_job_id);
    } catch {
      setError("No se pudo enviar la transcripción. ¿Está el agente en línea?");
    }
  };

  const onStopRecording = async () => {
    const { blob, durationSec } = await rec.stop();
    if (blob) void submitAudio(blob, "audio", durationSec);
    else setError("La grabación quedó vacía.");
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void submitAudio(f, "upload");
    e.target.value = "";
  };

  const onTextFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void submitTranscript(await f.text());
    e.target.value = "";
  };

  if (!project) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-[11px] leading-relaxed tracking-[0.1em]" style={{ color: "var(--text-dim)" }}>
          Enfoca un proyecto en la barra izquierda para grabar, subir y ver sus reuniones.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ── Nueva reunión ────────────────────────────────────────── */}
      <div className="space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Título (opcional) · junta de ${projectName ?? project}`}
          className="w-full rounded-sm border bg-transparent px-2.5 py-1.5 text-[11px] outline-none"
          style={{ borderColor: "var(--line)", color: "var(--text)" }}
        />

        <div className="flex flex-wrap items-center gap-2">
          {!rec.recording ? (
            <button
              type="button"
              onClick={() => void rec.start()}
              disabled={busy || !rec.supported}
              title={rec.supported ? "Grabar la junta" : "Grabación no soportada (usa subir archivo)"}
              className="cmd-btn !w-auto"
              style={{ borderColor: "var(--red)", color: "var(--red)" }}
            >
              ● Grabar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onStopRecording()}
              className="flex items-center gap-2 rounded-sm border px-3 py-2 text-[11px] tracking-[0.14em] uppercase"
              style={{ borderColor: "var(--red)", color: "var(--red)", background: "rgba(251,113,133,0.08)" }}
            >
              <Waveform />■ Detener · {fmt(rec.elapsed)}
            </button>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="cmd-btn !w-auto"
            style={{ borderColor: "var(--cyan)", color: "var(--cyan)" }}
          >
            ⇪ Subir audio
          </button>
          <input ref={fileRef} type="file" accept="audio/*" onChange={onFile} className="hidden" />

          <button
            type="button"
            onClick={() => textFileRef.current?.click()}
            disabled={busy}
            title="Subir un .txt/.md/.vtt/.srt con la transcripción (Otter, Fireflies, Zoom…)"
            className="cmd-btn !w-auto"
            style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
          >
            ⎗ Subir texto
          </button>
          <input
            ref={textFileRef}
            type="file"
            accept=".txt,.md,.vtt,.srt"
            onChange={onTextFile}
            className="hidden"
          />
        </div>

        {/* Pegar transcripción directo */}
        <div className="flex items-stretch gap-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="…o pega aquí la transcripción de la junta"
            rows={2}
            className="min-h-[40px] flex-1 resize-y rounded-sm border bg-transparent px-2.5 py-1.5 text-[11px] leading-snug outline-none"
            style={{ borderColor: "var(--line)", color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={() => {
              const t = pasteText;
              setPasteText("");
              void submitTranscript(t);
            }}
            disabled={busy || !pasteText.trim()}
            className="cmd-btn !w-auto self-stretch disabled:opacity-40"
            style={{ borderColor: "var(--green)", color: "var(--green)" }}
          >
            ⏎ Procesar
          </button>
        </div>

        {rec.error && (
          <p className="text-[10px] leading-snug" style={{ color: "var(--amber)" }}>
            ⚠ {rec.error}
          </p>
        )}
        {busy && (
          <p className="text-[10.5px] tracking-[0.14em] pulse-dot" style={{ color: "var(--violet)" }}>
            ◈ Transcribiendo y resumiendo la reunión…
          </p>
        )}
        {error && (
          <p className="text-[10.5px] leading-snug" style={{ color: "var(--red)" }}>
            ⚠ {error}
          </p>
        )}
      </div>

      {/* ── Detalle o historial ──────────────────────────────────── */}
      <div className="min-h-0 flex-1">
        {selected ? (
          <MeetingDetail
            key={selected}
            project={project}
            id={selected}
            onBack={() => setSelected(null)}
            onExecute={onExecute}
          />
        ) : meetings.length === 0 ? (
          <p className="pt-6 text-center text-[10.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Sin reuniones todavía. Graba, sube o pega la primera junta de {projectName ?? project}.
          </p>
        ) : (
          <div className="h-full space-y-1.5 overflow-y-auto pr-1">
            {meetings.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelected(m.id)}
                className="flex w-full items-center justify-between gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors hover:border-[var(--violet)]"
                style={{ borderColor: "var(--line)", background: "rgba(122,132,255,0.03)" }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px]" style={{ color: "var(--text)" }}>
                    {m.title}
                  </span>
                  <span className="text-[9px] tracking-[0.14em] uppercase" style={{ color: "var(--text-dim)" }}>
                    {m.fecha.slice(0, 10)} · {m.accionables_count} accionables
                  </span>
                </span>
                <span className="text-[10px]" style={{ color: "var(--violet)" }}>
                  →
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Waveform() {
  return (
    <span className="flex items-end gap-[2px]" style={{ height: 12 }} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="wave-bar" style={{ height: 12, animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Quita cabecera WEBVTT, números de cue y líneas de timestamp de .srt/.vtt. */
function cleanTranscript(raw: string): string {
  const isTimestamp = (l: string) => /^\d{1,2}:\d{2}(:\d{2})?[.,]?\d*\s*-->/.test(l.trim());
  const isCueNumber = (l: string) => /^\d+$/.test(l.trim());
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "WEBVTT" && !isTimestamp(l) && !isCueNumber(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
