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
 *
 * v5 (2026-10): la vista abre con ViewHeader y las secciones van en su
 * Segmented. Antes no había título (la pantalla no decía dónde estabas) y
 * cada sección envolvía su contenido en un Panel "hero" con título — una caja
 * dentro del lienzo que ya es la hoja. Ahora la lista ES la pantalla; solo
 * el chat de la pieza se separa, como columna con hairline (patrón del riel).
 */
import { useEffect, useState } from "react";
import { useEstudioContext } from "@/state/EstudioProvider";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Segmented } from "@/components/ui/Segmented";
import { ScrollArea } from "@/components/ui/ScrollArea";
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
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewHeader title="Estudio" />
        <PanelState
          kind="offline"
          title="Agente fuera de línea"
          hint="El pipeline vive en el agente local."
        />
      </div>
    );
  if (loaded && online && !board.available)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewHeader title="Estudio" />
        <PanelState
          kind="empty"
          title="Sin Supabase"
          hint="Aplica las migraciones 016/017 para activar el Estudio."
        />
      </div>
    );

  const activas = board.pieces.filter((p) => p.status !== "descartada").length;
  const inPiece = section === "produccion" && selected != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ViewHeader
        title="Estudio"
        // En la pieza, el ← vuelve a la lista (el mismo Esc de siempre). La
        // pieza pone su propio título grande debajo: aquí basta la etiqueta.
        onBack={inPiece ? () => setSelectedId(null) : undefined}
        backLabel="Piezas"
        meta={
          inPiece
            ? (selected?.week_label ?? undefined)
            : loaded
              ? `${activas} ${activas === 1 ? "pieza activa" : "piezas activas"}`
              : undefined
        }
        tabs={
          <Segmented
            ariaLabel="Secciones del Estudio"
            value={section}
            onChange={setSection}
            options={SECTIONS.map((s) => ({
              value: s.id,
              label: s.label,
              title: s.hint,
              count:
                !loaded || s.id === "planeacion"
                  ? undefined
                  : s.id === "produccion"
                    ? activas
                    : board.refs.length,
            }))}
          />
        }
      />

      {/* Producción SIN pieza: la lista ES la pantalla (entrada del takeover). */}
      {section === "produccion" && !selected && (
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <EstudioPipeline />
        </div>
      )}

      {/* Producción CON pieza: takeover — la pieza a todo el ancho y el chat
          de la pieza como columna derecha (colapsable). ← o Esc vuelven. */}
      {inPiece && (
        /* La fila lg va FIJADA a minmax(0,1fr): sin eso la fila del grid mide
           su contenido y el chat "no scrollea". Sin overflow-hidden a
           propósito: recortaría la columna del chat, que sale a sangre con
           márgenes negativos. En angosto se apila y scrollea la página. */
        <div
          className={`grid min-h-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)] ${
            chatOpen ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""
          }`}
        >
          {/* min-w-0: sin esto el contenido largo fija el ancho mínimo de la
              columna del grid y empuja el chat fuera de la pantalla. */}
          <div className="flex min-h-[520px] min-w-0 flex-col lg:min-h-0">
            <PieceWorkspace chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} />
          </div>
          {chatOpen && (
            /* El chat es una columna con hairline (patrón del riel), no una
               tarjeta: sube hasta la línea de la cabecera (-mt-8 = mb-5 del
               ViewHeader + gap-3) y baja hasta el borde del lienzo. */
            <aside
              aria-label="Chat de la pieza"
              className="flex min-h-[320px] min-w-0 flex-col border-line max-lg:border-t max-lg:pt-3 lg:-mt-8 lg:-mr-6 lg:-mb-5 lg:min-h-0 lg:border-l"
            >
              <p className="shrink-0 px-4 pt-4 pb-2 text-2xs font-medium text-text-faint">
                Chat de la pieza
              </p>
              <div className="min-h-0 flex-1 px-3 pb-3">
                <PieceChat piece={selected} />
              </div>
            </aside>
          )}
        </div>
      )}

      {/* -mt-3/pt-3: el fade superior del ScrollArea no se come la primera
          fila (los 12px de máscara caen sobre el aire, no sobre el contenido). */}
      {section === "radar" && (
        <ScrollArea rail fade="y" className="-mt-3 min-h-0 flex-1">
          <div className="mx-auto w-full max-w-3xl pt-3 pb-4">
            <EstudioRadar />
          </div>
        </ScrollArea>
      )}

      {section === "planeacion" && (
        <ScrollArea rail fade="y" className="-mt-3 min-h-0 flex-1">
          <div className="mx-auto w-full max-w-5xl pt-3 pb-4">
            <EstudioRail />
          </div>
        </ScrollArea>
      )}

      {/* Modo grabación: takeover a pantalla completa (portal). Se abre desde
          la pieza, desde el riel de sesión y desde ⌘K. */}
      <RecordMode />
    </div>
  );
}
