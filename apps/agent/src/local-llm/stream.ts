/**
 * Lógica pura del chat local: leer el SSE OpenAI de llama-server, armar las
 * tool calls que llegan en pedazos y recortar el historial al contexto.
 * Sin I/O, para que los tests la ejerzan sin un modelo cargado.
 */

/** Separa eventos SSE completos (`data: …`) del resto que aún no cerró. */
export function splitSse(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  let sep: number;
  while ((sep = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    const lines = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""));
    if (lines.length) data.push(lines.join("\n"));
  }
  return { data, rest };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Las tool calls llegan partidas por `index`: el primer delta trae id y
 * nombre, los siguientes van sumando pedazos del JSON de argumentos.
 */
export class ToolCallAccumulator {
  private byIndex = new Map<number, ToolCall>();

  add(deltas: ToolCallDelta[] | undefined): void {
    for (const d of deltas ?? []) {
      const i = d.index ?? 0;
      const cur = this.byIndex.get(i) ?? { id: "", name: "", arguments: "" };
      if (d.id) cur.id = d.id;
      if (d.function?.name) cur.name += d.function.name;
      if (d.function?.arguments) cur.arguments += d.function.arguments;
      this.byIndex.set(i, cur);
    }
  }

  calls(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, c]) => ({ ...c, id: c.id || `call_${i}` }))
      .filter((c) => c.name);
  }
}

/** Argumentos de una tool call como objeto (un JSON roto = sin argumentos). */
export function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface ChatMsg {
  role: string;
  content: string;
}

/**
 * Los mensajes más recientes que caben en `maxChars`. El último del usuario
 * entra siempre (recortado si hace falta) y el historial empieza en un turno
 * del usuario: un 4B que arranca leyendo una respuesta suelta se confunde.
 */
export function trimHistory(messages: ChatMsg[], maxChars: number): ChatMsg[] {
  const clean = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && m.content.trim(),
  );
  if (!clean.length) return [];
  const out: ChatMsg[] = [];
  let used = 0;
  for (let i = clean.length - 1; i >= 0; i--) {
    const m = clean[i];
    if (!out.length) {
      const content = m.content.slice(-maxChars);
      out.unshift({ ...m, content });
      used += content.length;
      continue;
    }
    if (used + m.content.length > maxChars) break;
    out.unshift(m);
    used += m.content.length;
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return out;
}
