"use client";

/**
 * Workspace de UNA canción (takeover): cabecera con título, semilla, etapa
 * (stepper clickeable), tonalidad·tempo·compás y notación; abajo, tabs de
 * una cosa a la vez: Letra · Tonalidad · Acordes · Estructura · Referencias
 * · Historial. El copiloto vive fuera, como panel derecho.
 */
import { useState } from "react";
import { keyLabel } from "@/lib/music-theory";
import { TabBar } from "@/components/ui/TabBar";
import { Badge } from "@/components/ui/Badge";
import { useComposicion } from "./ComposicionContext";
import { LyricsEditor } from "./LyricsEditor";
import { KeyPicker } from "./KeyPicker";
import { ChordBuilder } from "./ChordBuilder";
import { StructureTab } from "./StructureTab";
import { REF_KINDS, STAGES, STAGE_ORDER, TEXT_TONE, btnCls, fmtRelative, ghostBtnCls, inputCls } from "./labels";
import type { Song } from "./types";

type Tab = "letra" | "tonalidad" | "acordes" | "estructura" | "referencias" | "historial";

const TABS: { id: Tab; label: string }[] = [
  { id: "letra", label: "Letra" },
  { id: "tonalidad", label: "Tonalidad" },
  { id: "acordes", label: "Acordes" },
  { id: "estructura", label: "Estructura" },
  { id: "referencias", label: "Referencias" },
  { id: "historial", label: "Historial" },
];

export function SongWorkspace({
  song,
  onBack,
  chatOpen,
  onToggleChat,
  onAskHermes,
}: {
  song: Song;
  onBack: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onAskHermes: (sectionId: string) => void;
}) {
  const { patchSong, setStage, notation, setNotation, refs, linkRef } = useComposicion();
  const [tab, setTab] = useState<Tab>("letra");
  const stageIdx = STAGE_ORDER.indexOf(song.stage);
  const linked = refs.filter((r) => song.refIds.includes(r.id));
  const others = refs.filter((r) => !song.refIds.includes(r.id));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onBack} className={ghostBtnCls} title="Volver a la lista (Esc)">← Canciones</button>
          <input
            value={song.title}
            onChange={(e) => patchSong(song.id, { title: e.target.value })}
            className="min-w-0 flex-1 bg-transparent font-display text-xl tracking-title text-text uppercase focus:outline-none"
            aria-label="Título"
          />
          <div className="flex items-center gap-1">
            <button onClick={() => setNotation(notation === "en" ? "latin" : "en")} className={ghostBtnCls} title="Cómo se escriben las notas">
              {notation === "en" ? "C D E" : "Do Re Mi"}
            </button>
            <button onClick={onToggleChat} className={`${btnCls} ${chatOpen ? "border-accent text-accent" : ""}`}>✦ Hermes</button>
          </div>
        </div>
        <input
          value={song.seed}
          onChange={(e) => patchSong(song.id, { seed: e.target.value })}
          placeholder="La frase-semilla"
          className="bg-transparent text-xs text-text-dim italic placeholder:text-text-faint focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Stepper de etapas: clic = mover (decisión humana, sin criterios automáticos) */}
          <ol className="flex items-center gap-1">
            {STAGE_ORDER.map((st, i) => {
              const s = STAGES[st];
              const state = i < stageIdx ? "past" : i === stageIdx ? "now" : "next";
              return (
                <li key={st} className="flex items-center gap-1">
                  <button
                    onClick={() => setStage(song.id, st)}
                    title={s.hint}
                    className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs tracking-label uppercase ${
                      state === "now" ? "bg-accent/16 text-accent" : state === "past" ? "text-text-dim" : "text-text-faint hover:text-text-dim"
                    }`}
                  >
                    <span aria-hidden>{state === "past" ? "✓" : state === "now" ? "●" : "○"}</span>
                    <span className={state === "now" ? "" : "max-xl:hidden"}>{s.label}</span>
                  </button>
                  {i < STAGE_ORDER.length - 1 && <span aria-hidden className="h-px w-2 bg-line" />}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center gap-2 font-mono text-2xs text-text-dim">
            <button onClick={() => setTab("tonalidad")} className="text-text hover:text-accent">{keyLabel(song.key, notation)}</button>
            <span>·</span>
            <button onClick={() => setTab("acordes")} className="hover:text-text">{song.tempo} bpm</button>
            <span>·</span>
            <button onClick={() => setTab("estructura")} className="hover:text-text">{song.meter}</button>
            <span className="text-text-faint">· {fmtRelative(song.updatedAt)}</span>
          </div>
        </div>
      </header>

      <TabBar tabs={TABS.map((t) => ({ id: t.id, label: t.label, badge: t.id === "referencias" ? linked.length || undefined : undefined }))} active={tab} onChange={(id) => setTab(id as Tab)} />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {tab === "letra" && <LyricsEditor song={song} onAskHermes={onAskHermes} />}
        {tab === "tonalidad" && (
          <div className="mx-auto max-w-xl">
            <KeyPicker song={song} />
          </div>
        )}
        {tab === "acordes" && <ChordBuilder song={song} />}
        {tab === "estructura" && <StructureTab song={song} />}
        {tab === "referencias" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs tracking-label text-text-dim uppercase">Enlazadas a esta canción · {linked.length}</span>
              {linked.length === 0 && <p className="text-xs text-text-faint">Ninguna. Una referencia enlazada le da contexto real a Hermes cuando le pides caminos.</p>}
              {linked.map((r) => (
                <RefRow key={r.id} r={r} action={{ label: "quitar", run: () => linkRef(song.id, r.id, false) }} />
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs tracking-label text-text-dim uppercase">Del tablero · {others.length}</span>
              {others.map((r) => (
                <RefRow key={r.id} r={r} action={{ label: "enlazar", run: () => linkRef(song.id, r.id, true) }} />
              ))}
            </div>
          </div>
        )}
        {tab === "historial" && (
          <ol className="flex flex-col gap-1">
            {[...song.versions].reverse().map((v) => (
              <li key={v.id} className="flex items-center gap-3 rounded-sm border border-line px-2 py-1.5">
                <span className="w-16 shrink-0 font-mono text-2xs text-text-faint">{fmtRelative(v.at)}</span>
                <Badge tone={v.scope === "letra" ? "accent" : v.scope === "armonía" ? "amber" : v.scope === "tonalidad" ? "cyan" : "blue"} size="sm">{v.scope}</Badge>
                <span className="text-xs text-text">{v.note}</span>
              </li>
            ))}
            <li className="mt-2 text-2xs text-text-faint">Cada cambio real deja rastro. Cuando esto conecte al agente, el historial guardará el texto de cada versión para volver atrás.</li>
          </ol>
        )}
      </div>

      {tab === "letra" && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line pt-2">
          <input
            value={song.mood.join(", ")}
            onChange={(e) => patchSong(song.id, { mood: e.target.value.split(",").map((m) => m.trim()).filter(Boolean) })}
            placeholder="clima: íntima, nostálgica, de madrugada…"
            className={`${inputCls} flex-1`}
          />
        </div>
      )}
    </div>
  );
}

function RefRow({ r, action }: { r: { id: string; kind: keyof typeof REF_KINDS; title: string; by?: string; takeaway: string }; action: { label: string; run: () => void } }) {
  const k = REF_KINDS[r.kind];
  return (
    <div className="flex items-start gap-2 rounded-sm border border-line px-2 py-1.5">
      <span className={`mt-0.5 w-4 shrink-0 text-center text-xs ${TEXT_TONE[k.tone]}`} aria-hidden>{k.glyph}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-text">
          {r.title} {r.by && <span className="text-text-faint">· {r.by}</span>}
        </p>
        <p className="line-clamp-2 text-2xs text-text-dim">{r.takeaway}</p>
      </div>
      <button onClick={action.run} className={ghostBtnCls}>{action.label}</button>
    </div>
  );
}
