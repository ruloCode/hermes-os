# Acuerdos de trabajo para quien implementa v6 (lee esto primero)

Varios agentes trabajan A LA VEZ sobre las mismas carpetas. Estas reglas evitan que se pisen y que
alguien toque producción mientras el dueño duerme.

## Dónde se trabaja

- `hermes-os` → **`/Users/rulocode/dev/side/hermes-os-v6`** (rama `v6/nucleo`).
- `hermes-phone` → **`/Users/rulocode/dev/side/hermes-phone-v6`** (rama `v6/nucleo`).
- **Nunca** edites `/Users/rulocode/dev/side/hermes-os` ni `/Users/rulocode/dev/side/hermes-phone`: de
  ahí corre producción.

## Lo que está prohibido esta noche

1. **Producción**: nada contra `:8650` ni `:31415`. Ningún `launchctl`. Ningún `git push`. Ninguna
   migración de Supabase. Ningún `pnpm setup:elevenlabs`. Ningún `pnpm build` de la web (lo corre el
   orquestador al final, una vez).
2. **El mundo físico**: el dueño duerme. Nada de luces, TV, escenas, avisos al teléfono
   (`/phone/notify`, `notifyMac`), llamadas, ni comandos `adb` contra el teléfono real. No arranques
   emuladores de Android.
3. **Git**: no hagas `git add`, `git commit`, `git stash`, `git checkout` ni `git reset`. El
   orquestador hace los commits al final, por paquete. Solo edita archivos.
4. **Procesos**: nunca `pkill`/`killall`. Si arrancas un proceso, lo matas por SU PID o por SU puerto
   (`lsof -ti :PUERTO | xargs kill`).
5. **Datos reales**: Supabase y el vault son los de producción. Lee lo que necesites; no escribas
   filas ni notas de prueba. Si una prueba tiene que escribir, usa una carpeta temporal
   (`HERMES_HOME=$(mktemp -d)` o la variable que tu módulo defina).
6. **Dependencias**: no agregues paquetes de npm ni de Gradle.

## Cómo no pisarse

- Cada paquete tiene carpetas propias (están en tu encargo). Fuera de ellas, edita lo mínimo y vuelve
  a leer el archivo justo antes de editarlo: otro agente pudo cambiarlo.
- **`apps/agent/src/index.ts` no se toca.** Tus rutas van en TU archivo de rutas (ya existe como
  esqueleto y ya está montado desde `apps/agent/src/v6.ts`). Tus jobs van en tu archivo de jobs.
- **`packages/shared/src/index.ts` no se toca**: tu módulo puro ya está exportado.
- **`apps/agent/src/env.ts` solo lo toca el paquete «núcleo»**: los demás leen `process.env` dentro
  de su módulo.
- Cliente web: no agregues funciones a `apps/web/src/lib/hermes.ts`; crea
  `apps/web/src/lib/<paquete>-api.ts` reutilizando sus helpers.
- Mientras otros trabajan, `pnpm typecheck` puede mostrar errores en archivos ajenos: arregla solo
  los tuyos y repórtalos si te bloquean.

## Reglas del proyecto

- Español en UI, comentarios y mensajes; código y nombres en inglés. Sin nombres propios en el código.
- Todo dato visible es real: si la fuente no existe, el elemento no se muestra. Nada de marcadores de relleno.
- Toda llamada al modelo va por `trackedQuery(feature, …)` de `apps/agent/src/agent/tracked-query.ts`
  (pone `childEnv()` y el modelo del catálogo, y registra el gasto). Ningún id `claude-*` fuera de
  `apps/agent/src/agent/models.ts`. Si tu función no está en `FEATURES`, pídele la fila al paquete
  «núcleo» en tu informe y usa mientras tanto la más parecida que exista.
- Lógica pura en `packages/shared/src/<módulo>.ts` (teléfono: `:core`), con tests de contrato en
  `apps/agent/src/<carpeta>/<nombre>.test.ts`. Nunca snapshots. Un test por cada `#### Scenario` de tu spec.
- Las rutas HTTP responden `{ ok: true, … }` o `{ ok: false, error }` con 200, como `/gym/*`, cuando la
  interfaz debe mostrar el motivo.
- UI web: lee `docs/ui-v5-grafito.md` antes de tocarla. Colores por clases de tokens, primitivos de
  `apps/web/src/components/ui/`, probado en tema claro y oscuro. Sin dependencias nuevas.
- Comentarios: explican el porqué, como el resto del repo.

## Cómo probar

- Tus tests: `cd apps/agent && node --test --import tsx src/<carpeta>/<archivo>.test.ts`
- Tipos: `pnpm --filter @hermes/shared typecheck && pnpm --filter @hermes/agent typecheck` (y `@hermes/web` si tocaste la web).
- Agente de ensayo (solo si tu encargo lo pide), en TU puerto:
  `cd apps/agent && HERMES_PORT=<puerto> HERMES_JOBS=off HERMES_HUB=off HERMES_LEARNING=off MACHINE_NAME=ensayo-v6 pnpm exec tsx src/index.ts > /tmp/ensayo-<puerto>.log 2>&1 &`
  Llave: `HERMES_API_KEY` del `.env` como `Authorization: Bearer …`. Solo `GET` y tus rutas nuevas.
  Mátalo por puerto al terminar.
- Web: `pnpm --filter @hermes/web typecheck`. Para verla, `next dev` en TU puerto
  (`NEXT_PUBLIC_WEB_PORT=<puerto>`; escribe en `.next-dev/`, no en `.next/`).
- Teléfono: `cd /Users/rulocode/dev/side/hermes-phone-v6 && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew --console=plain -q :core:test :app:assembleDebug`

## Qué entregar

Al terminar, tu mensaje final debe traer:

1. Qué quedó hecho, por tarea de `tasks.md` (y cuáles no, con el motivo).
2. Archivos creados y modificados.
3. Resultado de tus tests y del typecheck (números).
4. Lo que mediste (latencias, conteos) con el comando que lo reproduce.
5. Lo que NO pudiste verificar, dicho como tal.
6. Decisiones que tomaste que se apartan de la spec o del diseño, y por qué.

Además, agrega al final de TU `specs/<capacidad>/spec.md` una sección `## Notas de implementación`
con las decisiones y los límites conocidos. No marques casillas en `tasks.md`: las marca el orquestador.
