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
- [ ] 1.1 Migrar todos los `query()` a `trackedQuery` con su `feature`; test que prohíbe `query(` suelto
- [ ] 1.2 Quitar ids de modelo de `env.ts` y de los módulos: todo por `modelFor`
- [ ] 1.3 `usage-routes.ts`: `/usage/summary`, `/usage/calls`
- [ ] 1.4 Prompt estable: base por sesión + `<contexto-hermes>` en el mensaje; tests
- [ ] 1.5 Perfiles de tools por canal
- [ ] 1.6 Hook `PostToolUse` → `recordSkillUse`
- [ ] 1.7 Sesión persistente del chat con caída al camino de una vuelta; medir segundo turno
- [ ] 1.8 Panel de gasto en la web

## 2. Memoria v2 (`memoria/`, `shared/memory-index.ts`, `knowledge.ts`, `embeddings.ts`, `memory.ts`)
- [ ] 2.1 Lógica pura: tokenizador, BM25, coseno, fusión, diversidad, vigencia; tests
- [ ] 2.2 Motor de vectores local administrado + enfriamiento de OpenAI
- [ ] 2.3 Almacén en disco e ingesta de fuentes (Supabase y `~/.hermes-os`)
- [ ] 2.4 `searchKnowledge` en modo `auto|v2|supabase`; `save_memory` inserta al instante
- [ ] 2.5 Sincronización incremental (job) y `pnpm memoria:build`
- [ ] 2.6 Sueño nocturno con propuestas
- [ ] 2.7 `/memoria/status` + aviso único + panel en la web
- [ ] 2.8 `pnpm memoria:eval` con comparación de modos; correrlo con datos reales y guardar el resultado

## 3. Juntas (`meetings/prep*.ts`, `shared/meeting-prep.ts`, `components/live/`)
- [ ] 3.1 Lógica pura: pendientes y promesas desde actas, validación de fuentes; tests
- [ ] 3.2 `meetings/prep.ts` + rutas + caché por proyecto y día
- [ ] 3.3 Preparación en el contexto del copiloto
- [ ] 3.4 Tarjeta de inicio en la web
- [ ] 3.5 Simulaciones `live:sim` en verde con el catálogo nuevo

## 4. Inglés (`english/review*.ts`, `shared/english-review.ts`, `components/ingles/`)
- [ ] 4.1 Lógica pura: tarjetas desde errores, Leitner, comparación tolerante, racha; tests
- [ ] 4.2 Almacén y rutas `/english/review/*`
- [ ] 4.3 Repaso en `/ingles`

## 5. Finanzas (`finance/today*.ts`, `shared/finance-today.ts`, `components/` de finanzas)
- [ ] 5.1 Lógica pura: disponible hoy, repetidos, hormiga, desvíos; tests
- [ ] 5.2 Rutas `/finance/today` y `/finance/insights` + tool con candado
- [ ] 5.3 Sección en `/finanzas`

## 6. Teléfono: cuerpo (`phone:body/ link/ net/ voice/ core/`, `apps/agent/src/phone/`)
- [ ] 6.1 Actuar devuelve pantalla; capacidades en el `hello`; tests de protocolo
- [ ] 6.2 `act_batch` e `intent` (teléfono y tools del agente)
- [ ] 6.3 Plazo de confirmación compartido
- [ ] 6.4 Conexión por la primera ruta buena; tests
- [ ] 6.5 Cola de chat sin conexión
- [ ] 6.6 Recorte por líneas para la voz; desplazar contenedor

## 7. Teléfono: foco (`phone:core/Focus*.kt`, `focus/`, `ui/Focus*.kt`)
- [ ] 7.1 Presupuesto diario, fricción creciente, intención; tests
- [ ] 7.2 Superficies (Reels, Shorts) con configuración y diagnóstico
- [ ] 7.3 Hoja con aperturas y minutos; plantillas
- [ ] 7.4 Resumen semanal en el agente (`focus/`)

## 8. Teléfono: aplicación (`phone:ui/`, `net/`)
- [ ] 8.1 Repaso de inglés (con cola sin conexión)
- [ ] 8.2 Finanzas de hoy
- [ ] 8.3 Preparación de junta
- [ ] 8.4 Novedades, versión 0.2.0, APK

## 9. Cierre (orquestador)
- [ ] 9.1 Revisión independiente de los cambios y correcciones
- [ ] 9.2 `pnpm typecheck`, `pnpm test`, `pnpm build`; `./gradlew :core:test :app:assembleDebug`
- [ ] 9.3 Agente de ensayo: arranque y rutas nuevas
- [ ] 9.4 `CLAUDE.md` como índice + `docs/contexto/`
- [ ] 9.5 Informe de la noche, pasos para promover a producción y APK en `~/Downloads`

## 10. Segunda fase
- [ ] 10.1 Pulso (`pulso/`)
