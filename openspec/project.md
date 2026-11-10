# Hermes OS — contexto del proyecto para las especificaciones

Hermes es el sistema operativo personal de un solo dueño. Dos repos:

- `hermes-os` (este): agente local (`apps/agent`, Hono + Claude Agent SDK), dashboard (`apps/web`, Next.js 15) y lógica pura compartida (`packages/shared`).
- `hermes-phone` (hermano, `../hermes-phone`): el cuerpo en Android (Kotlin + Compose; `:core` JVM puro con tests y `:app`).

## Cómo se especifica aquí

Formato OpenSpec. Lo vigente vive en `openspec/specs/<capacidad>/spec.md`. Un cambio vive en
`openspec/changes/<id>/` con:

- `proposal.md`: por qué, qué cambia, qué no.
- `design.md`: decisiones técnicas con la evidencia que las sostiene.
- `tasks.md`: lista de trabajo verificable, por paquete.
- `specs/<capacidad>/spec.md`: los requisitos que el cambio agrega o modifica (`## ADDED Requirements`,
  `## MODIFIED Requirements`), cada uno con al menos un `#### Scenario:` en forma CUANDO / ENTONCES.

Al terminar un cambio, sus specs se mueven a `openspec/specs/` y el cambio a `openspec/changes/archive/`.

## Reglas del proyecto que toda especificación respeta

1. **Todo dato visible es real.** Sin métricas inventadas; si la fuente no existe, el elemento se omite.
2. **Ningún nombre propio en el código.** La identidad del dueño vive en `.env` y `~/.hermes-os/SOUL.md`.
3. **El factor humano no se delega.** Hermes propone; lo que cambia la vida del dueño (reglas de foco,
   metas, publicar, pagar) lo decide él. Sin una regla suya no hay intervención.
4. **Los secretos no llegan al proceso hijo.** Las tools corren dentro del agente; el CLI recibe una
   lista corta de variables.
5. **Lógica pura con tests de contrato**, nunca snapshots. `pnpm typecheck` y `pnpm test` antes de
   cerrar; en el teléfono, `./gradlew :core:test`.
6. **Español en UI, comentarios y mensajes; código y nombres en inglés.**
7. **Sin dependencias nuevas** salvo que el cambio lo justifique por escrito.
8. **Compatibilidad entre versiones.** El teléfono nuevo funciona contra un agente viejo y al revés:
   lo nuevo se anuncia como capacidad y, si falta, la función se apaga con un mensaje.
