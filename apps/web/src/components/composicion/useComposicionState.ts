"use client";

/**
 * Estado de Composición: canciones, referencias y cuaderno.
 *
 * El tablero vive en el AGENTE (`~/.hermes-os/composicion/board.json`, rutas
 * `/composicion/board`). Este hook se hidrata de ahí y guarda con un PUT
 * diferido (~800 ms): escribir una letra dispara decenas de cambios por
 * segundo y el tablero entero viaja en cada guardado, así que se agrupan.
 *
 *  - 404 (el agente todavía no tiene tablero) → se siembra VACÍO. El mock son
 *    datos de prueba: sembrarlo convertía canciones de ejemplo en canciones
 *    "reales" del tablero, mezcladas con las de verdad.
 *  - Sin agente → el mock queda en memoria y la vista lo dice ("datos de
 *    prueba"); nada se guarda y nada lo finge.
 *  - `refresh()` es para después de acciones del SERVIDOR (crear una canción
 *    desde una sesión del Playground): primero vacía lo pendiente — si no, el
 *    PUT diferido de una edición local llegaba después y pisaba la canción
 *    recién creada — y después relee.
 *  - Concurrencia (otra pestaña, otro equipo, una acción del agente): cada PUT
 *    lleva `baseUpdatedAt` = el `updatedAt` del tablero que este cliente vio.
 *    Si el agente tiene otro, responde 409 con el vigente y aquí se MEZCLA por
 *    id (canciones, referencias y cuaderno) contra esa base: lo que tocaste
 *    manda en lo que tocaste, lo del servidor entra en todo lo demás (altas,
 *    bajas y cambios de otro lado). Se reintenta una vez. Al volver a la
 *    pestaña (focus/visibilitychange) se relee si no hay nada pendiente.
 *
 * La API pública es la misma de la versión estática: los componentes no
 * cambiaron para conectarse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chordSymbol, parseChord, transposeChord, type Key } from "@/lib/music-theory";
import { BoardConflictError, getComposicionBoard, putComposicionBoard } from "@/lib/hermes";
import { MOCK_NOTEBOOK, MOCK_REFS, MOCK_SONGS } from "./mock";
import type { ComposicionBoard, NotebookEntry, Reference, Song, SongSection, SongStage } from "./types";

export type Section = "canciones" | "temas" | "sesiones" | "referencias" | "cuaderno";

/** De dónde sale lo que se ve: el agente, o el mock en memoria (sin agente). */
export type BoardSource = "cargando" | "agente" | "mock";

export type SaveState = "idle" | "saving" | "saved" | "error";

// Ids con tiempo + azar: con un contador que arranca en 100 en cada carga, una
// canción nueva nacía "s-101" y chocaba con la "s-101" que ya estaba guardada.
const uid = (p: string) =>
  `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const SAVE_DEBOUNCE_MS = 800;

type BoardLists = Pick<ComposicionBoard, "songs" | "refs" | "notebook">;

/**
 * Mezcla de tres vías por id. `base` = lo último que este cliente vio del
 * agente; `local` = lo de ahora; `server` = el vigente. Un elemento que local
 * cambió respecto de la base (editado, creado o borrado — se compara por
 * IDENTIDAD: los setters solo crean objeto nuevo para lo que tocan) gana lo
 * local; lo que local no tocó toma la versión del servidor (incluido que allá
 * lo hayan borrado). Lo nuevo del servidor entra al principio (lo más nuevo
 * arriba, como se crean aquí).
 */
export function mergeById<T extends { id: string }>(base: T[], local: T[], server: T[]): T[] {
  const baseBy = new Map(base.map((x) => [x.id, x]));
  const localBy = new Map(local.map((x) => [x.id, x]));
  const serverBy = new Map(server.map((x) => [x.id, x]));
  const out: T[] = server.filter((x) => !baseBy.has(x.id) && !localBy.has(x.id));
  for (const x of local) {
    if (baseBy.get(x.id) !== x) out.push(x);
    else {
      const sv = serverBy.get(x.id);
      if (sv) out.push(sv);
    }
  }
  return out;
}

function mergeBoards(base: BoardLists, local: BoardLists, server: BoardLists): BoardLists {
  return {
    songs: mergeById(base.songs, local.songs, server.songs),
    refs: mergeById(base.refs, local.refs, server.refs),
    notebook: mergeById(base.notebook, local.notebook, server.notebook),
  };
}

export function useComposicionState(opts: { offline?: boolean } = {}) {
  const offline = !!opts.offline;
  const [songs, setSongsRaw] = useState<Song[]>(offline ? MOCK_SONGS : []);
  const [refs, setRefsRaw] = useState<Reference[]>(offline ? MOCK_REFS : []);
  const [notebook, setNotebookRaw] = useState<NotebookEntry[]>(offline ? MOCK_NOTEBOOK : []);
  const [source, setSource] = useState<BoardSource>(offline ? "mock" : "cargando");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notation, setNotation] = useState<"en" | "latin">("en");
  // La sección vive aquí (y no en la vista) porque crear una canción desde el
  // Cuaderno tiene que dejarte en Canciones: si no, al cerrar el takeover
  // vuelves al Cuaderno y la canción nueva parece no existir.
  const [section, setSection] = useState<Section>("canciones");

  // ── Persistencia ────────────────────────────────────────────────────
  /** Hay ediciones locales que el agente todavía no tiene. */
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  /** Lo último renderizado, para que flush() mande el tablero vigente y no uno viejo. */
  const latest = useRef({ songs, refs, notebook });
  latest.current = { songs, refs, notebook };
  /**
   * El último tablero que este cliente VIO del agente (adoptado o confirmado por
   * un PUT): su `updatedAt` viaja como `baseUpdatedAt` y sus listas son la base
   * de la mezcla ante un 409.
   */
  const base = useRef<ComposicionBoard | null>(null);

  // Setters "locales": marcan sucio. Adoptar lo que llega del agente usa los
  // crudos, que no marcan nada (si no, cada lectura provocaría un guardado).
  const setSongs: typeof setSongsRaw = useCallback((u) => {
    dirty.current = true;
    setSongsRaw(u);
  }, []);
  const setRefs: typeof setRefsRaw = useCallback((u) => {
    dirty.current = true;
    setRefsRaw(u);
  }, []);
  const setNotebook: typeof setNotebookRaw = useCallback((u) => {
    dirty.current = true;
    setNotebookRaw(u);
  }, []);

  /** Adopta el tablero del agente tal cual (y pasa a ser la base). */
  const adopt = useCallback((b: ComposicionBoard) => {
    base.current = b;
    setSongsRaw(b.songs);
    setRefsRaw(b.refs);
    setNotebookRaw(b.notebook);
  }, []);

  /**
   * Mete lo del servidor SIN perder lo local pendiente (mezcla por id contra la
   * base) y el vigente pasa a ser la base. Devuelve lo mezclado a partir de lo
   * último renderizado (lo que un reintento tiene que mandar).
   */
  const mergeIn = useCallback((server: ComposicionBoard): BoardLists => {
    const b: BoardLists = base.current ?? { songs: [], refs: [], notebook: [] };
    const local = latest.current;
    const merged = mergeBoards(b, local, server);
    // Funcionales: si se editó entre el último render y ahora, se mezcla sobre eso.
    setSongsRaw((prev) => (prev === local.songs ? merged.songs : mergeById(b.songs, prev, server.songs)));
    setRefsRaw((prev) => (prev === local.refs ? merged.refs : mergeById(b.refs, prev, server.refs)));
    setNotebookRaw((prev) => (prev === local.notebook ? merged.notebook : mergeById(b.notebook, prev, server.notebook)));
    base.current = server;
    return merged;
  }, []);

  /** PUT con la base vista; ante un 409 mezcla con el vigente y reintenta UNA vez. */
  const putMerging = useCallback(
    async (snap: BoardLists): Promise<void> => {
      const board = (x: BoardLists): ComposicionBoard => ({ version: 1, ...x, updatedAt: new Date().toISOString() });
      try {
        const saved = await putComposicionBoard(board(snap), base.current?.updatedAt);
        base.current = { ...board(snap), updatedAt: saved.updatedAt };
      } catch (e) {
        if (!(e instanceof BoardConflictError) || !e.board) throw e;
        const merged = mergeIn(e.board);
        const saved = await putComposicionBoard(board(merged), e.board.updatedAt);
        base.current = { ...board(merged), updatedAt: saved.updatedAt };
      }
    },
    [mergeIn],
  );

  /** Manda YA lo pendiente (y espera a lo que esté en vuelo). */
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current.catch(() => {});
    if (!dirty.current || sourceRef.current !== "agente") return;
    dirty.current = false;
    const { songs, refs, notebook } = latest.current;
    setSaveState("saving");
    const p = putMerging({ songs, refs, notebook })
      .then(() => {
        setSaveState("saved");
        setSaveError(null);
      })
      .catch((e: Error) => {
        // Se queda sucio: el próximo cambio (o "Reintentar") vuelve a probar.
        dirty.current = true;
        setSaveState("error");
        setSaveError(e.message);
      });
    inflight.current = p;
    await p;
    if (inflight.current === p) inflight.current = null;
  }, [putMerging]);

  // Carga inicial: agente → tablero; 404 → tablero vacío; sin agente → mock.
  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    (async () => {
      try {
        const b = await getComposicionBoard();
        if (cancelled) return;
        if (b) adopt(b);
        else {
          const seeded = await putComposicionBoard({
            version: 1,
            songs: [],
            refs: [],
            notebook: [],
            updatedAt: new Date().toISOString(),
          });
          if (cancelled) return;
          adopt(seeded);
        }
        setSource("agente");
      } catch {
        if (cancelled) return;
        adopt({ version: 1, songs: MOCK_SONGS, refs: MOCK_REFS, notebook: MOCK_NOTEBOOK, updatedAt: "" });
        setSource("mock");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offline, adopt]);

  // Guardado diferido: cada cambio local reinicia la cuenta.
  useEffect(() => {
    if (!dirty.current || source !== "agente") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [songs, refs, notebook, source, flush]);

  // Cerrar la pestaña con cambios pendientes: último intento (puede no llegar
  // si el browser corta la petición; por eso el diferido es corto).
  useEffect(() => {
    const onHide = () => {
      if (dirty.current && sourceRef.current === "agente") void flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  /** Relee el tablero del agente (tras una acción del servidor), sin perder lo local pendiente. */
  const refresh = useCallback(async (): Promise<void> => {
    if (offline) return;
    try {
      await flush();
      const b = await getComposicionBoard();
      if (!b) return;
      if (dirty.current || inflight.current) {
        // Se editó mientras leíamos (o no se pudo guardar): lo tocado manda, lo demás del
        // servidor entra — canciones, referencias Y cuaderno.
        mergeIn(b);
        return;
      }
      adopt(b);
      setSource("agente");
    } catch {
      /* sin agente: se queda lo que hay */
    }
  }, [offline, flush, adopt, mergeIn]);

  // Volver a la pestaña (o a la ventana): si otro lado guardó y aquí no hay nada pendiente,
  // se trae lo vigente — así el próximo guardado no choca con un 409 evitable.
  const revalidating = useRef(0);
  useEffect(() => {
    if (offline) return;
    const revalidate = async () => {
      if (document.visibilityState !== "visible") return;
      if (sourceRef.current !== "agente" || dirty.current || inflight.current || timer.current) return;
      // focus y visibilitychange llegan juntos al volver: una lectura basta.
      const now = Date.now();
      if (now - revalidating.current < 1500) return;
      revalidating.current = now;
      const b = await getComposicionBoard().catch(() => null);
      if (!b || b.updatedAt === base.current?.updatedAt) return;
      if (dirty.current || inflight.current) mergeIn(b);
      else adopt(b);
    };
    const onChange = () => void revalidate();
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [offline, adopt, mergeIn]);

  const selected = useMemo(() => songs.find((s) => s.id === selectedId) ?? null, [songs, selectedId]);

  // ── Mutaciones (misma API de la versión estática) ─────────────────────
  const patchSong = useCallback(
    (id: string, patch: Partial<Song> | ((s: Song) => Partial<Song>)) => {
      setSongs((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const p = typeof patch === "function" ? patch(s) : patch;
          return { ...s, ...p, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [setSongs],
  );

  const patchSection = useCallback(
    (songId: string, sectionId: string, patch: Partial<SongSection>) => {
      patchSong(songId, (s) => ({
        sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, ...patch } : sec)),
      }));
    },
    [patchSong],
  );

  const addSection = useCallback(
    (songId: string, kind: SongSection["kind"]) => {
      patchSong(songId, (s) => {
        const n = s.sections.filter((x) => x.kind === kind).length + 1;
        const label =
          kind === "verso"
            ? `Verso ${n}`
            : kind === "coro" && n > 1
              ? `Coro ${n}`
              : kind.charAt(0).toUpperCase() + kind.slice(1);
        const last = s.sections[s.sections.length - 1];
        return {
          sections: [...s.sections, { id: uid("sec"), kind, label, lyrics: "", chords: last?.chords ?? [], bars: 8 }],
        };
      });
    },
    [patchSong],
  );

  const moveSection = useCallback(
    (songId: string, sectionId: string, dir: -1 | 1) => {
      patchSong(songId, (s) => {
        const i = s.sections.findIndex((x) => x.id === sectionId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.sections.length) return {};
        const next = [...s.sections];
        [next[i], next[j]] = [next[j], next[i]];
        return {
          sections: next,
          versions: [
            ...s.versions,
            { id: uid("v"), at: new Date().toISOString(), note: `Se movió ${s.sections[i].label}`, scope: "estructura" },
          ],
        };
      });
    },
    [patchSong],
  );

  const removeSection = useCallback(
    (songId: string, sectionId: string) => {
      patchSong(songId, (s) => ({ sections: s.sections.filter((x) => x.id !== sectionId) }));
    },
    [patchSong],
  );

  /** Cambiar la tonalidad TRANSPONE los acordes (inline y de sección): la canción sigue siendo la misma. */
  const setKey = useCallback(
    (songId: string, key: Key, transpose: boolean) => {
      patchSong(songId, (s) => {
        const semis = key.tonic - s.key.tonic;
        const tr = (sym: string) => {
          const c = parseChord(sym);
          return c ? chordSymbol(transposeChord(c, semis), key) : sym;
        };
        const sections = transpose
          ? s.sections.map((sec) => ({
              ...sec,
              chords: sec.chords.map(tr),
              lyrics: sec.lyrics.replace(/\[([^\]]+)\]/g, (_m, c: string) => `[${tr(c)}]`),
            }))
          : s.sections;
        const label = `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][key.tonic]} ${key.mode === "major" ? "mayor" : "menor"}`;
        return {
          key,
          sections,
          versions: [
            ...s.versions,
            {
              id: uid("v"),
              at: new Date().toISOString(),
              note: `Tonalidad → ${label}${transpose ? " (acordes transpuestos)" : ""}`,
              scope: "tonalidad",
            },
          ],
        };
      });
    },
    [patchSong],
  );

  const setStage = useCallback((songId: string, stage: SongStage) => patchSong(songId, { stage }), [patchSong]);

  const createSong = useCallback(
    (title: string, seed: string, fromNotebookId?: string) => {
      const id = uid("s");
      const now = new Date().toISOString();
      const song: Song = {
        id,
        // Una canción sin título nace con su semilla como nombre provisional:
        // "Sin título" en la lista no dice nada de qué canción es.
        title: title.trim() || seed.trim().slice(0, 40) || "Sin título",
        stage: "idea",
        key: { tonic: 0, mode: "major" },
        tempo: 90,
        meter: "4/4",
        mood: [],
        seed,
        sections: [
          { id: uid("sec"), kind: "verso", label: "Verso 1", lyrics: "", chords: ["C", "G", "Am", "F"], bars: 8 },
          { id: uid("sec"), kind: "coro", label: "Coro", lyrics: "", chords: ["F", "G", "C", "Am"], bars: 8 },
        ],
        refIds: [],
        versions: [
          { id: uid("v"), at: now, note: fromNotebookId ? "Desde el cuaderno" : "Nueva canción", scope: "letra" },
        ],
        createdAt: now,
        updatedAt: now,
      };
      setSongs((prev) => [song, ...prev]);
      if (fromNotebookId)
        setNotebook((prev) => prev.map((n) => (n.id === fromNotebookId ? { ...n, songId: id } : n)));
      setSection("canciones");
      setSelectedId(id);
      return id;
    },
    [setSongs, setNotebook],
  );

  /** Mete (o reemplaza) una canción que llegó hecha — p. ej. la que crea el agente desde una sesión. */
  const upsertSong = useCallback(
    (song: Song) => {
      setSongs((prev) => (prev.some((s) => s.id === song.id) ? prev.map((s) => (s.id === song.id ? song : s)) : [song, ...prev]));
    },
    [setSongs],
  );

  /** Quita una canción del tablero (deshacer "Nueva canción desde el tema"). */
  const removeSong = useCallback(
    (id: string) => {
      setSongs((prev) => prev.filter((s) => s.id !== id));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [setSongs],
  );

  const addRef = useCallback(
    (ref: Omit<Reference, "id" | "savedAt">) => {
      const r: Reference = { ...ref, id: uid("r"), savedAt: new Date().toISOString() };
      setRefs((prev) => [r, ...prev]);
      return r.id;
    },
    [setRefs],
  );

  const patchRef = useCallback(
    (id: string, patch: Partial<Reference>) => {
      setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [setRefs],
  );

  const removeRef = useCallback(
    (id: string) => {
      setRefs((prev) => prev.filter((r) => r.id !== id));
      // Solo las canciones que la tenían cambian de objeto: la mezcla ante un 409 compara por
      // identidad, y tocarlas todas las marcaría a todas como editadas aquí.
      setSongs((prev) => prev.map((s) => (s.refIds.includes(id) ? { ...s, refIds: s.refIds.filter((x) => x !== id) } : s)));
    },
    [setRefs, setSongs],
  );

  const linkRef = useCallback(
    (songId: string, refId: string, on: boolean) => {
      patchSong(songId, (s) => ({
        refIds: on ? Array.from(new Set([...s.refIds, refId])) : s.refIds.filter((x) => x !== refId),
      }));
    },
    [patchSong],
  );

  /** Enlaza (o suelta) una sesión del Playground a una canción. */
  const linkSession = useCallback(
    (songId: string, sessionId: string, on: boolean) => {
      patchSong(songId, (s) => {
        const ids = s.sessionIds ?? [];
        return {
          sessionIds: on ? Array.from(new Set([...ids, sessionId])) : ids.filter((x) => x !== sessionId),
        };
      });
    },
    [patchSong],
  );

  const addNote = useCallback(
    (kind: NotebookEntry["kind"], text: string) => {
      setNotebook((prev) => [{ id: uid("n"), kind, text: text.trim(), at: new Date().toISOString() }, ...prev]);
    },
    [setNotebook],
  );

  const removeNote = useCallback(
    (id: string) => setNotebook((prev) => prev.filter((n) => n.id !== id)),
    [setNotebook],
  );

  return {
    songs,
    refs,
    notebook,
    selected,
    selectedId,
    setSelectedId,
    section,
    setSection,
    notation,
    setNotation,
    patchSong,
    patchSection,
    addSection,
    moveSection,
    removeSection,
    setKey,
    setStage,
    createSong,
    upsertSong,
    removeSong,
    addRef,
    patchRef,
    removeRef,
    linkRef,
    linkSession,
    addNote,
    removeNote,
    /** Persistencia */
    source,
    online: source === "agente",
    loaded: source !== "cargando",
    saveState,
    saveError,
    flush,
    refresh,
    newId: uid,
  };
}

export type ComposicionState = ReturnType<typeof useComposicionState>;
