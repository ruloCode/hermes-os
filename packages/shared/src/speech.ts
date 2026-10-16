/**
 * Texto para LEER EN VOZ ALTA (modo voz del tutor y otras respuestas
 * habladas): lógica pura, sin APIs del navegador.
 *
 * Dos problemas que resuelve:
 * - Lo que sirve en pantalla estorba al oído: `Front/app/api/chat/route.ts:126`,
 *   tablas, viñetas, asteriscos. Las rutas y el código se callan (las fuentes
 *   siguen en la pizarra); un `nombre` suelto se dice sin las comillas.
 * - La respuesta llega en streaming: hay que hablar cada frase apenas se
 *   completa, no esperar al final. `SentenceSplitter` entrega frases cerradas
 *   y guarda el resto hasta que llegue su punto.
 */

/** ¿Este fragmento de código es una ruta/referencia (se calla) o un nombre (se dice)? */
function isReference(code: string): boolean {
  return /[/\\]|:\d|\.(tsx?|jsx?|py|ya?ml|md|json|sql|sh)\b|\(\)|[{}=<>]/.test(code);
}

/** Limpia markdown, rutas y código para que se pueda decir. */
export function speakableText(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, (_, code: string) => (isReference(code) ? "" : code))
      // Paréntesis que quedaron vacíos o solo con separadores tras quitar rutas.
      .replace(/\(\s*[,;:·\s-]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^\s*\|.*\|\s*$/gm, " ") // filas de tablas
      .replace(/^\s*#{1,6}\s*/gm, "")
      .replace(/^\s*[-*+•]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/[*_~>#|]/g, "")
      .replace(/\s*·\s*/g, ", ")
      .replace(/→|->/g, " a ")
      .replace(/\s+([,.;:?!])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Parte un stream de texto en frases habladas. `push` devuelve las frases que
 * ya cerraron (punto, interrogación, exclamación o salto de párrafo) y
 * `flush` lo que quedó al final del stream.
 */
export class SentenceSplitter {
  private buf = "";

  constructor(private readonly minChars = 24) {}

  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    // Un fin de frase seguido de espacio o salto (no "1.5", no "route.ts").
    const re = /([.?!…]+)(\s+)|\n{2,}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[0].length;
      const piece = this.buf.slice(last, end);
      // Frases muy cortas ("Sí.") se juntan con la siguiente: suena más natural.
      if (speakableText(piece).length < this.minChars && !m[0].includes("\n")) continue;
      const say = speakableText(piece);
      if (say) out.push(say);
      last = end;
    }
    this.buf = this.buf.slice(last);
    return out;
  }

  flush(): string[] {
    const say = speakableText(this.buf);
    this.buf = "";
    return say ? [say] : [];
  }
}
