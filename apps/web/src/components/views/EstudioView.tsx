"use client";

/**
 * Vista ESTUDIO (/estudio): centro de creación de contenido.
 *
 * UX (patrones Mobbin): **una cosa a la vez**, llevado al límite — la
 * pantalla de entrada de Producción es la LISTA de piezas; elegir una la
 * abre en TAKEOVER a pantalla completa con ← volver (mismo patrón que el
 * tablero Linear del tab TAREAS), con el chat de la pieza como panel derecho
 * (Mistral Le Chat / Grok File Chat / Copilot Pages: documento al centro,
 * chat al lado, los cambios se aplican en vivo). Radar y Planeación viven en
 * sus propias secciones. Datos: EstudioProvider (poll /content/board).
 */
import { useEffect, useState } from "react";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Panel } from "@/components/ui/Panel";
import { PanelState } from "@/components/ui/PanelState";
import { EstudioPipeline } from "@/components/estudio/EstudioPipeline";
import { PieceWorkspace } from "@/components/estudio/PieceWorkspace";
import { EstudioRadar } from "@/components/estudio/EstudioRadar";
import { EstudioRail } from "@/components/estudio/EstudioRail";
import { RecordMode } from "@/components/estudio/RecordMode";
import { PieceChat } from "@/components/estudio/PieceChat";

type Section = "produccion" | "radar" | "planeacion";

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: "produccion", label: "Producción", hint: "El pipeline y la pieza en la que estás" },
  { id: "radar", label: "Radar", hint: "Tendencias, referentes y referencias guardadas" },
  { id: "planeacion", label: "Planeación", hint: "Sesión de grabación, colchón y agenda" },
];

export function EstudioView() {
  const { board, online, loaded, selected, setSelectedId, recordingId } = useEstudioContext();
  const [section, setSection] = useState<Section>("produccion");
  // Chat de la pieza: panel derecho colapsable (persiste la preferencia).
  const [chatOpen, setChatOpen] = useState(true);

  // Esc vuelve a la lista — pero cede ante los takeovers propios (grabación,
  // ⛶ Escribir) y nunca roba el Esc de un campo de texto.
  useEffect(() => {
    if (!selected || recordingId != null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      // El portal de ⛶ Escribir maneja su propio Esc y vive en el body.
      if (document.querySelector("[data-estudio-takeover]")) return;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, recordingId, setSelectedId]);

  if (loaded && !online)
    return (
      <Panel title="Estudio" variant="hero" className="flex-1">
        <PanelState kind="offline" title="Agente fuera de línea" hint="El pipeline vive en el agente local." />
      </Panel>
    );
  if (loaded && online && !board.available)
    return (
      <Panel title="Estudio" variant="hero" className="flex-1">
        <PanelState
          kind="empty"
          title="Sin Supabase"
          hint="Aplica las migraciones 016/017 para activar el Estudio."
        />
      </Panel>
    );

  const activas = board.pieces.filter((p) => p.status !== "descartada").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Selector de sección: el resto de la pantalla es UNA cosa */}
      <div className="flex shrink-0 gap-0.5 self-start rounded-sm border border-line p-0.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            title={s.hint}
            className={`rounded-xs px-3 py-1 text-2xs tracking-label uppercase ${
              section === s.id ? "bg-violet/16 text-violet" : "text-text-faint hover:text-text-dim"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Producción SIN pieza: la lista ES la pantalla (entrada del takeover). */}
      {section === "produccion" && !selected && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Panel
            title={`Piezas · ${activas}`}
            variant="hero"
            delay={40}
            className="min-h-[320px] flex-1"
            padding="sm"
          >
            <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col">
              <EstudioPipeline />
            </div>
          </Panel>
        </div>
      )}

      {/* Producción CON pieza: takeover — la pieza a todo el ancho y el chat
          de la pieza como panel derecho (colapsable). ← o Esc vuelven. */}
      {section === "produccion" && selected && (
        /* La fila lg va FIJADA a minmax(0,1fr): sin eso la fila del grid mide
           su contenido, el overflow-hidden recorta el resto y el chat "no
           scrollea". En angosto se apila y scrollea la página (auto-rows-min). */
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          {/* min-w-0: sin esto el contenido largo fija el ancho mínimo de la
              columna del grid y empuja el chat fuera de la pantalla. */}
          <div className="flex min-h-0 min-w-0 flex-col">
            <Panel
              title={`Pieza · ${selected.week_label ?? selected.format}`}
              variant="hero"
              delay={40}
              className="min-h-[520px] flex-1 lg:min-h-0"
              padding="sm"
            >
              <PieceWorkspace onBack={() => setSelectedId(null)} chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} />
            </Panel>
          </div>
          {chatOpen && (
            <div className="flex min-h-0 min-w-0 flex-col">
              <Panel
                title="Chat de la pieza"
                delay={80}
                className="min-h-[320px] flex-1 lg:min-h-0"
                padding="sm"
              >
                <PieceChat piece={selected} />
              </Panel>
            </div>
          )}
        </div>
      )}

      {section === "radar" && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Panel
            title="Radar · tendencias y referencias"
            variant="hero"
            delay={40}
            className="h-full"
            padding="sm"
            scroll
          >
            <div className="mx-auto w-full max-w-3xl">
              <EstudioRadar />
            </div>
          </Panel>
        </div>
      )}

      {section === "planeacion" && (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto overscroll-contain md:grid-cols-2 xl:grid-cols-4">
          <EstudioRail />
        </div>
      )}

      {/* Modo grabación: takeover a pantalla completa (portal). Se abre desde
          la pieza, desde el riel de sesión y desde ⌘K. */}
      <RecordMode />
    </div>
  );
}
