# Identidad del dueño fuera del código

> Cuándo leerlo: prompts, soul.md, nombres propios, defaults personales.

- **Identidad del dueño fuera del código** (`apps/agent/src/owner.ts`): `HERMES_OWNER_NAME` (nombre) + `~/.hermes-os/SOUL.md` (persona en markdown, plantilla en `docs/SOUL.example.md`, override `HERMES_SOUL_PATH`). `OWNER` va en todos los prompts del agente y de la voz; `soulPromptBlock()` se inyecta al system prompt y `ownerBlurb("<sección>")` alimenta los prompts especializados (Estudio lee `## Creador de contenido`, coach/tutor `## Inglés`/`## English`). La web usa `NEXT_PUBLIC_HERMES_OWNER_NAME` (`lib/owner.ts`). Regla: **ningún nombre propio en código** — el mismo repo corre en la máquina de cualquiera con su `.env` + SOUL.md. Defaults personales (disco del Estudio, IP de luces, URL LAN del móvil) van vacíos: la feature se apaga con mensaje, no se inventa un host.
