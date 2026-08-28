"use client";

/**
 * Versiones de una PARTE del guion (el hook o un bloque): el pool `variants`
 * de la pieza filtrado por parte, con generación por Hermes (✦, ángulos
 * distintos), alta manual y "Usar" — que reescribe el texto REAL (hook o el
 * bloque dentro de script_md vía replaceBeatText). La activa es la que
 * coincide con lo que hoy dice el guion, no un flag aparte.
 *
 * Patrón Mobbin (Gamma/Bard "modify this response"): lista compacta de
 * apuestas etiquetadas por ángulo, elegir una es un clic.
 */
import { useState } from "react";
import type { ContentPiece, ContentVariant } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { replaceBeatText, type ScriptBeat } from "@/lib/script-beats";

const uid = () => Math.random().toString(36).slice(2, 9);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function BeatVariants({
  piece,
  beat,
  /** Con el editor sucio no se aplica nada: guarda primero (⌘S). */
  dirty,
}: {
  piece: ContentPiece;
  beat: ScriptBeat;
  dirty?: boolean;
}) {
  const { generateVariants, patchPiece } = useEstudioContext();
  const partKey = beat.kind === "hook" ? "hook" : beat.label;
  const list = piece.variants.filter((v) => v.part === partKey);
  // El hook es LA decisión del video: sus versiones se muestran abiertas.
  const [open, setOpen] = useState(beat.kind === "hook" && list.length > 0);
  const [generating, setGenerating] = useState(false);
  const [manual, setManual] = useState("");

  const current = norm(beat.say.join(" "));

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    const updated = await generateVariants(piece.id, partKey, beat.say.join(" ") || undefined);
    if (updated) setOpen(true);
    setGenerating(false);
  };

  const apply = async (v: ContentVariant) => {
    if (dirty) return;
    if (beat.kind === "hook") {
      await patchPiece(piece.id, { hook: v.text });
    } else {
      const md = replaceBeatText(piece.script_md, beat, v.text);
      if (md != null) await patchPiece(piece.id, { script_md: md });
    }
  };

  const addManual = async () => {
    const text = manual.trim();
    if (!text) return;
    await patchPiece(piece.id, {
      variants: [
        ...piece.variants,
        {
          id: uid(),
          part: partKey,
          text,
          angle: null,
          source: "manual",
          created_at: new Date().toISOString(),
        },
      ],
    });
    setManual("");
  };

  const remove = (id: string) =>
    void patchPiece(piece.id, { variants: piece.variants.filter((v) => v.id !== id) });

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className={`text-2xs tracking-label uppercase ${
            open || list.length ? "text-violet" : "text-text-faint hover:text-text-dim"
          }`}
        >
          {open ? "▴" : "▾"} Versiones{list.length ? ` · ${list.length}` : ""}
        </button>
        <button
          onClick={() => void generate()}
          disabled={generating}
          title="Hermes genera 3-5 versiones con ángulos distintos (se agregan, nada se pisa)"
          className="text-2xs tracking-label text-text-faint uppercase hover:text-violet disabled:opacity-50"
        >
          {generating ? "◌ generando…" : "✦ generar"}
        </button>
        {dirty && open && (
          <span className="text-2xs text-amber">guarda el guion (⌘S) para poder aplicar</span>
        )}
      </div>

      {open && (
        <div className="mt-1 flex flex-col gap-1">
          {list.map((v) => {
            const active = norm(v.text) === current && current !== "";
            return (
              <div
                key={v.id}
                className={`group flex items-start gap-2 rounded-sm border px-2 py-1.5 ${
                  active ? "border-green/40 bg-green/6" : "border-line bg-panel-2/30"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {v.angle && (
                      <span className="text-2xs tracking-label text-cyan uppercase">{v.angle}</span>
                    )}
                    <span className="text-2xs text-text-faint uppercase">
                      {v.source === "manual" ? "tuya" : "hermes"}
                    </span>
                    {active && <span className="text-2xs text-green uppercase">✓ activa</span>}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-text">{v.text}</p>
                </div>
                {!active && (
                  <button
                    onClick={() => void apply(v)}
                    disabled={dirty}
                    title={dirty ? "Guarda el guion primero (⌘S)" : "Reescribir el guion con esta versión"}
                    className="shrink-0 rounded-xs border border-line-2 px-1.5 py-0.5 text-2xs tracking-label text-text-dim uppercase hover:border-violet hover:text-violet disabled:opacity-35"
                  >
                    Usar
                  </button>
                )}
                <button
                  onClick={() => remove(v.id)}
                  aria-label="Borrar versión"
                  className="shrink-0 text-2xs text-text-faint opacity-0 group-hover:opacity-100 hover:text-red"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {!list.length && (
            <p className="text-2xs text-text-faint">
              Sin versiones todavía — genera con ✦ o escribe la tuya abajo.
            </p>
          )}
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addManual()}
            placeholder="+ escribe tu versión (Enter guarda al pool)"
            className="rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-violet focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
