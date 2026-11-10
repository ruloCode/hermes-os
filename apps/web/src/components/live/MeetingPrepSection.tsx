"use client";

// «Preparación» en la tarjeta de inicio de la junta: la hoja que se lee UN
// minuto antes de entrar. Objetivo arriba (lo único en negrita), después lo
// que se dice — preguntas y apertura —, lo que prometiste y lo que sigue
// abierto; los riesgos al final. Cada punto lleva su fuente, chica y gris: está
// para comprobar, no para leerla. Sin hoja de hoy, un botón «Preparar».
//
// Lo arma el agente (`/meetings/prep`, ~10 s) y el copiloto la recibe al
// iniciar la junta. Spec: openspec/changes/v6-nucleo/specs/juntas.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  prepCardState,
  prepSourceText,
  type MeetingPrep,
  type PrepPoint,
} from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { generateMeetingPrep, getMeetingPrep } from "@/lib/meeting-prep-api";

/** Pendientes visibles antes de «ver todos»: la hoja es de un minuto. */
const PENDING_VISIBLE = 4;

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

export function MeetingPrepSection({ project }: { project: string }) {
  const [prep, setPrep] = useState<MeetingPrep | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // El proyecto puede cambiar mientras se genera: solo se pinta la respuesta del vigente.
  const current = useRef(project);
  current.current = project;

  useEffect(() => {
    let alive = true;
    setPrep(null);
    setStale(false);
    setError(null);
    setShowAll(false);
    setLoading(true);
    void getMeetingPrep(project).then((r) => {
      if (!alive) return;
      setLoading(false);
      // Si la consulta falla no hay nada que mostrar: se ofrece «Preparar» (el
      // POST devuelve la guardada si existe). El error se dice solo al generar.
      if (r.ok) {
        setPrep(r.prep);
        setStale(!!r.stale);
      }
    });
    return () => {
      alive = false;
    };
  }, [project]);

  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [generating]);

  const generate = useCallback(
    async (force: boolean) => {
      const target = project;
      setGenerating(true);
      setError(null);
      const r = await generateMeetingPrep(target, force);
      if (current.current !== target) return;
      setGenerating(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPrep(r.prep);
      setStale(false);
    },
    [project],
  );

  const state = prepCardState({ loading, generating, error, prep });

  return (
    <section aria-label="Preparación de la junta" className="space-y-2.5 border-b border-line pb-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-text">Preparación</h3>
        {state === "sheet" && prep && <SheetMeta prep={prep} />}
        <div className="ml-auto flex items-center gap-2">
          {state === "sheet" && stale && (
            <span className="text-xs text-amber">Hay novedades desde que se armó</span>
          )}
          {state === "sheet" && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void generate(true)}
              title="Volver a leer actas y tareas y redactar de nuevo (~10 s)"
            >
              Rehacer
            </Button>
          )}
        </div>
      </div>

      {state === "loading" && (
        <div className="space-y-2" role="status" aria-label="Buscando la preparación de hoy">
          <div className="skeleton h-3 w-2/3" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      )}

      {state === "offer" && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 basis-[260px] text-xs leading-snug text-text-dim">
            Objetivo, preguntas para hacer y lo que prometiste, sacado de las actas y tareas de este
            proyecto. El copiloto la usa durante la junta.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void generate(false)}>
            Preparar
          </Button>
        </div>
      )}

      {state === "generating" && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <p className="text-xs text-text-dim">
            {elapsed < 3 ? "Leyendo actas y tareas…" : "Redactando objetivo y preguntas…"}{" "}
            <span className="font-mono tabular-nums text-text-faint">{elapsed} s</span>
          </p>
          {/* Avance estimado: suele tardar 10-20 s; se queda en 90 % hasta que llega. */}
          <div className="h-1 overflow-hidden rounded-full bg-hover">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
              style={{ width: `${Math.min(90, (elapsed / 15) * 90)}%` }}
            />
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs text-red">No se pudo preparar: {error}</p>
          <Button variant="secondary" size="sm" onClick={() => void generate(false)}>
            Reintentar
          </Button>
        </div>
      )}

      {state === "sheet" && prep && (
        <Sheet prep={prep} showAll={showAll} onShowAll={() => setShowAll(true)} />
      )}
    </section>
  );
}

function SheetMeta({ prep }: { prep: MeetingPrep }) {
  const parts: string[] = [];
  if (prep.event) {
    const at = hhmm(prep.event.startsAt);
    parts.push(`para «${prep.event.title}»${at ? ` · ${at}` : ""}`);
  }
  parts.push(`armada ${hhmm(prep.generatedAt)}`);
  return <span className="min-w-0 truncate text-xs text-text-faint">{parts.join(" · ")}</span>;
}

function Sheet({
  prep,
  showAll,
  onShowAll,
}: {
  prep: MeetingPrep;
  showAll: boolean;
  onShowAll: () => void;
}) {
  if (prep.status === "no-history") {
    return <p className="text-xs leading-snug text-text-dim">{prep.note}</p>;
  }
  const pending = showAll ? prep.pending : prep.pending.slice(0, PENDING_VISIBLE);
  const hidden = prep.pending.length - pending.length;

  return (
    <div className="space-y-3">
      {prep.status === "draft-failed" && prep.note && (
        <p className="text-xs leading-snug text-amber">{prep.note}</p>
      )}

      {prep.objective && (
        <div className="min-w-0">
          <p className="text-md leading-snug font-semibold text-text">{prep.objective.text}</p>
          <SourceLine point={prep.objective} />
        </div>
      )}

      <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
        {prep.questions.length > 0 && (
          <Block title="Preguntas para hacer">
            <ol className="space-y-1.5">
              {prep.questions.map((q, i) => (
                <Item key={i} point={q} marker={`${i + 1}.`} />
              ))}
            </ol>
          </Block>
        )}

        {prep.opener && (
          <Block title="Para abrir">
            <p className="text-sm leading-snug text-text">«{prep.opener.text}»</p>
          </Block>
        )}

        {prep.promises.length > 0 && (
          <Block title="Lo que prometiste">
            <ul className="space-y-1.5">
              {prep.promises.map((p, i) => (
                <Item key={i} point={p} marker="·" />
              ))}
            </ul>
          </Block>
        )}

        {prep.pending.length > 0 && (
          <Block title="Sigue abierto">
            <ul className="space-y-1.5">
              {pending.map((p, i) => (
                <Item key={i} point={p} marker="·" />
              ))}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={onShowAll}
                className="mt-1 cursor-pointer text-xs text-accent hover:underline"
              >
                Ver {hidden} más
              </button>
            )}
          </Block>
        )}

        {prep.risks.length > 0 && (
          <Block title="Riesgos">
            <ul className="space-y-1.5">
              {prep.risks.map((r, i) => (
                <Item key={i} point={r} marker="·" dim />
              ))}
            </ul>
          </Block>
        )}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-xs font-medium text-text-dim">{title}</h4>
      {children}
    </div>
  );
}

function Item({ point, marker, dim = false }: { point: PrepPoint; marker: string; dim?: boolean }) {
  return (
    <li className="flex min-w-0 gap-2">
      <span aria-hidden className="w-3 shrink-0 text-right text-xs leading-5 text-text-faint">
        {marker}
      </span>
      <div className="min-w-0">
        <p className={`text-sm leading-snug break-words ${dim ? "text-text-dim" : "text-text"}`}>
          {point.text}
        </p>
        <SourceLine point={point} />
      </div>
    </li>
  );
}

/** La fuente del punto: discreta, completa al pasar el mouse. */
function SourceLine({ point }: { point: PrepPoint }) {
  const text = prepSourceText(point.source);
  const title = point.detail ? `${text}\n${point.detail}` : text;
  return (
    <p className="truncate text-2xs text-text-faint" title={title}>
      {text}
    </p>
  );
}
