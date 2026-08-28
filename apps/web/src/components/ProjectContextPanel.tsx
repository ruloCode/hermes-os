"use client";

import { Children, useEffect, useRef, useState } from "react";
import type { ProjectContext } from "@hermes/shared";
import { getProjectContext, openProjectInCursor } from "@/lib/hermes";
import { Panel } from "@/components/ui/Panel";
import { PanelState } from "@/components/ui/PanelState";
import type { Tone } from "@/components/ui/tones";
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
          className="flex items-center gap-1.5 text-2xs tracking-label text-cyan uppercase transition-colors"
        >
          <span>◈ {name ?? slug}</span>
          <span className="opacity-60 hover:opacity-100">✕</span>
        </button>
      }
    >
      <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
        {/* Estado del proyecto (del vault): las referencias .md son clickables. */}
        {(estadoActual?.trim() || (tareas && tareas.length > 0)) && (
          <div className="space-y-2 border-b border-line pb-3">
            {estadoActual?.trim() && (
              <div>
                <p className="mb-1 text-2xs tracking-title text-green uppercase">
                  ▸ Estado actual
                </p>
                <Markdown source={estadoActual} project={slug} />
              </div>
            )}
            {tareas && tareas.length > 0 && (
              <div>
                <p className="mb-1 text-2xs tracking-title text-amber uppercase">
                  ▸ Tareas pendientes
                </p>
                <Markdown source={tareas.map((t) => `- ${t}`).join("\n")} project={slug} />
              </div>
            )}
          </div>
        )}

        {loading && <PanelState kind="loading" compact />}

        {error && (
          <PanelState kind="offline" compact title="Agente offline" hint="corre pnpm dev:agent" />
        )}

        {ctx && !ctx.found && (
          <p className="pt-3 text-xs leading-relaxed text-text-dim">
            Sin repo local para <span className="text-cyan">{name ?? slug}</span>. Agrega{" "}
            <code className="text-2xs">ruta_local</code> al frontmatter del proyecto en el vault para
            ver sus skills, MCP y herramientas.
          </p>
        )}

        {ctx && ctx.found && (
          <>
            {/* Meta: rama · CLAUDE.md · ruta */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs tracking-label text-text-dim uppercase">
              {ctx.rama && (
                <span className="flex items-center gap-1">
                  <span className="text-amber">⌥</span> {ctx.rama}
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className={ctx.hasClaudeMd ? "text-green" : "text-text-dim"}>
                  {ctx.hasClaudeMd ? "◉" : "○"}
                </span>{" "}
                CLAUDE.md
              </span>
            </div>
            {ctx.ruta_local && (
              <div className="flex items-center gap-2">
                <p
                  className="min-w-0 flex-1 truncate text-2xs text-text-dim"
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
                  className="flex shrink-0 items-center gap-1 rounded-sm border border-cyan bg-cyan/5 px-1.5 py-0.5 text-2xs tracking-label text-cyan uppercase opacity-80 transition-opacity hover:opacity-100 disabled:opacity-40"
                >
                  <CursorGlyph spinning={opening} />
                  {opening ? "Abriendo…" : "Cursor"}
                </button>
              </div>
            )}

            {openError && <p className="text-2xs leading-snug text-red">⚠ {openError}</p>}

            {empty && (
              <p className="pt-1 text-2xs leading-relaxed text-text-dim">
                Este proyecto no declara skills, MCP ni permisos en su{" "}
                <code className="text-2xs">.claude/</code>.
              </p>
            )}

            <Section label="Skills" tone="violet" count={ctx.skills.length}>
              {ctx.skills.map((s) => (
                <Chip key={s.name} tone="violet" title={s.description || undefined}>
                  {s.name}
                </Chip>
              ))}
            </Section>

            <Section label="MCP" tone="cyan" count={ctx.mcpServers.length}>
              {ctx.mcpServers.map((m) => (
                <Chip
                  key={m.name}
                  tone="cyan"
                  title={`${m.kind}${m.detail ? ` · ${m.detail}` : ""}`}
                  dim={m.enabled === false}
                >
                  <span
                    className={`mr-1 text-2xs ${m.enabled === false ? "text-text-dim" : "text-cyan"}`}
                  >
                    {m.enabled === false ? "○" : "◉"}
                  </span>
                  {m.name}
                </Chip>
              ))}
            </Section>

            <Section label="Permitidas" tone="green" count={ctx.allowTools.length}>
              {ctx.allowTools.map((t) => (
                <Chip key={t} tone="green" title={t}>
                  {t}
                </Chip>
              ))}
            </Section>

            {ctx.denyTools.length > 0 && (
              <Section label="Denegadas" tone="red" count={ctx.denyTools.length}>
                {ctx.denyTools.map((t) => (
                  <Chip key={t} tone="red" title={t}>
                    {t}
                  </Chip>
                ))}
              </Section>
            )}

            {ctx.commands.length > 0 && (
              <Section label="Comandos" tone="blue" count={ctx.commands.length}>
                {ctx.commands.map((cmd) => (
                  <Chip key={cmd} tone="blue">
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

// Clases estáticas por tono (Tailwind necesita literales completos, no
// nombres de clase interpolados).
const TONE_TEXT: Record<Tone, string> = {
  violet: "text-violet",
  cyan: "text-cyan",
  blue: "text-blue",
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  neutral: "text-text-dim",
};

const TONE_CHIP: Record<Tone, string> = {
  violet: "border-violet text-violet",
  cyan: "border-cyan text-cyan",
  blue: "border-blue text-blue",
  green: "border-green text-green",
  amber: "border-amber text-amber",
  red: "border-red text-red",
  neutral: "border-line text-text-dim",
};

function Section({
  label,
  tone,
  count,
  children,
}: {
  label: string;
  tone: Tone;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const all = Children.toArray(children);
  const rest = all.length - SECTION_MAX;
  const shown = open || rest <= 0 ? all : all.slice(0, SECTION_MAX);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-2xs tracking-title uppercase">
        <span className={TONE_TEXT[tone]}>▸ {label}</span>
        <span className="rounded-full bg-violet/10 px-1.5 text-2xs text-text-dim">{count}</span>
      </div>
      {count === 0 ? (
        <p className="text-2xs tracking-widest text-text-dim">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {shown}
          {rest > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title={open ? "Mostrar menos" : `Mostrar las ${rest} restantes`}
              className="inline-flex items-center rounded-sm border border-dashed border-line px-1.5 py-0.5 text-2xs leading-none text-text-dim transition-colors hover:border-line-2 hover:text-text"
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
  tone,
  title,
  dim = false,
}: {
  children: React.ReactNode;
  tone: Tone;
  title?: string;
  dim?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-2xs leading-none ${
        dim ? "border-line bg-transparent text-text-dim" : `${TONE_CHIP[tone]} bg-violet/5`
      }`}
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
