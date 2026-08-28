# Prompt: auditoría del flujo de creación de contenido (RuloCodeShow)

> Pégale esto a otro agente que trabaje sobre `~/dev/side/hermes-os`.
> Preparado 2026-08-10 con el estado real del repo y de la base verificado.
> Si lo usas semanas después, los números de la sección "Estado medido" habrán
> cambiado — dile al agente que los vuelva a medir antes de razonar sobre ellos.

---

## Contexto

Eres un agente trabajando en **Hermes OS** (`~/dev/side/hermes-os`), el sistema
operativo personal de Rulo. Lee primero `CLAUDE.md` en la raíz: ahí está la
arquitectura y las convenciones, y **son obligatorias**.

Este encargo es sobre el **tab ESTUDIO**: el pipeline de producción de
contenido de la marca **RuloCodeShow** (video vertical de ~40 s para YouTube
Shorts + TikTok + Instagram Reels, más posts de LinkedIn).

La estrategia madre vive en el vault de Obsidian
(`/Users/rulocode/Documents/Obsidian Vault`):

- `projects/rulocode/docs/estrategia-marca-personal-2026.md` — posicionamiento,
  pilares P1-P5, objetivos de negocio.
- `projects/rulocodeshow/docs/etapas-de-produccion.md` — definición de etapas.
- `projects/rulocodeshow/contenido/` — 15 guiones reales espejados en .md.

**Léelos antes de opinar.** El objetivo comercial detrás del contenido es una
meta de ingresos por servicios de agentes de IA; el contenido es el funnel, no
un fin en sí mismo. Una recomendación que ignore eso no sirve.

---

## Tu misión

Auditar **todo el ciclo de creación de contenido** y entregar un plan de mejora
priorizado. El ciclo, de punta a punta:

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   ▼                                                              │
① IDEA ──▶ ② GUION/HOOK ──▶ ③ GRABACIÓN ──▶ ④ EDICIÓN ──▶ ⑤ PUBLICACIÓN
 ¿de dónde     ¿qué se dice   ¿cómo se       ¿cómo queda   ¿dónde y
  sale?         y cómo abre?   captura?        el corte?     cuándo sale?
                                                                  │
                                                                  ▼
                                                          ⑥ RESULTADOS
                                                          ¿funcionó? ¿por qué?
                                                                  │
                                                                  │
   └──────────────────── el bucle que hoy NO existe ──────────────┘
```

**La pregunta madre: ¿por qué el bucle no se cierra, y qué hace falta para que
cada video publicado mejore el siguiente?**

---

## Estado medido del sistema (verificado 2026-08-10)

Estos números salen de `GET /content/board` contra la base real. Vuélvelos a
medir tú mismo antes de razonar sobre ellos.

| Dato | Valor | Qué sugiere |
|---|---|---|
| Piezas totales | 22 | — |
| En `guion` | **12** | Cuello de botella evidente: más de la mitad atascadas escribiendo |
| En `idea` | 6 | — |
| En `grabacion` / `edicion` | 1 / 1 | El batch de grabación casi no se usa |
| **Publicadas** | **2** | Ratio idea→publicado ≈ 9% |
| Sesiones de grabación | 1 | El modelo de batch sabatino no arrancó |
| Referencias del radar | 15 (7 tendencias · 6 referentes · 2 guardadas) | Se capturan… |
| Piezas con `ref_id` | **0** | …pero **ninguna idea nació de una referencia**. La trazabilidad existe en el esquema y nadie la usa |
| Ingesta de métricas | **0 líneas de código** | No hay analytics de ninguna plataforma en ningún sitio del repo |

---

## Qué existe hoy (no lo reinventes: audítalo)

**Backend** — `apps/agent/src/content/`:

| Archivo | Qué hace |
|---|---|
| `store.ts` | CRUD de piezas, transiciones de etapa (`stage_history`), espejo al vault, enlace a Linear |
| `generate.ts` | Genera el "kit" con el Agent SDK: guion + hook + plan de tomas + puntos de edición + copies |
| `variants.ts` | 3-5 versiones alternativas de una parte del guion (pool por bloque) |
| `chat.ts` | Chat por pieza con memoria; sus únicas tools son `get_piece`/`update_piece` |
| `media.ts` | Carpeta canónica en el disco extraíble + `resolveMaster` |
| `edit.ts` | Crudos + run de edición automática (OpenMontage, repo aparte en `~/dev/video-edit`) |
| `publish.ts` + `providers/youtube.ts` | Publicación automática a YouTube (fase 1) |

**Definición compartida** — `packages/shared/src/content.ts`: `STAGES`,
`stageGates` (criterios de salida calculados sobre el dato real),
`pipelineProgress`, `isStuck`, `PLATFORM_PROVIDER`, `effectiveTitle`.

**Frontend** — `apps/web/src/components/estudio/`: pipeline, workspace por
pieza (Guion / Tomas / Edición / Publicación), `RecordMode` (teleprompter con
beats), `EstudioRadar` (tendencias/referentes/guardadas), `PlatformCards`,
`SchedulePanel`, `PublishTab`.

**Datos** — Supabase: `content_pieces`, `content_sessions`, `content_refs`,
`content_chat_messages`. Migraciones 016-021 en `supabase/migrations/`.

---

## Las seis preguntas, una por fase

Para cada una: **mide primero, opina después**. Mira el dato real (base, repo,
vault, guiones publicados) antes de proponer nada.

### ① IDEA — ¿de dónde salen y deberían salir de otro lado?

- ¿Cómo nacen hoy las 22 piezas? (mira `created_at`, `ref_id`, `notes`, el chat)
- El radar tiene 15 referencias y **0 piezas trazadas a ellas**: ¿es que el
  radar no sirve, que no está en el camino, o que falta el paso "convertir
  referencia en idea"?
- ¿Qué fuentes de demanda REAL existen y no se están usando? Piensa en las que
  Hermes ya tiene a mano: reuniones (`meetings`), conversaciones de voz y chat,
  issues de Linear, preguntas repetidas del tutor de inglés, búsquedas del
  knowledge layer (`match_knowledge`). Rulo ya habla con clientes y graba
  juntas — ahí hay dolores reales que podrían ser contenido.
- ¿Qué le falta al modelo para que una idea nazca con una **hipótesis** ("esto
  funciona porque X") en vez de con un título suelto?

### ② GUION / HOOK — el cuello de botella (12 de 22 atascadas)

- Lee los 15 guiones reales del vault. ¿Qué tienen en común los 2 publicados
  frente a los 12 atascados? ¿Longitud, estructura, claridad del ángulo?
- `stageGates` para `guion` pide hook, ≥120 palabras y un CTA detectado por
  regex. ¿Son los criterios correctos o están dejando pasar/atascando lo que no
  deben? ¿La regex del CTA acierta sobre los guiones reales? **Compruébalo.**
- **Hooks**: hoy `variants.ts` genera versiones alternativas pero nada sabe qué
  hook funcionó. ¿Cómo sería una **biblioteca de hooks** con estructura
  (pregunta / dato duro / contraste / error común / promesa) que aprenda de los
  resultados? ¿Qué haría falta guardar para eso?
- ¿`generate.ts` está usando el contexto que ya existe (estrategia, radar,
  guiones anteriores, code-graph) o genera a ciegas? Lee su prompt.

### ③ GRABACIÓN — 1 sesión en todo el histórico

- El modelo de batch sabatino (`content_sessions`) prácticamente no se usa.
  ¿Es el modelo equivocado o la UI no lo pone en el camino?
- `RecordMode` (teleprompter con beats) es sofisticado. ¿Se está usando?
  (mira `takes` por pieza: cuántas tienen veredicto real)
- El checklist de captura se marca solo cuando aparece el archivo en
  `/Volumes/Rulo/estudio/<slug>/crudos/`. ¿Cuántas piezas tienen carpeta y
  archivos de verdad? ¿El disco externo es un obstáculo?

### ④ EDICIÓN — referencias y criterio

- `edit_points` son instrucciones tipadas (corte/zoom/caption/broll/card) que
  alimentan el run de OpenMontage. ¿Cuántas piezas los tienen? ¿El run
  automático se ha usado o se edita todo a mano?
- **Referencias de edición**: hoy `content_refs` guarda referentes como texto.
  ¿Cómo sería un sistema de referencias de edición útil de verdad — ritmo,
  tipos de corte, uso de captions, b-roll — que se pueda aplicar a una pieza
  concreta en vez de leerse como inspiración suelta?
- ¿Qué separa un corte que retiene de uno que no, y qué de eso puede el sistema
  ayudar a decidir ANTES de exportar?

### ⑤ PUBLICACIÓN — recién construida, valídala

- YouTube ya publica solo (`publish.ts`); TikTok e Instagram están en manual.
  Lee `docs/auto-publicacion-rulocodeshow.md` para el porqué de cada bloqueo.
- ¿El copy por red se está reescribiendo de verdad o todo hereda del hook?
- ¿La fecha/hora se elige con criterio o al azar? (hoy no hay dato de audiencia
  que lo informe — di si vale la pena tenerlo)

### ⑥ RESULTADOS — **el agujero grande: no existe**

No hay una sola línea de código que traiga métricas de ninguna plataforma.
El sistema produce y publica a ciegas.

- ¿Qué métricas importan de verdad para el objetivo (no vanity)? Retención a
  3 s, retención media, seguidores ganados, clics al perfil, conversaciones
  iniciadas… Prioriza según el funnel de servicios, no según lo que sea fácil.
- ¿Qué APIs dan esos datos y qué cuestan en permisos? (YouTube Analytics API
  necesita scopes propios; TikTok e Instagram tienen sus insights). **Verifica
  contra la documentación oficial, no de memoria.**
- Diseña el bucle: ¿cómo vuelven esos datos a ① y ②? ¿Qué decisión concreta
  cambia un dato de retención — el tipo de hook, la duración, el pilar?
- Ojo con la regla de oro del dashboard: **todo dato visible es real**. Un panel
  de analíticas inventadas o estimadas es peor que ninguno.

---

## Reglas de la casa (no negociables)

1. **No inventes el estado.** Cada afirmación sobre el sistema va con su
   `archivo:línea` o su consulta. Si no lo mediste, dilo como hipótesis.
2. **Todo dato visible es real.** Nada de métricas estimadas, placeholders ni
   "N/A bonito": si la fuente no existe, el elemento no se pinta.
3. **Español** en UI, comentarios y mensajes; código y nombres en inglés.
4. **No toques las piezas reales de Rulo** para probar. Si necesitas datos,
   crea una pieza fixture (`local_key: qa-*`) y bórrala al terminar. Ya se
   perdieron datos reales por no hacer esto.
5. **No publiques nada.** Cualquier acción que salga hacia fuera (subir un
   video, postear, mandar un correo) está prohibida en esta auditoría.
6. **No agregues dependencias pesadas** al dashboard sin justificarlo.
7. `pnpm typecheck` antes de dar nada por terminado.
8. Las migraciones se aplican con `supabase db push` (la CLI ya está logueada
   con la cuenta correcta).

---

## Entregable

Un documento en `docs/mejoras-flujo-contenido.md` con:

1. **Diagnóstico medido** — el ciclo fase por fase, con los números reales que
   tú mediste (no los de arriba: vuelve a medirlos) y dónde se rompe.
2. **Los 3 cuellos de botella principales**, ordenados por cuánto frenan la
   producción, con la evidencia que lo demuestra.
3. **Propuestas priorizadas** en una tabla: `impacto × esfuerzo`, con qué
   archivos tocaría cada una y qué dato nuevo haría falta guardar.
4. **Diseño del bucle de resultados** — el que hoy no existe: qué métricas, de
   qué API, con qué permisos, dónde se guardan, cómo vuelven a la creación.
   Incluye un diagrama (mermaid o texto) y el modelo de datos propuesto.
5. **Quick wins** — lo que se puede hacer en menos de una hora cada uno y ya
   mueve la aguja.
6. **Decisiones abiertas** para que Rulo confirme antes de construir nada.

## Criterios de aceptación

- Cada número del diagnóstico es reproducible (incluye la consulta o el comando).
- Cada afirmación sobre una API externa lleva enlace a su documentación oficial.
- Las propuestas citan archivos y símbolos que existen de verdad.
- La priorización está justificada contra el objetivo comercial, no contra lo
  que sea técnicamente más entretenido.
- **No se modifica código de producción**: esto es una auditoría, el
  entregable es el documento.

## Cómo verificar

- Abre el doc y comprueba que las rutas citadas existen (`grep`, abrir archivos).
- Re-ejecuta una consulta del diagnóstico y confirma que da el mismo número.
- Confirma que ninguna pieza real cambió: compara `status`, `publish_at` y
  `stage_history` antes y después de tu trabajo.

---

## Pistas de arranque (para que no gastes tiempo buscando)

```bash
# El tablero completo, en JSON:
KEY=$(grep -E "^HERMES_API_KEY=" .env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:8650/content/board | python3 -m json.tool

# Los guiones reales (15 .md):
ls "/Users/rulocode/Documents/Obsidian Vault/projects/rulocodeshow/contenido/"

# Consultas finas a Supabase (service role en el .env de la raíz):
#   tablas: content_pieces · content_sessions · content_refs · content_chat_messages

# Grafo de código del repo (tool del agente): query_code_graph, modes query/path/explain
```

El agente de Hermes corre en `:8650` (launchd `com.hermes-os.agent`) y el
dashboard en `:31415`. Para reiniciar:
`launchctl kickstart -k gui/$UID/com.hermes-os.agent`.
