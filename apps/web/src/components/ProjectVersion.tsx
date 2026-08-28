"use client";

import { useEffect, useState } from "react";
import type { ProjectContext } from "@hermes/shared";
import { getProjectContext } from "@/lib/hermes";
import { PanelState } from "@/components/ui/PanelState";

/**
 * Vista "Versión" del proyecto en foco: rama, último commit y archivos con
 * cambios sin commitear del repo local. Ocupa el slot del Knowledge Network
 * cuando se enfoca un proyecto (ver page.tsx). Refresca cada 30s, en línea
 * con el TTL del cache de contexto del agente.
 */

// "hace 3 h" a partir de un epoch ms (fecha del último commit).
function timeAgo(ms: number): string {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export function ProjectVersion({ slug }: { slug: string }) {
  const [ctx, setCtx] = useState<ProjectContext | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    setError(false);
    const load = () =>
      getProjectContext(slug)
        .then((data) => {
          if (!alive) return;
          setCtx(data);
          setError(false);
        })
        .catch(() => {
          if (!alive) return;
          setError(true);
        });
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [slug]);

  if (error) {
    return <PanelState kind="offline" title="Agente offline" hint="corre pnpm dev:agent" />;
  }
  if (!ctx) {
    return <PanelState kind="loading" title="Leyendo repo…" />;
  }
  if (!ctx.found) {
    return (
      <PanelState
        kind="empty"
        title="Sin repo local"
        hint="Agrega ruta_local al frontmatter del proyecto en el vault."
      />
    );
  }
  if (!ctx.git) {
    return (
      <PanelState
        kind="empty"
        title="Sin repo git"
        hint="La ruta local no es un repo git (o no tiene commits todavía)."
      />
    );
  }

  const { rama, commit, mensaje, descripcion, commitAt, archivosCambiados } = ctx.git;
  const dirty = archivosCambiados > 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Row label="Rama" hint="HEAD">
        <div
          className="font-display mt-1 truncate text-xl font-bold tracking-wider text-amber glow-text-amber"
          title={rama}
        >
          <span className="mr-1.5 text-sm align-middle">⌥</span>
          {rama}
        </div>
      </Row>

      <Row label="Commit" hint={timeAgo(commitAt)}>
        <div className="font-display mt-1 text-2xl font-bold tracking-wider tabular-nums text-violet glow-text-violet">
          {commit}
        </div>
        <p className="mt-1 text-xs leading-snug text-text" title={mensaje}>
          {mensaje || "(sin mensaje)"}
        </p>
        {descripcion && (
          <p
            className="mt-1 line-clamp-4 text-2xs leading-relaxed whitespace-pre-line text-text-dim"
            title={descripcion}
          >
            {descripcion}
          </p>
        )}
      </Row>

      <Row label="Cambios" hint="SIN COMMITEAR">
        <div
          className={`font-display mt-1 text-2xl font-bold tracking-wider tabular-nums ${
            dirty ? "text-amber glow-text-amber" : "text-green glow-text-green"
          }`}
        >
          {archivosCambiados}
          <span className="ml-2 text-2xs font-normal tracking-label text-text-dim uppercase">
            {archivosCambiados === 1 ? "archivo" : "archivos"}
          </span>
        </div>
      </Row>

      <div className="mt-auto flex items-center justify-between pt-2 text-2xs tracking-label text-text-dim uppercase">
        <span>{dirty ? "● working tree sucio" : "○ working tree limpio"}</span>
        <span>git · local</span>
      </div>
    </div>
  );
}

// ── Piezas ─────────────────────────────────────────────────────────────

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between">
        <span className="text-2xs tracking-label text-text-dim uppercase">{label}</span>
        {hint && <span className="text-2xs tracking-widest text-text-dim">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
