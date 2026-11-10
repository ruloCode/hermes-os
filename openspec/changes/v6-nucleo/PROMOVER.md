# Llevar v6 «Núcleo» a producción

Estado al 2026-11-10: todo vive en las ramas `v6/nucleo` de los dos repos (carpetas `hermes-os-v6` y
`hermes-phone-v6`). Producción no se tocó: ni reinicios, ni migraciones, ni push, ni ElevenLabs.

## Verificado
- `pnpm typecheck` en verde · `pnpm test` 1.680 + 18 en verde · `pnpm --filter @hermes/web build` en verde.
- Teléfono: `:core:test` 364 en verde · `:app:assembleDebug` → 0.2.0 (código 2).
- Agente de ensayo (:8669): arranca en ~2 s y responden las 13 rutas nuevas con datos reales.
- Chat por la sesión viva (Haiku 5.5): turnos 2 y 3 en 1,1 y 0,7 s al primer texto; Detener corta y el
  siguiente turno recuerda lo interrumpido.
- Revisión independiente: 10 hallazgos, todos corregidos o cubiertos (ver commits `fix(v6)`).

## Sin verificar
- Nada de la 0.2.0 se abrió en el S25 (pasos en `specs/telefono-app`, `specs/telefono-cuerpo` y
  `specs/telefono-foco`, sección «Sin probar en el teléfono real»).
- Ids de Reels/Shorts del freno por superficie: `./phone qa focus surface` para confirmarlos.
- Los jobs nuevos corriendo solos bajo launchd (memoria 15 min, sueño 3:30, pulso 10 min).
- El hook de uso de skills con una invocación real.

## Pasos (en este orden)

1. **Agente y web.** En `hermes-os`:
   ```bash
   git fetch . v6/nucleo   # o desde la carpeta: git -C ../hermes-os-v6 log --oneline f9f2a36..HEAD
   git merge --ff-only v6/nucleo     # main sigue en b75723b + tu trabajo sin commitear (ya va en el commit base f9f2a36)
   pnpm install && pnpm typecheck && pnpm test
   pnpm build
   launchctl kickstart -k gui/$UID/com.hermes-os.agent
   launchctl kickstart -k gui/$UID/com.hermes-os.web
   ```
   Ojo: `main` tiene cambios sin commitear que YA están en el commit base de la rama. Antes del merge,
   descártalos en `main` (`git stash` para tenerlos a mano) o el merge se negará.
2. **Comprobar** (`Authorization: Bearer $HERMES_API_KEY`): `GET /memoria/status` → `"health":"hibrida"`;
   `GET /usage/summary?days=1`; abrir `/gasto`, `/finanzas` («Hoy puedes gastar»), `/ingles` (Repaso) y la
   tarjeta de junta («Preparación»).
3. **Teléfono.** `adb install -r ~/Downloads/hermes-phone-0.2.0.apk` (o `./phone install` desde
   `hermes-phone-v6`). Firmado con la llave de depuración de esta Mac. Luego en `hermes-phone`:
   `git merge --ff-only v6/nucleo` (también allí hay cambios sin commitear que ya van en la rama).
4. **Opcional, voz del teléfono:** la voz aún pide «lee otra vez» tras cada toque. Para que use la pantalla
   que ahora devuelve cada acción, ajustar `PHONE_PROMPT` y republicar con `pnpm setup:elevenlabs --phone`.

## Interruptores (todos con valor por defecto seguro)
| Variable | Default | Para qué |
|---|---|---|
| `HERMES_MODEL_TIER_<FAST\|BALANCED\|DEEP\|FRONTIER>` | catálogo | Cambiar el modelo de un nivel entero |
| `HERMES_MODEL` | vacío | Chat y tareas (como antes) |
| `HERMES_CHAT_SESSION` | persistente | `oneshot` vuelve al camino de una vuelta |
| `HERMES_MEMORY` | `auto` | `supabase` vuelve a la búsqueda anterior |
| `HERMES_PULSE` | bandeja | `off` lo apaga · `notify` permite avisos al teléfono |
| `HERMES_PULSE_DISTRACTION_APPS` | vacío | Sin esto no hay tarjetas de foco en el pulso |

## Cambios de comportamiento que vas a notar
- El chat pasa de Opus 5.5 (el default del CLI) a Sonnet 5.5. Si lo extrañas: `HERMES_MODEL=claude-opus-5-5`.
- La búsqueda de conocimiento usa el índice local (no OpenAI); la primera búsqueda tras un rato tarda
  ~1,3 s mientras arranca el motor de vectores (~760 MB de RAM, se apaga a los 10 min sin uso).
- Las conversaciones del tutor de proyecto ya no entran a la memoria buscable (son solo LAN).

## Datos que dejaron las pruebas
- Supabase: mensajes y filas de `sessions` con ids `qa-v6-*` (el historial los excluye).
- `~/.hermes-os/memoria/v2/` (índice real, 26 MB), `~/.hermes-os/meetings/prep/nevadatech/2026-11-10.json`,
  `~/.hermes-os/usage/calls-2026-11-10.jsonl`, `~/.hermes-os/models/bge-m3-Q8_0.gguf` (635 MB).
