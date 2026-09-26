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
 */
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
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
  if (source === "cargando") return <span className="text-2xs text-text-faint">cargando…</span>;
  if (source === "mock")
    return (
      <span className="text-2xs text-amber" title="El agente no responde: nada de lo que edites se guarda">
        sin agente · datos de prueba, no se guarda
      </span>
    );
  if (saveState === "error")
    return (
      <button onClick={() => void flush()} className="text-2xs text-red hover:underline" title={saveError ?? ""}>
        no se guardó · reintentar
      </button>
    );
  return (
    <span className="text-2xs text-text-faint">
      {saveState === "saving" ? "guardando…" : saveState === "saved" ? "guardado" : "tablero en este equipo"}
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
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex gap-0.5 self-start rounded-sm border border-line p-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSection(s.id);
                if (s.id !== "canciones") setSelectedId(null);
              }}
              title={s.hint}
              className={`rounded-xs px-3 py-1 text-2xs tracking-label uppercase ${
                section === s.id && !(selected && s.id !== "canciones")
                  ? "bg-accent/16 text-accent"
                  : "text-text-faint hover:text-text-dim"
              }`}
            >
              {s.label} <sup className="text-cyan">{counts[s.id]}</sup>
            </button>
          ))}
        </div>
        <BoardStatus />
      </div>

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
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          <div
            className={`grid min-h-0 gap-3 ${chatOpen ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-1"} lg:grid-rows-[minmax(0,1fr)]`}
          >
            <div className="flex min-h-0 min-w-0 flex-col">
              <Panel
                title="Canción"
                variant="hero"
                delay={40}
                className="min-h-[520px] flex-1 lg:min-h-0"
                padding="sm"
              >
                <SongWorkspace
                  song={selected}
                  onBack={() => setSelectedId(null)}
                  chatOpen={chatOpen}
                  onToggleChat={() => setChatOpen((v) => !v)}
                  onAskHermes={askHermes}
                />
              </Panel>
            </div>
            {chatOpen && (
              <div className="flex min-h-0 min-w-0 flex-col">
                <Panel
                  title="Copiloto · Hermes"
                  tone="cyan"
                  delay={80}
                  className="min-h-[360px] flex-1 lg:min-h-0"
                  padding="sm"
                >
                  <CoWriterPanel
                    song={selected}
                    focusSectionId={focusSection}
                    onFocusHandled={focusHandled}
                  />
                </Panel>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
          <div className="col-span-12 flex min-h-[420px] min-w-0 flex-col lg:col-span-9 lg:min-h-0">
            {section === "canciones" && (
              <Panel
                title={`Canciones · ${songs.length}`}
                variant="hero"
                delay={40}
                className="min-h-0 flex-1"
                padding="sm"
              >
                <SongList />
              </Panel>
            )}
            {section === "referencias" && (
              <Panel
                title={`Referencias · ${refs.length}`}
                variant="hero"
                tone="cyan"
                delay={40}
                className="min-h-0 flex-1"
                padding="sm"
              >
                <ReferencesBoard />
              </Panel>
            )}
            {section === "cuaderno" && (
              <Panel
                title={`Cuaderno · ${notebook.length}`}
                variant="hero"
                tone="amber"
                delay={40}
                className="min-h-0 flex-1"
                padding="sm"
              >
                <NotebookPanel />
              </Panel>
            )}
          </div>
          <div className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-3">
            <ComposicionRail />
          </div>
        </div>
      )}
    </div>
  );
}
