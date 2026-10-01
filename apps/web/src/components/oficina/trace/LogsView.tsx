"use client";

// Logs del agente seleccionado, tal como salen: para un run de claude -p, su
// stream (init, texto, tools, resultados y stderr: lo mismo que la consola);
// para una tarea del SDK, los eventos del bus de actividad con su taskId (lo
// que ven el feed y los monitores, recortado como siempre).

import { useEffect, useRef } from "react";
import type { AgentActivityEvent, ReducedTrace } from "@hermes/shared";
import type { Redact } from "@/lib/oficina/public-view";
import { downloadText } from "@/lib/download";
import { buildRows } from "./TraceList";

export interface LogLine {
  t?: number | string;
  kind: string;
  text: string;
}

const KIND_CLASS: Record<string, string> = {
  tool: "text-accent",
  tool_call: "text-accent",
  result: "text-text-dim",
  tool_result: "text-text-dim",
  error: "text-red",
  done: "text-green",
  task_done: "text-green",
  init: "text-text-faint",
  task_start: "text-text-faint",
  session_start: "text-text-faint",
};

function hhmmss(t: number | string | undefined): string {
  if (t === undefined) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-CO", { hour12: false });
}

/**
 * El log COMPLETO de un agente, salido de su traza: cada evento con su hora, su
 * vuelta y su contenido entero (el input de cada tool, lo que le devolvió, el
 * texto del modelo, los permisos). Son las mismas filas de la traza (buildRows),
 * desplegadas: ya vienen redactadas si la vista pública está prendida.
 */
export function traceLogLines(reduced: ReducedTrace, r: Redact, publicView: boolean): LogLine[] {
  return buildRows(reduced, r, publicView).map((row) => {
    const ev = row.ev;
    const head = [ev.turn ? `V${ev.turn}` : "", row.step ? `#${row.step}` : "", row.plain.split("\n")[0]].filter(Boolean).join(" · ");
    const meta = [ev.durationMs !== undefined && ev.kind === "tool_result" ? `${ev.durationMs} ms` : "", row.fixedBy ? `corregido en el paso ${row.fixedBy.step}` : ""].filter(Boolean).join(" · ");
    const body = row.detail && row.detail !== row.plain ? `\n${row.detail}` : row.plain.includes("\n") ? `\n${row.plain.split("\n").slice(1).join("\n")}` : "";
    const cut = row.cut ? `\n(recortado: el original medía ${Math.round(row.cut / 1024)} KB)` : "";
    const kind = row.error ? "error" : ev.kind === "tool_use" ? "tool" : ev.kind === "tool_result" ? "result" : ev.kind === "result" ? "done" : ev.kind;
    return { t: ev.t, kind, text: `${head}${meta ? ` (${meta})` : ""}${body}${cut}` };
  });
}

export function busLines(events: AgentActivityEvent[], taskId: string): LogLine[] {
  return events.filter((e) => e.taskId === taskId).map((e) => ({ t: e.ts, kind: e.kind, text: [e.toolName, e.detail].filter(Boolean).join(" · ") }));
}

export function LogsView({
  lines,
  source,
  redact,
  big = false,
  full = false,
  downloadName,
}: {
  lines: LogLine[] | null;
  source: string;
  redact: Redact;
  big?: boolean;
  /** Log completo: todas las líneas (las que no se ven no cuestan: content-visibility). */
  full?: boolean;
  /** Si viene, botón para bajar el log entero en .txt (ya redactado). */
  downloadName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines?.length]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-logs>
      <div className="mb-1 flex items-baseline gap-2">
        <p className={`min-w-0 flex-1 text-text-dim ${big ? "text-[17px]" : "text-xs"}`}>
          {source}
          {lines?.length ? ` · ${lines.length} entradas` : ""}
        </p>
        {downloadName && lines?.length ? (
          <button
            type="button"
            data-log-download
            onClick={() => downloadText(downloadName, lines.map((l) => `${hhmmss(l.t)} [${l.kind}] ${redact(l.text)}`).join("\n\n") + "\n")}
            className={`shrink-0 rounded-md px-2 py-0.5 text-text-dim hover:bg-panel-2 hover:text-text ${big ? "text-[16px]" : "text-xs"}`}
          >
            ⤓ .txt
          </button>
        ) : null}
      </div>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className={`min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-panel px-3 py-2 font-mono ${big ? "text-[17px] leading-[25px]" : "text-[11px] leading-4"}`}
      >
        {!lines ? <p className="text-text-faint">Este run ya salió de la memoria del agente: sus logs no están.</p> : lines.length === 0 ? <p className="text-text-faint">Sin logs todavía.</p> : null}
        {(full ? lines : lines?.slice(-600))?.map((l, i) => (
          <div
            key={i}
            data-log-line
            style={full ? { contentVisibility: "auto", containIntrinsicSize: "auto 40px" } : undefined}
            className={`break-words whitespace-pre-wrap ${full ? "mb-2 border-b border-line/50 pb-2" : ""} ${KIND_CLASS[l.kind] ?? "text-text"}`}
          >
            <span className="text-text-faint">{hhmmss(l.t)} </span>
            <span className="text-text-faint">[{l.kind}] </span>
            {redact(l.text)}
          </div>
        ))}
      </div>
    </div>
  );
}
