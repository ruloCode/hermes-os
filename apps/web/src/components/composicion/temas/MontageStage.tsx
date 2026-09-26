"use client";

/**
 * Etapa MONTAJE: armar el tema tomando partes. Una parte por sección, de este
 * tema o de otros; escucharlo entero sobre la pista; aplicarlo a una canción.
 * Referencias Mobbin:
 *  - Riverside (capítulos sobre la línea de tiempo): los HUECOS, uno por
 *    sección en el orden del tema, tan anchos como sus compases.
 *  - Zillow "Virtual Staging" (columna de estilos con el elegido marcado): las
 *    ALTERNATIVAS del hueco elegido.
 *  - Suno "Extend" (conservar / regenerar un tramo): 🔒 CONSERVAR y ↻ REGENERAR
 *    por hueco (regenerar lleva a Letra o a Grabar esa sección).
 *
 * ▶ ENSAMBLE: el tema entero, sección por sección (sus compases, su loop), con
 * la voz de cada parte alineada a su compás 1 — Tarareo (la toma), Guía (la
 * guía cantada de la letra elegida, misma rejilla) o Ambos.
 *
 * Regla de la casa: el factor humano no se delega. La ★ de Grabar se PROPONE
 * (hueco punteado, "propuesta") pero no cuenta como elegida hasta el clic; lo
 * que se aplica a una canción es solo lo elegido, con su antes/después.
 *
 * Teclado (fuera de campos y sin hojas abiertas; nada con ⌘ salvo ⌘Z):
 * ←/→ hueco · Enter alternativas · ↑/↓ elige · Esc cierra alternativas ·
 * Espacio ▶ ensamble (le gana al Espacio del transporte) · ⌘Z deshace el
 * último aplicar.
 */
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { montageSlots, type MemoRef, type MontagePick, type Tema, type TemaCandidate, type TemaSection } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { useComposicion } from "../ComposicionContext";
import { usePlaygroundApi } from "../playground/api";
import { ApplyToSongSheet, type AppliedChange } from "../playground/ApplySheet";
import { fmtDuration, fmtTime, pct } from "../playground/format";
import { btn, btnGhost, btnPrimary, chip, plainKey, spaceOnButton, typingTarget } from "../playground/ui";
import { useTemaCtx } from "./TemaContext";
import { fmtBpm, showChord } from "./track-edit";
import { barSecOf, loadTakeAudio } from "./take-audio";
import { transportStore } from "./transport-settings";
import { guideProblem } from "../playground/useGuide";
import {
  buildApplyRequest,
  candidateRev,
  lyricFor,
  memoKey,
  mineOf,
  playEnsemble,
  sameMemo,
  useOtherTemas,
  usePartMaterials,
  versionsOf,
  loadGuide,
  type EnsembleHandle,
  type EnsemblePart,
  type EnsembleVoice,
  type LyricChoice,
  type OtherTema,
  type PartEntry,
  type PartMaterial,
} from "./montage";

type Scope = "tema" | "todos";

const VOICE_KEY = "hermes-montaje-voz";
const VOICE_LABEL: Record<EnsembleVoice, { label: string; hint: string }> = {
  tarareo: { label: "Tarareo", hint: "Tus tomas sobre la pista. Nada sale del equipo." },
  guia: {
    label: "Guía",
    hint: "La guía cantada de la letra elegida (voz genérica, con la voz y la altura que elegiste en Letra). Sale el TEXTO de la letra a ElevenLabs; tu voz no. Lo ya pedido sale de caché.",
  },
  ambos: { label: "Ambos", hint: "Tu tarareo y la guía a la vez, alineados (se mezclan en «Mezcla» del transporte)." },
};

const STATUS: Record<TemaCandidate["status"], { label: string; cls: string }> = {
  procesando: { label: "procesando", cls: "text-text-dim" },
  pendiente: { label: "sin analizar", cls: "text-text-dim" },
  analizando: { label: "analizando", cls: "text-text-dim" },
  listo: { label: "lista", cls: "text-green" },
  error: { label: "sin melodía clara", cls: "text-red" },
};

/** Una parte de otro tema, vista desde este. */
interface Foreign {
  tema: Tema;
  section: TemaSection | null;
}

interface Slot {
  index: number;
  section: TemaSection;
  pick: MontagePick | null;
  /** elegida = el humano la eligió · propuesta = la ★ de Grabar, sin elegir · vacia = nada que proponer. */
  state: "elegida" | "propuesta" | "vacia";
  cand: TemaCandidate | null;
  foreign: Foreign | null;
  /** El pick nombra una parte que no se encuentra (cargando otros temas, o ya no existe). */
  unresolved: "cargando" | "perdida" | null;
  lyric: LyricChoice | null;
  keep: boolean;
}

const partName = (s: Slot): string | null => {
  if (!s.cand) return null;
  return `${s.cand.label}${s.cand.favorite ? " ★" : ""}`;
};

// ─────────────────────────── Etapa ───────────────────────────

export function MontageStage() {
  const ctx = useTemaCtx();
  const { tema, detail, section, setSectionId, setStage, patch, engine, active } = ctx;
  const api = usePlaygroundApi();
  const comp = useComposicion();
  const { notation } = comp;
  const [scope, setScope] = useState<Scope>("tema");
  const [altOpen, setAltOpen] = useState(false);
  const [forceLane, setForceLane] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<(AppliedChange & { prevSongId?: string }) | null>(null);
  const [linkPending, setLinkPending] = useState<string | null>(null);
  const altRef = useRef<HTMLDivElement>(null);

  const raw = useMemo(() => montageSlots(tema, detail.candidates), [tema, detail.candidates]);
  const foreignPicks = raw.some((r) => r.pick?.memo && !r.candidate);
  const others = useOtherTemas(tema.id, scope === "todos" || foreignPicks);

  /** Cualquier candidato de otro tema, por memo. */
  const foreignIndex = useMemo(() => {
    const m = new Map<string, { cand: TemaCandidate; other: OtherTema }>();
    for (const o of others.items ?? []) for (const c of o.candidates) m.set(memoKey(c.memo), { cand: c, other: o });
    return m;
  }, [others.items]);

  // Material: la onda de todas las partes a la vista; análisis y letra de las que están en un hueco.
  const inSlots = new Set(raw.flatMap((r) => (r.pick?.memo ? [memoKey(r.pick.memo)] : r.candidate ? [memoKey(r.candidate.memo)] : [])));
  const foreignFavs = useMemo(
    () => (others.items ?? []).flatMap((o) => o.candidates.filter((c) => c.favorite && c.status === "listo")),
    [others.items],
  );
  const entries: PartEntry[] = useMemo(() => {
    const seen = new Set<string>();
    const out: PartEntry[] = [];
    const add = (c: TemaCandidate) => {
      const k = memoKey(c.memo);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ memo: c.memo, kind: c.kind, rev: candidateRev(c), deep: inSlots.has(k) });
    };
    detail.candidates.forEach(add);
    for (const r of raw) if (r.pick?.memo) {
      const f = foreignIndex.get(memoKey(r.pick.memo));
      if (f) add(f.cand);
    }
    if (scope === "todos") foreignFavs.forEach(add);
    return out;
    // inSlots se deriva de raw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.candidates, raw, foreignIndex, foreignFavs, scope]);
  const mats = usePartMaterials(api, entries);
  const mat = (m: MemoRef | undefined): PartMaterial | null => (m ? (mats[memoKey(m)] ?? null) : null);

  const slots: Slot[] = useMemo(
    () =>
      raw.map((r, index): Slot => {
        const pick = r.pick;
        let cand = r.candidate;
        let foreign: Foreign | null = null;
        let unresolved: Slot["unresolved"] = null;
        if (pick?.memo && !cand) {
          const f = foreignIndex.get(memoKey(pick.memo));
          if (f) {
            cand = f.cand;
            foreign = { tema: f.other.tema, section: f.other.tema.track.sections.find((s) => s.id === f.cand.sectionId) ?? null };
          } else unresolved = others.items === null || others.loading ? "cargando" : "perdida";
        }
        const state: Slot["state"] = pick?.memo ? "elegida" : cand ? "propuesta" : "vacia";
        const m = cand ? mat(cand.memo) : null;
        const lyric = cand ? lyricFor(m?.board ?? null, m?.analysis ?? null, state === "elegida" ? pick?.lyric : undefined) : null;
        return { index, section: r.section, pick, state, cand, foreign, unresolved, lyric, keep: !!pick?.keep };
      }),
    // mats cambia cuando llega material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, foreignIndex, others.items, others.loading, mats],
  );

  const selIndex = Math.max(0, slots.findIndex((s) => s.section.id === section.id));
  const sel = slots[selIndex];

  // ─────────── Elegir ───────────

  const setPick = useCallback(
    (sectionId: string, next: MontagePick | null) => {
      const rest = tema.montage.filter((p) => p.sectionId !== sectionId);
      patch({ montage: next ? [...rest, next] : rest });
    },
    [patch, tema.montage],
  );

  const choose = useCallback(
    (slot: Slot, memo: MemoRef) => {
      if (slot.keep) return;
      const prev = slot.pick;
      if (prev?.memo && sameMemo(prev.memo, memo)) return;
      // La letra elegida era de la parte anterior: con otra parte vuelve a "Tu versión".
      setPick(slot.section.id, { sectionId: slot.section.id, memo, ...(prev?.keep ? { keep: true } : {}) });
    },
    [setPick],
  );

  const chooseLyric = useCallback(
    (slot: Slot, lyric: MontagePick["lyric"]) => {
      if (!slot.pick?.memo) return;
      setPick(slot.section.id, { ...slot.pick, lyric });
    },
    [setPick],
  );

  const toggleKeep = useCallback(
    (slot: Slot) => {
      if (!slot.pick?.memo) return;
      const { keep: _k, ...rest } = slot.pick;
      setPick(slot.section.id, slot.keep ? rest : { ...rest, keep: true });
    },
    [setPick],
  );

  const unchoose = useCallback(
    (slot: Slot) => {
      if (slot.keep) return;
      setPick(slot.section.id, null);
    },
    [setPick],
  );

  /** Las alternativas del hueco en el alcance vigente (las mismas que recorre ↑/↓). */
  const alternatives = useMemo(() => {
    if (!sel) return [] as TemaCandidate[];
    if (scope === "tema")
      return detail.candidates
        .filter((c) => c.sectionId === sel.section.id)
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    return foreignFavs;
  }, [detail.candidates, foreignFavs, scope, sel]);

  const stepAlt = useCallback(
    (dir: 1 | -1) => {
      if (!sel || sel.keep || !alternatives.length) return;
      const cur = alternatives.findIndex((c) => sel.pick?.memo && sameMemo(c.memo, sel.pick.memo));
      const i = cur < 0 ? (dir > 0 ? 0 : alternatives.length - 1) : Math.min(alternatives.length - 1, Math.max(0, cur + dir));
      choose(sel, alternatives[i].memo);
    },
    [alternatives, choose, sel],
  );

  // ─────────── Ensamble ───────────

  const [playing, setPlaying] = useState<null | { only: number | null; loading: boolean }>(null);
  const [playIndex, setPlayIndex] = useState<number | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const handle = useRef<EnsembleHandle | null>(null);
  /** Lo que se está pidiendo para el ensamble (la guía se cancela al detener). */
  const loadAbort = useRef<AbortController | null>(null);
  const [voice, setVoiceState] = useState<EnsembleVoice>("tarareo");
  useEffect(() => {
    try {
      const v = localStorage.getItem(VOICE_KEY);
      if (v === "guia" || v === "ambos") setVoiceState(v);
    } catch {
      /* sin almacenamiento: tarareo */
    }
  }, []);
  const setVoice = useCallback((v: EnsembleVoice) => {
    setVoiceState(v);
    try {
      localStorage.setItem(VOICE_KEY, v);
    } catch {
      /* vive hasta recargar */
    }
  }, []);
  const run = useRef(0);
  const laneRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const stopEnsemble = useCallback(() => {
    run.current++;
    loadAbort.current?.abort();
    handle.current?.stop();
    handle.current = null;
    setPlaying(null);
    setPlayIndex(null);
  }, []);

  const playSlots = useCallback(
    async (only: number | null) => {
      const ac = engine.context();
      if (!ac) {
        setNotes(["Este navegador no tiene audio web."]);
        return;
      }
      const my = ++run.current;
      handle.current?.stop();
      handle.current = null;
      loadAbort.current?.abort();
      const abort = new AbortController();
      loadAbort.current = abort;
      setPlaying({ only, loading: true });
      const list = only == null ? slots : slots.filter((s) => s.index === only);
      const wantTake = voice !== "guia";
      const wantGuide = voice !== "tarareo";
      const out: string[] = [];
      let charged = 0;
      let guides = 0;
      let fromCache = 0;
      let problem: string | null = null;
      const parts = await Promise.all(
        list.map(async (s): Promise<EnsemblePart | null> => {
          const c = s.cand;
          if (!c) return null;
          if (c.kind !== "toma" || !c.onGrid) {
            out.push(`${s.section.label}: pasaje sin rejilla, suena solo la pista.`);
            return null;
          }
          try {
            // La rejilla viaja con la toma: con el tarareo se baja su audio; para la guía sola basta la sesión.
            const got = wantTake
              ? await loadTakeAudio(api, ac, c.memo.sessionId)
              : { session: await api.getSession(c.memo.sessionId), buffer: null };
            const g = got.session.take?.grid;
            if (!g) throw new Error("Esta sesión no es una toma de un tema.");
            if (Math.abs(g.bpm - tema.track.bpm) > 0.5)
              out.push(`${s.section.label}: grabada a ${fmtBpm(g.bpm)} bpm (el tema va a ${fmtBpm(tema.track.bpm)}): se desfasa.`);
            if (s.state === "propuesta") out.push(`${s.section.label} suena con la ★ propuesta, todavía sin elegir.`);
            let guide: AudioBuffer | null = null;
            if (wantGuide) {
              const lines = s.lyric && !s.lyric.missing ? s.lyric.lines : [];
              if (!lines.length) out.push(`${s.section.label}: sin letra elegida, no hay guía que cantar.`);
              else {
                try {
                  const mode = mats[memoKey(c.memo)]?.board?.melismaMode ?? "respetar";
                  const r = await loadGuide(api, ac, c.memo, lines, mode, abort.signal);
                  guide = r.buffer;
                  charged += r.ttsChars;
                  guides++;
                  if (!r.ttsChars) fromCache++;
                } catch (e) {
                  const pb = guideProblem(e);
                  if (pb) problem = pb.kind === "voz" ? `${pb.message} (en Letra, junto a ▶ guía).` : pb.message;
                }
              }
            }
            return { grid: g, take: wantTake ? got.buffer : null, guide };
          } catch (e) {
            out.push(`${s.section.label}: ${(e as Error).message}`);
            return null;
          }
        }),
      );
      if (run.current !== my) return;
      if (problem) out.unshift(`Guía: ${problem}`);
      if (guides)
        out.push(
          !charged
            ? "Guía de caché: sin costo."
            : `Guía: ${charged} caracteres cobrados a ElevenLabs${fromCache ? ` (${fromCache} de ${guides} de caché)` : ""}.`,
        );
      setNotes(out);
      const mix = transportStore.get().settings;
      const h = playEnsemble(engine, {
        track: tema.track,
        sectionIds: list.map((s) => s.section.id),
        parts,
        chords: mix.chords,
        groove: mix.groove,
        onSection: (i) => {
          if (run.current === my) setPlayIndex(list[i]?.index ?? null);
        },
        onEnd: () => {
          if (run.current !== my) return;
          handle.current = null;
          setPlaying(null);
          setPlayIndex(null);
        },
      });
      if (!h) {
        setPlaying(null);
        return;
      }
      handle.current = h;
      setPlaying({ only, loading: false });
      setPlayIndex(list[0]?.index ?? null);
    },
    [api, engine, mats, slots, tema.track, voice],
  );

  const toggleEnsemble = useCallback(() => {
    if (playing) stopEnsemble();
    else void playSlots(null);
  }, [playSlots, playing, stopEnsemble]);

  // Salir de la etapa calla el ensamble.
  useEffect(() => () => {
    run.current++;
    loadAbort.current?.abort();
    handle.current?.stop();
  }, []);

  // Cabezal sobre los huecos: rAF que escribe por ref (un estado por cuadro re-renderizaría la mesa).
  useEffect(() => {
    if (!playing || playing.loading || !active) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const h = handle.current;
      const head = headRef.current;
      const lane = laneRef.current;
      const ac = engine.context();
      if (!h || !head || !lane || !ac) return;
      const t = ac.currentTime;
      const list = playing.only == null ? slots : slots.filter((s) => s.index === playing.only);
      let i = h.starts.findIndex((st, k) => t >= st && t < st + h.durs[k]);
      if (i < 0) i = t < h.startAt ? 0 : h.starts.length - 1;
      const frac = t < h.startAt ? 0 : Math.max(0, Math.min(1, (t - h.starts[i]) / h.durs[i]));
      const card = lane.querySelector<HTMLElement>(`[data-slot="${list[i]?.index}"]`);
      if (!card) return;
      head.style.opacity = "1";
      head.style.transform = `translateX(${card.offsetLeft + frac * card.offsetWidth}px)`;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (headRef.current) headRef.current.style.opacity = "0";
    };
  }, [active, engine, playing, slots]);

  // ─────────── Aplicar ───────────

  const request = useMemo(
    () =>
      buildApplyRequest(
        tema,
        slots.map((s) => ({
          section: s.section,
          chosen: s.state === "elegida" && s.cand ? s.pick!.memo! : null,
          partLabel: partName(s),
          proposed: s.state === "propuesta",
          lyric: s.lyric,
        })),
      ),
    [slots, tema],
  );
  const lyricsLoading =
    slots.some((s) => s.unresolved === "cargando") ||
    slots.some((s) => s.state === "elegida" && s.cand && !mat(s.cand.memo)?.board && mat(s.cand.memo)?.loading !== false);

  // Enlazar la canción al tema cuando el tablero ya la tiene (el agente valida que exista):
  // primero se guarda el tablero y después el PATCH del tema.
  useEffect(() => {
    if (!linkPending || !comp.songs.some((s) => s.id === linkPending)) return;
    const id = linkPending;
    setLinkPending(null);
    void comp.flush().then(() => patch({ songId: id }));
  }, [comp, linkPending, patch]);

  const undoApplied = useCallback(() => {
    if (!applied) return;
    applied.undo();
    if (applied.prevSongId !== applied.songId) patch({ songId: applied.prevSongId });
    setApplied(null);
  }, [applied, patch]);

  const linkedSong = tema.songId ? comp.songs.find((s) => s.id === tema.songId) : undefined;

  // ─────────── Teclado ───────────

  const keys = useRef({ active, stage: ctx.stage, altOpen, slots, selIndex, toggleEnsemble, stepAlt, setSectionId, applied, undoApplied });
  keys.current = { active, stage: ctx.stage, altOpen, slots, selIndex, toggleEnsemble, stepAlt, setSectionId, applied, undoApplied };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (!k.active || k.stage !== "montaje") return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (!k.applied || typingTarget(e) || document.querySelector("[data-composicion-modal]")) return;
        e.preventDefault();
        k.undoApplied();
        return;
      }
      if (!plainKey(e)) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      /** El foco está en un hueco del carril (Enter abre sus alternativas; ←/→ lo mueven con la selección). */
      const onCard = !!el?.dataset.slot;
      switch (e.key) {
        case " ":
          if (spaceOnButton(e)) return;
          e.preventDefault();
          // El Espacio del transporte tocaría el loop de la sección encima del ensamble.
          e.stopPropagation();
          k.toggleEnsemble();
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const i = Math.max(0, Math.min(k.slots.length - 1, k.selIndex + (e.key === "ArrowRight" ? 1 : -1)));
          if (k.slots[i]) k.setSectionId(k.slots[i].section.id);
          // El foco va al hueco nuevo: si se quedara en una alternativa del hueco anterior,
          // Enter la "cliquearía" para este.
          document.querySelector<HTMLElement>(`[data-slot="${i}"]`)?.focus();
          setAltOpen(false);
          return;
        }
        case "Enter":
          if ((tag === "BUTTON" || tag === "A") && !onCard) return;
          e.preventDefault();
          setAltOpen(true);
          return;
        case "ArrowUp":
        case "ArrowDown":
          if (!k.altOpen) return;
          e.preventDefault();
          k.stepAlt(e.key === "ArrowDown" ? 1 : -1);
          return;
        case "Escape":
          if (!k.altOpen) return;
          e.preventDefault();
          // Sin esto, el Esc de la cáscara saca del tema.
          e.stopPropagation();
          setAltOpen(false);
          document.querySelector<HTMLElement>(`[data-slot="${k.selIndex}"]`)?.focus();
          return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (altOpen) altRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [altOpen]);

  // ─────────── Render ───────────

  const noMaterial = !detail.candidates.length && !tema.montage.some((p) => p.memo);
  if (noMaterial && !forceLane)
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm text-text">Todavía no hay partes para montar</p>
        <p className="max-w-[58ch] text-xs text-text-dim">
          El montaje arma el tema con tus tomas: una parte por sección, de este tema o de otros, escuchada entera sobre la
          pista. Graba el tarareo de cada sección y vuelve.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" className={btnPrimary} onClick={() => setStage("grabar")}>
            Ir a Grabar
          </button>
          {others.available && (
            <button
              type="button"
              className={btn}
              onClick={() => {
                setForceLane(true);
                setScope("todos");
                setAltOpen(true);
              }}
            >
              Traer partes de otros temas
            </button>
          )}
        </div>
      </div>
    );

  const chosenCount = slots.filter((s) => s.state === "elegida").length;
  const proposedCount = slots.filter((s) => s.state === "propuesta").length;
  const barSec = barSecOf(tema.track.bpm, tema.track.meter);
  const totalBars = slots.reduce((a, s) => a + s.section.bars, 0);
  const soloing = playing?.only != null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-md font-medium text-text">Montaje</h2>
          <p className="text-xs text-text-dim">
            {chosenCount} de {slots.length} {slots.length === 1 ? "sección" : "secciones"} con parte elegida
            {proposedCount > 0 && ` · ${proposedCount} con ★ propuesta sin elegir`} · {totalBars} compases ·{" "}
            {fmtDuration(totalBars * barSec)}
            {linkedSong && (
              <>
                {" · "}
                <button
                  type="button"
                  className="cursor-pointer text-text-dim underline decoration-line-2 underline-offset-2 hover:text-text"
                  onClick={() => {
                    comp.setSection("canciones");
                    comp.setSelectedId(linkedSong.id);
                  }}
                  title="Abrir la canción"
                >
                  aplicado a «{linkedSong.title}» ↗
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={playing && !soloing ? `${btn} border-accent text-accent` : btn}
            onClick={toggleEnsemble}
            aria-pressed={!!playing && !soloing}
            title="Tocar el tema entero, sección por sección (Espacio)"
          >
            {playing && !soloing ? (playing.loading ? "Cargando…" : "■ Detener") : "▶ Ensamble"}
            <kbd className="text-2xs opacity-70">Espacio</kbd>
          </button>
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Qué voz suena sobre la pista">
            {(Object.keys(VOICE_LABEL) as EnsembleVoice[]).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={voice === v}
                className={chip(voice === v)}
                onClick={() => {
                  setVoice(v);
                  if (playing) stopEnsemble();
                }}
                title={VOICE_LABEL[v].hint}
              >
                {VOICE_LABEL[v].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setApplying(true)}
            disabled={lyricsLoading}
            title={lyricsLoading ? "Cargando las letras de las partes…" : "Ver el antes/después y aplicarlo a una canción"}
          >
            Aplicar a canción
          </button>
        </div>
      </header>

      {applied && (
        <div className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2 text-xs" role="status">
          <span className="text-green">✓</span>
          <span className="min-w-0 flex-1 truncate text-text">
            {comp.songs.find((s) => s.id === applied.songId)?.title ?? "La canción"}: {applied.note}
          </span>
          <button type="button" className={btnGhost} onClick={undoApplied}>
            Deshacer <kbd className="text-2xs opacity-70">⌘Z</kbd>
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              comp.setSection("canciones");
              comp.setSelectedId(applied.songId);
            }}
          >
            Ver la canción ↗
          </button>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-text-dim" aria-label="Sobre el ensamble">
          {notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {/* Los huecos (Riverside): uno por sección, tan anchos como sus compases */}
      <div className="overflow-x-auto pb-1">
        <div ref={laneRef} className="relative flex min-w-full gap-1.5" role="listbox" aria-label="Secciones del montaje" aria-activedescendant={`hueco-${selIndex}`}>
          {slots.map((s) => (
            <SlotCard
              key={s.section.id}
              slot={s}
              on={s.index === selIndex}
              sounding={playIndex === s.index}
              startSec={slots.slice(0, s.index).reduce((a, x) => a + x.section.bars, 0) * barSec}
              barSec={barSec}
              peaks={s.cand ? (mat(s.cand.memo)?.peaks ?? null) : null}
              onSelect={() => setSectionId(s.section.id)}
            />
          ))}
          <div
            ref={headRef}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-full bg-accent opacity-0 transition-opacity"
          />
        </div>
      </div>

      {sel && (
        <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 min-[1180px]:grid-cols-[minmax(0,1fr)_340px]">
          <SlotPiece
            slot={sel}
            material={sel.cand ? mat(sel.cand.memo) : null}
            tema={tema}
            notation={notation}
            barSec={barSec}
            playingThis={!!playing && playing.only === sel.index}
            loadingThis={!!playing?.loading && playing.only === sel.index}
            onPlay={() => (playing?.only === sel.index ? stopEnsemble() : void playSlots(sel.index))}
            onAccept={() => sel.cand && choose(sel, sel.cand.memo)}
            onUnchoose={() => unchoose(sel)}
            onKeep={() => toggleKeep(sel)}
            onLyric={(l) => chooseLyric(sel, l)}
            onRegenerate={(to) => {
              setSectionId(sel.section.id);
              setStage(to);
            }}
            onBringOthers={() => {
              setScope("todos");
              setAltOpen(true);
            }}
          />
          <Alternatives
            ref={altRef}
            slot={sel}
            scope={scope}
            setScope={setScope}
            open={altOpen}
            setOpen={setAltOpen}
            list={alternatives}
            others={others}
            foreignOf={(c) => foreignIndex.get(memoKey(c.memo))?.other ?? null}
            tema={tema}
            notation={notation}
            mats={mats}
            onChoose={(c) => choose(sel, c.memo)}
            onRecord={() => setStage("grabar")}
          />
        </div>
      )}

      {applying && (
        <ApplyToSongSheet
          request={request}
          onClose={() => setApplying(false)}
          onApplied={(c) => {
            setApplying(false);
            setApplied({ ...c, prevSongId: tema.songId });
            setLinkPending(c.songId);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────── Onda mínima ───────────────────────────

/** Picos por cubeta, sin normalizar (una toma bajita se ve bajita: es un dato). */
function MiniWave({ peaks, className = "h-6", dim }: { peaks: number[] | null; className?: string; dim?: boolean }) {
  const bars = useMemo(() => {
    if (!peaks?.length) return null;
    const n = Math.min(72, peaks.length);
    const size = peaks.length / n;
    return Array.from({ length: n }, (_, i) => {
      let p = 0;
      for (let j = Math.floor(i * size); j < Math.floor((i + 1) * size); j++) p = Math.max(p, peaks[j] ?? 0);
      return p;
    });
  }, [peaks]);
  if (!bars) return <div className={`${className} w-full rounded-xs border-y border-dashed border-line`} aria-hidden />;
  return (
    <svg viewBox={`0 0 ${bars.length} 20`} preserveAspectRatio="none" className={`${className} w-full`} aria-hidden>
      {bars.map((v, i) => {
        const h = Math.max(0.8, Math.min(1, v) * 18);
        return <rect key={i} x={i + 0.2} y={10 - h / 2} width={0.6} height={h} className={dim ? "fill-line-2" : "fill-text-faint"} />;
      })}
    </svg>
  );
}

// ─────────────────────────── Hueco ───────────────────────────

const CARD: Record<Slot["state"], string> = {
  elegida: "border-line-2 bg-panel",
  propuesta: "border-dashed border-line-2 bg-panel/60",
  vacia: "border-dashed border-line bg-transparent",
};

function SlotCard({
  slot,
  on,
  sounding,
  startSec,
  barSec,
  peaks,
  onSelect,
}: {
  slot: Slot;
  on: boolean;
  sounding: boolean;
  startSec: number;
  barSec: number;
  peaks: number[] | null;
  onSelect: () => void;
}) {
  const s = slot;
  const first = s.lyric?.lines[0]?.text;
  return (
    <button
      type="button"
      id={`hueco-${s.index}`}
      data-slot={s.index}
      role="option"
      aria-selected={on}
      onClick={onSelect}
      style={{ flexGrow: s.section.bars, flexBasis: 0 }}
      className={`flex min-w-[196px] cursor-pointer flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors ${CARD[s.state]} ${
        on ? "border-solid !border-accent" : "hover:border-line-2"
      }`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-sm ${on ? "text-accent" : "text-text"}`}>
          {s.section.label}
          {sounding && <span className="ml-1.5 text-xs text-text-dim">sonando</span>}
        </span>
        <span className="shrink-0 font-mono text-xs text-text-faint tabular-nums">
          {fmtTime(startSec)} · {s.section.bars} c.
        </span>
      </span>
      {s.cand ? (
        <MiniWave peaks={peaks} dim={s.state !== "elegida"} />
      ) : (
        <span className="grid h-6 place-items-center text-xs text-text-faint">
          {s.unresolved === "cargando" ? "cargando la parte…" : s.unresolved === "perdida" ? "la parte elegida ya no está" : "elige una parte"}
        </span>
      )}
      <span className={`line-clamp-1 min-h-[1.25rem] text-xs ${s.state === "elegida" ? "text-text" : "text-text-faint"}`}>
        {first ?? (s.cand ? "sin letra" : " ")}
      </span>
      <span className="flex items-center gap-1.5 text-xs">
        {s.state === "elegida" && (
          <>
            <span className="truncate text-text-dim">
              {partName(s)}
              {s.foreign ? ` · de «${s.foreign.tema.title}»` : ""}
              {s.lyric ? ` · ${s.lyric.label}` : ""}
            </span>
            {s.keep && (
              <span className="ml-auto shrink-0 text-text-dim" aria-label="conservada" title="Conservada: no se regenera">
                🔒
              </span>
            )}
          </>
        )}
        {s.state === "propuesta" && <span className="truncate text-text-faint">{partName(s)} propuesta · elige</span>}
        {s.state === "vacia" && <span className="text-text-faint">{fmtDuration(s.section.bars * barSec)} sin parte</span>}
      </span>
    </button>
  );
}

// ─────────────────────────── La pieza: el hueco elegido ───────────────────────────

function SlotPiece({
  slot: s,
  material,
  tema,
  notation,
  barSec,
  playingThis,
  loadingThis,
  onPlay,
  onAccept,
  onUnchoose,
  onKeep,
  onLyric,
  onRegenerate,
  onBringOthers,
}: {
  slot: Slot;
  material: PartMaterial | null;
  tema: Tema;
  notation: "en" | "latin";
  barSec: number;
  playingThis: boolean;
  loadingThis: boolean;
  onPlay: () => void;
  onAccept: () => void;
  onUnchoose: () => void;
  onKeep: () => void;
  onLyric: (l: MontagePick["lyric"]) => void;
  onRegenerate: (to: "letra" | "grabar") => void;
  onBringOthers: () => void;
}) {
  const [regen, setRegen] = useState(false);
  const c = s.cand;
  const board = material?.board ?? null;
  const analysis = material?.analysis ?? null;
  const mine = mineOf(board, analysis);
  const versions = versionsOf(board, analysis);
  const chords = s.section.loop.map((b) => b.chords.map((x) => showChord(x.symbol, tema.track.key, notation)).join("/")).join(" · ");
  const pickLyric = s.pick?.lyric;
  const lyricIs = (k: "mine" | string) =>
    k === "mine" ? s.state === "elegida" && (!pickLyric || pickLyric.kind === "mine") : pickLyric?.kind === "version" && pickLyric.versionId === k;
  const g = s.foreign ? s.foreign.tema.track : null;

  useEffect(() => setRegen(false), [s.section.id]);
  // El menú se cierra con Esc (en captura: si no, el Esc de la cáscara saca del tema) o con un clic fuera.
  const regenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!regen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setRegen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!regenRef.current?.contains(e.target as Node)) setRegen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [regen]);

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={`Parte de ${s.section.label}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text">{s.section.label}</h3>
          <p className="truncate text-xs text-text-faint">
            {s.section.bars} compases · {fmtDuration(s.section.bars * barSec)} · <span className="font-mono">{chords}</span>
          </p>
        </div>
        <div ref={regenRef} className="relative flex items-center gap-1">
          <button type="button" className={btn} onClick={onPlay} disabled={!c && !playingThis} title="Esta sección sola, con su parte, sobre la pista">
            {playingThis ? (loadingThis ? "Cargando…" : "■ Detener") : "▶ Esta parte"}
          </button>
          <button
            type="button"
            className={s.keep ? `${btn} border-accent/60 text-text` : btn}
            onClick={onKeep}
            disabled={s.state !== "elegida"}
            aria-pressed={s.keep}
            title={s.state !== "elegida" ? "Primero elige una parte" : s.keep ? "Quitar el candado" : "Conservar: no se cambia ni se regenera"}
          >
            🔒 {s.keep ? "Conservada" : "Conservar"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => setRegen((v) => !v)}
            disabled={s.keep}
            aria-expanded={regen}
            title={s.keep ? "Conservada: quítale el candado para regenerar" : "Otra letra u otra toma para esta sección"}
          >
            ↻ Regenerar <span className="text-text-faint">▾</span>
          </button>
          {regen && !s.keep && (
            <div className="absolute top-full right-0 z-20 mt-1 flex w-64 flex-col rounded-md border border-line bg-panel p-1 shadow-[var(--shadow-pop)]" role="menu">
              <button type="button" role="menuitem" className="flex cursor-pointer flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-panel-2" onClick={() => onRegenerate("letra")}>
                <span className="text-xs text-text">Otra letra</span>
                <span className="text-xs text-text-faint">En Letra: regeneras las frases que no bloqueaste.</span>
              </button>
              <button type="button" role="menuitem" className="flex cursor-pointer flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-panel-2" onClick={() => onRegenerate("grabar")}>
                <span className="text-xs text-text">Otra toma</span>
                <span className="text-xs text-text-faint">En Grabar: tarareas «{s.section.label}» otra vez.</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {s.state === "vacia" && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-line px-4 py-4">
          <p className="text-sm text-text">
            {s.unresolved === "perdida"
              ? "La parte elegida para esta sección ya no está (su tema se borró o la toma cambió)."
              : s.unresolved === "cargando"
                ? "Cargando la parte que viene de otro tema…"
                : `Ninguna parte para «${s.section.label}» todavía.`}
          </p>
          <p className="text-xs text-text-dim">Graba su tarareo sobre la pista, o trae una toma ★ de otro tema.</p>
          <div className="flex items-center gap-2">
            <button type="button" className={btnPrimary} onClick={() => onRegenerate("grabar")}>
              Grabar «{s.section.label}»
            </button>
            <button type="button" className={btn} onClick={onBringOthers}>
              Traer de otro tema →
            </button>
            {s.unresolved === "perdida" && (
              <button type="button" className={btnGhost} onClick={onUnchoose}>
                Soltar la elección
              </button>
            )}
          </div>
        </div>
      )}

      {c && (
        <>
          {s.state === "propuesta" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-line-2 px-3 py-2.5">
              <p className="min-w-0 flex-1 text-xs text-text-dim">
                Hermes propone <span className="text-text">{partName(s)}</span>
                {c.favorite ? ": es tu favorita de Grabar." : ": es la última toma lista."} La elección es tuya.
              </p>
              <button type="button" className={btnPrimary} onClick={onAccept}>
                Usar esta parte
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="text-text">{partName(s)}</span>
              <span className="text-text-faint">
                {s.foreign
                  ? `de «${s.foreign.tema.title}»${s.foreign.section ? ` · ${s.foreign.section.label}` : ""}`
                  : c.kind === "pasaje"
                    ? "pasaje de Sesiones"
                    : "de este tema"}
              </span>
              <span className={STATUS[c.status].cls}>{STATUS[c.status].label}</span>
              {fmtDuration(c.durationSec) && <span className="text-text-faint">{fmtDuration(c.durationSec)}</span>}
              {c.syllables != null && <span className="text-text-faint">{c.syllables} sílabas</span>}
              {c.melismas != null && c.melismas > 0 && (
                <span className="text-text-faint">
                  {c.melismas} {c.melismas === 1 ? "melisma" : "melismas"}
                </span>
              )}
              {s.state === "elegida" && !s.keep && (
                <button type="button" className={`${btnGhost} ml-auto`} onClick={onUnchoose}>
                  Quitar la parte
                </button>
              )}
            </p>
            <MiniWave peaks={material?.peaks ?? null} className="h-10" dim={s.state !== "elegida"} />
            {(!c.onGrid || c.kind === "pasaje") && (
              <p className="text-xs text-amber">Sin rejilla (no se grabó sobre la pista): en el ensamble suena solo la pista.</p>
            )}
            {g && (g.bpm !== tema.track.bpm || g.key.tonic !== tema.track.key.tonic || g.key.mode !== tema.track.key.mode) && (
              <p className="text-xs text-amber">
                Su tema va en {keyLabel(g.key, notation)} a {fmtBpm(g.bpm)} bpm; este, en {keyLabel(tema.track.key, notation)} a{" "}
                {fmtBpm(tema.track.bpm)}. En el ensamble suena a su tempo y en su tono.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={`Letra de ${s.section.label}`}>
              <span className="mr-1 text-xs text-text-faint">Letra</span>
              {material?.loading && !board ? (
                <span className="text-xs text-text-faint">cargando…</span>
              ) : (
                <>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={lyricIs("mine")}
                    className={`${chip(lyricIs("mine"))} disabled:cursor-not-allowed disabled:opacity-45`}
                    disabled={s.state !== "elegida" || !mine}
                    onClick={() => onLyric({ kind: "mine" })}
                    title={mine ? undefined : "«Tu versión» está vacía: se arma en Letra"}
                  >
                    Tu versión
                    {mine && (
                      <span className="text-text-faint">
                        {mine.lines.length}
                        {mine.phrases != null ? `/${mine.phrases}` : ""}
                      </span>
                    )}
                  </button>
                  {versions.map((v) => (
                    <button
                      key={v.versionId}
                      type="button"
                      role="radio"
                      aria-checked={lyricIs(v.versionId!)}
                      className={`${chip(lyricIs(v.versionId!))} disabled:cursor-not-allowed disabled:opacity-45`}
                      disabled={s.state !== "elegida"}
                      onClick={() => onLyric({ kind: "version", versionId: v.versionId! })}
                      title={s.state !== "elegida" ? "Primero elige la parte" : undefined}
                    >
                      {v.label}
                      {v.score != null && <span className="text-text-faint">{pct(v.score)}</span>}
                    </button>
                  ))}
                  {!mine && !versions.length && <span className="text-xs text-text-faint">sin letra todavía</span>}
                </>
              )}
            </div>
            <LyricLines choice={s.lyric} phrases={analysis?.phrases.length ?? null} dim={s.state !== "elegida"} />
            {material?.error && !board && <p className="text-xs text-red">No se pudo leer la letra: {material.error}</p>}
          </div>
        </>
      )}
    </section>
  );
}

/** La letra de la parte, frase por frase; las frases sin texto se ven (no se esconden). */
function LyricLines({ choice, phrases, dim }: { choice: LyricChoice | null; phrases: number | null; dim: boolean }) {
  if (choice?.missing)
    return (
      <p className="text-xs text-amber">
        {choice.stale
          ? "La versión elegida es de un análisis anterior (las frases cambiaron): elige otra."
          : "La versión elegida ya no está en el tablero de letras: elige otra."}
      </p>
    );
  const n = Math.max(phrases ?? 0, ...(choice?.lines.map((l) => l.phrase + 1) ?? [0]));
  if (!n) return <p className="text-xs text-text-faint">Sin letra: en Letra armas «Tu versión» o generas versiones.</p>;
  const byPhrase = new Map(choice?.lines.map((l) => [l.phrase, l.text]) ?? []);
  return (
    <ol className="flex flex-col gap-1 border-l border-line pl-3">
      {Array.from({ length: n }, (_, i) => {
        const t = byPhrase.get(i);
        return (
          <li key={i} className="flex gap-2 text-sm">
            <span className="w-4 shrink-0 text-right font-mono text-xs leading-5 text-text-faint tabular-nums">{i + 1}</span>
            {t ? (
              <span className={dim ? "text-text-dim" : "text-text"}>{t}</span>
            ) : (
              <span className="text-xs leading-5 text-text-faint">frase sin letra</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────── Alternativas ───────────────────────────


const Alternatives = forwardRef<
  HTMLDivElement,
  {
    slot: Slot;
    scope: Scope;
    setScope: (s: Scope) => void;
    open: boolean;
    setOpen: (v: boolean) => void;
    list: TemaCandidate[];
    others: ReturnType<typeof useOtherTemas>;
    foreignOf: (c: TemaCandidate) => OtherTema | null;
    tema: Tema;
    notation: "en" | "latin";
    mats: Record<string, PartMaterial>;
    onChoose: (c: TemaCandidate) => void;
    onRecord: () => void;
  }
>(function Alternatives({ slot, scope, setScope, open, setOpen, list, others, foreignOf, tema, notation, mats, onChoose, onRecord }, ref) {
  const listRef = useRef<HTMLOListElement>(null);
  // Enter abre: el foco entra a la elegida (o a la primera) para que ↑/↓ y el lector sigan la selección.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? listRef.current?.querySelector<HTMLElement>("[role=option]");
    el?.focus({ preventScroll: true });
  }, [open, slot.pick?.memo, scope]);

  const isChosen = (c: TemaCandidate) => slot.state === "elegida" && sameMemo(slot.pick?.memo, c.memo);
  const isProposed = (c: TemaCandidate) => slot.state === "propuesta" && sameMemo(slot.cand?.memo, c.memo);

  // "De todos": agrupadas por tema.
  const groups = useMemo(() => {
    if (scope !== "todos") return null;
    const m = new Map<string, { other: OtherTema; items: TemaCandidate[] }>();
    for (const c of list) {
      const o = foreignOf(c);
      if (!o) continue;
      const g = m.get(o.tema.id) ?? { other: o, items: [] };
      g.items.push(c);
      m.set(o.tema.id, g);
    }
    return [...m.values()];
  }, [foreignOf, list, scope]);

  const row = (c: TemaCandidate, extra?: string) => {
    const chosen = isChosen(c);
    const proposed = isProposed(c);
    const m = mats[memoKey(c.memo)];
    return (
      <li key={memoKey(c.memo)}>
        <button
          type="button"
          role="option"
          aria-selected={chosen}
          disabled={slot.keep}
          onClick={() => onChoose(c)}
          className={`flex w-full cursor-pointer flex-col gap-1 rounded-sm border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${
            chosen ? "border-accent bg-accent/5" : proposed ? "border-dashed border-line-2" : "border-line hover:border-line-2"
          }`}
        >
          <span className="flex items-center gap-2 text-xs">
            <span className="text-sm text-text">
              {extra ? `${extra} · ` : ""}
              {c.label}
              {c.favorite ? " ★" : ""}
            </span>
            <span className={STATUS[c.status].cls}>{STATUS[c.status].label}</span>
            {chosen && <span className="ml-auto text-accent">✓ elegida</span>}
            {proposed && <span className="ml-auto text-text-faint">propuesta</span>}
          </span>
          <MiniWave peaks={m?.peaks ?? null} className="h-5" dim={!chosen} />
          <span className="flex flex-wrap gap-x-2 text-xs text-text-faint">
            {c.kind === "pasaje" && <span>pasaje</span>}
            {c.syllables != null && <span>{c.syllables} sílabas</span>}
            {c.melismas != null && c.melismas > 0 && <span>{c.melismas} {c.melismas === 1 ? "melisma" : "melismas"}</span>}
            {c.lyrics.bestScore != null ? <span>letra {pct(c.lyrics.bestScore)}</span> : c.lyrics.mine > 0 ? <span>tu versión</span> : <span>sin letra</span>}
            {!c.onGrid && <span className="text-amber">sin rejilla</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div
      ref={ref}
      // Sin marco ni margen propios (desbordaban la etapa): el modo teclado lo dicen el título y el foco de la fila.
      className="flex min-w-0 flex-col gap-2 self-start"
      aria-label={`Alternativas de ${slot.section.label}`}
      onFocus={() => setOpen(true)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className={`text-sm font-medium ${open ? "text-accent" : "text-text"}`}>Alternativas</h3>
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="De dónde">
          <button type="button" role="radio" aria-checked={scope === "tema"} className={chip(scope === "tema")} onClick={() => setScope("tema")}>
            De este tema
          </button>
          <button type="button" role="radio" aria-checked={scope === "todos"} className={chip(scope === "todos")} onClick={() => setScope("todos")}>
            De todos
          </button>
        </div>
      </div>
      <p className="text-xs text-text-faint">
        {slot.keep
          ? "Conservada: quítale el 🔒 para cambiarla."
          : open
            ? "↑↓ elige · Esc cierra"
            : scope === "tema"
              ? `Tomas y pasajes de «${slot.section.label}». Clic para elegir · Enter y ↑↓.`
              : "Tus tomas ★ de otros temas. Clic para usarla aquí."}
      </p>

      {scope === "tema" &&
        (list.length ? (
          <ol ref={listRef} role="listbox" aria-label={`Partes de ${slot.section.label}`} className="flex flex-col gap-1.5">
            {list.map((c) => row(c))}
          </ol>
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-sm border border-dashed border-line px-3 py-3 text-xs text-text-dim">
            «{slot.section.label}» no tiene tomas en este tema.
            <button type="button" className={btn} onClick={onRecord}>
              Ir a Grabar
            </button>
          </div>
        ))}

      {scope === "todos" && (
        <>
          {others.loading && !others.items && (
            <div className="flex flex-col gap-1.5" role="status" aria-label="Cargando otros temas">
              <div className="skeleton h-14 w-full" />
              <div className="skeleton h-14 w-full" />
            </div>
          )}
          {others.error && <p className="text-xs text-amber">{others.error}: se muestra lo que respondió.</p>}
          {!others.available && <p className="text-xs text-text-faint">No hay otros temas con tomas todavía.</p>}
          {others.items && others.available && !groups?.length && (
            <p className="text-xs text-text-faint">Los otros temas no tienen tomas ★ listas. Marca tu favorita en su Grabar.</p>
          )}
          {!!groups?.length && (
            <ol ref={listRef} role="listbox" aria-label="Tomas ★ de otros temas" className="flex flex-col gap-3">
              {groups.map(({ other, items }) => {
                const t = other.tema.track;
                const differs = t.bpm !== tema.track.bpm || t.key.tonic !== tema.track.key.tonic || t.key.mode !== tema.track.key.mode;
                return (
                  <li key={other.tema.id} className="flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="text-text">{other.tema.title}</span>
                      <span className={differs ? "text-amber" : "text-text-faint"}>
                        {keyLabel(t.key, notation)} · {fmtBpm(t.bpm)} bpm
                      </span>
                    </span>
                    <ol className="flex flex-col gap-1.5">
                      {items.map((c) => row(c, other.tema.track.sections.find((s) => s.id === c.sectionId)?.label))}
                    </ol>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
});
