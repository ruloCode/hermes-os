"use client";

/**
 * Editor de letra por secciones (patrón Mobbin: tarjetas de sección de
 * ElevenLabs Music + la letra grande de Spotify). Cada verso lleva sus
 * acordes ENCIMA (notación inline [Am], estilo ChordPro) y, al margen, dos
 * medidas honestas: sílabas métricas (aprox.) y la letra del esquema de
 * rimas. Clic en la terminación de un verso → rimas del banco. Editar abre
 * el textarea crudo; la vista de lectura es la que se canta.
 */
import { useMemo, useState } from "react";
import { analyzeStanza, findRhymes, splitChords, type LineAnalysis } from "@/lib/lyrics-analysis";
import { chordSymbol, parseChord } from "@/lib/music-theory";
import { playChord } from "@/lib/chord-audio";
import { Badge } from "@/components/ui/Badge";
import { useComposicion } from "./ComposicionContext";
import { RHYME_BANK } from "./mock";
import { SECTION_KINDS, btnCls, ghostBtnCls, inputCls } from "./labels";
import type { Song, SongSection } from "./types";

export function LyricsEditor({ song, onAskHermes }: { song: Song; onAskHermes: (sectionId: string) => void }) {
  const totalLines = song.sections.reduce((n, s) => n + s.lyrics.split("\n").filter((l) => l.trim()).length, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-dim">
          <span className="text-text">{totalLines}</span> versos · semilla: <em className="text-text">{song.seed}</em>
        </p>
        <span className="text-2xs text-text-faint">sílabas métricas ≈ · esquema de rima por estrofa</span>
      </div>
      {song.sections.map((sec) => (
        <SectionCard key={sec.id} song={song} section={sec} onAskHermes={() => onAskHermes(sec.id)} />
      ))}
    </div>
  );
}

function SectionCard({ song, section, onAskHermes }: { song: Song; section: SongSection; onAskHermes: () => void }) {
  const { patchSection, notation } = useComposicion();
  const [editing, setEditing] = useState(section.lyrics.trim() === "");
  const [draft, setDraft] = useState(section.lyrics);
  const [rhymeFor, setRhymeFor] = useState<string | null>(null);
  const kind = SECTION_KINDS[section.kind];

  const lines = useMemo(() => section.lyrics.split("\n"), [section.lyrics]);
  const analysis = useMemo(() => analyzeStanza(lines), [lines]);
  const syllables = analysis.filter((a) => a.text).map((a) => a.syllables);
  const scheme = analysis.filter((a) => a.text).map((a) => a.scheme).join("");
  const rhymes = rhymeFor ? findRhymes(rhymeFor, RHYME_BANK) : [];

  const save = () => {
    patchSection(song.id, section.id, { lyrics: draft.replace(/\s+$/g, "") });
    setEditing(false);
  };
  const show = (s: string) => {
    const c = parseChord(s);
    return c ? chordSymbol(c, song.key, notation) : s;
  };

  return (
    <article className="hud-panel flex flex-col gap-2 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={kind.tone} size="sm">{kind.label}</Badge>
          <input
            value={section.label}
            onChange={(e) => patchSection(song.id, section.id, { label: e.target.value })}
            className="w-28 bg-transparent font-display text-sm tracking-title text-text uppercase focus:outline-none"
            aria-label="Nombre de la sección"
          />
          <span className="font-mono text-2xs text-text-faint">{section.chords.map(show).join(" · ") || "sin acordes"}</span>
        </div>
        <div className="flex items-center gap-1">
          {scheme && <span className="font-mono text-2xs text-text-dim" title="esquema de rima">{scheme}</span>}
          {syllables.length > 0 && (
            <span className="font-mono text-2xs text-text-dim" title="sílabas por verso">
              {syllables.join("·")}
            </span>
          )}
          <button onClick={onAskHermes} className={ghostBtnCls} title="Pedirle a Hermes caminos para esta sección">✦ Hermes</button>
          {editing ? (
            <>
              <button onClick={() => { setDraft(section.lyrics); setEditing(false); }} className={ghostBtnCls}>Cancelar</button>
              <button onClick={save} className={btnCls}>Guardar</button>
            </>
          ) : (
            <button onClick={() => { setDraft(section.lyrics); setEditing(true); }} className={ghostBtnCls}>Editar</button>
          )}
        </div>
      </header>

      {section.intent !== undefined && (
        <input
          value={section.intent}
          onChange={(e) => patchSection(song.id, section.id, { intent: e.target.value })}
          placeholder="Intención: qué tiene que pasar aquí"
          className="bg-transparent text-2xs text-text-dim italic placeholder:text-text-faint focus:outline-none"
        />
      )}

      {editing ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
            }}
            rows={Math.max(4, draft.split("\n").length + 1)}
            placeholder={`Un verso por línea. Acordes entre corchetes sobre la sílaba: [Am]Son las tres…\n${kind.hint}`}
            className={`${inputCls} w-full resize-y font-mono leading-relaxed`}
          />
          <span className="text-2xs text-text-faint">⌘↵ guarda · los [acordes] van justo antes de la sílaba donde cambian</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {analysis.map((a, i) =>
            a.text ? (
              <LyricLine key={i} raw={lines[i]} a={a} show={show} onRhyme={() => setRhymeFor(rhymeFor === a.ending ? null : a.ending)} active={rhymeFor === a.ending} />
            ) : (
              <div key={i} className="h-3" />
            ),
          )}
        </div>
      )}

      {rhymeFor && (
        <div className="flex flex-wrap items-center gap-1 rounded-sm border border-line bg-panel-2 px-2 py-1.5">
          <span className="mr-1 text-2xs tracking-label text-text-dim uppercase">rima con -{rhymeFor}</span>
          {rhymes.length === 0 && <span className="text-2xs text-text-faint">nada en el banco (mock chico)</span>}
          {rhymes.map((r) => (
            <span key={r.word} className={`rounded-xs px-1.5 py-0.5 font-mono text-2xs ${r.kind === "consonante" ? "bg-violet/16 text-violet" : "bg-cyan/10 text-cyan"}`} title={r.kind ?? ""}>
              {r.word}
            </span>
          ))}
          <button onClick={() => setRhymeFor(null)} className="ml-auto text-2xs text-text-faint hover:text-text">✕</button>
        </div>
      )}
    </article>
  );
}

function LyricLine({ raw, a, show, onRhyme, active }: { raw: string; a: LineAnalysis; show: (s: string) => string; onRhyme: () => void; active: boolean }) {
  const { text, chords } = splitChords(raw);
  // Línea de acordes alineada por posición de carácter (monoespaciada).
  let chordLine = "";
  for (const c of chords) {
    const symbol = show(c.chord);
    while (chordLine.length < c.at) chordLine += " ";
    if (chordLine.length > 0 && !chordLine.endsWith(" ") && chordLine.length >= c.at) chordLine += " ";
    chordLine += symbol;
  }
  const endIdx = text.toLowerCase().lastIndexOf(a.ending.toLowerCase());
  const head = endIdx >= 0 ? text.slice(0, endIdx) : text;
  const tail = endIdx >= 0 ? text.slice(endIdx) : "";

  return (
    <div className="group flex items-end gap-3">
      <div className="min-w-0 flex-1 font-mono">
        {chordLine && (
          <div className="flex whitespace-pre text-2xs leading-none text-violet">
            {chordLine.split(/(\S+)/).map((part, i) =>
              part.trim() ? (
                <button key={i} onClick={() => { const c = parseChord(part); if (c) playChord(c, 0.9); }} className="hover:text-cyan" title="oír">
                  {part}
                </button>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </div>
        )}
        <div className="whitespace-pre text-sm leading-snug text-text">
          {head}
          {tail && (
            <button onClick={onRhyme} className={`rounded-xs ${active ? "bg-violet/25 text-violet" : "group-hover:bg-violet/10"}`} title="buscar rimas">
              {tail}
            </button>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pb-0.5 font-mono text-2xs">
        <span className="w-4 text-right text-text-dim" title="sílabas métricas (aprox.)">{a.syllables}</span>
        <span className={`w-3 text-center ${a.scheme === "–" ? "text-text-faint" : a.rhyme === "consonante" ? "text-violet" : "text-cyan"}`} title={a.rhyme ? `rima ${a.rhyme}` : "no rima"}>
          {a.scheme}
        </span>
      </div>
    </div>
  );
}
