# ⚡ Hermes OS

Sistema operativo de IA personal de RuloCode: un dashboard local estilo "AGENTIC OS" con **voz en tiempo real** (ElevenLabs), un **agente ejecutor local** (Claude Agent SDK) que conoce el vault de Obsidian, y **memoria persistente compartida** entre máquinas (Supabase + pgvector).

```
Browser (localhost:3000)
 ├─ Voz: ElevenLabs Agents (WebRTC) → client tools → localhost:8642
 ├─ Consola: contrato Hermes SSE → agente local
 └─ Dashboard: grafo de conocimiento, vitals, actividad en vivo
        ▼
Agent server (apps/agent, :8642) — Claude Agent SDK + tools MCP "hermes"
        ▼
Supabase (memories + pgvector, preferences, sessions, presence)  ·  Vault Obsidian (read + write controlado)
```

## Setup por máquina

1. **Requisitos**: Node 22+, pnpm 10+, [Claude Code](https://claude.com/claude-code) logueado (el Agent SDK usa esas credenciales), `rg` (ripgrep).
2. Clona e instala:
   ```bash
   git clone <repo> ~/dev/side/hermes-os && cd ~/dev/side/hermes-os
   pnpm install
   cp .env.example .env   # y completa los valores
   ```
3. **Supabase** (una sola vez por proyecto): aplica `supabase/migrations/001_init.sql` en el SQL Editor.
4. **ElevenLabs** (una sola vez): `pnpm setup:elevenlabs` → pega el `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` que imprime en `.env`.
5. **Memorias de clawd** (opcional, una vez): `pnpm migrate:clawd`.
6. Arranca todo:
   ```bash
   pnpm dev   # web :3000 + agente :8642
   ```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Web + agente en paralelo |
| `pnpm dev:agent` | Solo el agent server (:8642) |
| `pnpm setup:elevenlabs` | Crea/actualiza el agente de voz y sus client tools |
| `pnpm migrate:clawd` | Importa las ~180 memorias de `~/dev/side/clawd` |
| `pnpm typecheck` | Typecheck de todos los paquetes |

## Cómo funciona la voz sin túnel

Los *client tools* de ElevenLabs se ejecutan **en el browser**, así que pueden llamar a `localhost:8642` directo. El LLM de voz solo conversa y rutea; todo lo que toca la máquina pasa por `run_task` → el Claude Agent SDK trabaja async y la voz reporta con `check_task`. Guardrail `canUseTool` bloquea comandos destructivos (`rm -rf`, `sudo`, force-push, etc.).

## Multi-Mac (Tailscale)

Para ver y controlar el Hermes de otra Mac (p.ej. la portátil manejando los proyectos de la mini):

1. Instala [Tailscale](https://tailscale.com) en ambas Macs con la misma cuenta y anota la IP `100.x.y.z` de la Mac "servidor" (`tailscale ip -4`).
2. En el `.env` de la Mac servidor define `HERMES_API_KEY=<key fuerte>` — con key el agente pasa de escuchar solo en 127.0.0.1 a 0.0.0.0 **exigiendo Bearer** (o `?key=` en los SSE).
3. En la Mac cliente: clona el repo, `pnpm install`, `.env` con el MISMO Supabase, su propio `MACHINE_NAME`, y:
   ```bash
   NEXT_PUBLIC_HERMES_API_KEY=<la misma key>
   NEXT_PUBLIC_HERMES_AGENTS=mini=http://100.x.y.z:8650|portatil=http://localhost:8650
   ```
4. `pnpm --filter @hermes/web dev` en la cliente basta (usa el agente remoto); el selector de máquina aparece en el header del dashboard. Si además corre su propio agente, puede alternar entre ambos.

Memorias, presencia y `projects_cache` ya se comparten vía Supabase entre todas las máquinas.

## Seguridad

- Sin `HERMES_API_KEY` el agent server escucha SOLO en 127.0.0.1 (y CORS de localhost). Con key escucha en 0.0.0.0 exigiendo Bearer/`?key=` — pensado para Tailscale, no para exponerlo a internet.
- Al terminar o fallar un run/tarea hay notificación nativa de macOS (`HERMES_NOTIFY=0` la apaga).
- Escrituras del agente limitadas al vault, `~/dev` y `~/Documents`.
