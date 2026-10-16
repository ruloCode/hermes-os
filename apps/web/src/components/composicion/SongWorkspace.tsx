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
import { Button } from "@/components/ui/Button";
import { useComposicion } from "./ComposicionContext";
import { LyricsEditor } from "./LyricsEditor";
import { KeyPicker } from "./KeyPicker";
import { ChordBuilder } from "./ChordBuilder";
import { StructureTab } from "./StructureTab";
import { REF_KINDS, STAGES, STAGE_ORDER, TEXT_TONE, fmtRelative, ghostBtnCls, inputCls } from "./labels";
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
  /** v5: el ← vive en la cabecera de la vista (ViewHeader); opcional aquí. */
  onBack?: () => void;
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
      <header className="flex shrink-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {onBack && (
            <Button variant="ghost" onClick={onBack} title="Volver a la lista (Esc)">
              Canciones
            </Button>
          )}
          <input
            value={song.title}
            onChange={(e) => patchSong(song.id, { title: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-text focus:outline-none"
            aria-label="Título"
          />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={() => setNotation(notation === "en" ? "latin" : "en")}
              title="Cómo se escriben las notas"
            >
              {notation === "en" ? "C D E" : "Do Re Mi"}
            </Button>
            <Button
              variant="ghost"
              onClick={onToggleChat}
              aria-pressed={chatOpen}
              title={chatOpen ? "Ocultar el copiloto" : "Mostrar el copiloto"}
              className={chatOpen ? "bg-selected text-text" : ""}
            >
              Copiloto
            </Button>
          </div>
        </div>
        <input
          value={song.seed}
          onChange={(e) => patchSong(song.id, { seed: e.target.value })}
          placeholder="La frase-semilla"
          aria-label="Frase-semilla"
          className="bg-transparent text-sm text-text-dim italic placeholder:text-text-faint focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Stepper de etapas: clic = mover (decisión humana, sin criterios
              automáticos). La actual va en gris "seleccionado", no en acento. */}
          <ol className="flex items-center gap-1" aria-label="Etapa de la canción">
            {STAGE_ORDER.map((st, i) => {
              const s = STAGES[st];
              const state = i < stageIdx ? "past" : i === stageIdx ? "now" : "next";
              return (
                <li key={st} className="flex items-center gap-1">
                  <button
                    onClick={() => setStage(song.id, st)}
                    title={s.hint}
                    aria-current={state === "now" ? "step" : undefined}
                    className={`flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2 text-xs transition-colors ${
                      state === "now"
                        ? "bg-selected font-medium text-text"
                        : state === "past"
                          ? "text-text-dim hover:bg-hover hover:text-text"
                          : "text-text-faint hover:bg-hover hover:text-text"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        state === "next" ? "border border-line-2" : state === "now" ? "bg-text" : "bg-text-faint"
                      }`}
                    />
                    <span className={state === "now" ? "" : "max-xl:hidden"}>{s.label}</span>
                  </button>
                  {i < STAGE_ORDER.length - 1 && <span aria-hidden className="h-px w-2 bg-line-2" />}
                </li>
              );
            })}
          </ol>
          {/* Datos musicales: atajos a su tab. Sans con cifras tabulares (el
              mono es para acordes y código, no para "90 bpm"). */}
          <div className="flex items-center gap-1.5 text-xs text-text-faint tabular-nums">
            <button
              onClick={() => setTab("tonalidad")}
              className="cursor-pointer text-text-dim hover:text-text"
            >
              {keyLabel(song.key, notation)}
            </button>
            <span aria-hidden>·</span>
            <button onClick={() => setTab("acordes")} className="cursor-pointer hover:text-text">
              {song.tempo} bpm
            </button>
            <span aria-hidden>·</span>
            <button onClick={() => setTab("estructura")} className="cursor-pointer hover:text-text">
              {song.meter}
            </button>
            <span aria-hidden>·</span>
            <span>{fmtRelative(song.updatedAt)}</span>
          </div>
        </div>
      </header>

      <TabBar
        size="md"
        tabs={TABS.map((t) => ({
          id: t.id,
          label: t.label,
          badge: t.id === "referencias" ? linked.length || undefined : undefined,
        }))}
        active={tab}
        onChange={(id) => setTab(id as Tab)}
      />

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
              <span className="text-xs font-medium text-text-dim">Enlazadas a esta canción · {linked.length}</span>
              {linked.length === 0 && <p className="text-xs text-text-faint">Ninguna. Una referencia enlazada le da contexto real a Hermes cuando le pides caminos.</p>}
              {linked.map((r) => (
                <RefRow key={r.id} r={r} action={{ label: "quitar", run: () => linkRef(song.id, r.id, false) }} />
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-dim">Del tablero · {others.length}</span>
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
