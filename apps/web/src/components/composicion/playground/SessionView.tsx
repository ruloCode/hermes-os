"use client";

/**
 * Playground · SESIÓN (la pieza de la lista): cabecera con título editable,
 * fecha, duración y voces; el pipeline en vivo; la franja de voces sobre el
 * tiempo; la lista de pasajes; y a la derecha el video + contexto. Desde aquí
 * se crea la canción del tablero (o se vincula a una existente) y se abre cada
 * pasaje como MEMO.
 *
 * Teclado (fuera de campos de texto): ↑↓ / J K pasaje · ⏎ abrir memo ·
 * Espacio escuchar el pasaje · ⌫ descartar · Esc volver a la lista.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComposeSession } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { PanelState } from "@/components/ui/PanelState";
import { useComposicion } from "../ComposicionContext";
import { usePlaygroundApi, useViewActive } from "./api";
import { usePlayground } from "./PlaygroundContext";
import { useSessionData } from "./useSessionData";
import { useMediaClock } from "./useMediaClock";
import { SessionPipeline } from "./SessionPipeline";
import { VoiceStrip, visibleSpeakers } from "./VoiceStrip";
import { PassageList } from "./PassageList";
import { SessionAside, SessionMedia } from "./SessionAside";
import { MemoView } from "./MemoView";
import { btn, btnGhost, btnPrimary, field, plainKey, spaceOnButton } from "./ui";
import { fmtDate, fmtDuration } from "./format";

export function SessionView({ id }: { id: string }) {
  const data = useSessionData(id);
  const { passageId, openPassage, openSession, focusPassage, setFocusPassage } = usePlayground();
  const { session, error } = data;

  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <BackBar onBack={() => openSession(null)} />
        {error ? (
          <PanelState kind="error" title="No pude abrir la sesión" hint={error} retry={() => void data.reload()} />
        ) : (
          <PanelState kind="loading" />
        )}
      </div>
    );
  }

  const passage = passageId ? session.passages.find((p) => p.id === passageId) ?? null : null;
  if (passage) {
    return <MemoView session={session} passage={passage} onBack={() => openPassage(null)} data={data} />;
  }
  return (
    <SessionBody
      session={session}
      data={data}
      selected={focusPassage}
      onSelect={setFocusPassage}
      onOpen={(pid) => openPassage(pid)}
      onBack={() => openSession(null)}
    />
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-1 pb-3">
      <button type="button" onClick={onBack} className={btn}>
        ← Sesiones
      </button>
    </div>
  );
}

function SessionBody({
  session,
  data,
  selected,
  onSelect,
  onOpen,
  onBack,
}: {
  session: ComposeSession;
  data: ReturnType<typeof useSessionData>;
  selected: string | null;
  onSelect: (pid: string | null) => void;
  onOpen: (pid: string) => void;
  onBack: () => void;
}) {
  const api = usePlaygroundApi();
  const active = useViewActive();
  const comp = useComposicion();
  const clock = useMediaClock({ active });
  const selectedPassage = session.passages.find((p) => p.id === selected) ?? null;
  const duration =
    session.durationSec ?? data.peaks?.durationSec ?? Math.max(1, ...session.passages.map((p) => p.end));

  // El orden de navegación con el teclado = el de la lista (probables, dudosos).
  const order = useMemo(
    () => [
      ...session.passages.filter((p) => p.group === "probable"),
      ...session.passages.filter((p) => p.group === "dudoso"),
    ],
    [session.passages],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && plainKey(e)) {
        e.preventDefault();
        clock.pause();
        onBack();
        return;
      }
      if (!plainKey(e) || spaceOnButton(e)) return;
      const i = order.findIndex((p) => p.id === selected);
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        const n = order[Math.min(order.length - 1, i + 1)];
        if (n) onSelect(n.id);
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        const n = order[Math.max(0, i - 1)];
        if (n) onSelect(n.id);
      } else if (e.key === "Enter" && selectedPassage?.status === "listo") {
        e.preventDefault();
        clock.pause();
        onOpen(selectedPassage.id);
      } else if (e.key === " ") {
        e.preventDefault();
        if (clock.playing) clock.pause();
        else if (selectedPassage) clock.playRange(selectedPassage.start, selectedPassage.end);
        else clock.toggle();
      } else if ((e.key === "Backspace" || e.key === "Delete") && selectedPassage && !session.take) {
        // Una toma tiene un solo pasaje: no se descarta (el agente respondería 409).
        e.preventDefault();
        void data.patchPassage(selectedPassage.id, { group: "descartado" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, clock, data, onBack, onOpen, onSelect, order, selected, selectedPassage, session.take]);

  const voices = visibleSpeakers(session);
  const meta = [
    fmtDate(session.recordedAt ?? session.createdAt),
    fmtDuration(session.durationSec),
    voices.length ? `${voices.length} ${voices.length === 1 ? "voz" : "voces"}` : null,
    session.key ? `≈ ${keyLabel(session.key.best.key, comp.notation)}` : null,
  ].filter(Boolean);

  const onProcess = async (from?: Parameters<typeof api.process>[1]) => {
    try {
      await api.process(session.id, from);
    } catch (e) {
      data.setError((e as Error).message);
    }
    void data.reload();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-1 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button type="button" onClick={onBack} className={btn} title="Volver a la lista (Esc)">
            ← Sesiones
          </button>
          <TitleField
            value={session.title}
            onCommit={(t) => void data.patchSession({ title: t })}
          />
          <span className="shrink-0 truncate text-xs text-text-faint">{meta.join(" · ")}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={btnGhost} onClick={() => void api.reveal(session.id)} title="Abrir la carpeta en Finder">
            ⊙ Carpeta
          </button>
          <SongLink session={session} data={data} comp={comp} />
        </div>
      </header>
      {data.error && (
        <p className="shrink-0 text-xs text-red">
          {data.error}{" "}
          <button type="button" className={btnGhost} onClick={() => data.setError(null)}>
            ocultar
          </button>
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)] wide:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-h-[480px] min-w-0 flex-col gap-4 lg:min-h-0">
          <SessionPipeline
            session={session}
            onProcess={(from) => void onProcess(from)}
            onStop={async () => {
              await api.stop(session.id).catch((e: Error) => data.setError(e.message));
              void data.reload();
            }}
          />
          <VoiceStrip
            session={session}
            transcript={data.transcript}
            peaks={data.peaks?.peaks ?? null}
            duration={duration}
            time={clock.time}
            selected={selected}
            onSeek={clock.seek}
            onSelectPassage={onSelect}
          />
          <PassageList
            session={session}
            clock={clock}
            selected={selected}
            onSelect={onSelect}
            onOpen={(pid) => {
              clock.pause();
              onOpen(pid);
            }}
            onPatch={(pid, patch) => void data.patchPassage(pid, patch)}
            onAnalyze={async (pid) => {
              await api.analyze(session.id, pid).catch((e: Error) => data.setError(e.message));
              void data.reload();
            }}
            onAddManual={async (a, b, sp) => {
              const p = await api.addPassage(session.id, { start: a, end: b, speaker: sp });
              await data.reload();
              onSelect(p.id);
            }}
            notation={comp.notation}
          />
        </div>
        <aside
          aria-label="Contexto de la sesión"
          className="flex min-h-[420px] min-w-0 flex-col gap-3 border-line lg:min-h-0 lg:border-l lg:pl-6"
        >
          <SessionMedia session={session} clock={clock} fileUrl={(rel) => api.fileUrl(session.id, rel)} />
          <SessionAside
            session={session}
            transcript={data.transcript}
            clock={clock}
            selected={selectedPassage}
            onRenameSpeaker={(sid, name) => void data.patchSession({ speakers: [{ id: sid, name }] })}
            onMergeSpeaker={(sid, into) => void data.patchSession({ speakers: [{ id: sid, mergedInto: into }] })}
          />
        </aside>
      </div>
    </div>
  );
}

function TitleField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v.trim() !== value && onCommit(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label="Título de la sesión"
      className="min-w-0 flex-1 truncate rounded-sm border border-transparent bg-transparent px-1 text-lg font-medium text-text hover:border-line focus:border-accent focus:outline-none"
    />
  );
}

/**
 * La canción del tablero que sale de esta sesión: crearla desde el resumen
 * (el agente la arma con lo que dijeron) o vincular una existente. Crear es
 * una acción del SERVIDOR: primero se vacía lo pendiente del tablero local y
 * después se relee — si no, un guardado diferido pisaba la canción nueva.
 */
function SongLink({
  session,
  data,
  comp,
}: {
  session: ComposeSession;
  data: ReturnType<typeof useSessionData>;
  comp: ReturnType<typeof useComposicion>;
}) {
  const api = usePlaygroundApi();
  const [busy, setBusy] = useState(false);
  const song = session.songId ? comp.songs.find((s) => s.id === session.songId) : null;

  const create = useCallback(async () => {
    setBusy(true);
    try {
      await comp.flush();
      const s = await api.createSong(session.id);
      await comp.refresh();
      await data.reload();
      // Sin agente (QA) la canción no llega por refresh: se agrega en memoria.
      if (!comp.online) comp.upsertSong(s);
    } catch (e) {
      data.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, comp, data, session.id]);

  if (song) {
    return (
      <span className="flex items-center gap-1">
        <button
          type="button"
          className={btn}
          onClick={() => {
            comp.setSection("canciones");
            comp.setSelectedId(song.id);
          }}
          title="Abrir la canción"
        >
          ♫ {song.title} ↗
        </button>
        <button
          type="button"
          className={btnGhost}
          title="Desvincular (la canción no se borra)"
          onClick={async () => {
            await data.patchSession({ songId: null });
            comp.linkSession(song.id, session.id, false);
          }}
        >
          ✕
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        className={btnPrimary}
        disabled={busy || session.status === "procesando" || !session.summary}
        onClick={() => void create()}
        title={
          session.summary
            ? "Crea la canción en el tablero con el título, el tema y las líneas del resumen"
            : "Falta el resumen de la sesión (etapa Resumen): la canción se arma con él"
        }
      >
        {busy ? "Creando…" : "Crear canción desde la sesión"}
      </button>
      {comp.songs.length > 0 && (
        <select
          value=""
          onChange={async (e) => {
            const sid = e.target.value;
            if (!sid) return;
            const s = await data.patchSession({ songId: sid });
            if (s) comp.linkSession(sid, session.id, true);
          }}
          className={`${field} w-40`}
          aria-label="Vincular a una canción existente"
        >
          <option value="">o vincular a…</option>
          {comp.songs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
