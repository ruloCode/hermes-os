"use client";

// Lo que imprimió el código y, si reventó, el error de Python con su línea y
// qué significa en español. Lo usan los ejemplos de las lecciones y la consola
// de cada caso.

import { explainPyError, type PyError } from "@hermes/shared";

export function PyErrorBox({ error, onLine }: { error: PyError; onLine?: boolean }) {
  const help = explainPyError(error.type);
  return (
    <div className="rounded-sm border border-red/30 bg-red/5 px-3 py-2">
      <p className="font-mono text-sm text-red">
        {error.type}
        {error.message ? `: ${error.message}` : ""}
        {onLine !== false && error.line ? <span className="text-text-faint"> · línea {error.line}</span> : null}
      </p>
      {help && <p className="mt-1 text-sm text-text-dim">{help}</p>}
    </div>
  );
}

export function Stdout({ text, label = "Salida" }: { text: string; label?: string }) {
  if (!text) return null;
  return (
    <div>
      <p className="mb-1 text-xs text-text-faint">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-sm bg-panel-2 px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap text-text">
        {text}
      </pre>
    </div>
  );
}
