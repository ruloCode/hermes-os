/**
 * Polyfills que TIENEN que existir antes de evaluar cualquier otro módulo.
 * Sin imports a propósito: este archivo es el primer import de index.js.
 *
 * DOMException: Hermes no la trae, y livekit-client (la voz) declara al cargar
 * `class DeferrableMapAbortError extends DOMException`. Si ese módulo se
 * evaluaba antes de registerGlobals(), la app moría con "Property
 * 'DOMException' doesn't exist" antes de registrarse: abría y se cerraba
 * (1.4.0, 2026-10-08). Reproducido en emulador con el reporte del guardián.
 */
type DOMExceptionCtor = new (message?: string, name?: string) => Error;
const g = globalThis as unknown as { DOMException?: DOMExceptionCtor };

if (typeof g.DOMException === "undefined") {
  class DOMExceptionPolyfill extends Error {
    readonly code = 0;
    constructor(message = "", name = "Error") {
      super(message);
      this.name = name;
    }
  }
  g.DOMException = DOMExceptionPolyfill;
}

export {};
