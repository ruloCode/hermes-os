"use client";

/**
 * Workspace de la pieza seleccionada: etapa (qué significa, qué falta para
 * avanzar y cuánto lleva ahí), guion editable (con preview markdown), tomas,
 * puntos de edición (kit Divisual) y variantes de publicación por plataforma.
 * Todo persiste vía PATCH /content/pieces/:id con merge optimista.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STAGES } from "@hermes/shared";
import type {
  ClipBrowse,
  ContentEditPoint,
  ContentPiece,
  ContentPillar,
  ContentStatus,
  ContentTake,
  PieceMedia,
} from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Badge } from "@/components/ui/Badge";
import { Markdown } from "@/components/Markdown";
import { usePieceMedia } from "@/hooks/usePieceMedia";
import { pieceBeats, takeForBeat, withBeatVerdict } from "@/lib/script-beats";
import {
  beatSeconds,
  captureFormat,
  fmtSeconds,
  latestVoTakes,
  takeStem,
  voTakesFor,
} from "@/lib/capture";
import { VoiceTab } from "./VoiceTab";
import { ScriptBoard } from "./ScriptChecklist";
import { PieceProgress } from "./PieceProgress";
import {
  PILLARS,
  PLATFORMS,
  STATUSES,
  STATUS_ORDER,
  fmtDays,
  fmtPublish,
  isoToLocal,
} from "./labels";
import { btnCls, inputCls, selectCls } from "./styles";
import { PublicacionTab } from "./PublishTab";

type Tab = "guion" | "tomas" | "voz" | "edicion" | "publicacion";

const uid = () => Math.random().toString(36).slice(2, 9);


export function PieceWorkspace({
  onBack,
  chatOpen,
  onToggleChat,
}: {
  /** Vuelve a la lista (takeover). */
  onBack?: () => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
}) {
  const { selected, patchPiece, linkLinear } = useEstudioContext();
  const [tab, setTab] = useState<Tab>("guion");
  if (!selected)
    return (
      <p className="px-3 py-6 text-xs text-text-faint">
        Selecciona una pieza del pipeline (o crea una idea) para trabajarla aquí.
      </p>
    );
  return (
    /* h-full por la misma razón que PieceChat: el body del Panel no es flex —
       sin altura definida el tab no scrollea internamente y el contenido
       sangra por debajo del panel. */
    <div className="flex h-full min-h-0 flex-col">
      <PieceHeader
        piece={selected}
        onPatch={patchPiece}
        onLinear={linkLinear}
        onBack={onBack}
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
      />
      {/* TODO el progreso en un módulo: % hasta publicar + stepper + qué falta. */}
      <div className="px-1">
        <PieceProgress piece={selected} onGo={setTab} />
      </div>
      {/* Tabs */}
      <div className="mt-2 flex gap-1 border-b border-line px-1">
        {(
          [
            ["guion", "Guion"],
            ["tomas", `Tomas · ${selected.takes.length}`],
            ["voz", "Voz"],
            ["edicion", `Edición · ${selected.edit_points.length}`],
            ["publicacion", `Publicación · ${selected.publications.length}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-2xs tracking-label uppercase ${
              tab === id
                ? "border-violet text-violet"
                : "border-transparent text-text-faint hover:text-text-dim"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2">
        {tab === "guion" && <GuionTab key={selected.id} piece={selected} onPatch={patchPiece} />}
        {tab === "tomas" && <TomasTab piece={selected} onPatch={patchPiece} />}
        {tab === "voz" && <VoiceTab key={selected.id} piece={selected} />}
        {tab === "edicion" && <EdicionTab piece={selected} onPatch={patchPiece} />}
        {tab === "publicacion" && <PublicacionTab piece={selected} onPatch={patchPiece} />}
      </div>
    </div>
  );
}

type PatchFn = ReturnType<typeof useEstudioContext>["patchPiece"];

function PieceHeader({
  piece,
  onPatch,
  onLinear,
  onBack,
  chatOpen,
  onToggleChat,
}: {
  piece: ContentPiece;
  onPatch: PatchFn;
  onLinear: (id: number) => Promise<ContentPiece | null>;
  onBack?: () => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
}) {
  const { setRecording } = useEstudioContext();
  const [linking, setLinking] = useState(false);
  const [props, setProps] = useState(false);
  // Grabar es la acción de la pieza, no de un tab: vive junto al título y se
  // enciende cuando la etapa es `grabacion` (lo que TOCA hacer con esta pieza).
  const canRecord = pieceBeats(piece).length > 0;
  const recording = piece.status === "grabacion";
  return (
    <div className="px-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {onBack && (
          <button
            onClick={onBack}
            title="Volver a la lista (Esc)"
            className="mt-0.5 shrink-0 text-2xs tracking-label text-text-faint uppercase hover:text-text"
          >
            ← Piezas
          </button>
        )}
        <h3 className="min-w-0 flex-1 font-display text-sm leading-snug text-text">{piece.title}</h3>
        <div className="flex shrink-0 items-center gap-2">
          {canRecord && (
            <button
              onClick={() => setRecording(piece.id)}
              title="Teleprompter a pantalla completa: solo tus frases + el detalle de cada toma"
              className={`${btnCls} ${recording ? "border-red text-red" : "border-line-2 text-text-dim hover:text-text"}`}
            >
              ● Grabar
            </button>
          )}
          {piece.linear_url ? (
            <a
              href={piece.linear_url}
              target="_blank"
              rel="noreferrer"
              className="text-2xs tracking-label text-cyan uppercase hover:underline"
            >
              {piece.linear_identifier} ↗
            </a>
          ) : (
            <button
              className={btnCls}
              disabled={linking}
              onClick={async () => {
                setLinking(true);
                await onLinear(piece.id);
                setLinking(false);
              }}
            >
              {linking ? "creando…" : "◫ Crear en Linear"}
            </button>
          )}
          {onToggleChat && (
            <button
              onClick={onToggleChat}
              title={chatOpen ? "Ocultar el chat de la pieza" : "Mostrar el chat de la pieza"}
              className={`${btnCls} ${chatOpen ? "border-cyan text-cyan" : ""}`}
            >
              ✳ Chat
            </button>
          )}
        </div>
      </div>
      {/* Propiedades: se configuran una vez y estorban siempre — van plegadas
          (patrón CMS de Framer: los campos no compiten con el contenido). */}
      <button
        onClick={() => setProps(!props)}
        className="mt-1.5 flex items-center gap-2 text-2xs tracking-label text-text-faint uppercase hover:text-text-dim"
      >
        <span>{props ? "▴" : "▾"} Propiedades</span>
        {!props && (
          <span className="text-text-dim normal-case">
            {PILLARS[piece.pillar].short} · {piece.platforms.join("+") || piece.format} ·{" "}
            {fmtPublish(piece.publish_at)}
          </span>
        )}
      </button>
      <div className={`mt-1.5 flex-wrap items-center gap-2 ${props ? "flex" : "hidden"}`}>
        <select
          value={piece.pillar}
          onChange={(e) => void onPatch(piece.id, { pillar: e.target.value as ContentPillar })}
          className={selectCls}
          aria-label="Pilar"
        >
          {(Object.keys(PILLARS) as ContentPillar[]).map((p) => (
            <option key={p} value={p}>
              {PILLARS[p].short} · {PILLARS[p].label}
            </option>
          ))}
        </select>
        <select
          value={piece.format}
          onChange={(e) =>
            void onPatch(piece.id, { format: e.target.value as ContentPiece["format"] })
          }
          className={selectCls}
          aria-label="Formato"
        >
          {["pilar", "vertical", "post", "carrusel", "otro"].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={isoToLocal(piece.publish_at)}
          onChange={(e) =>
            void onPatch(piece.id, {
              publish_at: e.target.value ? new Date(e.target.value).toISOString() : null,
            })
          }
          className={`${inputCls} tabular-nums`}
          aria-label="Fecha de publicación"
        />
        {/* Plataformas como toggles */}
        <div className="flex gap-1">
          {PLATFORMS.map((pl) => {
            const on = piece.platforms.includes(pl);
            return (
              <button
                key={pl}
                onClick={() =>
                  void onPatch(piece.id, {
                    platforms: on
                      ? piece.platforms.filter((x) => x !== pl)
                      : [...piece.platforms, pl],
                  })
                }
                className={`rounded-xs px-1.5 py-0.5 text-2xs tracking-label uppercase ${on ? "bg-cyan/16 text-cyan" : "text-text-faint hover:text-text-dim"}`}
              >
                {pl}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Guion ──────────────────────────────────────────────────────────────

/** Guion: bloques listos para grabar · markdown crudo · render final. */
type GuionMode = "guion" | "editar" | "vista";

function GuionTab({ piece, onPatch }: { piece: ContentPiece; onPatch: PatchFn }) {
  const { generateKit, setRecording } = useEstudioContext();
  const [hook, setHook] = useState(piece.hook ?? "");
  const [script, setScript] = useState(piece.script_md ?? "");
  // Con guion escrito, lo primero que se ve son los BLOQUES (qué digo y qué se
  // ve en cada uno); el markdown crudo solo cuando hay que escribirlo.
  const [mode, setMode] = useState<GuionMode>(piece.script_md?.trim() ? "guion" : "editar");
  const preview = mode === "vista";
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genDesc, setGenDesc] = useState(piece.notes ?? "");
  const [generating, setGenerating] = useState(false);
  // Modo escritura: el guion a pantalla completa, sin pipeline ni riel.
  const [full, setFull] = useState(false);
  const [mounted, setMounted] = useState(false);
  const hookRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => setMounted(true), []);

  // `dirty` = TÚ editaste desde lo último adoptado — no que la pieza cambió
  // por fuera (chat, variantes, ✦ generar). Comparar contra la pieza en vivo
  // marcaba sucio cualquier cambio del server y bloqueaba la adopción.
  const adopted = useRef({ hook: piece.hook ?? "", script: piece.script_md ?? "" });
  const dirty = hook !== adopted.current.hook || script !== adopted.current.script;
  const words = useMemo(() => (script.trim() ? script.trim().split(/\s+/).length : 0), [script]);

  const adopt = (h: string | null, s: string | null) => {
    adopted.current = { hook: h ?? "", script: s ?? "" };
    setHook(h ?? "");
    setScript(s ?? "");
  };

  // La pieza puede cambiar POR FUERA del editor: sin edición local pendiente,
  // el editor adopta lo nuevo; con edición pendiente, lo tuyo manda hasta ⌘S.
  useEffect(() => {
    if (!dirty) adopt(piece.hook, piece.script_md);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece.hook, piece.script_md]);

  const save = async () => {
    if (!dirty) return;
    const saved = await onPatch(piece.id, { hook: hook || null, script_md: script || null });
    if (saved) {
      adopt(saved.hook, saved.script_md);
      setSavedAt(Date.now());
    }
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    const updated = await generateKit(piece.id, genDesc.trim() || undefined);
    if (updated) {
      // El editor local se sincroniza con lo generado (mismo id → sin remount).
      adopt(updated.hook, updated.script_md);
      setGenOpen(false);
    }
    setGenerating(false);
  };

  // ⌘S guarda sin pelear con el navegador.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hook, script, dirty]);

  // Esc sale del modo escritura (patrón Substack/Read.cv).
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const saveState = dirty ? "Sin guardar" : savedAt ? "Guardado ✓" : "Al día";
  const minutes = Math.max(1, Math.round(words / 140));

  return (
    <div className="flex flex-col gap-2">
      {/* Una sola barra: qué cara del guion miras + las acciones que aplican a
          esa cara (Substack/Medium: el chrome se hace a un lado del texto). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-0.5 rounded-sm border border-line p-0.5">
          {(
            [
              ["guion", "Bloques"],
              ["editar", "Editar"],
              ["vista", "Vista"],
            ] as [GuionMode, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`rounded-xs px-2.5 py-0.5 text-2xs tracking-label uppercase ${
                mode === id ? "bg-violet/16 text-violet" : "text-text-faint hover:text-text-dim"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-text-faint tabular-nums">
            {words} palabras · ~{minutes} min
          </span>
          {mode === "editar" && (
            <button
              onClick={() => setFull(true)}
              className={`${btnCls} border-violet text-violet`}
              title="Escribir a pantalla completa (Esc para salir)"
            >
              ⛶ Escribir
            </button>
          )}
          <button
            onClick={() => setGenOpen(!genOpen)}
            className={btnCls}
            disabled={generating}
            title="Generar guion + tomas + edición + copies con Hermes"
          >
            {generating ? "◌ generando…" : genOpen ? "Cerrar" : "✦ Generar"}
          </button>
          <button
            onClick={() => void save()}
            disabled={!dirty}
            className={`${btnCls} ${dirty ? "border-violet text-violet" : "opacity-40"}`}
          >
            {dirty ? "Guardar ⌘S" : saveState}
          </button>
        </div>
      </div>

      {genOpen && (
        <div className="flex flex-col gap-1.5 rounded-sm border border-violet/40 bg-violet/5 px-2 py-1.5">
          <textarea
            value={genDesc}
            onChange={(e) => setGenDesc(e.target.value)}
            placeholder="Describe la pieza: qué quieres mostrar, ángulo, qué demo entra… (opcional — mientras más contexto, mejor kit)"
            className={`${inputCls} min-h-[56px] resize-y`}
            disabled={generating}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs text-text-faint">
              Guion + hook + tomas + edición + copies. Tu material real nunca se pisa.
            </span>
            <button
              onClick={() => void generate()}
              disabled={generating}
              className={`${btnCls} shrink-0 ${generating ? "opacity-60" : "border-violet text-violet"}`}
            >
              {generating ? "◌ Generando… ~30-60s" : "✦ Generar kit completo"}
            </button>
          </div>
        </div>
      )}

      {/* En Bloques el hook ya encabeza el checklist: repetir el campo aquí
          duplicaba la misma frase dos veces seguidas. Se edita con un clic. */}
      {mode !== "guion" && (
        <input
          ref={hookRef}
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          placeholder="Hook — el primer segundo del video…"
          className={inputCls}
        />
      )}
      {mode === "guion" ? (
        <ScriptBoard
          piece={piece}
          dirty={dirty}
          onRecord={(i) => setRecording(piece.id, i)}
          onMark={(beat, verdict) =>
            void onPatch(piece.id, { takes: withBeatVerdict(piece, beat, verdict) })
          }
          onEditHook={() => {
            setMode("editar");
            setTimeout(() => hookRef.current?.focus(), 0);
          }}
        />
      ) : preview ? (
        <div className="min-h-[280px] rounded-sm border border-line bg-panel-2/40 px-3 py-2">
          <Markdown source={script || "_(guion vacío)_"} project="rulocodeshow" />
        </div>
      ) : (
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={
            "[0-3s] **[DEMO: qué se ve en pantalla]**\n«La frase exacta que dices a cámara.»\n\n[3-12s] (cara a cámara)\n«…»\n\n**Notas de grabación:** luz, encuadre, repeticiones."
          }
          spellCheck={false}
          className={`${inputCls} min-h-[320px] flex-1 resize-y font-mono text-xs leading-relaxed`}
        />
      )}

      {/* Modo escritura: el guion ocupa la pantalla, sin pipeline ni riel.
          Columna de medida legible, chrome mínimo arriba y las métricas de
          lectura como dato ambiente abajo (patrón Substack). */}
      {full &&
        mounted &&
        createPortal(
          <div data-estudio-takeover className="fixed inset-0 z-[70] flex flex-col bg-bg">
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={() => setFull(false)}
                  className="shrink-0 text-2xs tracking-label text-text-faint uppercase hover:text-text"
                >
                  ← Salir
                </button>
                <span className="min-w-0 truncate text-xs text-text-dim">{piece.title}</span>
                <span className="shrink-0 text-2xs tracking-label text-violet uppercase">
                  {STAGES[piece.status].label}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`text-2xs tracking-label uppercase ${dirty ? "text-amber" : "text-text-faint"}`}
                >
                  {saveState}
                </span>
                <button onClick={() => setMode(preview ? "editar" : "vista")} className={btnCls}>
                  {preview ? "Editar" : "Vista previa"}
                </button>
                <button
                  onClick={() => void save()}
                  disabled={!dirty}
                  className={`${btnCls} ${dirty ? "border-violet text-violet" : "opacity-40"}`}
                >
                  Guardar ⌘S
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
              {/* hud-field: en modo escritura la página ENTERA es el campo —
                  el anillo de foco por campo sobra (convención de globals.css). */}
              <div className="hud-field mx-auto flex w-full max-w-[76ch] flex-col gap-4">
                <input
                  value={hook}
                  onChange={(e) => setHook(e.target.value)}
                  placeholder="Hook — el primer segundo del video…"
                  className="w-full border-none bg-transparent font-display text-lg leading-snug text-text placeholder:text-text-faint focus:outline-none"
                />
                {preview ? (
                  <Markdown source={script || "_(guion vacío)_"} project="rulocodeshow" />
                ) : (
                  <textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    autoFocus
                    placeholder={"## Hook (0:00–0:15)\n…\n\n## Contexto\n…\n\n## Demos\n…\n\n## CTA\n…"}
                    spellCheck={false}
                    className="min-h-[70vh] w-full resize-none border-none bg-transparent font-mono text-sm leading-loose text-text placeholder:text-text-faint focus:outline-none"
                  />
                )}
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-1.5">
              <span className="text-2xs text-text-faint tabular-nums">
                {words} palabras · ~{minutes} min hablado · {script.split("\n").length} líneas
              </span>
              <span className="text-2xs text-text-faint">Esc para salir · ⌘S para guardar</span>
            </footer>
          </div>,
          document.body,
        )}
      {piece.vault_path && (
        <p className="text-2xs text-text-faint">
          Espejo en el vault: <span className="text-text-dim">{piece.vault_path}</span> (se
          actualiza al guardar)
        </p>
      )}
    </div>
  );
}

// ── Tomas: checklist de captura contra el disco extraíble ──────────────

const VERDICTS: ContentTake["verdict"][] = ["buena", "revisar", "descartada"];
const VERDICT_TONE = { buena: "green", revisar: "amber", descartada: "neutral" } as const;

/**
 * Con guion, el tab Tomas es el PLAN DE CAPTURA (patrones Mobbin Frame.io/
 * Asana): una fila por bloque con el nombre de archivo esperado (copiable),
 * formato y duración estimada; el check lo marca el DISCO — si el archivo
 * con ese nombre existe en crudos/, la toma está grabada (con su duración
 * real de ffprobe). Sin guion, cae a la lista manual de siempre.
 */
function TomasTab({ piece, onPatch }: { piece: ContentPiece; onPatch: PatchFn }) {
  const beats = useMemo(() => pieceBeats(piece), [piece]);
  const { media, error, refresh } = usePieceMedia(piece.id);

  return (
    <div className="flex flex-col gap-2">
      <FolderBar piece={piece} media={media} error={error} onRefresh={refresh} />
      {beats.length ? (
        <CaptureChecklist piece={piece} beats={beats} media={media} onPatch={onPatch} />
      ) : (
        <ManualTakes piece={piece} onPatch={onPatch} />
      )}
    </div>
  );
}

/**
 * Carpeta de la pieza en el disco: ruta + accesos directos a las subcarpetas.
 * Los botones de Finder están SIEMPRE (el agente crea lo que falte antes de
 * abrir) — la carpeta es el contrato del flujo grabar→editar y llegar a ella
 * no puede depender de que exista ya.
 */
function FolderBar({
  piece,
  media,
  error,
  onRefresh,
}: {
  piece: ContentPiece;
  media: PieceMedia | null;
  error: boolean;
  onRefresh: () => Promise<PieceMedia | null>;
}) {
  const { revealMediaFolder } = useEstudioContext();
  const [openError, setOpenError] = useState<string | null>(null);

  const open = async (sub?: "crudos" | "assets" | "exports") => {
    setOpenError(null);
    const r = await revealMediaFolder(piece.id, sub);
    if (!r.ok) setOpenError(r.error ?? "no se pudo abrir la carpeta");
    else await onRefresh();
  };

  if (error)
    return (
      <p className="text-2xs text-text-faint">
        No se pudo consultar el disco (¿agente fuera de línea?).
      </p>
    );
  if (!media) return <p className="text-2xs text-text-faint">◌ consultando el disco…</p>;

  // Sin disco, la grabación NO se bloquea: el agente resuelve un fallback
  // local (~/Movies/estudio) y el check se marca contra esa carpeta. El aviso
  // recuerda archivar al disco cuando vuelva — nada de "conéctalo para seguir".
  return (
    <div className="flex flex-col gap-1.5">
      {media.root === "local" && (
        <div className="flex items-center gap-2 rounded-sm border border-amber/40 bg-amber/5 px-2 py-1.5">
          <span className="min-w-0 flex-1 text-2xs text-amber">
            Disco del estudio no conectado — se usa la carpeta local; cuando lo conectes, archiva
            los crudos allá.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line px-2 py-1.5">
        <button
          onClick={() => void open()}
          title={`Abrir ${media.dir} en Finder`}
          className="min-w-0 flex-1 truncate text-left text-2xs text-text-dim hover:text-violet"
        >
          {media.exists ? media.dir : `${media.dir} (se crea al abrir)`}
        </button>
        <button onClick={() => void open("crudos")} className={btnCls} title="Abrir crudos/ en Finder">
          ⊙ Crudos
        </button>
        <button onClick={() => void open("assets")} className={btnCls} title="Abrir assets/ en Finder (voz en off y gráficos)">
          ⊙ Assets
        </button>
        <button onClick={() => void onRefresh()} className={btnCls} title="Volver a escanear la carpeta">
          ↻
        </button>
      </div>
      {openError && <p className="text-2xs text-red">{openError}</p>}
    </div>
  );
}

/** Una fila por bloque del guion; el check sale del archivo en crudos/. */
function CaptureChecklist({
  piece,
  beats,
  media,
  onPatch,
}: {
  piece: ContentPiece;
  beats: ReturnType<typeof pieceBeats>;
  media: PieceMedia | null;
  onPatch: PatchFn;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const format = captureFormat(piece);

  const copy = async (stem: string) => {
    try {
      await navigator.clipboard.writeText(stem);
      setCopied(stem);
      setTimeout(() => setCopied((c) => (c === stem ? null : c)), 1500);
    } catch {
      /* clipboard bloqueado: el nombre queda visible igual */
    }
  };

  // El veredicto sigue siendo humano (buena/revisar/descartada); el CHECK es
  // del disco. Ciclo: pendiente → buena → revisar → descartada → pendiente.
  const cycleVerdict = (beat: (typeof beats)[number]) => {
    const current = takeForBeat(piece, beat)?.verdict ?? null;
    const next: ContentTake["verdict"] =
      current === null ? "buena" : current === "buena" ? "revisar" : "descartada";
    void onPatch(piece.id, { takes: withBeatVerdict(piece, beat, next) });
  };

  const rows = beats.map((beat, i) => {
    const stem = takeStem(i, beat.label);
    const found = media?.crudos.find((f) => f.stem.toLowerCase() === stem) ?? null;
    // La voz en off cubre el bloque igual que el video: los beats de pantalla
    // se cierran narrando, los de cámara con el crudo. Manda la última toma.
    const voice = voTakesFor(media?.assets ?? [], stem);
    const lastVoice = voice[voice.length - 1] ?? null;
    return { beat, i, stem, found, voice: lastVoice, covered: Boolean(found || lastVoice) };
  });
  const expected = new Set(rows.map((r) => r.stem));
  const extra = (media?.crudos ?? []).filter((f) => !expected.has(f.stem.toLowerCase()));
  const estimated = rows.reduce((acc, r) => acc + (beatSeconds(r.beat) ?? 0), 0);
  const recorded = rows.reduce(
    (acc, r) => acc + (r.found?.duration_sec ?? r.voice?.duration_sec ?? 0),
    0,
  );
  const done = rows.filter((r) => r.covered).length;

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(({ beat, stem, found, voice, covered }) => {
        const verdict = takeForBeat(piece, beat)?.verdict ?? null;
        return (
          <div key={stem} className="rounded-sm border border-line px-2 py-1.5">
            <div className="flex items-center gap-2">
              {/* El check ES el archivo en el disco — no se puede marcar a mano. */}
              <span
                aria-hidden
                title={
                  covered
                    ? `Encontrado: ${[found?.name, voice?.name].filter(Boolean).join(" · ")}`
                    : "Esperando el archivo en crudos/ (o la voz en off)…"
                }
                className={`text-sm ${covered ? "text-green" : "text-text-faint"}`}
              >
                {covered ? "☑" : "☐"}
              </span>
              <button
                onClick={() => void copy(stem)}
                title="Copiar el nombre para grabar/guardar con él"
                className="shrink-0 rounded-xs border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-2xs text-violet hover:border-violet"
              >
                {copied === stem ? "✓ copiado" : `${stem} ⧉`}
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-text-dim">
                {beat.say[0] ?? beat.cues[0] ?? beat.label}
              </span>
              <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                ~{fmtSeconds(beatSeconds(beat))}
                {format ? ` · ${format}` : ""}
              </span>
              <button onClick={() => cycleVerdict(beat)} title="Veredicto (tuyo): buena / revisar / descartada">
                <Badge tone={verdict ? VERDICT_TONE[verdict] : "neutral"} variant={verdict ? "solid" : "line"} size="sm">
                  {verdict === "buena" ? "✓ buena" : (verdict ?? "pendiente")}
                </Badge>
              </button>
            </div>
            {found && (
              <p className="mt-1 pl-6 text-2xs text-text-faint">
                🎥 <span className="text-text-dim">{found.name}</span> ·{" "}
                <span className="tabular-nums">{fmtClipDur(found.duration_sec)} real</span> ·{" "}
                {fmtBytes(found.size_bytes)}
              </p>
            )}
            {voice && (
              <p className="mt-1 pl-6 text-2xs text-text-faint">
                🎙 <span className="text-text-dim">{voice.name}</span> ·{" "}
                <span className="tabular-nums">{fmtClipDur(voice.duration_sec)} de voz</span>{" "}
                <span className="text-text-faint">(se graba en el tab Edición)</span>
              </p>
            )}
          </div>
        );
      })}

      {extra.length > 0 && (
        <>
          <span className="mt-1 text-2xs tracking-label text-text-faint uppercase">
            En crudos/ sin plan · {extra.length}
          </span>
          {extra.map((f) => (
            <div key={f.path} className="flex items-center gap-2 rounded-sm border border-line/60 px-2 py-1">
              <span aria-hidden className="text-text-faint">
                ▮
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-text-faint">{f.name}</span>
              <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                {fmtClipDur(f.duration_sec)} · {fmtBytes(f.size_bytes)}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Suma al pie (patrón Asana): cuánto llevo vs cuánto estimé. */}
      <p className="mt-1 text-2xs text-text-faint tabular-nums">
        {done}/{rows.length} en disco (video o voz) · grabado {fmtSeconds(recorded)} de ~
        {fmtSeconds(estimated)} estimado
      </p>
    </div>
  );
}

/** Lista manual de tomas (piezas sin guion parseable). */
function ManualTakes({ piece, onPatch }: { piece: ContentPiece; onPatch: PatchFn }) {
  const [label, setLabel] = useState("");
  const [range, setRange] = useState("");
  const [note, setNote] = useState("");

  const save = (takes: ContentTake[]) => void onPatch(piece.id, { takes });

  const add = () => {
    if (!label.trim()) return;
    save([
      ...piece.takes,
      { id: uid(), label: label.trim(), range: range.trim() || null, verdict: "revisar", note: note.trim() || null },
    ]);
    setLabel("");
    setRange("");
    setNote("");
  };

  return (
    <div className="flex flex-col gap-2">
      {piece.takes.map((t) => (
        <div
          key={t.id}
          className="flex flex-wrap items-center gap-2 rounded-sm border border-line px-2 py-1.5"
        >
          <span className="text-2xs tracking-label text-text-dim uppercase">{t.label}</span>
          {t.range && <span className="text-2xs text-cyan tabular-nums">{t.range}</span>}
          <span className={`flex-1 text-xs ${t.verdict === "descartada" ? "text-text-faint line-through" : "text-text-dim"}`}>
            {t.note ?? ""}
          </span>
          <button
            onClick={() =>
              save(
                piece.takes.map((x) =>
                  x.id === t.id
                    ? { ...x, verdict: VERDICTS[(VERDICTS.indexOf(x.verdict) + 1) % 3] }
                    : x,
                ),
              )
            }
            title="Cambiar veredicto"
          >
            <Badge tone={VERDICT_TONE[t.verdict]} variant="solid" size="sm">
              {t.verdict === "buena" ? "✓ buena" : t.verdict}
            </Badge>
          </button>
          <button
            onClick={() => save(piece.takes.filter((x) => x.id !== t.id))}
            className="text-2xs text-text-faint hover:text-red"
            aria-label={`Borrar ${t.label}`}
          >
            ✕
          </button>
        </div>
      ))}
      {!piece.takes.length && (
        <p className="text-xs text-text-faint">Sin tomas — márcalas durante la sesión de grabación.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Toma 01" className={`${inputCls} w-24`} />
        <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="00:00–02:14" className={`${inputCls} w-32 tabular-nums`} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="nota (Enter agrega)"
          className={`${inputCls} min-w-0 flex-1`}
        />
        <button onClick={add} className={btnCls}>＋ Toma</button>
      </div>
    </div>
  );
}

// ── Edición: crudos + run automático (OpenMontage) + puntos ────────────

/** "1:24" a partir de segundos reales (null = ffprobe no pudo). */
function fmtClipDur(sec: number | null): string {
  if (sec == null) return "—";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
}

const CLIPS_DIR_KEY = "hermes_clips_dir";

function EdicionTab({ piece, onPatch }: { piece: ContentPiece; onPatch: PatchFn }) {
  // El disco se consulta aquí (no solo en Tomas): la barra de carpeta y la voz
  // en off leen el mismo escaneo, y el bump del provider lo mantiene fresco.
  const { media, error, refresh } = usePieceMedia(piece.id);
  const voiceTakes = latestVoTakes(media?.assets ?? []);

  return (
    <div className="flex flex-col gap-3">
      <FolderBar piece={piece} media={media} error={error} onRefresh={refresh} />
      <CrudosSection piece={piece} />
      {voiceTakes.length > 0 && (
        <p className="text-2xs text-text-faint">
          🎙 {voiceTakes.length} {voiceTakes.length === 1 ? "bloque narrado" : "bloques narrados"} en
          assets/ — la edición automática los usa como narración (grábalos en el tab Voz).
        </p>
      )}
      <AutoEditCard piece={piece} />
      <EditPointsSection piece={piece} onPatch={onPatch} />
    </div>
  );
}

// ── Crudos: el material real del disco, vinculado a la pieza ───────────

function CrudosSection({ piece }: { piece: ContentPiece }) {
  const { board, removeClip, linkFolderClips } = useEstudioContext();
  const [browsing, setBrowsing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const clips = piece.raw_clips;
  const totalSec = clips.reduce((acc, c) => acc + (c.duration_sec ?? 0), 0);

  // La carpeta de la pieza (disco extraíble) es la fuente canónica: un clic
  // trae crudos/ + assets/; el picker manual queda para archivos sueltos.
  const linkFolder = async () => {
    setLinking(true);
    setLinkNote(null);
    const { piece: updated, added } = await linkFolderClips(piece.id);
    setLinkNote(
      !updated
        ? "No se pudo leer la carpeta (¿disco conectado?)."
        : added > 0
          ? `${added} ${added === 1 ? "clip vinculado" : "clips vinculados"} de la carpeta.`
          : "Nada nuevo en la carpeta de la pieza.",
    );
    setLinking(false);
  };
  // Arranque del picker: última carpeta usada → carpeta de la sesión de
  // grabación de la pieza → default del agente (~/Movies).
  const sessionFolder = board.sessions.find((s) => s.id === piece.session_id)?.folder ?? null;
  const defaultDir = (() => {
    try {
      return localStorage.getItem(CLIPS_DIR_KEY) ?? sessionFolder ?? undefined;
    } catch {
      return sessionFolder ?? undefined;
    }
  })();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs tracking-label text-text-dim uppercase">
          Crudos · {clips.length}
          {totalSec > 0 && (
            <span className="ml-1.5 text-text-faint normal-case tabular-nums">
              {fmtClipDur(totalSec)} en total
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => void linkFolder()}
            disabled={linking}
            title="Vincula los videos de crudos/ y assets/ de la carpeta de la pieza en el disco"
            className={btnCls}
          >
            {linking ? "◌ leyendo…" : "⇊ De la carpeta"}
          </button>
          <button onClick={() => setBrowsing(!browsing)} className={btnCls}>
            {browsing ? "Cerrar" : "＋ Agregar crudos"}
          </button>
        </div>
      </div>
      {linkNote && <p className="text-2xs text-text-faint">{linkNote}</p>}

      {clips.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-2 rounded-sm border border-line px-2 py-1.5"
        >
          <span aria-hidden className="text-violet">
            ▮
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-text" title={c.path}>
            {c.name}
          </span>
          <span className="shrink-0 text-2xs text-text-faint tabular-nums">
            {fmtClipDur(c.duration_sec)}
            {c.resolution ? ` · ${c.resolution}` : ""} · {fmtBytes(c.size_bytes)}
          </span>
          <button
            onClick={() => void removeClip(piece.id, c.id)}
            className="text-2xs text-text-faint hover:text-red"
            aria-label={`Quitar ${c.name}`}
          >
            ✕
          </button>
        </div>
      ))}

      {/* Empty state con CTA central (patrón media library de ElevenLabs/VEED). */}
      {!clips.length && !browsing && (
        <button
          onClick={() => setBrowsing(true)}
          className="flex flex-col items-center gap-1 rounded-sm border border-dashed border-line-2 px-3 py-5 text-center hover:border-violet"
        >
          <span className="text-xs text-text-dim">Sin crudos todavía</span>
          <span className="text-2xs text-text-faint">
            Vincula el material grabado (quedan como rutas locales; nada se copia) para armar el
            corte automático.
          </span>
          <span className="mt-1 text-2xs tracking-label text-violet uppercase">＋ Agregar crudos</span>
        </button>
      )}

      {browsing && (
        <ClipBrowser
          pieceId={piece.id}
          defaultDir={defaultDir}
          known={clips.map((c) => c.path)}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

/** File-picker server-side: navega el disco del AGENTE (el browser no da rutas). */
function ClipBrowser({
  pieceId,
  defaultDir,
  known,
  onClose,
}: {
  pieceId: number;
  defaultDir?: string;
  known: string[];
  onClose: () => void;
}) {
  const { browseClips, addClips } = useEstudioContext();
  const [data, setData] = useState<ClipBrowse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = async (dir?: string) => {
    setError(null);
    try {
      const d = await browseClips(dir);
      setData(d);
      try {
        localStorage.setItem(CLIPS_DIR_KEY, d.dir);
      } catch {
        /* modo privado */
      }
    } catch {
      setError("No se pudo listar la carpeta (¿agente fuera de línea?).");
    }
  };

  useEffect(() => {
    void load(defaultDir);
    // Solo al montar: después navega con los clics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (path: string) =>
    setSel((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const add = async () => {
    if (!sel.size || adding) return;
    setAdding(true);
    await addClips(pieceId, [...sel]);
    setAdding(false);
    onClose();
  };

  const knownSet = new Set(known);

  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-violet/40 bg-violet/5 px-2 py-2">
      <div className="flex items-center gap-2">
        {data?.parent && (
          <button onClick={() => void load(data.parent!)} className={btnCls}>
            ↑ Arriba
          </button>
        )}
        <span
          className="min-w-0 flex-1 truncate text-2xs text-text-faint tabular-nums"
          title={data?.dir}
          style={{ direction: "rtl", textAlign: "left" }}
        >
          {data?.dir ?? "…"}
        </span>
      </div>

      {error && <p className="text-2xs text-red">{error}</p>}

      <div className="max-h-56 overflow-y-auto overscroll-contain">
        {data?.dirs.map((d) => (
          <button
            key={d.path}
            onClick={() => void load(d.path)}
            className="flex w-full items-center gap-2 rounded-xs px-1.5 py-1 text-left text-xs text-text-dim hover:bg-panel-2"
          >
            <span aria-hidden className="text-text-faint">
              ▸
            </span>
            <span className="min-w-0 truncate">{d.name}</span>
          </button>
        ))}
        {data?.files.map((f) => {
          const linked = knownSet.has(f.path);
          return (
            <label
              key={f.path}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-xs px-1.5 py-1 text-xs ${linked ? "opacity-40" : "hover:bg-panel-2"}`}
            >
              <input
                type="checkbox"
                checked={linked || sel.has(f.path)}
                disabled={linked}
                onChange={() => toggle(f.path)}
                className="accent-violet"
              />
              <span className="min-w-0 flex-1 truncate text-text">{f.name}</span>
              <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                {fmtBytes(f.size_bytes)} ·{" "}
                {new Date(f.mtime).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
              </span>
            </label>
          );
        })}
        {data && !data.dirs.length && !data.files.length && (
          <p className="px-1.5 py-2 text-2xs text-text-faint">Carpeta vacía (o sin videos).</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-text-faint">
          Los clips ya vinculados aparecen atenuados.
        </span>
        <button
          onClick={() => void add()}
          disabled={!sel.size || adding}
          className={`${btnCls} ${sel.size && !adding ? "border-violet text-violet" : "opacity-40"}`}
        >
          {adding ? "◌ vinculando…" : `Agregar ${sel.size || ""} ${sel.size === 1 ? "clip" : "clips"}`}
        </button>
      </div>
    </div>
  );
}

// ── Edición automática: el run de OpenMontage sobre los crudos ─────────

const clipBasename = (p: string) => p.split("/").pop() ?? p;

function AutoEditCard({ piece }: { piece: ContentPiece }) {
  const { startEditRun, stopEditRun, openEditOutput } = useEstudioContext();
  const job = piece.edit_job;
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await startEditRun(piece.id, brief.trim() || undefined);
    if (r.error) setError(r.error);
    else setRetrying(false);
    setBusy(false);
  };

  const open = async (reveal: boolean) => {
    setOpenError(null);
    const r = await openEditOutput(piece.id, reveal);
    if (!r.ok) setOpenError(r.error ?? "no se pudo abrir");
  };

  // Corriendo: estado visible con etapa + detalle (patrón Activity de
  // Descript) — el poll de 10s lo refresca solo; se puede seguir trabajando.
  if (job?.status === "running") {
    const min = Math.max(0, Math.round((Date.now() - new Date(job.started_at).getTime()) / 60000));
    return (
      <div className="flex flex-col gap-1.5 rounded-sm border border-violet/40 bg-violet/5 px-2 py-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
          <span className="flex-1 text-xs text-text">
            Editando con OpenMontage — <span className="text-violet">{job.stage ?? "…"}</span>
          </span>
          <span className="text-2xs text-text-faint tabular-nums">
            {min < 1 ? "recién" : `${min} min`}
          </span>
          <button onClick={() => void stopEditRun(piece.id)} className={`${btnCls} hover:border-red hover:text-red`}>
            ⏹ Detener
          </button>
        </div>
        {job.detail && <p className="text-2xs text-text-dim">{job.detail}</p>}
        <p className="text-2xs text-text-faint">
          Corre local en el agente; puedes seguir trabajando — el estado se actualiza solo.
        </p>
      </div>
    );
  }

  // Corte listo: tarjeta de resultado con acciones directas.
  if (job?.status === "done" && !retrying) {
    return (
      <div className="flex flex-col gap-1.5 rounded-sm border border-green/40 bg-green/5 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-green">✓ Corte listo</span>
          {job.output_path && (
            <span className="min-w-0 truncate text-2xs text-text-dim" title={job.output_path}>
              {clipBasename(job.output_path)}
            </span>
          )}
          <span className="flex-1" />
          <button onClick={() => void open(false)} className={btnCls}>
            ▶ Abrir
          </button>
          <button onClick={() => void open(true)} className={btnCls}>
            ⊙ Finder
          </button>
          <button onClick={() => setRetrying(true)} className={btnCls}>
            ↻ Re-editar
          </button>
        </div>
        {job.detail && <p className="text-2xs text-text-dim">{job.detail}</p>}
        {openError && <p className="text-2xs text-red">{openError}</p>}
      </div>
    );
  }

  // Idle / error / re-editar: el composer del run.
  const noClips = piece.raw_clips.length === 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line px-2 py-2">
      {job?.status === "error" && (
        <p className="text-2xs text-red">✕ La edición anterior falló: {job.error ?? "sin detalle"}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs tracking-label text-text-dim uppercase">Edición automática</span>
        {retrying && (
          <button onClick={() => setRetrying(false)} className="text-2xs text-text-faint hover:text-text-dim">
            ← volver al corte listo
          </button>
        )}
      </div>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="Brief opcional para el editor (ritmo, qué priorizar, qué cortar)…"
        className={`${inputCls} min-h-[40px] resize-y`}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-2xs text-text-faint">
          Usa el guion y los {piece.edit_points.length} puntos como instrucciones; OpenMontage corre
          local (varios minutos).
        </span>
        <button
          onClick={() => void run()}
          disabled={noClips || busy}
          title={noClips ? "Vincula al menos un crudo primero" : undefined}
          className={`${btnCls} shrink-0 ${noClips || busy ? "opacity-40" : "border-violet text-violet"}`}
        >
          {busy ? "◌ arrancando…" : "✦ Editar con OpenMontage"}
        </button>
      </div>
      {error && <p className="text-2xs text-red">{error}</p>}
    </div>
  );
}

// ── Puntos de edición ──────────────────────────────────────────────────

const EDIT_KINDS: ContentEditPoint["kind"][] = ["corte", "zoom", "caption", "broll", "card"];
const KIND_TONE = { corte: "red", zoom: "violet", caption: "amber", broll: "green", card: "cyan" } as const;

function EditPointsSection({ piece, onPatch }: { piece: ContentPiece; onPatch: PatchFn }) {
  const [tc, setTc] = useState("");
  const [kind, setKind] = useState<ContentEditPoint["kind"]>("corte");
  const [note, setNote] = useState("");

  const save = (pts: ContentEditPoint[]) => void onPatch(piece.id, { edit_points: pts });
  const sorted = [...piece.edit_points].sort((a, b) => a.tc.localeCompare(b.tc));

  const add = () => {
    if (!tc.trim() || !note.trim()) return;
    save([...piece.edit_points, { id: uid(), tc: tc.trim(), kind, note: note.trim() }]);
    setTc("");
    setNote("");
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-2xs tracking-label text-text-dim uppercase">
        Puntos de edición · {sorted.length}
      </span>
      {sorted.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-sm border border-line px-2 py-1.5">
          <span className="w-12 text-2xs text-cyan tabular-nums">{p.tc}</span>
          <Badge tone={KIND_TONE[p.kind]} variant="solid" size="sm">
            {p.kind}
          </Badge>
          <span className="flex-1 text-xs text-text-dim">{p.note}</span>
          <button
            onClick={() => save(piece.edit_points.filter((x) => x.id !== p.id))}
            className="text-2xs text-text-faint hover:text-red"
            aria-label={`Borrar punto ${p.tc}`}
          >
            ✕
          </button>
        </div>
      ))}
      {!sorted.length && (
        <p className="text-xs text-text-faint">
          Sin puntos de edición — márcalos al revisar las tomas; el run de edición automática los
          usa como instrucciones de corte.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <input value={tc} onChange={(e) => setTc(e.target.value)} placeholder="01:05" className={`${inputCls} w-20 tabular-nums`} />
        <select value={kind} onChange={(e) => setKind(e.target.value as ContentEditPoint["kind"])} className={selectCls} aria-label="Tipo de punto">
          {EDIT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="qué hacer aquí (Enter agrega)"
          className={`${inputCls} min-w-0 flex-1`}
        />
        <button onClick={add} className={btnCls}>＋ Punto</button>
      </div>
      <p className="text-2xs text-text-faint">
        Los puntos viajan como instrucciones al run de OpenMontage (y como contexto del kit
        Divisual).
      </p>
    </div>
  );
}
