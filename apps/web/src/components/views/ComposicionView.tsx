"use client";

/**
 * Vista COMPOSICIÓN (/composicion): el cuarto de escribir canciones.
 *
 * UX (patrones Mobbin): una cosa a la vez. Tres secciones — Canciones ·
 * Referencias · Cuaderno — y un riel con el ritual del día. Elegir una
 * canción abre el takeover (letra al centro, copiloto a la derecha) con
 * ← / Esc para volver, igual que el Estudio. Versión ESTÁTICA con datos de
 * prueba: el estado vive en memoria (ComposicionProvider); pasar a
 * Supabase + agente no cambia los componentes.
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
import type { Section } from "@/components/composicion/useComposicionState";

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: "canciones", label: "Canciones", hint: "Las canciones y la que estás escribiendo" },
  { id: "referencias", label: "Referencias", hint: "Letras, canciones, progresiones y poemas que te alimentan" },
  { id: "cuaderno", label: "Cuaderno", hint: "Versos sueltos, frases, títulos y tarareos" },
];

export function ComposicionView() {
  return (
    <ComposicionProvider>
      <Inner />
    </ComposicionProvider>
  );
}

function Inner() {
  const { selected, setSelectedId, songs, refs, notebook, section, setSection } = useComposicion();
  const [chatOpen, setChatOpen] = useState(true);
  const [focusSection, setFocusSection] = useState<string | null>(null);

  const askHermes = useCallback((sectionId: string) => {
    setChatOpen(true);
    setFocusSection(sectionId);
  }, []);
  const focusHandled = useCallback(() => setFocusSection(null), []);

  // Esc vuelve a la lista sin robarle el Esc a los campos de texto.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, setSelectedId]);

  const counts: Record<Section, number> = { canciones: songs.length, referencias: refs.length, cuaderno: notebook.length };

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
                section === s.id && !(selected && s.id !== "canciones") ? "bg-violet/16 text-violet" : "text-text-faint hover:text-text-dim"
              }`}
            >
              {s.label} <sup className="text-cyan">{counts[s.id]}</sup>
            </button>
          ))}
        </div>
        <span className="text-2xs text-text-faint">versión estática · datos de prueba</span>
      </div>

      {/* Canción abierta: takeover con el copiloto a la derecha */}
      {selected ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          <div className={`grid min-h-0 gap-3 ${chatOpen ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-1"} lg:grid-rows-[minmax(0,1fr)]`}>
            <div className="flex min-h-0 min-w-0 flex-col">
              <Panel title="Canción" variant="hero" delay={40} className="min-h-[520px] flex-1 lg:min-h-0" padding="sm">
                <SongWorkspace song={selected} onBack={() => setSelectedId(null)} chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} onAskHermes={askHermes} />
              </Panel>
            </div>
            {chatOpen && (
              <div className="flex min-h-0 min-w-0 flex-col">
                <Panel title="Copiloto · Hermes" tone="cyan" delay={80} className="min-h-[360px] flex-1 lg:min-h-0" padding="sm">
                  <CoWriterPanel song={selected} focusSectionId={focusSection} onFocusHandled={focusHandled} />
                </Panel>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
          <div className="col-span-12 flex min-h-[420px] min-w-0 flex-col lg:col-span-9 lg:min-h-0">
            {section === "canciones" && (
              <Panel title={`Canciones · ${songs.length}`} variant="hero" delay={40} className="min-h-0 flex-1" padding="sm">
                <SongList />
              </Panel>
            )}
            {section === "referencias" && (
              <Panel title={`Referencias · ${refs.length}`} variant="hero" tone="cyan" delay={40} className="min-h-0 flex-1" padding="sm">
                <ReferencesBoard />
              </Panel>
            )}
            {section === "cuaderno" && (
              <Panel title={`Cuaderno · ${notebook.length}`} variant="hero" tone="amber" delay={40} className="min-h-0 flex-1" padding="sm">
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
