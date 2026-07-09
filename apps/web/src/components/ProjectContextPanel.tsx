"use client";

import { Children, useEffect, useRef, useState } from "react";
import type { ProjectContext } from "@hermes/shared";
import { getProjectContext, openProjectInCursor } from "@/lib/hermes";
import { Panel } from "./Panel";
import { Markdown } from "./Markdown";

/**
 * Panel de contexto del proyecto en foco: qué skills, servers MCP, herramientas
 * y comandos declara su repo local. Ocupa el slot del Command Deck cuando se
 * enfoca un proyecto (ver page.tsx). Los datos salen de ruta_local/.claude.
 */
export function ProjectContextPanel({
  slug,
  name,
  estadoActual,
  tareas,
  onClear,
}: {
  slug: string;
  name?: string;
  estadoActual?: string;
  tareas?: string[];
  onClear?: () => void;
}) {
  const [ctx, setCtx] = useState<ProjectContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  // Vive mientras el componente esté montado → no toca estado tras desmontar
  // (p.ej. si se quita el foco con un "abrir en Cursor" todavía en vuelo).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const openCursor = async () => {
    setOpening(true);
    setOpenError(null);
    const res = await openProjectInCursor(slug);
    if (!mounted.current) return;
    if (!res.ok) setOpenError(res.error ?? "no se pudo abrir Cursor");
    setOpening(false);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setOpenError(null);
    setCtx(null);
    getProjectContext(slug)
      .then((data) => {
        if (!alive) return;
        setCtx(data);
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
  }, [slug]);

  const empty =
    ctx &&
    ctx.found &&
    ctx.skills.length === 0 &&
    ctx.mcpServers.length === 0 &&
    ctx.allowTools.length === 0 &&
    ctx.denyTools.length === 0 &&
    ctx.commands.length === 0;

  return (
    <Panel
      title="Contexto"
      delay={180}
      right={
        <button
          type="button"
          onClick={onClear}
          title="Quitar foco de proyecto"
          className="flex items-center gap-1.5 text-[9px] tracking-[0.2em] uppercase transition-colors"
          style={{ color: "var(--cyan)" }}
        >
          <span>◈ {name ?? slug}</span>
          <span className="opacity-60 hover:opacity-100">✕</span>
        </button>
      }
    >
      <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
        {/* Estado del proyecto (del vault): las referencias .md son clickables. */}
        {(estadoActual?.trim() || (tareas && tareas.length > 0)) && (
          <div className="space-y-2 border-b pb-3" style={{ borderColor: "var(--line)" }}>
            {estadoActual?.trim() && (
              <div>
                <p className="mb-1 text-[9px] tracking-[0.25em] uppercase" style={{ color: "var(--green)" }}>
                  ▸ Estado actual
                </p>
                <Markdown source={estadoActual} project={slug} />
              </div>
            )}
            {tareas && tareas.length > 0 && (
              <div>
                <p className="mb-1 text-[9px] tracking-[0.25em] uppercase" style={{ color: "var(--amber)" }}>
                  ▸ Tareas pendientes
                </p>
                <Markdown source={tareas.map((t) => `- ${t}`).join("\n")} project={slug} />
              </div>
            )}
          </div>
        )}

        {loading && (
          <p className="pt-4 text-center text-[10px] tracking-[0.25em] pulse-dot" style={{ color: "var(--text-dim)" }}>
            LEYENDO CONTEXTO…
          </p>
        )}

        {error && (
          <p className="pt-4 text-center text-[10px] leading-relaxed tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
            AGENTE OFFLINE — corre <code className="text-[10px]">pnpm dev:agent</code>
          </p>
        )}

        {ctx && !ctx.found && (
          <p className="pt-3 text-[10.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Sin repo local para <span style={{ color: "var(--cyan)" }}>{name ?? slug}</span>. Agrega{" "}
            <code className="text-[10px]">ruta_local</code> al frontmatter del proyecto en el vault para
            ver sus skills, MCP y herramientas.
          </p>
        )}

        {ctx && ctx.found && (
          <>
            {/* Meta: rama · CLAUDE.md · ruta */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] tracking-[0.14em] uppercase" style={{ color: "var(--text-dim)" }}>
              {ctx.rama && (
                <span className="flex items-center gap-1">
                  <span style={{ color: "var(--amber)" }}>⌥</span> {ctx.rama}
                </span>
              )}
              <span className="flex items-center gap-1">
                <span style={{ color: ctx.hasClaudeMd ? "var(--green)" : "var(--text-dim)" }}>
                  {ctx.hasClaudeMd ? "◉" : "○"}
                </span>{" "}
                CLAUDE.md
              </span>
            </div>
            {ctx.ruta_local && (
              <div className="flex items-center gap-2">
                <p
                  className="min-w-0 flex-1 truncate text-[9.5px]"
                  style={{ color: "var(--text-dim)" }}
                  title={ctx.ruta_local}
                >
                  {ctx.ruta_local}
                </p>
                <button
                  type="button"
                  onClick={() => void openCursor()}
                  disabled={opening}
                  title="Abrir el proyecto en Cursor"
                  aria-label="Abrir el proyecto en Cursor"
                  className="flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] tracking-[0.18em] uppercase opacity-80 transition-opacity hover:opacity-100 disabled:opacity-40"
                  style={{ borderColor: "var(--cyan)", color: "var(--cyan)", background: "rgba(103,232,249,0.05)" }}
                >
                  <CursorGlyph spinning={opening} />
                  {opening ? "Abriendo…" : "Cursor"}
                </button>
              </div>
            )}

            {openError && (
              <p className="text-[9.5px] leading-snug" style={{ color: "var(--red)" }}>
                ⚠ {openError}
              </p>
            )}

            {empty && (
              <p className="pt-1 text-[10px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
                Este proyecto no declara skills, MCP ni permisos en su{" "}
                <code className="text-[10px]">.claude/</code>.
              </p>
            )}

            <Section label="Skills" color="var(--violet)" count={ctx.skills.length}>
              {ctx.skills.map((s) => (
                <Chip key={s.name} color="var(--violet)" title={s.description || undefined}>
                  {s.name}
                </Chip>
              ))}
            </Section>

            <Section label="MCP" color="var(--cyan)" count={ctx.mcpServers.length}>
              {ctx.mcpServers.map((m) => (
                <Chip
                  key={m.name}
                  color="var(--cyan)"
                  title={`${m.kind}${m.detail ? ` · ${m.detail}` : ""}`}
                  dim={m.enabled === false}
                >
                  <span
                    className="mr-1 text-[8px]"
                    style={{ color: m.enabled === false ? "var(--text-dim)" : "var(--cyan)" }}
                  >
                    {m.enabled === false ? "○" : "◉"}
                  </span>
                  {m.name}
                </Chip>
              ))}
            </Section>

            <Section label="Permitidas" color="var(--green)" count={ctx.allowTools.length}>
              {ctx.allowTools.map((t) => (
                <Chip key={t} color="var(--green)" title={t}>
                  {t}
                </Chip>
              ))}
            </Section>

            {ctx.denyTools.length > 0 && (
              <Section label="Denegadas" color="var(--red)" count={ctx.denyTools.length}>
                {ctx.denyTools.map((t) => (
                  <Chip key={t} color="var(--red)" title={t}>
                    {t}
                  </Chip>
                ))}
              </Section>
            )}

            {ctx.commands.length > 0 && (
              <Section label="Comandos" color="var(--blue)" count={ctx.commands.length}>
                {ctx.commands.map((cmd) => (
                  <Chip key={cmd} color="var(--blue)">
                    /{cmd}
                  </Chip>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

// ── Piezas ─────────────────────────────────────────────────────────────

// Cuántas chips muestra una sección antes de colapsar el resto en "+N más".
const SECTION_MAX = 8;

function Section({
  label,
  color,
  count,
  children,
}: {
  label: string;
  color: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const all = Children.toArray(children);
  const rest = all.length - SECTION_MAX;
  const shown = open || rest <= 0 ? all : all.slice(0, SECTION_MAX);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[9px] tracking-[0.25em] uppercase">
        <span style={{ color }}>▸ {label}</span>
        <span
          className="rounded-full px-1.5 text-[8px]"
          style={{ color: "var(--text-dim)", background: "rgba(122,132,255,0.08)" }}
        >
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-[9.5px] tracking-[0.1em]" style={{ color: "var(--text-dim)" }}>
          —
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {shown}
          {rest > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title={open ? "Mostrar menos" : `Mostrar las ${rest} restantes`}
              className="inline-flex items-center rounded-sm border border-dashed px-1.5 py-0.5 text-[9.5px] leading-none transition-colors hover:opacity-100"
              style={{ borderColor: "var(--line)", color: "var(--text-dim)" }}
            >
              {open ? "menos ▴" : `+${rest} más ▾`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  color,
  title,
  dim = false,
}: {
  children: React.ReactNode;
  color: string;
  title?: string;
  dim?: boolean;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none"
      style={{
        borderColor: dim ? "var(--line)" : color,
        color: dim ? "var(--text-dim)" : color,
        background: dim ? "transparent" : "rgba(122,132,255,0.04)",
      }}
    >
      {children}
    </span>
  );
}

// Icono del botón "Abrir en Cursor": open-external en reposo, spinner al abrir.
function CursorGlyph({ spinning }: { spinning?: boolean }) {
  if (spinning) {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
