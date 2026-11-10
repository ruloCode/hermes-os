# Tareas de v6 «Núcleo»

Cada paquete tiene un dueño y carpetas propias, para que varios trabajen a la vez sin pisarse.
Reglas para todos los paquetes:

- Rama `v6/nucleo`. Carpetas de trabajo: `hermes-os-v6` y `hermes-phone-v6`. Los repos originales no se tocan.
- Producción no se toca: nada en `:8650` ni `:31415`, ningún `launchctl`, ninguna migración, ningún push,
  ningún `setup:elevenlabs`.
- De noche no se toca el mundo físico: nada de luces, TV, avisos al teléfono ni comandos `adb` al teléfono real.
- Rutas nuevas en un archivo propio `mountXRoutes(app)`; en `index.ts` solo el `import` y el `mount`.
- Toda llamada al modelo por `trackedQuery`; ningún id de modelo fuera de `models.ts`.
- Lógica pura en `packages/shared` (o `:core`) con tests de contrato.

## 0. Cimientos (orquestador)
- [x] 0.1 Ramas y carpetas `v6` con el trabajo pendiente como commit base
- [x] 0.2 Línea base: typecheck, 1.444 + 18 tests, APK de depuración
- [x] 0.3 SDK 0.3.322 y sonda de modelos (`scripts/probe-models.ts`)
- [x] 0.4 `llama.cpp` instalado y `bge-m3-Q8_0.gguf` descargado y probado
- [x] 0.5 Especificación (este cambio)
- [x] 0.6 `agent/models.ts` + tests
- [x] 0.7 `agent/tracked-query.ts`, `usage-ledger.ts`, `shared/usage-ledger.ts` + tests

## 1. Núcleo (`agent/`, `env.ts`, sitios que llaman al modelo)
- [x] 1.1 Migrar todos los `query()` a `trackedQuery` con su `feature`; test que prohíbe `query(` suelto
- [x] 1.2 Quitar ids de modelo de `env.ts` y de los módulos: todo por `modelFor`
- [x] 1.3 `usage-routes.ts`: `/usage/summary`, `/usage/calls`
- [x] 1.4 Prompt estable: base por sesión + `<contexto-hermes>` en el mensaje; tests
- [x] 1.5 Perfiles de tools por canal
- [x] 1.6 Hook `PostToolUse` → `recordSkillUse`
- [x] 1.7 Sesión persistente del chat con caída al camino de una vuelta; medir segundo turno
- [x] 1.8 Panel de gasto en la web

## 2. Memoria v2 (`memoria/`, `shared/memory-index.ts`, `knowledge.ts`, `embeddings.ts`, `memory.ts`)
- [x] 2.1 Lógica pura: tokenizador, BM25, coseno, fusión, diversidad, vigencia; tests
- [x] 2.2 Motor de vectores local administrado + enfriamiento de OpenAI
- [x] 2.3 Almacén en disco e ingesta de fuentes (Supabase y `~/.hermes-os`)
- [x] 2.4 `searchKnowledge` en modo `auto|v2|supabase`; `save_memory` inserta al instante
- [x] 2.5 Sincronización incremental (job) y `pnpm memoria:build`
- [x] 2.6 Sueño nocturno con propuestas
- [x] 2.7 `/memoria/status` + aviso único + panel en la web
- [x] 2.8 `pnpm memoria:eval` con comparación de modos; correrlo con datos reales y guardar el resultado

## 3. Juntas (`meetings/prep*.ts`, `shared/meeting-prep.ts`, `components/live/`)
- [x] 3.1 Lógica pura: pendientes y promesas desde actas, validación de fuentes; tests
- [x] 3.2 `meetings/prep.ts` + rutas + caché por proyecto y día
- [x] 3.3 Preparación en el contexto del copiloto
- [x] 3.4 Tarjeta de inicio en la web
- [ ] 3.5 Simulaciones `live:sim` en verde con el catálogo nuevo

## 4. Inglés (`english/review*.ts`, `shared/english-review.ts`, `components/ingles/`)
- [x] 4.1 Lógica pura: tarjetas desde errores, Leitner, comparación tolerante, racha; tests
- [x] 4.2 Almacén y rutas `/english/review/*`
- [x] 4.3 Repaso en `/ingles`

## 5. Finanzas (`finance/today*.ts`, `shared/finance-today.ts`, `components/` de finanzas)
- [x] 5.1 Lógica pura: disponible hoy, repetidos, hormiga, desvíos; tests
- [x] 5.2 Rutas `/finance/today` y `/finance/insights` + tool con candado
- [x] 5.3 Sección en `/finanzas`

## 6. Teléfono: cuerpo (`phone:body/ link/ net/ voice/ core/`, `apps/agent/src/phone/`)
- [x] 6.1 Actuar devuelve pantalla; capacidades en el `hello`; tests de protocolo
- [x] 6.2 `act_batch` e `intent` (teléfono y tools del agente)
- [x] 6.3 Plazo de confirmación compartido
- [x] 6.4 Conexión por la primera ruta buena; tests
- [x] 6.5 Cola de chat sin conexión
- [x] 6.6 Recorte por líneas para la voz; desplazar contenedor

## 7. Teléfono: foco (`phone:core/Focus*.kt`, `focus/`, `ui/Focus*.kt`)
- [x] 7.1 Presupuesto diario, fricción creciente, intención; tests
- [x] 7.2 Superficies (Reels, Shorts) con configuración y diagnóstico
- [x] 7.3 Hoja con aperturas y minutos; plantillas
- [x] 7.4 Resumen semanal en el agente (`focus/`)

## 8. Teléfono: aplicación (`phone:ui/`, `net/`)
- [x] 8.1 Repaso de inglés (con cola sin conexión)
- [x] 8.2 Finanzas de hoy
- [x] 8.3 Preparación de junta
- [x] 8.4 Novedades, versión 0.2.0, APK

## 9. Cierre (orquestador)
- [x] 9.1 Revisión independiente de los cambios y correcciones
- [x] 9.2 `pnpm typecheck`, `pnpm test`, `pnpm build`; `./gradlew :core:test :app:assembleDebug`
- [x] 9.3 Agente de ensayo: arranque y rutas nuevas
- [x] 9.4 `CLAUDE.md` como índice + `docs/contexto/`
- [x] 9.5 Pasos para promover a producción (`PROMOVER.md`) y APK en `~/Downloads/hermes-phone-0.2.0.apk`

## 10. Segunda fase
- [x] 10.1 Pulso (`pulso/`)
