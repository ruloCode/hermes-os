"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MeetingSummary } from "@hermes/shared";
import { listMeetings, uploadMeeting, getMeetingJob } from "@/lib/hermes";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useLiveMeeting } from "@/state/LiveMeetingProvider";
import { PanelState } from "@/components/ui/PanelState";
import { LiveMeetingView } from "./live/LiveMeetingView";
import { LiveSetupCard } from "./live/LiveSetupCard";
import { MeetingDetail } from "./MeetingDetail";

// Campos de texto: mismo borde/focus que el resto del design system.
const FIELD =
  "rounded-sm border border-line bg-transparent outline-none transition-colors focus:border-line-2";

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
  onExecute: (
    r: { slug: string; runId: string; sessionId: string },
    task?: import("@hermes/shared").Task | null,
  ) => void;
}) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const rec = useMediaRecorder();
  const live = useLiveMeeting();
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
    setLiveNotice(null);
    setBusy(false);
    stopPoll();
    refresh();
  }, [project, refresh, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  // La junta EN VIVO terminó de procesarse: abre su detalle si el foco sigue
  // en ese proyecto (MeetingDetail carga por {project, id}); si el foco
  // cambió, deja un aviso honesto en vez de secuestrar la navegación.
  const liveResult = live.result;
  useEffect(() => {
    if (!liveResult) return;
    if (liveResult.project === project) {
      setSelected(liveResult.meetingId);
      refresh();
    } else {
      setLiveNotice(
        `La junta de ${liveResult.project} quedó procesada — enfoca ese proyecto para verla.`,
      );
    }
    live.consumeResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveResult, project]);

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

  // Takeover: con junta en curso (conectando/viva/cerrando/procesando/error)
  // la vista EN VIVO reemplaza todo el panel — mismo patrón "el detalle
  // reemplaza la lista". Va ANTES del guard de proyecto: una junta reanudada
  // tras ⌘R existe aunque no haya proyecto en foco.
  if (live.phase !== "idle") {
    return <LiveMeetingView />;
  }

  if (!project) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-xs leading-relaxed text-text-dim">
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
          className={`${FIELD} w-full px-2.5 py-1.5 text-xs text-text`}
        />

        {/* Junta EN VIVO: copiloto en tiempo real (takeover al iniciar).
            Usa el proyecto en foco y el input de título de arriba; modo de
            audio e idiomas se eligen en el card. */}
        <LiveSetupCard
          projectLabel={projectName ?? project}
          disabled={busy || rec.recording}
          disabledTitle={
            rec.recording ? "Detén la grabación batch antes de iniciar la junta en vivo" : undefined
          }
          onStart={(opts) => {
            const t = title.trim();
            setTitle("");
            void live.start({ project, title: t || undefined, ...opts });
          }}
        />
        {/* Guards del provider (p. ej. llamada de voz activa) sin takeover */}
        {live.error && (
          <p className="text-2xs leading-snug text-red">
            ⚠ {live.error}
          </p>
        )}
        {liveNotice && (
          <p className="text-2xs leading-snug text-green">
            ✓ {liveNotice}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!rec.recording ? (
            <button
              type="button"
              onClick={() => void rec.start()}
              disabled={busy || !rec.supported || live.active}
              title={
                live.active
                  ? "Hay una junta en vivo usando el micrófono"
                  : rec.supported
                    ? "Grabar la junta"
                    : "Grabación no soportada (usa subir archivo)"
              }
              className="cmd-btn !w-auto"
              // `.cmd-btn` vive fuera de @layer y le gana a las utilities:
              // el tinte va por style con las vars nuevas (ver CmdButton.tsx).
              style={{ borderColor: "var(--color-red)", color: "var(--color-red)" }}
            >
              ● Grabar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onStopRecording()}
              className="flex items-center gap-2 rounded-sm border border-red bg-red/10 px-3 py-2 text-xs tracking-label text-red uppercase"
            >
              <Waveform />■ Detener · {fmt(rec.elapsed)}
            </button>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="cmd-btn !w-auto"
            style={{ borderColor: "var(--color-cyan)", color: "var(--color-cyan)" }}
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
            style={{ borderColor: "var(--color-blue)", color: "var(--color-blue)" }}
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
            className={`${FIELD} min-h-[40px] flex-1 resize-y px-2.5 py-1.5 text-xs leading-snug text-text`}
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
            style={{ borderColor: "var(--color-green)", color: "var(--color-green)" }}
          >
            ⏎ Procesar
          </button>
        </div>

        {rec.error && (
          <p className="text-2xs leading-snug text-amber">
            ⚠ {rec.error}
          </p>
        )}
        {busy && (
          <p className="text-2xs tracking-label text-violet pulse-dot">
            ◈ Transcribiendo y resumiendo la reunión…
          </p>
        )}
        {error && (
          <p className="text-2xs leading-snug text-red">
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
          <PanelState
            kind="empty"
            title="Sin reuniones todavía"
            hint={`Graba, sube o pega la primera junta de ${projectName ?? project}.`}
          />
        ) : (
          <div className="h-full space-y-1.5 overflow-y-auto pr-1">
            {meetings.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelected(m.id)}
                className="flex w-full items-center justify-between gap-2 rounded-sm border border-line bg-violet/5 px-2.5 py-2 text-left transition-colors hover:border-violet"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-text">
                    {m.title}
                  </span>
                  <span className="text-2xs tracking-label text-text-dim uppercase">
                    {m.fecha.slice(0, 10)} · {m.accionables_count} accionables
                  </span>
                </span>
                <span className="text-2xs text-violet">
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
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        // animationDelay depende del índice: se queda inline a propósito.
        <span key={i} className="wave-bar h-3" style={{ animationDelay: `${i * 0.12}s` }} />
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
