/**
 * Reglas puras de la sesión persistente del chat (chat-sessions.ts): qué la
 * identifica, cuándo se cierra y cómo se ordenan sus turnos. Sin SDK ni reloj
 * real, para probarlas.
 */

export interface ChatSessionKeyInput {
  /** X-Hermes-Session-Id (un hilo por pestaña de la web o del teléfono). */
  clientId: string;
  /** Perfil de tools (chat-web / chat-phone). */
  profile: string;
  model: string;
  project?: string;
  /** Candado de finanzas del teléfono: cambia las tools que existen. */
  disallowedTools?: string[];
}

/**
 * Todo lo que se fija al ABRIR el proceso del CLI: si algo de esto cambia, la
 * sesión viva ya no sirve (sus tools, su modelo o su system prompt son otros)
 * y se recicla.
 */
export function chatSessionKey(k: ChatSessionKeyInput): string {
  const locked = [...(k.disallowedTools ?? [])].sort().join(",");
  return [k.clientId, k.profile, k.model, (k.project ?? "").toLowerCase(), locked].join("\u0000");
}

export const CHAT_SESSION_IDLE_MS = 10 * 60_000;
export const CHAT_SESSION_MAX = 3;

export interface SessionUsage {
  key: string;
  lastUsed: number;
  /** Con un turno en curso no se cierra (se cerraría a mitad de una respuesta). */
  busy: boolean;
}

/**
 * Qué sesiones cerrar: las que llevan `idleMs` sin uso y, si con la que va a
 * entrar (`incoming`) se pasa del máximo, las menos usadas recientemente.
 */
export function pickEvictions(
  sessions: SessionUsage[],
  now: number,
  opts: { max?: number; idleMs?: number; incoming?: number } = {},
): string[] {
  const max = opts.max ?? CHAT_SESSION_MAX;
  const idleMs = opts.idleMs ?? CHAT_SESSION_IDLE_MS;
  const out: string[] = [];
  const left = sessions.filter((s) => {
    if (!s.busy && now - s.lastUsed >= idleMs) {
      out.push(s.key);
      return false;
    }
    return true;
  });
  const overflow = left.length + (opts.incoming ?? 0) - max;
  if (overflow > 0) {
    const lru = left.filter((s) => !s.busy).sort((a, b) => a.lastUsed - b.lastUsed);
    out.push(...lru.slice(0, overflow).map((s) => s.key));
  }
  return out;
}

/**
 * Un turno a la vez: el que llega mientras otro corre espera su turno, en orden
 * de llegada. Un turno que falla no bloquea a los siguientes.
 */
export class TurnQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private count = 0;

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.count += 1;
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.count -= 1;
    });
  }

  /** Turnos en curso o esperando. */
  get pending(): number {
    return this.count;
  }
}

/**
 * Si la sesión viva sirve para este turno según la conversación pedida. El
 * cliente manda el id de la sesión SDK que quiere seguir (o nada: la del mapeo
 * legado). Si pide OTRA conversación que la que la sesión viva lleva, la viva
 * no sirve: seguirla mezclaría dos hilos.
 */
export function liveMatchesResume(live: { sdkSessionId?: string; resumedFrom?: string }, requested: string | undefined, fresh: boolean): boolean {
  if (fresh) return false;
  if (!requested) return true;
  return requested === live.sdkSessionId || requested === live.resumedFrom;
}
