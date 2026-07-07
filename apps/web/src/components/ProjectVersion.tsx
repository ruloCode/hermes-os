"use client";

import { useEffect, useState } from "react";
import type { ProjectContext } from "@hermes/shared";
import { getProjectContext } from "@/lib/hermes";

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
    return (
      <Notice>
        AGENTE OFFLINE — corre <code className="text-[10px]">pnpm dev:agent</code>
      </Notice>
    );
  }
  if (!ctx) {
    return (
      <p className="pt-6 text-center text-[10px] tracking-[0.25em] pulse-dot" style={{ color: "var(--text-dim)" }}>
        LEYENDO REPO…
      </p>
    );
  }
  if (!ctx.found) {
    return (
      <Notice>
        Sin repo local. Agrega <code className="text-[10px]">ruta_local</code> al frontmatter del
        proyecto en el vault.
      </Notice>
    );
  }
  if (!ctx.git) {
    return <Notice>La ruta local no es un repo git (o no tiene commits todavía).</Notice>;
  }

  const { rama, commit, mensaje, descripcion, commitAt, archivosCambiados } = ctx.git;
  const dirty = archivosCambiados > 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Row label="Rama" hint="HEAD">
        <div
          className="font-display mt-1 truncate text-xl font-bold tracking-wider"
          style={{ color: "var(--amber)", textShadow: "0 0 16px rgba(251,191,36,0.33)" }}
          title={rama}
        >
          <span className="mr-1.5 text-sm align-middle">⌥</span>
          {rama}
        </div>
      </Row>

      <Row label="Commit" hint={timeAgo(commitAt)}>
        <div
          className="font-display mt-1 text-2xl font-bold tracking-wider"
          style={{ color: "var(--violet)", textShadow: "0 0 16px rgba(167,139,250,0.33)" }}
        >
          {commit}
        </div>
        <p
          className="mt-1 text-[10.5px] leading-snug"
          style={{ color: "var(--text)" }}
          title={mensaje}
        >
          {mensaje || "(sin mensaje)"}
        </p>
        {descripcion && (
          <p
            className="mt-1 line-clamp-4 text-[10px] leading-relaxed whitespace-pre-line"
            style={{ color: "var(--text-dim)" }}
            title={descripcion}
          >
            {descripcion}
          </p>
        )}
      </Row>

      <Row label="Cambios" hint="SIN COMMITEAR">
        <div
          className="font-display mt-1 text-2xl font-bold tracking-wider"
          style={{
            color: dirty ? "var(--amber)" : "var(--green)",
            textShadow: `0 0 16px ${dirty ? "rgba(251,191,36,0.33)" : "rgba(110,231,160,0.33)"}`,
          }}
        >
          {archivosCambiados}
          <span className="ml-2 text-[10px] font-normal tracking-[0.22em] uppercase" style={{ color: "var(--text-dim)" }}>
            {archivosCambiados === 1 ? "archivo" : "archivos"}
          </span>
        </div>
      </Row>

      <div
        className="mt-auto flex items-center justify-between pt-2 text-[9px] tracking-[0.18em] uppercase"
        style={{ color: "var(--text-dim)" }}
      >
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
    <div className="border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-[0.22em] uppercase" style={{ color: "var(--text-dim)" }}>
          {label}
        </span>
        {hint && (
          <span className="text-[9px] tracking-widest" style={{ color: "var(--text-dim)" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-4 text-center text-[10px] leading-relaxed tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
      {children}
    </p>
  );
}
