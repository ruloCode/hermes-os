"use client";

/**
 * APLICAR A UNA CANCIÓN — el único camino por el que algo del Playground o de
 * un Tema entra al tablero: con un clic humano, viendo el antes y el después, y
 * dejando rastro en el Historial de la canción. Referencias Mobbin:
 * Confluence AI (verbos explícitos: Insertar debajo · Reemplazar), Semrush
 * "Review your content" (el antes/después lado a lado ES la confirmación) y
 * Asana "Replace existing content?" (la advertencia solo si la sección destino
 * ya tiene letra).
 *
 * Una FILA por sección, cada una con su destino (debajo · reemplazar · nueva):
 *  - el memo de Sesiones manda UNA fila ("Tu versión" del pasaje) — `ApplySheet`,
 *    misma API de siempre;
 *  - el Montaje de un tema manda N (letra elegida + acordes del loop + la
 *    melodía enlazada, por sección) y además ofrece "Nueva canción desde el
 *    tema" — `ApplyToSongSheet`.
 *
 * El resultado y el diff salen de `applyToSong` (@hermes/shared, puro): lo que
 * se ve es exactamente lo que se aplica. Si la canción cambia con la hoja
 * abierta (otra pestaña, un guardado), el diff se recalcula y confirmar pide
 * mirarlo otra vez; una sección destino que ya no existe se dice, no se adivina.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComposeSession, Key, LyricBoard, Passage, SectionKind, Song, SongSection } from "@hermes/shared";
import { applyToSong, lineSyllables, semitonesToKey, stripChords, type ApplyPayload, type ApplyTarget } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { useComposicion } from "../ComposicionContext";
import { SECTION_KINDS } from "../labels";
import { Sheet } from "./Sheet";
import { btn, btnGhost, btnPrimary, chip, field } from "./ui";
import { fmtSemis } from "./format";

type Mode = "debajo" | "reemplazar" | "nueva";

export interface AppliedChange {
  songId: string;
  note: string;
  undo: () => void;
  /** La canción nació con este aplicar (deshacer la borra). */
  created?: boolean;
}

/** Una fila = una sección que entra a la canción. */
export interface ApplyRow {
  /** Estable (la sección del tema, o "memo"). */
  id: string;
  payload: ApplyPayload;
  /** Marcada por defecto. Una sección sin parte elegida arranca desmarcada. */
  include?: boolean;
  /** Lo que hay que saber de esta fila ("sin parte elegida: solo acordes y compases"). */
  note?: string;
}

export interface ApplyRequest {
  /** Qué se aplica, dicho corto: "Tu versión de P01", "el montaje de «Coro de prueba»". */
  origin: string;
  /** Principio de la entrada del Historial: "Letra desde «Sesión» P01", "Desde el tema «X»". */
  notePrefix: string;
  /** Final de la entrada del Historial (" (melodía +2 st)"). */
  noteSuffix?: string;
  rows: ApplyRow[];
  /** Tonalidad de origen: los acordes se transponen a la de la canción y el memo guarda esos semitonos. */
  fromKey?: Key;
  /** Canción sugerida. */
  songId?: string;
  /** Ofrece "Nueva canción desde …" con estos datos (título, tonalidad, tempo, compás, semilla). */
  newSong?: { from: string; title: string; key: Key; tempo: number; meter: Song["meter"]; seed: string };
  /** Pie: dónde queda enlazada la melodía. */
  footnote?: string;
}

interface RowTarget {
  include: boolean;
  mode: Mode;
  /** Sección destino (debajo / reemplazar). */
  sectionId: string;
  /** Sección nueva: clase, nombre y detrás de cuál va ("" = al final). */
  kind: SectionKind;
  label: string;
  after: string;
}

const count = (l: string) => {
  try {
    return lineSyllables(stripChords(l));
  } catch {
    return null;
  }
};

const metric = (ls: string[]) => ls.map((l) => count(l) ?? "?").join("·") || "vacía";
const linesOf = (s: SongSection | null | undefined) => (s ? s.lyrics.split("\n").filter((l) => l.trim()) : []);

/**
 * Destino por defecto de una fila:
 *  - letra suelta (sin `kind`, el memo): la sección ya enlazada a ese memo, si
 *    no el primer coro, si no la primera; debajo si ya tiene letra.
 *  - sección entera (con `kind`, el tema): reemplaza la sección enlazada a ese
 *    memo o una VACÍA de la misma clase y nombre (el esqueleto de la canción);
 *    si no, sección nueva al final. Nunca pisa letra por defecto.
 */
function defaultTarget(song: Song | null, row: ApplyRow): RowTarget {
  const p = row.payload;
  const base: RowTarget = {
    include: row.include ?? true,
    mode: "nueva",
    sectionId: song?.sections[0]?.id ?? "",
    kind: p.kind ?? "coro",
    label: p.label,
    after: "",
  };
  if (!song || !song.sections.length) return base;
  const link = p.link;
  const linked = link
    ? song.sections.find((x) => x.memo?.sessionId === link.sessionId && x.memo.passageId === link.passageId)
    : undefined;
  if (!p.kind) {
    const sec = linked ?? song.sections.find((x) => x.kind === "coro") ?? song.sections[0];
    return { ...base, mode: sec.lyrics.trim() ? "debajo" : "reemplazar", sectionId: sec.id, after: sec.id };
  }
  if (linked) return { ...base, mode: "reemplazar", sectionId: linked.id };
  const same = song.sections.find(
    (x) => x.kind === p.kind && x.label.trim().toLowerCase() === p.label.trim().toLowerCase() && !x.lyrics.trim(),
  );
  if (same) return { ...base, mode: "reemplazar", sectionId: same.id };
  return base;
}

const VERB: Record<Mode, string> = { debajo: "insertada en", reemplazar: "reemplazó", nueva: "sección nueva:" };

/** El destino vigente de una fila (en una canción nueva, todo es sección nueva al final). */
function effectiveTarget(r: ApplyRow, targets: Record<string, RowTarget>, createNew: boolean, song: Song | null): RowTarget {
  const t = targets[r.id] ?? defaultTarget(song, r);
  return createNew ? { ...t, mode: "nueva", after: "" } : t;
}

type Item = { row: ApplyRow; t: RowTarget; payload: ApplyPayload; target: ApplyTarget };

/** Las filas marcadas, listas para applyToSong (con su nombre y clase si van a sección nueva). */
function buildItems(rows: ApplyRow[], targets: Record<string, RowTarget>, createNew: boolean, song: Song | null): Item[] {
  return rows
    .map((row) => ({ row, t: effectiveTarget(row, targets, createNew, song) }))
    .filter(({ t }) => t.include)
    .map(({ row, t }) => {
      const payload: ApplyPayload =
        t.mode === "nueva" ? { ...row.payload, kind: t.kind, label: t.label.trim() || SECTION_KINDS[t.kind].label } : row.payload;
      const target: ApplyTarget =
        t.mode === "nueva"
          ? t.after
            ? { mode: "nueva", afterSectionId: t.after }
            : { mode: "nueva" }
          : { mode: t.mode, sectionId: t.sectionId };
      return { row, t, payload, target };
    });
}

/** El memo de Sesiones: UNA fila, "Tu versión" del pasaje. Misma hoja, misma API de antes. */
export function ApplySheet({
  session,
  passage,
  board,
  semis,
  onClose,
  onApplied,
}: {
  session: ComposeSession;
  passage: Passage;
  board: LyricBoard;
  semis: number;
  onClose: () => void;
  onApplied: (c: AppliedChange) => void;
}) {
  const request = useMemo<ApplyRequest>(() => {
    // Las líneas de un análisis anterior (`stale`) no son de las frases de hoy: no viajan.
    const lines = board.mine
      .filter((m) => !m.stale)
      .sort((a, b) => a.phrase - b.phrase)
      .map((m) => m.text.trim())
      .filter(Boolean);
    return {
      origin: `Tu versión de ${passage.label}`,
      notePrefix: `Letra desde «${session.title}» ${passage.label}`,
      noteSuffix: semis ? ` (melodía ${fmtSemis(semis)})` : "",
      rows: [
        {
          id: "memo",
          payload: { label: "", lines, link: { sessionId: session.id, passageId: passage.id, semitones: semis } },
          note: lines.length ? undefined : "«Tu versión» está vacía: elige o escribe al menos una línea.",
        },
      ],
      songId: session.songId,
      footnote: `${semis !== 0 ? `La melodía viaja transpuesta ${fmtSemis(semis)} · la` : "La"} sección queda enlazada a ${
        passage.label
      } de la sesión.`,
    };
  }, [board.mine, passage.id, passage.label, semis, session.id, session.songId, session.title]);
  return <ApplyToSongSheet request={request} width={860} onClose={onClose} onApplied={onApplied} />;
}

/** La hoja general: N filas (una por sección) a una canción del tablero o a una canción nueva. */
export function ApplyToSongSheet({
  request,
  width = 940,
  onClose,
  onApplied,
}: {
  request: ApplyRequest;
  width?: number;
  onClose: () => void;
  onApplied: (c: AppliedChange) => void;
}) {
  const { songs, patchSong, upsertSong, removeSong, newId, notation } = useComposicion();
  const { rows, fromKey, newSong } = request;
  const single = rows.length === 1;
  const [songId, setSongId] = useState(
    () => (request.songId && songs.some((s) => s.id === request.songId) ? request.songId : songs[0]?.id) ?? "",
  );
  const [createNew, setCreateNew] = useState(() => !!newSong && songs.length === 0);
  const [newTitle, setNewTitle] = useState(newSong?.title ?? "");
  const song = createNew ? null : (songs.find((s) => s.id === songId) ?? null);

  /** La canción de la vista previa: la elegida, o el esqueleto de la nueva. */
  const draftSong = useMemo<Song | null>(() => {
    if (!createNew) return song;
    if (!newSong) return null;
    const now = new Date().toISOString();
    return {
      id: "__nueva",
      title: newTitle.trim() || newSong.title,
      stage: "letra",
      key: newSong.key,
      tempo: Math.round(newSong.tempo),
      meter: newSong.meter,
      mood: [],
      seed: newSong.seed,
      sections: [],
      refIds: [],
      versions: [],
      createdAt: now,
      updatedAt: now,
    };
  }, [createNew, newSong, newTitle, song]);

  const [targets, setTargets] = useState<Record<string, RowTarget>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, defaultTarget(song, r)])),
  );
  const resetTargets = useCallback(
    (s: Song | null) => setTargets(Object.fromEntries(rows.map((r) => [r.id, defaultTarget(s, r)]))),
    [rows],
  );
  const setTarget = (id: string, p: Partial<RowTarget>) => setTargets((t) => ({ ...t, [id]: { ...t[id], ...p } }));

  // La marca de la canción que se está mirando: si cambia con la hoja abierta, confirmar pide mirarla otra vez.
  const [seenAt, setSeenAt] = useState<string | null>(song?.updatedAt ?? null);
  const [stale, setStale] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  useEffect(() => {
    setSeenAt(song?.updatedAt ?? null);
    setStale(false);
    setApplyError(null);
    // Solo al cambiar de canción: un cambio de la MISMA canción es justo lo que hay que detectar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, createNew]);

  // Costura de QA (solo en desarrollo): tocar la canción con la hoja abierta.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !song) return;
    const w = window as unknown as Record<string, unknown>;
    w.__hermesApplySheet = {
      touch: () => patchSong(song.id, {}),
      dropSection: (sectionId: string) =>
        patchSong(song.id, (s) => ({ sections: s.sections.filter((x) => x.id !== sectionId) })),
    };
    return () => {
      delete w.__hermesApplySheet;
    };
  }, [patchSong, song]);

  const effective = (r: ApplyRow): RowTarget => effectiveTarget(r, targets, createNew, draftSong);
  /** Filas listas para applyToSong (con su nombre/clase si van a sección nueva). */
  const items = useMemo(() => buildItems(rows, targets, createNew, draftSong), [rows, targets, createNew, draftSong]);

  const targetName = (t: RowTarget, s: Song | null) =>
    t.mode === "nueva" ? t.label.trim() || SECTION_KINDS[t.kind].label : (s?.sections.find((x) => x.id === t.sectionId)?.label ?? "—");

  // Vista previa con la MISMA función que aplica.
  const preview = useMemo(() => {
    if (!draftSong || !items.length) return null;
    let n = 0;
    const newIds: string[] = [];
    try {
      const next = applyToSong(
        draftSong,
        items.map(({ payload, target }) => ({ payload, target })),
        {
          note: "(vista previa)",
          now: draftSong.updatedAt,
          fromKey,
          newId: (p) => {
            const id = `__preview-${p}-${n++}`;
            if (p === "sec") newIds.push(id);
            return id;
          },
        },
      );
      return { next, newIds, error: null as string | null };
    } catch (e) {
      return { next: null, newIds, error: (e as Error).message };
    }
  }, [draftSong, items, fromKey]);

  const semis = fromKey && draftSong ? semitonesToKey(fromKey, draftSong.key) : 0;
  const missingTargets = items.filter(({ t }) => t.mode !== "nueva" && !draftSong?.sections.some((x) => x.id === t.sectionId));
  const emptyRows = items.filter(({ payload }) => !payload.lines.some((l) => l.trim()) && !payload.chords?.length);
  const ready =
    !!draftSong && items.length > 0 && !missingTargets.length && !emptyRows.length && !!preview?.next && (!createNew || !!newTitle.trim());

  const summary = (short: boolean) =>
    items
      .map(({ t, payload }) => {
        const name = targetName(t, draftSong);
        if (short && single) {
          const n = payload.lines.filter((l) => l.trim()).length;
          return `${name} · ${t.mode === "reemplazar" ? `${n} líneas nuevas` : `+${n} líneas`}${payload.link ? " · melodía adjunta" : ""}`;
        }
        return t.mode === "nueva" ? `${name} (nueva)` : t.mode === "reemplazar" ? `${name} (reemplazada)` : `${name} (+letra)`;
      })
      .join(" · ");

  const historyNote = () => {
    if (single && items[0]) {
      const { t } = items[0];
      return `${request.notePrefix} ${VERB[t.mode]} ${targetName(t, draftSong)}${request.noteSuffix ?? ""}`;
    }
    return `${request.notePrefix}: ${summary(false)}${request.noteSuffix ?? ""}`;
  };

  const confirm = () => {
    if (!ready || !draftSong) return;
    const now = new Date().toISOString();
    const apply = (s: Song) =>
      applyToSong(
        s,
        items.map(({ payload, target }) => ({ payload, target })),
        { note: historyNote(), now, fromKey, newId },
      );

    if (createNew) {
      let created: Song;
      try {
        created = apply({ ...draftSong, id: newId("s"), createdAt: now, updatedAt: now });
      } catch (e) {
        setApplyError((e as Error).message);
        return;
      }
      upsertSong(created);
      onApplied({
        songId: created.id,
        note: `canción nueva · ${summary(false)}`,
        created: true,
        undo: () => removeSong(created.id),
      });
      return;
    }

    const cur = songs.find((s) => s.id === songId);
    if (!cur) {
      setApplyError("La canción ya no está en el tablero: elige otra.");
      return;
    }
    if (cur.updatedAt !== seenAt) {
      // La canción cambió con la hoja abierta: el antes/después ya se recalculó; que lo mire antes de confirmar.
      setSeenAt(cur.updatedAt);
      setStale(true);
      return;
    }
    let next: Song;
    try {
      next = apply(cur);
    } catch (e) {
      setApplyError(`${(e as Error).message}. Los destinos se recalcularon: revísalos.`);
      resetTargets(cur);
      return;
    }
    const snapshot = { sections: cur.sections, versions: cur.versions, sessionIds: cur.sessionIds };
    patchSong(cur.id, { sections: next.sections, versions: next.versions, sessionIds: next.sessionIds });
    onApplied({ songId: cur.id, note: summary(true), undo: () => patchSong(cur.id, snapshot) });
  };

  const confirmLabel = (() => {
    if (createNew) return `Crear «${newTitle.trim() || newSong?.title || "canción"}»`;
    if (single && items[0]) {
      const { t } = items[0];
      const name = targetName(t, song);
      return t.mode === "debajo" ? `Insertar en ${name}` : t.mode === "reemplazar" ? `Reemplazar ${name}` : `Crear ${name}`;
    }
    const n = items.length;
    return `Aplicar ${n} ${n === 1 ? "sección" : "secciones"}${song ? ` a «${song.title}»` : ""}`;
  })();

  const pickSong = (id: string) => {
    setSongId(id);
    setCreateNew(false);
    resetTargets(songs.find((x) => x.id === id) ?? null);
  };

  const noSongs = songs.length === 0 && !newSong;

  return (
    <Sheet
      title={single ? "Aplicar a una canción" : `Aplicar ${request.origin} a una canción`}
      width={width}
      onClose={onClose}
      onConfirm={ready ? confirm : undefined}
      footer={
        <>
          <span className="mr-auto text-xs text-text-faint">
            {createNew ? "Nace con su entrada en el Historial." : "Queda en el Historial de la canción."} Se puede deshacer.
          </span>
          <button type="button" className={btn} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={btnPrimary} disabled={!ready} onClick={confirm}>
            {confirmLabel}
            <kbd className="text-2xs opacity-70">⌘⏎</kbd>
          </button>
        </>
      }
    >
      {noSongs ? (
        <p className="text-sm text-text-dim">No hay canciones en el tablero. Crea una desde la sesión primero.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Destino: una canción del tablero o una nueva desde el origen */}
          <div className="flex flex-wrap items-center gap-2">
            {newSong ? (
              <div className="flex items-center gap-0.5" role="radiogroup" aria-label="A qué canción">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!createNew}
                  disabled={!songs.length}
                  className={`${chip(!createNew)} disabled:cursor-not-allowed disabled:opacity-45`}
                  onClick={() => pickSong(songId || songs[0]?.id || "")}
                >
                  Canción del tablero
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={createNew}
                  className={chip(createNew)}
                  onClick={() => {
                    setCreateNew(true);
                    resetTargets(null);
                  }}
                >
                  Nueva canción {newSong.from}
                </button>
              </div>
            ) : (
              <label className="text-xs text-text-dim" htmlFor="apply-song">
                Canción
              </label>
            )}
            {!createNew && songs.length > 0 && (
              <select id="apply-song" value={songId} onChange={(e) => pickSong(e.target.value)} className={field} aria-label="Canción">
                {songs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            )}
            {createNew && newSong && (
              <>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className={`${field} w-56`}
                  aria-label="Título de la canción nueva"
                  placeholder="Título"
                />
                <span className="text-xs text-text-faint">
                  {keyLabel(newSong.key, notation)} · {Math.round(newSong.tempo)} bpm · {newSong.meter}
                </span>
              </>
            )}
            {!createNew && song && (
              <span className="text-xs text-text-faint">
                {keyLabel(song.key, notation)} · {song.tempo} bpm · {song.sections.length}{" "}
                {song.sections.length === 1 ? "sección" : "secciones"}
              </span>
            )}
          </div>

          {stale && (
            <p className="rounded-sm border border-amber/50 px-3 py-2 text-xs text-amber" role="alert">
              «{song?.title}» cambió mientras mirabas (otra pestaña o un guardado). El antes/después ya se recalculó:
              revísalo y confirma de nuevo.
            </p>
          )}
          {applyError && (
            <p className="rounded-sm border border-red/50 px-3 py-2 text-xs text-red" role="alert">
              No se aplicó: {applyError}
            </p>
          )}
          {preview?.error && !missingTargets.length && (
            <p className="text-xs text-red" role="alert">
              No se puede calcular el resultado: {preview.error}
            </p>
          )}

          <ol className={single ? "flex flex-col" : "flex flex-col divide-y divide-line border-y border-line"}>
            {rows.map((r) => (
              <RowView
                key={r.id}
                row={r}
                single={single}
                target={effective(r)}
                song={draftSong}
                createNew={createNew}
                preview={preview}
                items={items}
                semis={semis}
                onTarget={(p) => setTarget(r.id, p)}
              />
            ))}
          </ol>

          {missingTargets.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-amber" role="alert">
              {missingTargets.length === 1 ? "Una sección destino ya no existe" : `${missingTargets.length} secciones destino ya no existen`} en
              la canción.
              <button type="button" className={btnGhost} onClick={() => resetTargets(draftSong)}>
                Recalcular destinos
              </button>
            </p>
          )}
          {!single && fromKey && semis !== 0 && (
            <p className="text-xs text-text-faint">
              Los acordes se transponen {fmtSemis(semis)} a {draftSong ? keyLabel(draftSong.key, notation) : "la tonalidad"}{" "}
              de la canción; la melodía enlazada guarda esos semitonos.
            </p>
          )}
          {request.footnote && <p className="text-xs text-text-faint">{request.footnote}</p>}
        </div>
      )}
    </Sheet>
  );
}

type Preview = { next: Song | null; newIds: string[]; error: string | null } | null;

/** Una fila: destino (verbo + sección) y su antes/después. */
function RowView({
  row,
  single,
  target: t,
  song,
  createNew,
  preview,
  items,
  semis,
  onTarget,
}: {
  row: ApplyRow;
  single: boolean;
  target: RowTarget;
  song: Song | null;
  createNew: boolean;
  preview: Preview;
  items: Item[];
  semis: number;
  onTarget: (p: Partial<RowTarget>) => void;
}) {
  const p = row.payload;
  const before = t.mode === "nueva" ? null : (song?.sections.find((x) => x.id === t.sectionId) ?? null);
  // El "después" sale del resultado de applyToSong (el k-ésimo id nuevo es la k-ésima fila nueva).
  let after: SongSection | null = null;
  if (t.include && preview?.next) {
    if (t.mode === "nueva") {
      const k = items.filter((x) => x.t.mode === "nueva").findIndex((x) => x.row.id === row.id);
      after = preview.next.sections.find((x) => x.id === preview.newIds[k]) ?? null;
    } else after = preview.next.sections.find((x) => x.id === t.sectionId) ?? null;
  }
  const shared = t.mode !== "nueva" && items.filter((x) => x.t.mode !== "nueva" && x.t.sectionId === t.sectionId).length > 1;
  const beforeLines = linesOf(before);
  const afterLines = linesOf(after);
  const name = t.mode === "nueva" ? t.label.trim() || SECTION_KINDS[t.kind].label : (before?.label ?? "—");
  const replacing = t.mode === "reemplazar" && beforeLines.length > 0;
  const hasLines = p.lines.some((l) => l.trim());
  const headline = p.label || (single ? "" : "Sección");

  return (
    <li className={`flex flex-col gap-2.5 ${single ? "" : "py-3"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {!single && (
          <label className="flex min-w-[9rem] cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={t.include}
              onChange={(e) => onTarget({ include: e.target.checked })}
              className="accent-accent"
              aria-label={`Aplicar ${headline}`}
            />
            <span className={t.include ? "text-text" : "text-text-faint"}>{headline}</span>
            {p.bars != null && <span className="text-xs text-text-faint">{p.bars} c.</span>}
          </label>
        )}
        {t.include && !createNew && (
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={`Cómo aplicar ${headline}`}>
            <button type="button" role="radio" aria-checked={t.mode === "debajo"} className={chip(t.mode === "debajo")} onClick={() => onTarget({ mode: "debajo" })} disabled={!song?.sections.length}>
              Insertar debajo
            </button>
            <button type="button" role="radio" aria-checked={t.mode === "reemplazar"} className={chip(t.mode === "reemplazar")} onClick={() => onTarget({ mode: "reemplazar" })} disabled={!song?.sections.length}>
              {single ? `Reemplazar la letra de ${before?.label ?? "la sección"}` : "Reemplazar"}
            </button>
            <button type="button" role="radio" aria-checked={t.mode === "nueva"} className={chip(t.mode === "nueva")} onClick={() => onTarget({ mode: "nueva" })}>
              Sección nueva
            </button>
          </div>
        )}
        {t.include && t.mode !== "nueva" && song && (
          <label className="flex items-center gap-1.5 text-xs text-text-dim">
            en
            <select value={t.sectionId} onChange={(e) => onTarget({ sectionId: e.target.value })} className={field} aria-label={`Sección destino de ${headline}`}>
              {!song.sections.some((x) => x.id === t.sectionId) && <option value={t.sectionId}>(ya no existe)</option>}
              {song.sections.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label} · {x.bars} c.{x.lyrics.trim() ? "" : " · vacía"}
                </option>
              ))}
            </select>
          </label>
        )}
        {t.include && t.mode === "nueva" && (
          <span className="flex flex-wrap items-center gap-1.5">
            <select value={t.kind} onChange={(e) => onTarget({ kind: e.target.value as SectionKind })} className={field} aria-label={`Clase de ${headline}`}>
              {(Object.keys(SECTION_KINDS) as SectionKind[]).map((k) => (
                <option key={k} value={k}>
                  {SECTION_KINDS[k].label}
                </option>
              ))}
            </select>
            <input
              value={t.label}
              onChange={(e) => onTarget({ label: e.target.value })}
              placeholder={SECTION_KINDS[t.kind].label}
              className={`${field} w-32`}
              aria-label={`Nombre de la sección nueva (${headline})`}
            />
            {!createNew && song && song.sections.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-text-faint">
                va después de
                <select value={t.after} onChange={(e) => onTarget({ after: e.target.value })} className={field} aria-label={`Dónde va ${headline}`}>
                  <option value="">la última (al final)</option>
                  {song.sections.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </span>
        )}
      </div>

      {row.note && <p className={`text-xs ${hasLines || !single ? "text-text-faint" : "text-amber"}`}>{row.note}</p>}
      {t.include && replacing && (
        <p className="text-xs text-amber">
          {before!.label} ya tiene {beforeLines.length} {beforeLines.length === 1 ? "línea" : "líneas"}: se reemplazan
          {p.chords?.length ? " (y su progresión)" : ""}. El Historial guarda el cambio y hay Deshacer.
        </p>
      )}
      {t.include && shared && (
        <p className="text-xs text-text-faint">Otra fila también va a {before?.label}: el después muestra las dos.</p>
      )}

      {t.include && t.mode !== "nueva" && !before && (
        <p className="text-xs text-amber">La sección destino ya no existe en la canción: elige otra o crea una sección nueva.</p>
      )}
      {t.include && (t.mode === "nueva" || before) && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <DiffCol
              title={t.mode === "nueva" ? "No existe todavía" : `${before?.label ?? "—"} ahora`}
              lines={beforeLines}
              mark={() => (t.mode === "reemplazar" ? "del" : "keep")}
            />
            <DiffCol
              title={`${name} después`}
              lines={afterLines}
              mark={(i) => (t.mode === "debajo" && i < beforeLines.length ? "keep" : "add")}
            />
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-faint">
            <span>
              Métrica (aprox.): {t.mode === "nueva" ? "—" : metric(beforeLines)} → {metric(afterLines)}
            </span>
            {!!p.chords?.length && after && (
              <span>
                Acordes: {t.mode === "nueva" ? "" : `${before?.chords.join(" ") || "—"} → `}
                <span className="font-mono text-text-dim">{after.chords.join(" ") || "—"}</span>
                {semis !== 0 && ` (${fmtSemis(semis)})`}
              </span>
            )}
            {p.bars != null && after && (
              <span>
                {t.mode === "nueva" ? "" : `${before?.bars ?? "—"} → `}
                {after.bars} compases
              </span>
            )}
          </p>
        </>
      )}
    </li>
  );
}

type Mark = "keep" | "add" | "del";

function DiffCol({ title, lines, mark }: { title: string; lines: string[]; mark: (i: number) => Mark }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-2xs text-text-faint">{title}</span>
      <ol className="flex min-h-16 flex-col gap-0.5 rounded-sm border border-line p-2 font-mono text-xs">
        {lines.length === 0 && <li className="text-text-faint">(vacía)</li>}
        {lines.map((l, i) => {
          const m = mark(i);
          return (
            <li
              key={i}
              className={`flex gap-2 ${
                m === "del" ? "text-red line-through decoration-red/50" : m === "add" ? "text-green" : "text-text-dim"
              }`}
            >
              <span className="w-4 shrink-0 text-text-faint tabular-nums">
                {m === "del" ? "−" : m === "add" ? "+" : i + 1}
              </span>
              <span className="min-w-0 break-words">{stripChords(l)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
