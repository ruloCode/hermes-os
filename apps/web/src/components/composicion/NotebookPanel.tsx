"use client";

/**
 * Cuaderno: la libreta de bolsillo. Versos sueltos, frases oídas, títulos,
 * imágenes y tarareos (audio grabado en el celular — mock con onda). Todo
 * lo que todavía no es canción vive aquí; "→ canción" lo convierte en una
 * con esa frase como semilla. Es el lugar más humano de la página: no hay
 * sugerencias de nadie.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { useComposicion } from "./ComposicionContext";
import { TEXT_TONE, btnCls, fmtRelative, ghostBtnCls, inputCls } from "./labels";
import type { NotebookEntry } from "./types";

const KIND: Record<NotebookEntry["kind"], { label: string; tone: "violet" | "cyan" | "amber" | "green" | "neutral"; glyph: string }> = {
  verso: { label: "verso", tone: "violet", glyph: "❝" },
  frase: { label: "frase", tone: "cyan", glyph: "—" },
  tarareo: { label: "tarareo", tone: "amber", glyph: "♪" },
  titulo: { label: "título", tone: "green", glyph: "T" },
  imagen: { label: "imagen", tone: "neutral", glyph: "◌" },
};

export function NotebookPanel() {
  const { notebook, songs, addNote, removeNote, createSong } = useComposicion();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<NotebookEntry["kind"]>("frase");

  const submit = () => {
    if (!text.trim()) return;
    addNote(kind, text);
    setText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel-2 p-2"
      >
        <div className="flex gap-1">
          {(Object.keys(KIND) as NotebookEntry["kind"][]).filter((k) => k !== "tarareo").map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-sm px-2 py-0.5 text-2xs tracking-label uppercase ${kind === k ? "bg-violet/16 text-violet" : "text-text-dim hover:text-text"}`}>
              {KIND[k].glyph} {KIND[k].label}
            </button>
          ))}
          <span className="ml-auto text-2xs text-text-faint">tarareos: desde el móvil (grabadora) — próximo paso</span>
        </div>
        <div className="flex gap-1.5">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Lo que oíste, viste o se te ocurrió. Sin editar." className={`${inputCls} flex-1`} />
          <button type="submit" className={btnCls} disabled={!text.trim()}>Anotar</button>
        </div>
      </form>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1">
        {notebook.map((n) => {
          const k = KIND[n.kind];
          const song = n.songId ? songs.find((s) => s.id === n.songId) : null;
          return (
            <div key={n.id} className="group flex items-start gap-3 rounded-sm border border-line px-3 py-2 hover:border-line-2">
              <span className={`mt-0.5 w-4 shrink-0 text-center text-sm ${TEXT_TONE[k.tone]}`} aria-hidden>{k.glyph}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm leading-snug text-text ${n.kind === "verso" || n.kind === "frase" ? "italic" : ""}`}>{n.text}</p>
                {n.audio && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <button className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-amber/60 text-2xs text-amber" title="reproducir (mock)">▶</button>
                    <div className="flex h-5 flex-1 items-end gap-px">
                      {n.audio.peaks.map((p, i) => (
                        <span key={i} className="flex-1 rounded-xs bg-amber/60" style={{ height: `${Math.max(8, p * 100)}%` }} />
                      ))}
                    </div>
                    <span className="font-mono text-2xs text-text-dim">0:{String(n.audio.seconds).padStart(2, "0")}</span>
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-2xs text-text-faint">
                  <Badge tone={k.tone} size="sm">{k.label}</Badge>
                  <span>{fmtRelative(n.at)}</span>
                  {song && <span className="text-violet">→ {song.title}</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {!song && (
                  <button onClick={() => createSong(n.kind === "titulo" ? n.text : "", n.text, n.id)} className={btnCls} title="Convertir en canción con esta semilla">→ canción</button>
                )}
                <button onClick={() => removeNote(n.id)} className={`${ghostBtnCls} text-red`}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
