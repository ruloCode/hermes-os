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
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { useComposicion } from "./ComposicionContext";
import { fieldCls, fmtRelative } from "./labels";
import type { NotebookEntry } from "./types";

// v5: sin glifos de adorno ni un color por tipo — el tipo es una etiqueta gris.
const KIND: Record<NotebookEntry["kind"], { label: string }> = {
  verso: { label: "verso" },
  frase: { label: "frase" },
  tarareo: { label: "tarareo" },
  titulo: { label: "título" },
  imagen: { label: "imagen" },
};

/** "verso" → "Verso" para los controles (el dato sigue en minúscula). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
        className="flex shrink-0 flex-col gap-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            ariaLabel="Tipo de nota"
            value={kind}
            onChange={setKind}
            options={(Object.keys(KIND) as NotebookEntry["kind"][])
              .filter((k) => k !== "tarareo")
              .map((k) => ({ value: k, label: cap(KIND[k].label) }))}
          />
          <span className="ml-auto text-xs text-text-faint">
            Tarareos: desde el móvil (grabadora) — próximo paso
          </span>
        </div>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Lo que oíste, viste o se te ocurrió. Sin editar."
            aria-label="Nota"
            className={`${fieldCls} min-w-0 flex-1`}
          />
          <Button type="submit" size="md" disabled={!text.trim()}>
            Anotar
          </Button>
        </div>
      </form>

      {/* Lista: filas con hairline, sin una caja por nota. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pr-1">
        {notebook.map((n) => {
          const k = KIND[n.kind];
          const song = n.songId ? songs.find((s) => s.id === n.songId) : null;
          return (
            <div
              key={n.id}
              className="group flex items-start gap-3 rounded-sm border-b border-line px-2 py-2.5 transition-colors last:border-b-0 hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <p className={`text-sm leading-snug text-text ${n.kind === "verso" || n.kind === "frase" ? "italic" : ""}`}>{n.text}</p>
                {n.audio && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full border border-line-2 text-text-dim"
                      title="Reproducir (de prueba)"
                      aria-label="Reproducir (de prueba)"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M7 4v16l13-8z" />
                      </svg>
                    </button>
                    <div className="flex h-5 flex-1 items-end gap-px">
                      {n.audio.peaks.map((p, i) => (
                        <span key={i} className="flex-1 rounded-xs bg-text-faint/50" style={{ height: `${Math.max(8, p * 100)}%` }} />
                      ))}
                    </div>
                    <span className="text-xs text-text-faint tabular-nums">0:{String(n.audio.seconds).padStart(2, "0")}</span>
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-text-faint">
                  <Badge size="sm">{k.label}</Badge>
                  <span>{fmtRelative(n.at)}</span>
                  {song && <span className="text-text-dim">en «{song.title}»</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {!song && (
                  <Button
                    onClick={() => createSong(n.kind === "titulo" ? n.text : "", n.text, n.id)}
                    title="Convertir en canción con esta semilla"
                  >
                    Convertir en canción
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="hover:text-red"
                  onClick={() => removeNote(n.id)}
                  title="Borrar la nota"
                  aria-label="Borrar la nota"
                >
                  Borrar
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
