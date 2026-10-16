"use client";

import { useCallback, useEffect, useState } from "react";
import type { Meeting, MeetingActionable, Task } from "@hermes/shared";
import {
  downloadMeeting,
  getMeeting,
  hermesPost,
  triageActionable,
  type RunRef,
} from "@/lib/hermes";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Button } from "@/components/ui/Button";
import { Markdown } from "./Markdown";

/**
 * Detalle de una reunión: resumen + accionables para TRIAR Linear-first
 * (Ejecutar / Crear en Linear / Ignorar) + transcripción colapsable. Ejecutar
 * y Crear publican el issue en Linear con el exec_prompt como Copy prompt;
 * Ejecutar además lanza el run y lo abre en la CONSOLA principal.
 *
 * Se puede bajar la transcripción sola (.txt) o la junta completa (.md del
 * vault: resumen, accionables, sugerencias en vivo, coach y transcripción).
 */
export function MeetingDetail({
  project,
  id,
  onBack,
  onExecute,
}: {
  project: string;
  id: string;
  onBack: () => void;
  onExecute: (r: RunRef, task?: Task | null) => void;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [downloading, setDownloading] = useState<"txt" | "md" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const m = await getMeeting(project, id);
    setMeeting(m);
    setLoading(false);
  }, [project, id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMeeting(project, id).then((m) => {
      if (!alive) return;
      setMeeting(m);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [project, id]);

  const triage = async (a: MeetingActionable, decision: "ejecutar" | "pendiente" | "ignorar") => {
    setBusy(a.idx);
    const { run, task } = await triageActionable(project, id, a.idx, decision);
    await load();
    setBusy(null);
    if (decision === "ejecutar" && run) onExecute(run, task);
  };

  const download = async (format: "txt" | "md") => {
    setDownloading(format);
    setDownloadError(null);
    try {
      await downloadMeeting(project, id, format);
    } catch {
      setDownloadError("No se pudo descargar el archivo");
    } finally {
      setDownloading(null);
    }
  };

  // Fuente de demanda REAL → idea de contenido: el dolor que salió en la junta
  // nace en el Estudio CON hipótesis (el porqué viene de la conversación, no
  // de un título suelto). No cambia el triage del accionable — es aditivo.
  const [ideaDone, setIdeaDone] = useState<Set<number>>(new Set());
  const [ideaBusy, setIdeaBusy] = useState<number | null>(null);
  const toContentIdea = async (a: MeetingActionable) => {
    if (!meeting) return;
    setIdeaBusy(a.idx);
    const when = new Date(meeting.fecha).toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      day: "numeric",
      month: "short",
    });
    const piece = await hermesPost("/content/pieces", {
      title: a.title,
      pillar: "p3",
      notes: `Nació de la junta "${meeting.title}" (${project}, ${when}). Hipótesis: ${a.one_liner?.trim() || "dolor real de cliente — escribir el porqué antes de comprometerla"}.`,
    }).catch(() => null);
    if (piece) setIdeaDone((s) => new Set(s).add(a.idx));
    setIdeaBusy(null);
  };

  // Control total de la junta: manda TODOS los accionables sin triar a Linear
  // (como pendientes). Secuencial: cada uno crea su issue con Copy prompt.
  const bulkToLinear = async () => {
    if (!meeting) return;
    setBulkBusy(true);
    for (const a of meeting.actionables) {
      if (a.taskId == null) await triageActionable(project, id, a.idx, "pendiente");
    }
    await load();
    setBulkBusy(false);
  };

  const pendingTriage = meeting?.actionables.some((a) => a.taskId == null) ?? false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabecera de PIEZA: ← Reuniones · título · descargar el acta. */}
      <ViewHeader
        title={meeting?.title ?? "Reunión"}
        onBack={onBack}
        backLabel="Reuniones"
        meta={meeting ? meeting.fecha.slice(0, 10) : undefined}
        actions={
          meeting ? (
            <>
              {downloadError && <span className="text-xs text-text-dim">{downloadError}</span>}
              <Button
                onClick={() => void download("md")}
                disabled={downloading !== null}
                title="Baja el acta completa: resumen, accionables, sugerencias en vivo, coach y transcripción"
                icon={<DownloadIcon />}
              >
                {downloading === "md" ? "Bajando…" : "Acta completa (.md)"}
              </Button>
            </>
          ) : undefined
        }
      />

      {loading && <PanelState kind="loading" title="Cargando reunión" />}

      {!loading && !meeting && <PanelState kind="error" title="No se pudo cargar la reunión" />}

      {meeting && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          <div className="mx-auto w-full max-w-[820px] space-y-8">
            {/* Metadatos: datos, no decoración (sin glifos de reloj ni flechas). */}
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <Meta label="Fecha">{meeting.fecha.slice(0, 10)}</Meta>
              <Meta label="Origen">{sourceLabel(meeting.source)}</Meta>
              {meeting.stt_provider && <Meta label="Transcripción">{meeting.stt_provider}</Meta>}
              {meeting.duracion_min ? <Meta label="Duración">{meeting.duracion_min} min</Meta> : null}
            </dl>

            <Section title="Resumen">
              {meeting.summary ? (
                <Markdown source={meeting.summary} project={project} />
              ) : (
                <p className="text-sm text-text-faint">Sin resumen.</p>
              )}
            </Section>

            <Section
              title="Accionables"
              count={meeting.actionables.length}
              right={
                pendingTriage ? (
                  <Button
                    variant="ghost"
                    onClick={() => void bulkToLinear()}
                    disabled={bulkBusy || busy !== null}
                    title="Crear TODOS los accionables sin triar como issues de Linear (pendientes)"
                  >
                    {bulkBusy ? "Creando…" : "Todos a Linear"}
                  </Button>
                ) : undefined
              }
            >
              <div className="space-y-2">
                {meeting.actionables.map((a) => (
                  // El accionable se OPERA (triar): por eso es tarjeta.
                  <div key={a.id} className="rounded-md border border-line bg-panel px-4 py-3">
                    <p className="text-sm font-medium text-text">{a.title}</p>
                    {a.one_liner && (
                      <p className="mt-1 text-sm leading-snug text-text-dim">{a.one_liner}</p>
                    )}

                    {a.taskId == null ? (
                      // Sin triar: 3 decisiones Linear-first (+ idea de contenido).
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="primary"
                          disabled={busy !== null || bulkBusy}
                          title="Crea el issue en Linear y lo ejecuta con Claude Code (abre la consola)"
                          onClick={() => void triage(a, "ejecutar")}
                          icon={
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
                            </svg>
                          }
                        >
                          {busy === a.idx ? "Lanzando…" : "Ejecutar"}
                        </Button>
                        <Button
                          disabled={busy !== null || bulkBusy}
                          title="Crea el issue en Linear (pendiente) con el Copy prompt listo"
                          onClick={() => void triage(a, "pendiente")}
                        >
                          {busy === a.idx ? "Creando…" : "Crear en Linear"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy !== null || bulkBusy}
                          title="No crear nada (queda auditado localmente)"
                          onClick={() => void triage(a, "ignorar")}
                        >
                          Ignorar
                        </Button>
                        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
                        {ideaDone.has(a.idx) ? (
                          <span className="inline-flex h-7 items-center gap-1.5 px-1 text-xs text-text-dim">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-green">
                              <path d="m5 12.5 4.5 4.5L19 7.5" />
                            </svg>
                            En el Estudio
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            disabled={ideaBusy !== null}
                            title="Crea la idea en el tab ESTUDIO con la hipótesis salida de esta junta (no toca el triage)"
                            onClick={() => void toContentIdea(a)}
                          >
                            {ideaBusy === a.idx ? "Creando…" : "Idea de contenido"}
                          </Button>
                        )}
                      </div>
                    ) : (
                      // Ya triado: estado + el issue de Linear (si lo hay).
                      <div className="mt-2.5 flex flex-wrap items-center gap-3">
                        <StatusChip status={a.status ?? "pending"} />
                        {a.linear_identifier && a.linear_url ? (
                          <a
                            href={a.linear_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-6 items-center gap-1 rounded-xs border border-line px-2 font-mono text-2xs text-text-dim transition-colors hover:border-line-2 hover:text-text"
                            title="Abrir el issue en Linear"
                          >
                            {a.linear_identifier}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M7 17 17 7M9 7h8v8" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-xs text-text-faint">Gestiónala en Tareas</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            {/* Coach: solo juntas EN VIVO con métricas reales (sin datos, sin sección). */}
            {meeting.coach && (
              <Section title="Coach">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dim tabular-nums">
                    {Object.entries(meeting.coach.metrics.bySpeaker)
                      .sort(([, a], [, b]) => b.talkMs - a.talkMs)
                      .map(([label, s]) => {
                        const total = Object.values(meeting.coach!.metrics.bySpeaker).reduce(
                          (a, x) => a + x.talkMs,
                          0,
                        );
                        const pct = total > 0 ? Math.round((s.talkMs / total) * 100) : 0;
                        const isSelf = label === meeting.coach!.metrics.selfSpeaker;
                        return (
                          <span key={label} className={isSelf ? "font-medium text-text" : undefined}>
                            {label}
                            {isSelf ? " (yo)" : ""}: {pct}% · {s.wpm} wpm · {s.fillers} muletillas
                          </span>
                        );
                      })}
                  </div>
                  {meeting.coach.performance && (
                    <div className="rounded-md border border-line bg-panel px-4 py-3">
                      <p className="text-sm font-medium text-text">
                        Desempeño{" "}
                        <span className="tabular-nums">{meeting.coach.performance.score}/10</span>
                      </p>
                      <ul className="mt-2 space-y-1 text-sm leading-snug">
                        {meeting.coach.performance.highlights.map((h) => (
                          <li key={h} className="flex gap-2 text-text">
                            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-green" />
                            {h}
                          </li>
                        ))}
                        {meeting.coach.performance.improvements.map((i) => (
                          <li key={i} className="flex gap-2 text-text-dim">
                            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                            {i}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Section>
            )}

            <Section
              title="Transcripción"
              right={
                <span className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => setShowTranscript((v) => !v)}
                    aria-expanded={showTranscript}
                  >
                    {showTranscript ? "Ocultar" : "Mostrar"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void download("txt")}
                    disabled={downloading !== null || !meeting.transcript}
                    title="Baja la transcripción completa como archivo de texto"
                    icon={<DownloadIcon />}
                  >
                    {downloading === "txt" ? "Bajando…" : ".txt"}
                  </Button>
                </span>
              }
            >
              {showTranscript ? (
                <p className="max-h-[48vh] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-text-dim">
                  {meeting.transcript || "Sin transcripción."}
                </p>
              ) : (
                <p className="text-xs text-text-faint">
                  {meeting.transcript
                    ? `${meeting.transcript.split(/\s+/).length.toLocaleString("es-CO")} palabras`
                    : "Sin transcripción."}
                </p>
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-text-faint">{label}</dt>
      <dd className="text-text-dim">{children}</dd>
    </div>
  );
}

function Section({
  title,
  count,
  right,
  children,
}: {
  title: string;
  count?: number;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex min-h-7 items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          {title}
          {count != null && <span className="font-normal text-text-faint tabular-nums">{count}</span>}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
    </svg>
  );
}

function StatusChip({ status }: { status: NonNullable<MeetingActionable["status"]> }) {
  // El color va en el punto (estado); el texto en gris.
  const map: Record<string, { label: string; dot: string }> = {
    pending: { label: "Pendiente", dot: "bg-amber" },
    running: { label: "Ejecutando", dot: "bg-cyan pulse-dot" },
    done: { label: "Hecha", dot: "bg-green" },
    dismissed: { label: "Ignorada", dot: "bg-text-faint" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-dim">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function sourceLabel(s: Meeting["source"]): string {
  return s === "audio"
    ? "Grabada"
    : s === "upload"
      ? "Audio subido"
      : s === "live"
        ? "Junta en vivo"
        : "Transcripción pegada";
}
