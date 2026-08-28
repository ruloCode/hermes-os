/**
 * Nombre del dueño de esta instancia para la UI (saludo, prompts de scope de
 * voz). Se inyecta en build con NEXT_PUBLIC_HERMES_OWNER_NAME; vacío = la UI
 * omite el nombre. El agente tiene su propio HERMES_OWNER_NAME + SOUL.md
 * (apps/agent/src/owner.ts) — la fuente de verdad de la identidad es esa.
 */
export const OWNER: string = (process.env.NEXT_PUBLIC_HERMES_OWNER_NAME || "").trim();

/** "El usuario (Ana)" o "El usuario" cuando no hay nombre. */
export const OWNER_LABEL: string = OWNER ? `El usuario (${OWNER})` : "El usuario";
