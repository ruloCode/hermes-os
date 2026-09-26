"use client";

/**
 * Temas · LISTA: cada tema con su etapa, su pista (tonalidad · bpm) y cuántas
 * tomas lleva; a la derecha, el contexto — qué es un tema y cómo nace uno de un
 * tarareo de Sesiones. "Nuevo tema" (N) crea y abre.
 *
 * Estados honestos: cargando con esqueleto; si el agente no tiene las rutas de
 * temas (todavía no se reinició) lo dice con esas palabras, no "error".
 */
import { useEffect } from "react";
import { TEMA_STAGES, TEMA_STAGE_LABEL, type TemaListItem } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { PanelState } from "@/components/ui/PanelState";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useComposicion } from "../ComposicionContext";
import { fmtRelative } from "../labels";
import { useViewActive } from "../playground/api";
import { btn, btnPrimary, plainKey } from "../playground/ui";
import { PrivacyPill } from "./PrivacyPill";
import { useTemas } from "./TemasProvider";
import { fmtBpm } from "./track-edit";

const STAGE_HINT: Record<(typeof TEMA_STAGES)[number], string> = {
  intencion: "De qué habla, qué transmite, a quién, qué evitar.",
  pista: "Tonalidad, acordes por compás, bpm, groove y secciones.",
  grabar: "Tarareas los fonemas encima del loop, con cuenta y metrónomo.",
  analisis: "La toma leída en la rejilla: compás, tiempo, grado, melisma, vocal, dinámica.",
  letra: "Versiones medidas contra el molde, con el eco de tus vocales.",
  montaje: "Eliges qué parte va en cada sección y lo aplicas a una canción.",
};

export function TemasHome() {
  const { temas, error, reload, openTema, create, creating, createError } = useTemas();
  const { notation, songs, setSection } = useComposicion();
  const active = useViewActive();

  // N = tema nuevo (sin ⌘: ⌘N abre una ventana del navegador).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e) || e.key.toLowerCase() !== "n" || e.shiftKey || creating) return;
      e.preventDefault();
      void create();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, create, creating]);

  const noRoutes = !!error && /404|not found|no encontrad/i.test(error);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-6 gap-y-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
      <section className="col-span-12 flex min-h-[360px] min-w-0 flex-col lg:col-span-8 lg:min-h-0">
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-text-faint">
            Un tema es una canción en construcción: pista, intención, tus fonemas encima y la letra que sale de ellos.
          </p>
          <div className="flex items-center gap-2">
            <PrivacyPill />
            <button type="button" className={btnPrimary} onClick={() => void create()} disabled={creating}>
              {creating ? "Creando…" : "Nuevo tema"} <kbd className="text-2xs opacity-70">N</kbd>
            </button>
          </div>
        </div>
        {createError && <p className="mb-2 text-xs text-red">No se pudo crear el tema: {createError}</p>}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-panel">
          {temas === null && !error && (
            <div className="p-4">
              <PanelState kind="loading" />
            </div>
          )}
          {temas === null && error && (
            <PanelState
              kind={noRoutes ? "empty" : "offline"}
              title={noRoutes ? "El agente todavía no tiene Temas" : "El agente no responde"}
              hint={
                noRoutes
                  ? "Las rutas de temas llegan al reiniciar el agente. Lo demás de Composición sigue funcionando."
                  : "Los temas viven en el agente (tomas, análisis, letras). Sin él no hay temas."
              }
              retry={() => void reload()}
            />
          )}
          {temas && temas.length === 0 && (
            <EmptyTemas onCreate={() => void create()} onSessions={() => setSection("sesiones")} creating={creating} />
          )}
          {temas && temas.length > 0 && (
            <ScrollArea className="h-full" fade="y">
              <ul>
                {temas.map((t) => (
                  <TemaRow
                    key={t.id}
                    t={t}
                    notation={notation}
                    songTitle={songs.find((s) => s.id === t.songId)?.title}
                    onOpen={() => openTema(t.id)}
                  />
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </section>
      <aside aria-label="Contexto" className="col-span-12 min-h-0 border-line lg:col-span-4 lg:border-l lg:pl-6">
        <div className="flex flex-col gap-6 lg:pt-1">
          <section className="flex flex-col gap-2">
            <span className="text-2xs text-text-faint">Las 6 etapas de un tema</span>
            <ol className="flex flex-col gap-2">
              {TEMA_STAGES.map((s, i) => (
                <li key={s} className="flex gap-2.5 text-xs">
                  <span className="w-3 shrink-0 text-right font-mono text-text-faint tabular-nums">{i + 1}</span>
                  <span>
                    <span className="text-text">{TEMA_STAGE_LABEL[s]}</span>
                    <span className="text-text-dim"> · {STAGE_HINT[s]}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-text-faint">La misma pista suena en loop en todas las etapas.</p>
          </section>
          <section className="flex flex-col gap-2">
            <span className="text-2xs text-text-faint">Desde un tarareo</span>
            <p className="text-xs text-text-dim">
              En Sesiones, elige un pasaje cantado y usa «Llevar a un Tema»: nace con la tonalidad medida y el bpm
              aproximado del tarareo.
            </p>
            <button type="button" className={`${btn} self-start`} onClick={() => setSection("sesiones")}>
              Ir a Sesiones
            </button>
          </section>
          <section className="flex flex-col gap-2">
            <span className="text-2xs text-text-faint">Atajos</span>
            <p className="text-xs text-text-dim">
              N tema nuevo · ⌥1…⌥6 etapas · Espacio ▶/■ · T tap · Esc volver
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}

function EmptyTemas({ onCreate, onSessions, creating }: { onCreate: () => void; onSessions: () => void; creating: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-text">Todavía no hay temas</p>
      <p className="max-w-[48ch] text-xs text-text-dim">
        Arma una pista (tonalidad y acordes), escribe la intención y tararea encima. Hermes mide lo que cantaste en la
        rejilla y te propone letras que respetan tus vocales. La letra la decides tú.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={btnPrimary} onClick={onCreate} disabled={creating}>
          Nuevo tema
        </button>
        <button type="button" className={btn} onClick={onSessions}>
          Desde un tarareo
        </button>
      </div>
    </div>
  );
}

function TemaRow({
  t,
  notation,
  songTitle,
  onOpen,
}: {
  t: TemaListItem;
  notation: "en" | "latin";
  songTitle?: string;
  onOpen: () => void;
}) {
  const reached = TEMA_STAGES.indexOf(t.stage);
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left hover:bg-panel-2/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-text group-hover:text-accent">{t.title}</span>
          <span className="mt-0.5 block truncate text-xs text-text-faint">
            {[
              keyLabel(t.key, notation),
              `${fmtBpm(t.bpm)} bpm`,
              t.takes ? `${t.takes} ${t.takes === 1 ? "toma" : "tomas"}` : "sin tomas",
              fmtRelative(t.updatedAt),
            ].join(" · ")}
            {songTitle && <span> · ♫ {songTitle}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-text-dim">{TEMA_STAGE_LABEL[t.stage]}</span>
          <span className="flex gap-0.5" aria-label={`Etapa ${reached + 1} de ${TEMA_STAGES.length}`}>
            {TEMA_STAGES.map((s, i) => (
              <span key={s} aria-hidden className={`h-1 w-3 rounded-full ${i <= reached ? "bg-text-dim" : "bg-line-2"}`} />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}
