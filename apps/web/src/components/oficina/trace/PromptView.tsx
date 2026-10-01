"use client";

// El system prompt en pantalla, y por qué quedó así.
// - Tarea del SDK: el string EXACTO que se envió, por secciones (cada una es un
//   slice del original: byte a byte), con su motivo escrito en
//   system-prompt.ts. En vista pública, lo personal queda con su título.
// - Run de claude -p: el prompt base es el de Claude Code y el CLI no lo
//   expone. Se muestra lo que Hermes controla: flags, modo, cwd, los CLAUDE.md
//   que carga, las reglas deny y el --mcp-config (sin el token del run).

import { useMemo, useState } from "react";
import { redactPrompt, sectionText, type CapturedPrompt, type CliRunConfig, type PublicViewContext, type TracePromptInfo } from "@hermes/shared";
import type { Redact } from "@/lib/oficina/public-view";

function Section({ title, why, personal, text, big, id, defaultOpen }: { title: string; why: string | null; personal?: boolean; text: string; big: boolean; id: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section data-prompt-section={id} className="rounded-lg border border-line bg-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`flex w-full items-start gap-2 px-3 py-2 text-left ${big ? "text-[20px]" : "text-sm"}`}>
        <span className="mt-0.5 text-text-faint">{open ? "▾" : "▸"}</span>
        <span className="min-w-0 flex-1">
          <span className="font-medium text-text">{title}</span>
          {personal ? <span className={`ml-2 rounded-full bg-panel-2 px-2 text-text-dim ${big ? "text-[15px]" : "text-[11px]"}`}>personal</span> : null}
          <span className={`ml-2 text-text-faint tabular-nums ${big ? "text-[15px]" : "text-[11px]"}`}>{text.length.toLocaleString("es-CO")} car.</span>
          <span className={`mt-1 block ${why ? "text-text-dim" : "text-amber"} ${big ? "text-[17px]" : "text-xs"}`} data-prompt-why>
            {why ? `Por qué: ${why}` : "Sin motivo escrito."}
          </span>
        </span>
      </button>
      {open ? (
        <pre data-prompt-text={id} className={`max-h-[60vh] overflow-y-auto border-t border-line px-3 py-2 font-mono break-words whitespace-pre-wrap text-text ${big ? "text-[16px] leading-[24px]" : "text-[11px] leading-4"}`}>
          {text}
        </pre>
      ) : null}
    </section>
  );
}

export function sdkPromptForView(p: CapturedPrompt, publicView: boolean, ctx: PublicViewContext): CapturedPrompt {
  return publicView ? redactPrompt(p, ctx) : p;
}

export function PromptView({ prompt, publicView, ctx, redact, big = false }: { prompt: TracePromptInfo | null; publicView: boolean; ctx: PublicViewContext; redact: Redact; big?: boolean }) {
  const shown = useMemo(() => (prompt?.kind === "sdk" ? sdkPromptForView(prompt, publicView, ctx) : null), [prompt, publicView, ctx]);
  if (!prompt) return <p className={`text-text-faint ${big ? "text-[20px]" : "text-xs"}`}>El prompt de este agente no se capturó (la traza empezó antes de este cambio o no es una sesión con personaje).</p>;

  if (prompt.kind === "sdk" && shown) {
    return (
      <div className="space-y-2" data-prompt-kind="sdk" data-prompt-length={prompt.raw.length}>
        <p className={`text-text-dim ${big ? "text-[18px]" : "text-xs"}`}>
          El string exacto que Hermes le pasó al Agent SDK como <code className="font-mono">systemPrompt</code> · {prompt.raw.length.toLocaleString("es-CO")} caracteres · {prompt.sections.length} secciones
          {publicView ? " · vista pública: lo personal queda con su título" : ""}
        </p>
        {shown.sections.map((s, i) => (
          <Section key={s.id} id={s.id} title={s.title} why={s.why} personal={s.personal} text={sectionText(shown, s)} big={big} defaultOpen={i === 0} />
        ))}
      </div>
    );
  }

  const c = prompt as CliRunConfig;
  return (
    <div className="space-y-2" data-prompt-kind="cli">
      <p className={`rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-text ${big ? "text-[19px]" : "text-sm"}`} data-cli-base-note>
        El prompt base es el de Claude Code: el CLI no lo expone. Esto es lo que Hermes controla de la invocación.
      </p>
      <Section id="flags" title="Flags y modo" why="Modelo, esfuerzo y modo salen de la consola de la Oficina (allowlists en claude-cli.ts); --settings aplica la deny-list porque el canUseTool del SDK no cubre esta ruta; --permission-prompt-tool manda las preguntas de permiso a la Oficina." text={redact(`claude ${c.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}\n\ncwd: ${c.cwd}\nmodelo: ${c.model} · esfuerzo: ${c.effort} · modo: ${c.permissionMode}`)} big={big} defaultOpen />
      {c.claudeMd.map((m) => (
        <Section key={m.path} id={`claude-md:${m.path}`} title={`CLAUDE.md · ${redact(m.path)}`} why="Claude Code lo carga solo para este cwd (el del usuario y, de la raíz al cwd, cada CLAUDE.md y CLAUDE.local.md). Los de subcarpetas los carga al leer ahí." text={redact(m.content) + (m.cut ? `\n\n(recortado: el archivo mide ${Math.round(m.cut / 1024)} KB)` : "")} big={big} defaultOpen={false} />
      ))}
      {c.settings ? <Section id="settings" title="--settings (reglas deny de Hermes)" why="Espejo de guardrails.ts para el CLI real: comandos destructivos y lecturas sensibles negados en TODA invocación." text={c.settings} big={big} defaultOpen={false} /> : null}
      {c.mcpConfig ? <Section id="mcp-config" title="--mcp-config" why="El puente de aprobaciones de la Oficina (MCP por stdio, oculto al modelo con --disallowedTools). El token es por run y solo sirve para pedir." text={redact(c.mcpConfig)} big={big} defaultOpen={false} /> : null}
      <Section id="user-prompt" title="Lo que se le pidió" why="La instrucción del humano tal cual; con proyecto, claude-cli.ts le antepone una línea de contexto." text={redact(c.prompt)} big={big} defaultOpen={false} />
    </div>
  );
}
