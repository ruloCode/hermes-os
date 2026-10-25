/**
 * Compuerta del streaming de sugerencias: el `suggestion_start` NO sale al
 * browser hasta que el modelo escribió algo que se pueda leer.
 *
 * Por qué: en la clase del 2026-10-16 casi la mitad de las preguntas de la
 * profe terminaron en "—" (silencio del modelo). El start salía al instante,
 * la UI pintaba la tarjeta "cargando…" y ~2 s después llegaba el aborted: se
 * veía como "empezó a cargar y no mostró nada". Con la compuerta, un silencio
 * no pinta nada y una sugerencia real aparece con su primer texto (la
 * latencia es la misma: antes de ese texto la tarjeta estaba vacía).
 */

/** ¿Ya hay texto legible? "—", guiones y espacios no cuentan. */
export function hasReadableText(text: string): boolean {
  return text.replace(/[\s—–\-.…]/g, "").length >= 2;
}

/** Qué debe emitirse hacia el browser tras cada evento del motor. */
export type GateOut<S> =
  | { type: "start"; start: S }
  | { type: "delta"; text: string }
  | { type: "aborted" };

interface Pending<S> {
  start: S;
  buf: string;
  shown: boolean;
}

export class SuggestionStreamGate<S> {
  private readonly pending = new Map<string, Pending<S>>();

  start(id: string, start: S): GateOut<S>[] {
    this.pending.set(id, { start, buf: "", shown: false });
    return [];
  }

  delta(id: string, text: string): GateOut<S>[] {
    const p = this.pending.get(id);
    if (!p) return [{ type: "delta", text }];
    if (p.shown) return [{ type: "delta", text }];
    p.buf += text;
    if (!hasReadableText(p.buf)) return [];
    p.shown = true;
    return [
      { type: "start", start: p.start },
      { type: "delta", text: p.buf },
    ];
  }

  /** Interrumpida: solo se avisa si el browser llegó a verla. */
  aborted(id: string): GateOut<S>[] {
    const p = this.pending.get(id);
    this.pending.delete(id);
    return p && !p.shown ? [] : [{ type: "aborted" }];
  }

  /** Terminó (con texto o en silencio). true = el browser ya tenía la tarjeta abierta. */
  done(id: string): boolean {
    const p = this.pending.get(id);
    this.pending.delete(id);
    return p ? p.shown : true;
  }

  clear(): void {
    this.pending.clear();
  }
}
