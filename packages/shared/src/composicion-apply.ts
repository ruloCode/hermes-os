/**
 * APLICAR A UNA CANCIÓN — el único camino por el que algo del Playground o de
 * un Tema entra al tablero: con un clic humano, viendo el antes y el después,
 * y dejando rastro en el historial. Puro: la UI calcula el diff con esto mismo
 * y el deshacer es volver a la canción anterior.
 */
import {
  ComposicionValidationError,
  type SectionKind,
  type SectionMemoLink,
  type Song,
  type SongSection,
} from "./composicion.js";
import { chordSymbol, parseChord, transposeChord, type Key } from "./music-theory.js";
import { semitonesToKey } from "./melody.js";

/** Lo que se aplica: una sección (letra, y opcionalmente acordes y memo). */
export interface ApplyPayload {
  label: string;
  lines: string[];
  kind?: SectionKind;
  /** Acordes por compás en la tonalidad de ORIGEN (se transponen a la de la canción). */
  chords?: string[];
  bars?: number;
  link?: SectionMemoLink;
}

export type ApplyTarget =
  | { mode: "debajo"; sectionId: string }
  | { mode: "reemplazar"; sectionId: string }
  | { mode: "nueva"; afterSectionId?: string };

/** Nombre por defecto de una sección nueva sin etiqueta (mismo vocabulario que el tablero). */
const KIND_LABEL: Record<SectionKind, string> = {
  intro: "Intro",
  verso: "Verso",
  pre: "Pre-coro",
  coro: "Coro",
  puente: "Puente",
  final: "Final",
  instrumental: "Instrumental",
};

const validBars = (n: number | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Aplica N payloads a una canción y devuelve la canción NUEVA (no muta).
 * "debajo" agrega líneas al final de la sección; "reemplazar" pisa su letra;
 * "nueva" crea la sección. Con `fromKey`, los acordes se transponen a la
 * tonalidad de la canción y los semitonos del memo salen de `semitonesToKey`.
 * Agrega UNA entrada al historial con `note`.
 *
 * Reglas:
 * - Los semitonos van por el camino corto y las relativas son la misma escala
 *   (`semitonesToKey`): una progresión en La menor entra IGUAL a una canción en
 *   Do mayor. Con 0 semitonos los símbolos se dejan como vinieron; con otro
 *   valor se deletrean en la tonalidad de la canción (el ♭ o ♯ lo manda ella).
 *   Un símbolo que no se entiende se deja tal cual (nada se inventa). También
 *   se transponen los acordes inline `[Am]` de las líneas.
 * - "debajo": la letra existente queda intacta y las líneas van al final; los
 *   acordes del payload se agregan a la progresión y sus compases se suman
 *   (la sección crece). "reemplazar": pisa la letra y, si el payload los trae,
 *   la progresión y los compases. "nueva": se inserta tras `afterSectionId`
 *   (o al final); varias nuevas tras la misma ancla quedan en el orden en que
 *   llegaron.
 * - `link` queda como `memo` de la sección (con los semitonos calculados si hay
 *   `fromKey`) y su sesión se suma a `sessionIds`.
 * - Las secciones que no se tocan son los MISMOS objetos (la UI compara por
 *   referencia) y una sección destino que no existe es un error: aplicar a
 *   ciegas no existe.
 */
export function applyToSong(
  song: Song,
  items: { payload: ApplyPayload; target: ApplyTarget }[],
  opts: { note: string; now: string; fromKey?: Key; newId: (p: string) => string },
): Song {
  if (!items.length) return song;
  const semis = opts.fromKey ? semitonesToKey(opts.fromKey, song.key) : 0;
  const trChord = (sym: string): string => {
    if (!semis) return sym;
    const c = parseChord(sym);
    return c ? chordSymbol(transposeChord(c, semis), song.key) : sym;
  };
  const trLine = (l: string): string =>
    l.replace(/\[([^\]]+)\]/g, (_m, c: string) => `[${trChord(c)}]`);

  const sections: SongSection[] = song.sections.slice();
  const sessionIds = new Set(song.sessionIds ?? []);
  /** Ancla → id de la última sección nueva insertada tras ella (para conservar el orden). */
  const lastAfter = new Map<string, string>();
  const END = "\u0000fin";

  for (const { payload, target } of items) {
    const lines = payload.lines.map((l) => trLine(l.trim())).filter(Boolean);
    const chords = payload.chords?.map(trChord);
    const link: SectionMemoLink | undefined = payload.link
      ? { ...payload.link, semitones: opts.fromKey ? semis : payload.link.semitones }
      : undefined;
    if (link) sessionIds.add(link.sessionId);

    if (target.mode === "nueva") {
      const kind = payload.kind ?? "coro";
      const sec: SongSection = {
        id: opts.newId("sec"),
        kind,
        label: payload.label.trim() || KIND_LABEL[kind],
        lyrics: lines.join("\n"),
        chords: chords ?? [],
        bars: validBars(payload.bars) ? payload.bars : Math.max(4, lines.length * 2),
      };
      if (link) sec.memo = link;
      const anchor = target.afterSectionId ?? END;
      const prevNew = lastAfter.get(anchor);
      let at: number;
      if (prevNew) at = sections.findIndex((x) => x.id === prevNew) + 1;
      else if (target.afterSectionId) {
        const i = sections.findIndex((x) => x.id === target.afterSectionId);
        if (i < 0)
          throw new ComposicionValidationError(
            `no existe la sección ${target.afterSectionId} en «${song.title}»`,
          );
        at = i + 1;
      } else at = sections.length;
      sections.splice(at, 0, sec);
      lastAfter.set(anchor, sec.id);
      continue;
    }

    const i = sections.findIndex((x) => x.id === target.sectionId);
    if (i < 0)
      throw new ComposicionValidationError(
        `no existe la sección ${target.sectionId} en «${song.title}»`,
      );
    const cur = sections[i];
    const next: SongSection = { ...cur };
    if (target.mode === "debajo") {
      const base = cur.lyrics.replace(/\s+$/, "");
      next.lyrics = [base, ...lines].filter(Boolean).join("\n");
      if (chords?.length) next.chords = [...cur.chords, ...chords];
      if (validBars(payload.bars)) next.bars = cur.bars + payload.bars;
    } else {
      next.lyrics = lines.join("\n");
      if (chords) next.chords = chords;
      if (validBars(payload.bars)) next.bars = payload.bars;
    }
    if (link) next.memo = link;
    sections[i] = next;
  }

  const out: Song = {
    ...song,
    sections,
    versions: [
      ...song.versions,
      { id: opts.newId("v"), at: opts.now, note: opts.note, scope: "letra" },
    ],
    updatedAt: opts.now,
  };
  if (sessionIds.size) out.sessionIds = [...sessionIds];
  return out;
}
