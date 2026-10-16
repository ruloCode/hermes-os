"use client";

/**
 * Vista COMPOSICIÓN (/composicion): el cuarto de escribir canciones.
 *
 * UX (patrones Mobbin): una cosa a la vez. Secciones — Canciones · Temas ·
 * Sesiones · Referencias · Cuaderno — y un riel con el ritual del día. Elegir una
 * canción abre el takeover (letra al centro, copiloto a la derecha) con
 * ← / Esc para volver, igual que el Estudio. El tablero vive en el agente
 * (`~/.hermes-os/composicion/board.json`); sin agente, el mock en memoria y
 * la cabecera lo dice. Sesiones = el Playground: sesiones grabadas → pasajes
 * cantados → memo (melodía, molde, versiones de letra). Temas = la máquina de
 * temas: pista + intención → tarareo encima → rejilla → letra (temas/).
 *
 * `active`: el AppShell deja la vista montada (oculta) al navegar a otra ruta;
 * sin esto, los atajos del Playground (Espacio, flechas) se disparaban desde
 * /finanzas sobre un memo que no se ve.
 *
 * v5 (2026-10): abre con ViewHeader; las secciones van en su Segmented con
 * el conteo real (antes: un selector propio con superíndices cyan y sin
 * título de vista). La lista de cada sección ya no va dentro de un Panel
 * "hero": el lienzo es la hoja, y el riel es una columna con hairline.
 */
import { useCallback, useEffect, useState } from "react";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Segmented } from "@/components/ui/Segmented";
import { ComposicionProvider, useComposicion } from "@/components/composicion/ComposicionContext";
import { SongList } from "@/components/composicion/SongList";
import { SongWorkspace } from "@/components/composicion/SongWorkspace";
import { CoWriterPanel } from "@/components/composicion/CoWriterPanel";
import { ReferencesBoard } from "@/components/composicion/ReferencesBoard";
import { NotebookPanel } from "@/components/composicion/NotebookPanel";
import { ComposicionRail } from "@/components/composicion/ComposicionRail";
import { PlaygroundProvider, usePlayground } from "@/components/composicion/playground/PlaygroundContext";
import { PlaygroundSection } from "@/components/composicion/playground/PlaygroundSection";
import { ViewActiveCtx, useViewActive } from "@/components/composicion/playground/api";
import { modalOpen } from "@/components/composicion/playground/ui";
import { TemasProvider, useTemas } from "@/components/composicion/temas/TemasProvider";
import { TemasSection } from "@/components/composicion/temas/TemasSection";
import { sessionsListed } from "@/components/composicion/playground/SessionsHome";
import type { Section } from "@/components/composicion/useComposicionState";

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: "canciones", label: "Canciones", hint: "Las canciones y la que estás escribiendo" },
  {
    id: "temas",
    label: "Temas",
    hint: "Temas en construcción: pista, intención, tus fonemas encima y la letra que sale de ellos",
  },
  {
    id: "sesiones",
    label: "Sesiones",
    hint: "Sesiones grabadas: pasajes cantados, melodía, molde y versiones de letra",
  },
  {
    id: "referencias",
    label: "Referencias",
    hint: "Letras, canciones, progresiones y poemas que te alimentan",
  },
  { id: "cuaderno", label: "Cuaderno", hint: "Versos sueltos, frases, títulos y tarareos" },
];

/** `offline`: tablero en memoria sin hablarle al agente (la página de QA /dev/temas). */
export function ComposicionView({ active = true, offline }: { active?: boolean; offline?: boolean }) {
  return (
    <ComposicionProvider offline={offline}>
      <ViewActiveCtx.Provider value={active}>
        <WithPlayground />
      </ViewActiveCtx.Provider>
    </ComposicionProvider>
  );
}

/**
 * El Playground y Temas cuentan lo suyo aunque no se vean (el selector muestra
 * cuántos hay). Temas envuelve también a Sesiones: "Llevar a un Tema" desde un
 * pasaje crea el tema y cambia de sección con él abierto.
 */
function WithPlayground() {
  const { section } = useComposicion();
  return (
    <PlaygroundProvider visible={section === "sesiones"}>
      <TemasProvider visible={section === "temas"}>
        <Inner />
      </TemasProvider>
    </PlaygroundProvider>
  );
}

/** Lo que dice la cabecera sobre dónde vive el tablero: siempre el estado REAL. */
function BoardStatus() {
  const { source, saveState, saveError, flush } = useComposicion();
  if (source === "cargando") return <span className="text-xs text-text-faint">Cargando…</span>;
  if (source === "mock")
    return (
      <span className="text-xs text-amber" title="El agente no responde: nada de lo que edites se guarda">
        Sin agente · datos de prueba, no se guarda
      </span>
    );
  if (saveState === "error")
    return (
      <button
        onClick={() => void flush()}
        className="cursor-pointer text-xs text-red hover:underline"
        title={saveError ?? ""}
      >
        No se guardó · reintentar
      </button>
    );
  return (
    <span className="text-xs text-text-faint">
      {saveState === "saving" ? "Guardando…" : saveState === "saved" ? "Guardado" : "Tablero en este equipo"}
    </span>
  );
}

function Inner() {
  const { selected, setSelectedId, songs, refs, notebook, section, setSection } = useComposicion();
  const { sessions } = usePlayground();
  const { temas } = useTemas();
  const active = useViewActive();
  const [chatOpen, setChatOpen] = useState(true);
  const [focusSection, setFocusSection] = useState<string | null>(null);

  const askHermes = useCallback((sectionId: string) => {
    setChatOpen(true);
    setFocusSection(sectionId);
  }, []);
  const focusHandled = useCallback(() => setFocusSection(null), []);

  // Esc vuelve a la lista sin robarle el Esc a los campos de texto, a una hoja abierta ni a
  // otra ruta: el AppShell deja esta vista montada (oculta) y, sin `active`, un Esc en
  // /finanzas cerraba la canción que no se ve.
  useEffect(() => {
    if (!selected || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || modalOpen()) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, setSelectedId, active]);

  const counts: Partial<Record<Section, number>> = {
    canciones: songs.length,
    temas: temas?.length ?? 0,
    // Las tomas de un tema son sesiones por dentro, pero se cuentan en Temas (salvo las de un
    // tema borrado: esas se listan en Sesiones).
    sesiones: sessionsListed(sessions, temas).sessions?.length ?? 0,
    referencias: refs.length,
    cuaderno: notebook.length,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ViewHeader
        title="Composición"
        // En una canción, ← vuelve a la lista (igual que Esc).
        onBack={selected ? () => setSelectedId(null) : undefined}
        backLabel="Canciones"
        tabs={
          <Segmented
            ariaLabel="Secciones de Composición"
            // Con una canción abierta la sección es Canciones (el takeover vive ahí).
            value={selected ? "canciones" : section}
            onChange={(id) => {
              setSection(id);
              if (id !== "canciones") setSelectedId(null);
            }}
            options={SECTIONS.map((s) => ({
              value: s.id,
              label: s.label,
              title: s.hint,
              count: counts[s.id],
            }))}
          />
        }
        // Dónde vive el tablero y si se guardó: estado REAL, a la derecha.
        actions={<BoardStatus />}
      />

      {/* Temas y Sesiones ocupan todo el ancho (traen su propio contexto) */}
      {section === "temas" && !selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <TemasSection />
        </div>
      ) : section === "sesiones" && !selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <PlaygroundSection />
        </div>
      ) : /* Canción abierta: takeover con el copiloto a la derecha */
      selected ? (
        <div
          className={`grid min-h-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)] ${
            chatOpen ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""
          }`}
        >
          <div className="flex min-h-[520px] min-w-0 flex-col lg:min-h-0">
            <SongWorkspace
              song={selected}
              chatOpen={chatOpen}
              onToggleChat={() => setChatOpen((v) => !v)}
              onAskHermes={askHermes}
            />
          </div>
          {chatOpen && (
            /* Copiloto = columna con hairline a sangre (patrón del riel): sube
               hasta la línea de la cabecera (-mt-8 = mb-5 del ViewHeader +
               gap-3) y baja hasta el borde del lienzo. */
            <aside
              aria-label="Copiloto"
              className="flex min-h-[360px] min-w-0 flex-col border-line max-lg:border-t max-lg:pt-3 lg:-mt-8 lg:-mr-6 lg:-mb-5 lg:min-h-0 lg:border-l"
            >
              <p className="shrink-0 px-4 pt-4 pb-2 text-2xs font-medium text-text-faint">
                Copiloto
              </p>
              <div className="min-h-0 flex-1 px-4 pb-4">
                <CoWriterPanel
                  song={selected}
                  focusSectionId={focusSection}
                  onFocusHandled={focusHandled}
                />
              </div>
            </aside>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-6 gap-y-6 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
          {/* La lista de la sección ES la pantalla: sin Panel alrededor. */}
          <div className="col-span-12 flex min-h-[420px] min-w-0 flex-col lg:col-span-9 lg:min-h-0">
            {section === "canciones" && <SongList />}
            {section === "referencias" && <ReferencesBoard />}
            {section === "cuaderno" && <NotebookPanel />}
          </div>
          <aside
            aria-label="Ritual y principios"
            className="col-span-12 flex min-h-0 min-w-0 flex-col border-line max-lg:border-t lg:col-span-3 lg:-mt-8 lg:-mr-6 lg:-mb-5 lg:border-l"
          >
            <ComposicionRail />
          </aside>
        </div>
      )}
    </div>
  );
}
