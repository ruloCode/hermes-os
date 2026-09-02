"use client";

/**
 * Estado LOCAL de Composición (versión estática): las canciones, referencias
 * y el cuaderno viven en memoria y se pueden editar para probar el flujo.
 * Cuando pase a producción, este hook se vuelve un provider con poll al
 * agente (`/composicion/*`) y la misma API — los componentes no cambian.
 */
import { useCallback, useMemo, useState } from "react";
import { chordSymbol, parseChord, transposeChord, type Key } from "@/lib/music-theory";
import { MOCK_NOTEBOOK, MOCK_REFS, MOCK_SONGS } from "./mock";
import type { NotebookEntry, Reference, Song, SongSection, SongStage } from "./types";

export type Section = "canciones" | "referencias" | "cuaderno";

let seq = 100;
const uid = (p: string) => `${p}-${++seq}`;

export function useComposicionState() {
  const [songs, setSongs] = useState<Song[]>(MOCK_SONGS);
  const [refs, setRefs] = useState<Reference[]>(MOCK_REFS);
  const [notebook, setNotebook] = useState<NotebookEntry[]>(MOCK_NOTEBOOK);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notation, setNotation] = useState<"en" | "latin">("en");
  // La sección vive aquí (y no en la vista) porque crear una canción desde el
  // Cuaderno tiene que dejarte en Canciones: si no, al cerrar el takeover
  // vuelves al Cuaderno y la canción nueva parece no existir.
  const [section, setSection] = useState<Section>("canciones");

  const selected = useMemo(() => songs.find((s) => s.id === selectedId) ?? null, [songs, selectedId]);

  const patchSong = useCallback((id: string, patch: Partial<Song> | ((s: Song) => Partial<Song>)) => {
    setSongs((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const p = typeof patch === "function" ? patch(s) : patch;
        return { ...s, ...p, updatedAt: new Date().toISOString() };
      }),
    );
  }, []);

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
        const label = kind === "verso" ? `Verso ${n}` : kind === "coro" && n > 1 ? `Coro ${n}` : kind.charAt(0).toUpperCase() + kind.slice(1);
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
          versions: [...s.versions, { id: uid("v"), at: new Date().toISOString(), note: `Se movió ${s.sections[i].label}`, scope: "estructura" }],
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
          versions: [...s.versions, { id: uid("v"), at: new Date().toISOString(), note: `Tonalidad → ${label}${transpose ? " (acordes transpuestos)" : ""}`, scope: "tonalidad" }],
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
        versions: [{ id: uid("v"), at: now, note: fromNotebookId ? "Desde el cuaderno" : "Nueva canción", scope: "letra" }],
        createdAt: now,
        updatedAt: now,
      };
      setSongs((prev) => [song, ...prev]);
      if (fromNotebookId) setNotebook((prev) => prev.map((n) => (n.id === fromNotebookId ? { ...n, songId: id } : n)));
      setSection("canciones");
      setSelectedId(id);
      return id;
    },
    [],
  );

  const addRef = useCallback((ref: Omit<Reference, "id" | "savedAt">) => {
    const r: Reference = { ...ref, id: uid("r"), savedAt: new Date().toISOString() };
    setRefs((prev) => [r, ...prev]);
    return r.id;
  }, []);

  const patchRef = useCallback((id: string, patch: Partial<Reference>) => {
    setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeRef = useCallback((id: string) => {
    setRefs((prev) => prev.filter((r) => r.id !== id));
    setSongs((prev) => prev.map((s) => ({ ...s, refIds: s.refIds.filter((x) => x !== id) })));
  }, []);

  const linkRef = useCallback(
    (songId: string, refId: string, on: boolean) => {
      patchSong(songId, (s) => ({ refIds: on ? Array.from(new Set([...s.refIds, refId])) : s.refIds.filter((x) => x !== refId) }));
    },
    [patchSong],
  );

  const addNote = useCallback((kind: NotebookEntry["kind"], text: string) => {
    setNotebook((prev) => [{ id: uid("n"), kind, text: text.trim(), at: new Date().toISOString() }, ...prev]);
  }, []);

  const removeNote = useCallback((id: string) => setNotebook((prev) => prev.filter((n) => n.id !== id)), []);

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
    addRef,
    patchRef,
    removeRef,
    linkRef,
    addNote,
    removeNote,
  };
}

export type ComposicionState = ReturnType<typeof useComposicionState>;
