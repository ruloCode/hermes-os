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

/**
 * Tope de vueltas (idas y vueltas al modelo) por MENSAJE del chat. En entrada
 * por streaming el CLI 0.3.322 cuenta `maxTurns` por mensaje, no acumulado:
 * su limitador de la corrida suma el `num_turns` de cada resultado y vuelve a
 * cero con cada mensaje nuevo del host (`turnEnded` / `tally` en el CLI), y el
 * bucle de cada mensaje recibe el mismo `maxTurns`. Medido además: en la
 * sesión viva cada turno trae `num_turns: 1`, no la suma.
 */
export const CHAT_MAX_TURNS = 40;

/** Tras Detener, cuánto se espera el `result` antes de dar la sesión por colgada y cerrarla. */
export const ABORT_GRACE_MS = 12_000;
/** Tope duro de un turno del chat: más que esto es un CLI colgado, no una respuesta. */
export const TURN_MAX_MS = 10 * 60_000;

/** Qué hacer con la sesión viva que hay para la clave (ocupada o no, da igual). */
export function reuseDecision(
  live: { closed: boolean; sdkSessionId?: string; resumedFrom?: string } | undefined,
  requested: string | undefined,
  fresh: boolean,
): "create" | "reuse" | "replace" {
  if (!live || live.closed) return "create";
  // Ocupada o no: si lleva OTRA conversación, el mensaje nuevo no entra en su
  // cola (la pestaña adoptaría el hilo viejo). Se reemplaza.
  return liveMatchesResume(live, requested, fresh) ? "reuse" : "replace";
}

/**
 * Lo que el chat no puede usar aunque la tool exista. Un `Bash` en segundo
 * plano hace que el CLI arranque un turno PROPIO cuando termina; en la sesión
 * viva ese turno no tiene mensaje del usuario y descuadra qué respuesta va con
 * qué mensaje. En el chat se niega con el motivo; una tarea larga va por
 * run_task / schedule_task.
 */
export function chatToolDenial(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === "Bash" && input.run_in_background === true) {
    return "En el chat no se corren comandos en segundo plano: córrelo en primer plano (con un timeout) o, si es largo, lánzalo como tarea con run_task.";
  }
  return null;
}
