"use client";

// QA del modo en vivo de una máquina: corre un código (la referencia o el de
// ?code=) con un ejemplo bajo el trazador y lo reproduce con TraceView, a
// 520 px y a 358 px, igual que debajo del editor del problema.

import { useEffect, useState } from "react";
import { pyRepr, type DojoItem, type DojoTrace } from "@hermes/shared";
import { traceFunction } from "@/lib/dojo/python";
import { TraceView } from "@/components/dojo/LivePanel";

export function LiveQa({ item, code, ex, theme }: { item: DojoItem; code: string; ex: number; theme?: "light" | "dark" }) {
  const p = item.problem!;
  const example = p.cases.filter((c) => !c.hidden && c.args)[ex];
  const [trace, setTrace] = useState<DojoTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void traceFunction(code, p.fn, example?.args ?? []).then((r) =>
      r.kind === "ok" ? setTrace(r.trace) : setError(r.kind === "timeout" ? "timeout" : r.message),
    );
  }, [code, p.fn, example]);
  if (error) return <p className="p-8 text-red">{error}</p>;
  if (!trace) return <p className="p-8 text-text-faint">Trazando…</p>;
  if (trace.phase !== "done") return <pre className="p-8 text-red">{JSON.stringify(trace, null, 2)}</pre>;
  const expected = example ? pyRepr(example.expected) : undefined;
  return (
    <main className="flex flex-wrap items-start gap-8 bg-bg p-8" data-theme-forced={theme}>
      <section data-qa="desktop" style={{ width: 520 }}>
        <p className="mb-2 font-mono text-xs text-text-faint">{item.id} · en vivo · {trace.call}</p>
        <TraceView trace={trace} fn={p.fn} code={code} itemId={item.id} reveal expected={expected} theme={theme} />
      </section>
      <section data-qa="phone" style={{ width: 358 }}>
        <p className="mb-2 font-mono text-xs text-text-faint">358 px</p>
        <TraceView trace={trace} fn={p.fn} code={code} itemId={item.id} reveal expected={expected} theme={theme} />
      </section>
    </main>
  );
}
