"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MeetingSummary } from "@hermes/shared";
import { listMeetings, uploadMeeting, getMeetingJob } from "@/lib/hermes";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useHermesData } from "@/hooks/useHermesData";
import { useLiveMeeting } from "@/state/LiveMeetingProvider";
import { useWorkspace } from "@/state/WorkspaceContext";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Button } from "@/components/ui/Button";
import { LiveMeetingView } from "./live/LiveMeetingView";
import { LiveSetupCard } from "./live/LiveSetupCard";
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
    // Una clase de inglés no es una reunión: su cierre lo consume /ingles.
    if (!liveResult || liveResult.englishSessionId) return;
    if (liveResult.project === project) {
      setSelected(liveResult.meetingId);
      refresh();
    } else {
      setLiveNotice(
        `La junta de ${liveResult.project} quedó procesada — elige ese proyecto para verla.`,
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
    return <LiveMeetingView asView />;
  }

  // Avisos de estado real (nunca decorativos): el color va en el punto.
  const notices = (
    <>
      {live.error && <Notice tone="red">{live.error}</Notice>}
      {liveNotice && <Notice tone="green">{liveNotice}</Notice>}
    </>
  );

  // Sin proyecto: antes decía "enfoca un proyecto en la barra izquierda" y no
  // había ninguna barra izquierda de proyectos (estaba a la derecha). Ahora el
  // vacío OFRECE el control: la lista de proyectos activos, a un clic.
  if (!project) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewHeader title="Reuniones" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProjectPicker />
          <div className="mx-auto mt-3 w-full max-w-[600px] space-y-1.5">{notices}</div>
        </div>
      </div>
    );
  }

  // Detalle: la PIEZA reemplaza la lista (con su propia cabecera y ← volver).
  if (selected) {
    return (
      <MeetingDetail
        key={selected}
        project={project}
        id={selected}
        onBack={() => setSelected(null)}
        onExecute={onExecute}
      />
    );
  }

  const label = projectName ?? project;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Reuniones"
        // El proyecto va pegado al título (cambia QUÉ ves) y el conteo detrás:
        // «Reuniones · [Hermes OS ▾] · 2 reuniones».
        tabs={
          <span className="flex min-w-0 items-center gap-3">
            <ProjectSwitcher current={project} label={label} />
            {meetings.length > 0 && (
              <span className="shrink-0 text-xs text-text-faint">
                {meetings.length} {meetings.length === 1 ? "reunión" : "reuniones"}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              title="Subir un archivo de audio de la junta"
              icon={<UploadIcon />}
            >
              Subir audio
            </Button>
            <Button
              variant="ghost"
              onClick={() => textFileRef.current?.click()}
              disabled={busy}
              title="Subir un .txt/.md/.vtt/.srt con la transcripción (Otter, Fireflies, Zoom…)"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
              }
            >
              Subir texto
            </Button>
            {!rec.recording ? (
              <Button
                onClick={() => void rec.start()}
                disabled={busy || !rec.supported || live.active}
                title={
                  live.active
                    ? "Hay una junta en vivo usando el micrófono"
                    : rec.supported
                      ? "Grabar la junta y procesarla al detener"
                      : "Grabación no soportada (usa subir archivo)"
                }
                icon={<MicIcon />}
              >
                Grabar
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() => void onStopRecording()}
                title="Detener y procesar la grabación"
                icon={<Waveform />}
              >
                Detener · <span className="tabular-nums">{fmt(rec.elapsed)}</span>
              </Button>
            )}
            <input ref={fileRef} type="file" accept="audio/*" onChange={onFile} className="hidden" />
            <input
              ref={textFileRef}
              type="file"
              accept=".txt,.md,.vtt,.srt"
              onChange={onTextFile}
              className="hidden"
            />
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* ── Nueva junta: se OPERA, por eso es la única caja ─────────── */}
        <section className="rounded-md border border-line bg-panel shadow-[var(--shadow-card)]">
          <div className="space-y-3 px-4 pt-3.5 pb-4">
            {/* El título vale para todo: en vivo, grabar, subir o pegar. */}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Título de la junta (opcional) · ${label}`}
              aria-label="Título de la junta"
              className="h-8 w-full rounded-sm border border-line bg-panel px-3 text-sm text-text outline-none transition-colors placeholder:text-text-faint focus:border-line-2"
            />

            {/* Junta EN VIVO: copiloto en tiempo real (takeover al iniciar).
                Modo de audio e idiomas se eligen aquí. */}
            <LiveSetupCard
              projectLabel={label}
              disabled={busy || rec.recording}
              disabledTitle={
                rec.recording ? "Detén la grabación antes de iniciar la junta en vivo" : undefined
              }
              onStart={(opts) => {
                const t = title.trim();
                setTitle("");
                void live.start({ project, title: t || undefined, ...opts });
              }}
            />
          </div>

          {/* Pegar transcripción directo */}
          <form
            className="flex items-end gap-2 border-t border-line px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const t = pasteText;
              setPasteText("");
              void submitTranscript(t);
            }}
          >
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="¿Ya tienes la transcripción? Pégala aquí y Hermes la resume…"
              aria-label="Pegar transcripción"
              rows={pasteText.includes("\n") ? 4 : 1}
              className="min-h-8 min-w-0 flex-1 resize-y rounded-sm border border-line bg-panel px-3 py-1.5 text-sm leading-snug text-text outline-none transition-colors placeholder:text-text-faint focus:border-line-2"
            />
            <Button type="submit" size="md" disabled={busy || !pasteText.trim()}>
              Procesar
            </Button>
          </form>
        </section>

        {(busy || error || rec.error || live.error || liveNotice) && (
          <div className="mt-3 space-y-1.5">
            {busy && (
              <Notice tone="cyan" pulse>
                Transcribiendo y resumiendo la reunión…
              </Notice>
            )}
            {rec.error && <Notice tone="amber">{rec.error}</Notice>}
            {error && <Notice tone="red">{error}</Notice>}
            {notices}
          </div>
        )}

        {/* ── Historial ──────────────────────────────────────────────── */}
        <section className="mt-7">
          <h3 className="mb-1.5 flex items-center gap-2 px-2 text-xs font-medium text-text-dim">
            Historial
            {meetings.length > 0 && (
              <span className="text-text-faint tabular-nums">{meetings.length}</span>
            )}
          </h3>
          {meetings.length === 0 ? (
            <PanelState
              kind="empty"
              title="Sin reuniones todavía"
              hint={`Inicia una junta en vivo, graba, sube o pega la primera junta de ${label}.`}
            />
          ) : (
            <ul>
              {meetings.map((m) => (
                <li key={m.id} className="border-t border-line first:border-t-0">
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    className="group flex h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-sm px-2 text-left transition-colors hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-text">{m.title}</span>
                    <span className="hidden shrink-0 text-xs text-text-faint sm:inline">
                      {sourceShort(m.source)}
                    </span>
                    <span className="w-[92px] shrink-0 text-right text-xs text-text-dim tabular-nums">
                      {m.accionables_count} {m.accionables_count === 1 ? "accionable" : "accionables"}
                    </span>
                    <span className="w-[76px] shrink-0 text-right font-mono text-2xs text-text-faint tabular-nums">
                      {m.fecha.slice(0, 10)}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Aviso de una línea: el tono va en el punto, el texto en gris legible. */
function Notice({
  tone,
  pulse = false,
  children,
}: {
  tone: "cyan" | "green" | "amber" | "red";
  pulse?: boolean;
  children: React.ReactNode;
}) {
  const DOT = { cyan: "bg-cyan", green: "bg-green", amber: "bg-amber", red: "bg-red" } as const;
  return (
    <p className="flex items-start gap-2 px-1 text-xs leading-snug text-text-dim">
      <span
        aria-hidden
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]} ${pulse ? "pulse-dot" : ""}`}
      />
      <span className={tone === "red" ? "text-text" : undefined}>{children}</span>
    </p>
  );
}

/** Proyectos activos del vault: los únicos con reuniones vivas. */
function useActiveProjects() {
  const { projects } = useHermesData();
  return projects
    .filter((p) => p.estado === "activo")
    .sort((a, b) => (a.name ?? a.slug).localeCompare(b.name ?? b.slug, "es"));
}

/**
 * Vacío con salida: elegir el proyecto AQUÍ. Usa selectProject (no
 * focusProject): elegir proyecto no debe sacarte de Reuniones a la consola.
 */
function ProjectPicker() {
  const ws = useWorkspace();
  const active = useActiveProjects();
  return (
    <div className="mx-auto w-full max-w-[600px] pt-[7vh] pb-6">
      <span
        aria-hidden
        className="mb-3 grid h-10 w-10 place-items-center rounded-full border border-line bg-panel-2 text-text-faint"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 19a6 6 0 0 1 12 0M16 4.5a3.2 3.2 0 0 1 0 6.2M18 13.5a6 6 0 0 1 3 5.5" />
        </svg>
      </span>
      <h2 className="text-md font-semibold text-text">Elige un proyecto</h2>
      <p className="mt-1 text-sm text-text-dim">
        Las juntas viven por proyecto: inicia una en vivo, grábala, súbela o pega la
        transcripción, y Hermes la resume con sus accionables.
      </p>
      {active.length === 0 ? (
        <PanelState
          kind="empty"
          title="Sin proyectos activos"
          hint="Marca un proyecto con estado: activo en el vault para verlo aquí."
        />
      ) : (
        <ul className="mt-5 grid gap-1.5 sm:grid-cols-2">
          {active.map((p) => (
            <li key={p.slug} className="min-w-0">
              <button
                type="button"
                onClick={() => ws.selectProject(p.slug)}
                className="group flex h-10 w-full min-w-0 cursor-pointer items-center gap-3 rounded-sm border border-line bg-panel px-3.5 text-left shadow-[var(--shadow-card)] transition-colors hover:border-line-2 hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text">{p.name ?? p.slug}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-text-faint transition-colors group-hover:text-text">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Cambiar (o quitar) el proyecto sin salir de Reuniones. */
function ProjectSwitcher({ current, label }: { current: string; label: string }) {
  const ws = useWorkspace();
  const active = useActiveProjects();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (slug: string | null) => {
    ws.selectProject(slug);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Cambiar de proyecto"
        className={`flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-xs border border-line px-2 text-xs transition-colors hover:bg-hover hover:text-text ${
          open ? "bg-hover text-text" : "text-text-dim"
        }`}
      >
        <span className="max-w-[200px] truncate">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Proyectos"
          className="absolute top-full left-0 z-30 mt-1 max-h-[360px] w-[260px] overflow-y-auto rounded-md border border-line bg-panel p-1 shadow-[var(--shadow-pop)]"
        >
          {active.map((p) => (
            <button
              key={p.slug}
              type="button"
              role="menuitem"
              onClick={() => pick(p.slug)}
              className={`flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors hover:bg-hover ${
                p.slug === current ? "bg-selected text-text" : "text-text-dim hover:text-text"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{p.name ?? p.slug}</span>
              {p.slug === current && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-text-dim">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => pick(null)}
            className="flex h-8 w-full cursor-pointer items-center rounded-sm px-2 text-left text-sm text-text-dim transition-colors hover:bg-hover hover:text-text"
          >
            Quitar proyecto
          </button>
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z" />
      <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function sourceShort(s: MeetingSummary["source"]): string {
  return s === "audio"
    ? "Grabada"
    : s === "upload"
      ? "Audio subido"
      : s === "live"
        ? "En vivo"
        : "Transcripción";
}

function Waveform() {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        // animationDelay depende del índice: se queda inline a propósito.
        <span
          key={i}
          className="wave-bar h-3 !bg-current"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
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
