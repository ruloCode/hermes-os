// Texto de la respuesta del agente de voz EN STREAMING (agent_chat_response_part
// de ElevenLabs), fuera de React: llega token a token y pasarlo por el contexto
// de la voz re-renderizaría todo el shell en cada delta. Lo escribe
// VoiceSessionBridge; lo leen la compañera de práctica (para arrancar "Dilo
// así" apenas la tutora completa la pregunta) y la vista de práctica (para
// pintar su frase mientras la dice).

export interface AgentPartial {
  /** Texto acumulado de la respuesta en curso. */
  text: string;
  /** false mientras sigue llegando; true cuando la respuesta cerró. */
  done: boolean;
}

type Listener = (p: AgentPartial | null) => void;

let current: AgentPartial | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(current);
}

export function onAgentPartial(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function agentPartialStart(): void {
  current = { text: "", done: false };
  emit();
}

export function agentPartialDelta(text: string): void {
  current = { text: (current?.done === false ? current.text : "") + text, done: false };
  emit();
}

export function agentPartialStop(): void {
  if (current) current = { ...current, done: true };
  emit();
}

/** La línea final llegó (onMessage): el parcial ya no hace falta. */
export function agentPartialClear(): void {
  current = null;
  emit();
}
