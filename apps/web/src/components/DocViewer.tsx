"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { VaultDoc } from "@hermes/shared";
import { getVaultDoc } from "@/lib/hermes";
import { Markdown } from "./Markdown";

/**
 * Visor global de documentos .md del vault. `DocViewerProvider` se monta una vez
 * (en el layout) y expone `openDoc(ref, project?)` vía contexto; cualquier
 * <Markdown> hace clickables sus referencias `[[wikilink]]` / `*.md` y las abre
 * en un modal tipo Notion — legible para humanos no técnicos y exportable a PDF.
 */
type OpenDoc = (ref: string, project?: string) => void;

const DocViewerCtx = createContext<OpenDoc>(() => {});

export function useDocViewer(): OpenDoc {
  return useContext(DocViewerCtx);
}

export function DocViewerProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<{ ref: string; project?: string } | null>(null);

  return (
    <DocViewerCtx.Provider value={(ref, project) => setTarget({ ref, project })}>
      {children}
      {target && (
        <DocModal ref={target.ref} project={target.project} onClose={() => setTarget(null)} />
      )}
    </DocViewerCtx.Provider>
  );
}

function DocModal({
  ref,
  project,
  onClose,
}: {
  ref: string;
  project?: string;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<VaultDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setDoc(null);
    getVaultDoc(ref, project)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ref, project]);

  // Esc cierra; bloquea el scroll del fondo mientras el modal vive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const label = doc?.title || label_from_ref(ref);

  return (
    <div className="doc-overlay no-print" onClick={onClose} role="presentation">
      <div
        className="doc-paper"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className="doc-toolbar no-print">
          <span className="doc-breadcrumb" title={doc?.path}>
            {doc?.path ?? label}
          </span>
          <div className="doc-actions">
            {doc?.found && (
              <button
                type="button"
                className="doc-btn"
                onClick={() => window.print()}
                title="Exportar este documento a PDF (imprimir → guardar como PDF)"
              >
                <PdfGlyph /> Exportar PDF
              </button>
            )}
            <button
              type="button"
              className="doc-btn doc-btn-icon"
              onClick={onClose}
              title="Cerrar (Esc)"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        <div id="doc-print-root" className="doc-body">
          {loading && <p className="doc-state">Cargando documento…</p>}
          {error && <p className="doc-state">No se pudo contactar al agente para leer el vault.</p>}
          {doc && !doc.found && (
            <p className="doc-state">
              No encontré <b>{label_from_ref(ref)}</b> en el vault.
            </p>
          )}
          {doc?.found && (
            <>
              {doc.updated && (
                <p className="doc-updated no-print">Actualizado el {doc.updated}</p>
              )}
              <Markdown source={doc.markdown ?? ""} project={project} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Nombre presentable de una referencia cruda ("docs/x.md" / "[[X|alias]]" → "x").
function label_from_ref(ref: string): string {
  return ref
    .replace(/^\[\[|\]\]$/g, "")
    .split("|")
    .pop()!
    .split("#")[0]
    .replace(/\.md$/i, "")
    .split(/[\\/]/)
    .pop()!
    .trim();
}

function PdfGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 13h6M9 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
