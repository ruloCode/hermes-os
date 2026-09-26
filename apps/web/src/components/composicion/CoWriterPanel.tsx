"use client";

/**
 * Copiloto de la canción (patrón Mobbin: Underlord de Descript + el hilo de
 * "cambios aplicados" de ElevenLabs Music). REGLA DE LA CASA: Hermes sugiere
 * y muestra el porqué; NUNCA escribe en la canción sin un "Usar" humano. Las
 * sugerencias son tarjetas con Usar / Variar / Descartar; los modos de arriba
 * (rimas · imágenes · acordes · referencias · pregúntame) solo cambian qué
 * tipo de ayuda pide el mensaje. En esta versión estática las respuestas son
 * datos de prueba: el composer lo dice en vez de fingir.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Toggle } from "@/components/ui/Toggle";
import { useComposicion } from "./ComposicionContext";
import { MOCK_CHAT } from "./mock";
import { btnCls, ghostBtnCls, inputCls } from "./labels";
import type { ChatTurn, Song, Suggestion } from "./types";

const MODES = [
  { id: "rimas", label: "Rimas", prompt: "Dame terminaciones que rimen con el último verso del coro, consonantes y asonantes, sin escribir el verso por mí." },
  { id: "imagenes", label: "Imágenes", prompt: "¿Qué imágenes concretas (objetos, luz, lugar) podrían reemplazar la explicación del coro?" },
  { id: "acordes", label: "Acordes", prompt: "Proponme dos caminos armónicos para el puente y explícame qué hace cada uno." },
  { id: "referencias", label: "Referencias", prompt: "Busca en internet tres canciones en español con esta tonalidad y este clima; dime qué tomar de cada una." },
  { id: "pregunta", label: "Pregúntame", prompt: "Hazme UNA pregunta que me destrabe el verso 2. No sugieras versos." },
];

const KIND_TONE = { rima: "cyan", verso: "accent", metafora: "accent", acorde: "amber", estructura: "blue", referencia: "green", pregunta: "neutral" } as const;

export function CoWriterPanel({ song, focusSectionId, onFocusHandled }: { song: Song; focusSectionId: string | null; onFocusHandled: () => void }) {
  const { patchSection, patchSong } = useComposicion();
  const [turns, setTurns] = useState<ChatTurn[]>(() => MOCK_CHAT[song.id] ?? []);
  const [text, setText] = useState("");
  const [quiet, setQuiet] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  // Cambiar de canción cambia el hilo.
  useEffect(() => {
    setTurns(MOCK_CHAT[song.id] ?? []);
    setUsed(new Set());
  }, [song.id]);

  // "✦ Hermes" desde una sección precarga la pregunta con contexto.
  useEffect(() => {
    if (!focusSectionId) return;
    const sec = song.sections.find((s) => s.id === focusSectionId);
    if (sec) setText(`Sobre ${sec.label}: ${sec.lyrics.trim() ? "¿qué le falta?" : "está vacío. Hazme preguntas, no versos."}`);
    onFocusHandled();
  }, [focusSectionId, song.sections, onFocusHandled]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns.length]);

  const pending = useMemo(() => turns.flatMap((t) => t.suggestions ?? []).filter((s) => !used.has(s.id)).length, [turns, used]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const now = new Date().toISOString();
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "tú", text: t, at: now },
      {
        id: `h-${Date.now()}`,
        role: "hermes",
        at: now,
        text: "Versión estática: aquí Hermes leería la canción completa (letra, tonalidad, acordes, referencias enlazadas) y respondería con tarjetas Usar/Variar/Descartar. Conectar el agente es el siguiente paso.",
      },
    ]);
    setText("");
  };

  const apply = (s: Suggestion, option?: string) => {
    const sec = s.sectionId ? song.sections.find((x) => x.id === s.sectionId) : null;
    if (s.kind === "acorde" && sec && s.options) {
      patchSection(song.id, sec.id, { chords: s.options });
      patchSong(song.id, (sg) => ({ versions: [...sg.versions, { id: `v-${Date.now()}`, at: new Date().toISOString(), note: `${sec.label}: ${s.title} (sugerencia usada)`, scope: "armonía" }] }));
    } else if (s.kind === "verso" && sec && option) {
      const line = option.replace(/^…/, "").trim();
      const lines = sec.lyrics.split("\n");
      const emptyIdx = lines.findIndex((l) => !l.trim());
      if (emptyIdx >= 0) lines[emptyIdx] = line;
      else lines.push(line);
      patchSection(song.id, sec.id, { lyrics: lines.join("\n") });
    }
    setUsed((prev) => new Set(prev).add(s.id));
  };

  const vary = (s: Suggestion) => {
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "tú", text: `Variar: ${s.title}`, at: new Date().toISOString() },
      { id: `h-${Date.now()}`, role: "hermes", text: "Versión estática: aquí llegaría una variante con otro ángulo (misma sección, mismo esquema).", at: new Date().toISOString() },
    ]);
  };

  const discard = (s: Suggestion) => setUsed((prev) => new Set(prev).add(s.id));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* El contrato, visible */}
      <div className="flex items-center justify-between gap-2 rounded-sm border border-line bg-panel-2 px-2 py-1.5">
        <p className="text-2xs text-text-dim">
          <span className="text-accent">Hermes sugiere, tú decides.</span> Nada entra a la canción sin <span className="text-text">Usar</span>.
        </p>
        <Toggle size="sm" checked={quiet} onChange={setQuiet} label="silencio" />
      </div>

      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setText(m.prompt)} className={ghostBtnCls}>{m.label}</button>
        ))}
        {pending > 0 && <Badge tone="accent" size="sm">{pending} por decidir</Badge>}
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
        {turns.length === 0 && (
          <div className="flex flex-col gap-2 py-4">
            <p className="text-xs text-text-dim">Sin conversación todavía. Empieza por una de estas:</p>
            {MODES.slice(0, 3).map((m) => (
              <button key={m.id} onClick={() => setText(m.prompt)} className="rounded-sm border border-line px-2 py-1.5 text-left text-2xs text-text-dim hover:border-accent hover:text-text">
                <span className="text-text">{m.label}</span> · {m.prompt}
              </button>
            ))}
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className={`flex flex-col gap-1.5 ${t.role === "tú" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[92%] rounded-sm px-2.5 py-1.5 text-xs leading-relaxed ${t.role === "tú" ? "bg-accent/12 text-text" : "border border-line text-text"}`}>
              {t.text}
            </div>
            {!quiet &&
              t.suggestions?.map((s) => {
                const done = used.has(s.id);
                return (
                  <div key={s.id} className={`w-full rounded-sm border px-2.5 py-2 ${done ? "border-line opacity-50" : "border-line-2 bg-panel-2"}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={KIND_TONE[s.kind]} size="sm">{s.kind}</Badge>
                      <span className="text-xs text-text">{s.title}</span>
                    </div>
                    <p className="text-2xs leading-relaxed text-text-dim">{s.body}</p>
                    <p className="mt-1 text-2xs text-text-faint">
                      <span className="text-text-dim">por qué:</span> {s.why}
                    </p>
                    {s.options && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {s.options.map((o, oi) => (
                          <button key={`${o}-${oi}`} disabled={done} onClick={() => apply(s, o)} className="rounded-xs border border-line px-1.5 py-0.5 font-mono text-2xs text-text hover:border-accent disabled:opacity-50" title="Usar esta opción">
                            {o}
                          </button>
                        ))}
                      </div>
                    )}
                    {!done && (
                      <div className="mt-2 flex gap-1">
                        {s.kind !== "pregunta" && s.kind !== "referencia" && !(s.kind === "verso" && s.options) && (
                          <button onClick={() => apply(s)} className={btnCls}>Usar</button>
                        )}
                        <button onClick={() => vary(s)} className={ghostBtnCls}>Variar</button>
                        <button onClick={() => discard(s)} className={ghostBtnCls}>Descartar</button>
                      </div>
                    )}
                    {done && <span className="mt-1 block text-2xs text-text-faint">decidido</span>}
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 items-end gap-1 border-t border-line pt-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Pídele a Hermes caminos, no respuestas…"
          className={`${inputCls} min-h-0 flex-1 resize-none`}
        />
        <button type="submit" className={btnCls} disabled={!text.trim()}>↑</button>
      </form>
    </div>
  );
}
