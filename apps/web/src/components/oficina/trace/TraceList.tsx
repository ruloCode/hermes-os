"use client";

// La traza del loop, una fila por evento: vuelta, icono por tipo, "Lee x
// (líneas 10–80)", "Ejecuta pnpm test", "Llama mcp__linear__…", el resultado
// plegado (clic o Enter lo despliega), duración y tokens. Los errores van en
// rojo con una flecha al paso que los corrigió.
//
// Virtualizada: solo se pintan las filas visibles (alto fijo por fila; una fila
// desplegada tiene su propio alto fijo con scroll adentro). Sigue el final solo
// si ya estabas abajo, como la terminal grande.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { describeStep, formatTokens, readsEnvFile, totalTokens, HIDDEN, type ReducedTrace, type TraceEvent } from "@hermes/shared";
import type { Redact } from "@/lib/oficina/public-view";

export type TraceSize = "md" | "xl";

const ROW_H: Record<TraceSize, number> = { md: 30, xl: 46 };
const OPEN_H: Record<TraceSize, number> = { md: 240, xl: 340 };

const BY_LABEL: Record<string, string> = {
  human: "el humano",
  guardrail: "el guardrail de Hermes",
  "auto-mode": "el modo Auto",
  settings: "una regla deny del CLI",
  timeout: "el tiempo (10 min)",
  nobody: "nadie miraba",
  chrome: "Chrome CDP",
  mode: "el modo",
};

interface RowInfo {
  ev: TraceEvent;
  icon: string;
  tone: "text" | "dim" | "accent" | "red" | "green" | "amber" | "cyan";
  label: React.ReactNode;
  /** Texto plano de la fila (búsqueda, QA). */
  plain: string;
  /** Lo que se despliega. */
  detail: string | null;
  cut?: number;
  step?: number;
  error?: boolean;
  fixedBy?: { step: number; seq: number };
  correctionOf?: number[];
}

const TONE: Record<RowInfo["tone"], string> = {
  text: "text-text",
  dim: "text-text-dim",
  accent: "text-accent",
  red: "text-red",
  green: "text-green",
  amber: "text-amber",
  cyan: "text-cyan",
};

function parse(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function firstLine(s: string, max = 160): string {
  const l = (s.split("\n").find((x) => x.trim()) ?? "").trim();
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
}

function ms(n: number | undefined): string {
  if (n === undefined) return "";
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} s`;
}

/** Todo lo que una fila necesita, ya redactado (lo que no pasa por aquí no llega al DOM). */
export function buildRows(reduced: ReducedTrace, r: Redact, publicOn: boolean): RowInfo[] {
  const stepByUse = new Map<number, number>();
  const stepByResult = new Map<number, number>();
  for (const s of reduced.steps) {
    stepByUse.set(s.useSeq, s.n);
    if (s.resultSeq) stepByResult.set(s.resultSeq, s.n);
  }
  const errBySeq = new Map(reduced.errors.map((e) => [e.seq, e]));
  const corrections = new Map<number, number[]>();
  reduced.errors.forEach((e, i) => {
    if (e.fixedBy) corrections.set(e.fixedBy.seq, [...(corrections.get(e.fixedBy.seq) ?? []), i + 1]);
  });
  const envReads = new Set<string>();
  const useById = new Map<string, TraceEvent>();
  for (const ev of reduced.events) {
    if (ev.kind !== "tool_use") continue;
    if (ev.id) useById.set(ev.id, ev);
    if (ev.id && readsEnvFile(ev.tool, ev.input)) envReads.add(ev.id);
  }

  return reduced.events.map((ev): RowInfo => {
    const err = errBySeq.get(ev.seq);
    const base = { ev, error: !!err || ev.isError === true, fixedBy: err?.fixedBy, correctionOf: corrections.get(ev.seq) };
    switch (ev.kind) {
      case "init": {
        const i = ev.init!;
        const plain = `Arranca · ${i.model ?? "modelo ?"} · modo ${i.permissionMode ?? "?"} · ${i.tools.length} tools · ${i.mcpServers.length} servidores MCP · ${i.skills.length} skills`;
        return { ...base, icon: "⚑", tone: "dim", label: plain, plain, detail: r(JSON.stringify({ ...i, tools: `${i.tools.length} tools (ver la pestaña Tools)` }, null, 2)) };
      }
      case "thinking": {
        const t = ev.text ?? "";
        const plain = t ? `Piensa: ${r(firstLine(t))}` : "Piensa (razonamiento oculto: el modelo no lo expone)";
        return { ...base, icon: "💭", tone: "cyan", label: plain, plain, detail: t ? r(t) : null, cut: ev.cut?.text };
      }
      case "text": {
        const t = r(ev.text ?? "");
        return { ...base, icon: "💬", tone: "text", label: firstLine(t), plain: t, detail: t.includes("\n") || t.length > 160 ? t : null, cut: ev.cut?.text };
      }
      case "tool_use": {
        const s = describeStep(ev.tool ?? "tool", parse(ev.input));
        const step = stepByUse.get(ev.seq);
        const target = r(s.target);
        const extra = s.extra ? r(s.extra) : "";
        const plain = `${s.verb} ${target}${extra ? ` (${extra})` : ""}`;
        return {
          ...base,
          step,
          icon: "▶",
          tone: "accent",
          label: (
            <>
              <b className="font-semibold">{s.verb}</b> <span className="font-mono">{target}</span>
              {extra ? <span className="text-text-dim"> · {extra}</span> : null}
            </>
          ),
          plain,
          detail: r(prettyJson(ev.input ?? "")),
          cut: ev.cut?.input,
        };
      }
      case "tool_result": {
        const hidden = publicOn && ev.id && envReads.has(ev.id);
        const out = hidden ? `[contenido de un .env o del entorno: ${HIDDEN}]` : r(ev.output ?? "");
        const step = stepByResult.get(ev.seq);
        const use = ev.id ? useById.get(ev.id) : undefined;
        const failed = !!err;
        // Una fila que falló dice QUÉ falló (la línea que eligió el reductor), no la primera de la salida.
        const head = (failed && !hidden ? r(err!.text) : firstLine(out)) || "(vacío)";
        return {
          ...base,
          step,
          icon: failed ? "✗" : "↩",
          tone: failed ? "red" : "dim",
          label: (
            <>
              <span className={failed ? "font-semibold" : ""}>{failed ? "Falló" : "Devuelve"}</span>
              <span className="text-text-faint"> · {use?.tool ?? ev.tool ?? "tool"}</span> <span className="font-mono">{head}</span>
            </>
          ),
          plain: `${failed ? "Falló" : "Devuelve"} ${head}`,
          detail: out,
          cut: hidden ? undefined : ev.cut?.output,
        };
      }
      case "permission": {
        const who = BY_LABEL[ev.by ?? "human"] ?? ev.by ?? "";
        const verb = ev.decision === "asked" ? "Pide permiso" : ev.decision === "allowed" ? `Permitido por ${who}` : `Negado por ${who}`;
        const t = r(ev.text ?? "");
        return {
          ...base,
          icon: ev.decision === "asked" ? "✋" : ev.decision === "allowed" ? "✓" : "⛔",
          tone: ev.decision === "denied" ? "red" : ev.decision === "asked" ? "amber" : "green",
          label: (
            <>
              <b className="font-semibold">{verb}</b>
              {ev.tool ? <span className="text-text-faint"> · {ev.tool}</span> : null} <span>{firstLine(t)}</span>
            </>
          ),
          plain: `${verb} ${t}`,
          detail: ev.input ? r(ev.input) : t.length > 160 ? t : null,
          error: ev.decision === "denied",
        };
      }
      case "guardrail": {
        const t = r(ev.text ?? "");
        return { ...base, icon: "🛡", tone: "red", label: <><b className="font-semibold">Guardrail lo negó</b> · {ev.tool} <span>{firstLine(t)}</span></>, plain: `Guardrail ${t}`, detail: ev.input ? `${t}\n\n${r(ev.input)}` : t, error: true };
      }
      case "error": {
        const t = r(ev.text ?? "");
        const real = ev.isError !== false;
        return { ...base, icon: real ? "✖" : "·", tone: real ? "red" : "dim", label: firstLine(t), plain: t, detail: t.length > 160 || t.includes("\n") ? t : null };
      }
      case "result": {
        const t = r(ev.text ?? "");
        const meta = [ev.numTurns !== undefined ? `${ev.numTurns} vueltas` : "", ms(ev.durationMs), ev.costUsd !== undefined ? `US$${ev.costUsd.toFixed(2)}` : ""].filter(Boolean).join(" · ");
        return {
          ...base,
          icon: ev.isError ? "■" : "✓",
          tone: ev.isError ? "red" : "green",
          label: (
            <>
              <b className="font-semibold">{ev.isError ? "Terminó con error" : "Terminó"}</b>
              {meta ? <span className="text-text-dim"> · {meta}</span> : null} <span>{firstLine(t, 120)}</span>
            </>
          ),
          plain: `Terminó ${t}`,
          detail: t || null,
          cut: ev.cut?.text,
        };
      }
      case "usage": {
        const models = ev.models?.map((m) => `${m.model}${m.costUsd !== undefined ? ` US$${m.costUsd.toFixed(2)}` : ""}`).join(" · ");
        const plain = models ? `Gasto por modelo: ${models}` : `Tokens de la vuelta: ${formatTokens(totalTokens(ev.tokens))}`;
        return { ...base, icon: "Σ", tone: "dim", label: plain, plain, detail: null };
      }
    }
  });
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export interface TraceListHandle {
  move: (delta: number) => void;
  toggle: () => void;
  jumpTo: (seq: number) => void;
  follow: () => void;
}

export const TraceList = memo(function TraceList({
  reduced,
  redact,
  publicView,
  size,
  focusSeq,
  onFocusSeq,
  handleRef,
  emptyText,
}: {
  reduced: ReducedTrace;
  redact: Redact;
  /** Vista pública: además de redactar, la salida de un .env se oculta entera. */
  publicView: boolean;
  size: TraceSize;
  /** Fila seleccionada (teclado/control). */
  focusSeq?: number | null;
  onFocusSeq?: (seq: number | null) => void;
  handleRef?: React.MutableRefObject<TraceListHandle | null>;
  emptyText?: string;
}) {
  const rows = useMemo(() => buildRows(reduced, redact, publicView), [reduced, redact, publicView]);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [following, setFollowing] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const rowH = ROW_H[size];
  const openH = OPEN_H[size];

  const offsets = useMemo(() => {
    const o = new Array<number>(rows.length + 1);
    o[0] = 0;
    for (let i = 0; i < rows.length; i++) o[i + 1] = o[i] + rowH + (open.has(rows[i].ev.seq) && rows[i].detail ? openH : 0);
    return o;
  }, [rows, open, rowH, openH]);
  const total = offsets[rows.length] ?? 0;
  const indexOf = useCallback((seq: number) => rows.findIndex((x) => x.ev.seq === seq), [rows]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Sigue el final solo si ya estabas abajo.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [total, following]);

  const scrollToIndex = useCallback(
    (i: number) => {
      const el = boxRef.current;
      if (!el || i < 0) return;
      const top = offsets[i];
      const bottom = offsets[i + 1];
      if (top < el.scrollTop) el.scrollTop = top - rowH;
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + rowH;
    },
    [offsets, rowH],
  );

  const toggle = useCallback((seq: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }, []);

  const jumpTo = useCallback(
    (seq: number) => {
      const i = indexOf(seq);
      if (i < 0) return;
      setFollowing(false);
      onFocusSeq?.(seq);
      requestAnimationFrame(() => scrollToIndex(i));
    },
    [indexOf, onFocusSeq, scrollToIndex],
  );

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      move: (delta) => {
        if (!rows.length) return;
        const cur = focusSeq != null ? indexOf(focusSeq) : rows.length;
        const i = Math.max(0, Math.min(rows.length - 1, (cur < 0 ? rows.length : cur) + delta));
        setFollowing(i === rows.length - 1);
        onFocusSeq?.(rows[i].ev.seq);
        requestAnimationFrame(() => scrollToIndex(i));
      },
      toggle: () => {
        if (focusSeq != null) toggle(focusSeq);
      },
      jumpTo,
      follow: () => {
        setFollowing(true);
        onFocusSeq?.(null);
      },
    };
  }, [handleRef, rows, focusSeq, indexOf, onFocusSeq, scrollToIndex, toggle, jumpTo]);

  // Ventana visible (+ margen).
  const overscan = rowH * 6;
  let first = 0;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] < scrollTop - overscan) lo = mid + 1;
    else hi = mid;
  }
  first = lo;
  let last = first;
  while (last < rows.length && offsets[last] < scrollTop + height + overscan) last++;

  const text = size === "xl" ? "text-[22px] leading-[30px]" : "text-xs leading-5";
  const metaText = size === "xl" ? "text-[18px]" : "text-[11px]";

  return (
    <div
      ref={boxRef}
      data-trace-list
      data-trace-count={rows.length}
      onScroll={(e) => {
        const el = e.currentTarget;
        setScrollTop(el.scrollTop);
        setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < rowH * 1.5);
      }}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {rows.length === 0 ? <p className={`px-4 py-3 text-text-faint ${size === "xl" ? "text-[22px]" : "text-xs"}`}>{emptyText ?? "Sin eventos todavía."}</p> : null}
      <div style={{ height: total }} className="relative">
        {rows.slice(first, last).map((row, k) => {
          const i = first + k;
          const isOpen = open.has(row.ev.seq) && !!row.detail;
          const focused = focusSeq === row.ev.seq;
          return (
            <div
              key={row.ev.seq}
              data-trace-row={row.ev.seq}
              data-kind={row.ev.kind}
              data-error={row.error ? "true" : undefined}
              data-fixed-by={row.fixedBy?.seq}
              data-step={row.step}
              data-open={isOpen ? "true" : undefined}
              style={{ position: "absolute", top: offsets[i], left: 0, right: 0, height: offsets[i + 1] - offsets[i] }}
              className={`border-b border-line/60 ${row.error ? "bg-red/10" : row.correctionOf ? "bg-green/10" : ""} ${focused ? "outline-2 -outline-offset-2 outline-accent" : ""}`}
            >
              <button
                type="button"
                onClick={() => {
                  onFocusSeq?.(row.ev.seq);
                  if (row.detail) toggle(row.ev.seq);
                }}
                style={{ height: rowH }}
                className={`flex w-full items-center gap-3 px-3 text-left ${text} ${row.detail ? "cursor-pointer hover:bg-panel-2/60" : "cursor-default"}`}
              >
                <span className={`w-[3.2em] shrink-0 text-right tabular-nums text-text-faint ${metaText}`} title="vuelta del loop">
                  {row.ev.turn ? `V${row.ev.turn}` : "—"}
                </span>
                <span className={`w-[1.4em] shrink-0 text-center ${TONE[row.tone]}`} aria-hidden>
                  {row.icon}
                </span>
                {row.step ? <span className={`shrink-0 rounded bg-panel-2 px-1.5 tabular-nums text-text-dim ${metaText}`}>#{row.step}</span> : null}
                <span className={`min-w-0 flex-1 truncate ${TONE[row.tone]}`}>{row.label}</span>
                {row.fixedBy ? (
                  <span
                    role="link"
                    tabIndex={-1}
                    data-jump={row.fixedBy.seq}
                    onClick={(e) => {
                      e.stopPropagation();
                      jumpTo(row.fixedBy!.seq);
                    }}
                    className={`shrink-0 rounded bg-green/15 px-2 text-green hover:bg-green/25 ${metaText}`}
                  >
                    → corregido en el paso {row.fixedBy.step}
                  </span>
                ) : row.error && row.ev.kind === "tool_result" ? (
                  <span className={`shrink-0 text-red ${metaText}`}>sin corregir aún</span>
                ) : null}
                {row.correctionOf ? <span className={`shrink-0 rounded bg-green/15 px-2 text-green ${metaText}`}>✓ así se corrigió</span> : null}
                {row.ev.kind === "tool_result" && row.ev.durationMs !== undefined ? <span className={`shrink-0 tabular-nums text-text-faint ${metaText}`}>{ms(row.ev.durationMs)}</span> : null}
                {row.ev.tokens && row.ev.kind !== "result" ? (
                  <span className={`shrink-0 tabular-nums text-text-faint ${metaText}`} title="tokens de esta vuelta (entrada + salida + caché)">
                    {formatTokens(totalTokens(row.ev.tokens))} tok
                  </span>
                ) : null}
                {row.detail ? <span className={`shrink-0 text-text-faint ${metaText}`}>{isOpen ? "▾" : "▸"}</span> : null}
              </button>
              {isOpen ? (
                <div style={{ height: openH }} className="overflow-y-auto bg-panel-2/50 px-4 py-2">
                  <pre className={`font-mono break-words whitespace-pre-wrap text-text ${size === "xl" ? "text-[18px] leading-[26px]" : "text-[11px] leading-4"}`} data-trace-detail={row.ev.seq}>
                    {row.detail}
                  </pre>
                  {row.cut ? <p className={`mt-1 text-amber ${metaText}`}>(recortado: el original medía {Math.round(row.cut / 1024)} KB; aquí van los primeros 20 KB)</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});
