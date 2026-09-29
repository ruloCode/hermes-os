# Oficina de agentes 3D (`/oficina`)

2026-09-29 · para el workshop de la comunidad de Anthropic (2026-10-01)

Una oficina 3D con estilo de caricatura donde cada sesión **viva** del Claude Agent SDK o run de `claude -p` que corre en Hermes es un personaje sentado en un escritorio. Los personajes se agrupan por proyecto del vault. Cada uno actúa su tool real, su bombilla dice su estado y su laptop muestra sus últimas líneas. Desde la misma oficina se contrata un agente y se abre la salida de cualquiera.

Inspirada en [agent-office](https://github.com/AgentSystemLabs/agent-office) (AgentSystemLabs, MIT). De ahí se portó el **motor visual**, no la infraestructura: el look toon (`MeshToonMaterial` con rampa de 3 pasos más `OutlineEffect`), el personaje con sus poses, la laptop, el confeti y el mapeo tool → pose (`actions.ts`). Cada archivo portado lo dice en su cabecera. agent-office corre CLIs en PTYs y lee su estado con hooks de Claude Code. Hermes ya tenía el bus de actividad del SDK, así que el estado sale de ahí.

![Oficina en simulación, tema oscuro](img/oficina-oscuro.png)

## Qué se ve

| En pantalla | Qué lo produce |
| --- | --- |
| Un pod de escritorios por proyecto, con tapete del color del proyecto | `buildOfficeLayout` (`packages/shared/src/office-layout.ts`). Un proyecto abre su pod cuando llega su primer agente y no se mueve en la sesión. **Todos los proyectos** muestra también los activos sin nadie |
| Un personaje por sesión viva, en el primer escritorio libre de su pod | `assignSeats`: pegajoso, nunca dos en un escritorio. Si el pod está lleno (4) va a General |
| Papeles al leer, teclear encorvado al editar, recostado en los tests, globo en la web | La última tool (`toolAction`, `office-actions.ts`). Dos tests fallidos seguidos: cabeza entre las manos |
| Bombilla y tarjeta: trabajando, pensando, bloqueado, listo, error | El reductor del agente (tabla de estados abajo) |
| La laptop con sus últimas líneas | `OfficeWorker.lines`: `⚙` tool y objetivo, `↩` resultado, texto del modelo, `✓`/`✗` cierre |
| Giro y confeti al terminar; tres minutos después se va | `celebrate()` y `Confetti.burst`; `GRACE_MS` en el reductor |
| Clic en un personaje: panel con su salida y ⏹ Detener | Para runs, el stream real `GET /claude/run/:id/stream`. Para el resto, sus líneas |
| Clic en un **+**: contratar | Con proyecto, `claude -p` en su carpeta con la config de la consola. En General, tarea de Hermes (`POST /tasks`) |

## Estados honestos

Hermes no tiene un "esperando tu respuesta" real, porque `canUseTool` decide solo. Por eso no se inventa:

| Estado | Cuándo |
| --- | --- |
| Arrancando | Registrado o `task_start`, sin tools todavía |
| Trabajando | Llegó una tool o texto en los últimos 12 s |
| Pensando | Sigue vivo pero lleva 12 s sin eventos (`THINKING_AFTER_MS`) |
| Bloqueado | Un guardrail o el Chrome CDP negaron una tool. Dura hasta la siguiente tool |
| Listo | `task_done` (o ✓ de una programada) |
| Error | `error` terminal: el cierre de un run o un fallo del SDK. `startTask` emite `task_done` aun cuando falló, y el error manda |

## Arquitectura

```
spawn points ── registerOfficeWorker({id, source, project, title})
(claude-cli, startTask, content/edit, scheduled/runner)
     │
bus emit() ──► office/state.ts ── reduceOfficeEvent + tickOffice (cada 2 s)
                 ├─ GET /office/state    snapshot (curl, QA)
                 └─ GET /office/events   SSE propio: snapshot al conectar + {worker|removed}
                                          │
                              /oficina (page.tsx) ── OficinaScene ── OfficeWorld (three.js)
```

- **La lógica es pura y tiene tests** en `packages/shared/src/office*.ts`, probados en `apps/agent/src/office/*.test.ts`: reductor, acciones y layout.
- **El canal es propio a propósito.** Por el bus general, cada tool call se duplicaría y sacaría del búfer de `/events` los eventos reales del feed del dashboard.
- **Los runs de `claude -p` emiten tool por tool.** `emitRunActivity` en `claude-cli.ts` saca `tool_call`, `text` y `tool_result` con `taskId = run.id`; antes solo emitían inicio y fin. El feed y las sparklines también lo ganan.
- **Los chats de texto no aparecen.** `/v1/chat/completions` emite sin `taskId`.
- **Privacidad:** los eventos privados (Composición) no salen por el túnel en ninguna de las dos rutas.
- **Colores:** todos salen de los tokens del tema (`lib/oficina/palette.ts`). La escena se re-monta con `key={theme.resolved}`.

## Ensayo y demo

```bash
# Sin gastar tokens: en la consola del navegador, en /oficina
window.__hermesOficinaSim("demo")   # 8 personajes, todos los estados (el HUD dice "simulación")
window.__hermesOficinaSim(null)     # vuelta a lo real

# QA automático en los dos temas (clics reales, capturas en docs/img)
~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-qa.py --url http://localhost:31415

# Trabajo REAL en paralelo: runs de solo lectura con Sonnet y esfuerzo bajo, más una tarea de Hermes.
# Para el público, pasa proyectos que se puedan mostrar (sin nombres de clientes):
scripts/oficina-demo.sh hermes-os zylen video-edit
scripts/oficina-demo.sh --cost      # costo (4 runs de prueba ≈ $0,80)
scripts/oficina-demo.sh --kill      # detener lo que siga corriendo
```

**Guion sugerido:**

1. Abre `http://localhost:31415/oficina` (en localhost, no por IP ni túnel). La oficina está vacía y solo existe el pod General.
2. Con ⌘K, "Oficina de agentes". Clic en el **+** de General, elige un proyecto y contrata. Aparece un pod nuevo con su personaje, que empieza a leer.
3. Lanza `scripts/oficina-demo.sh` con dos o tres proyectos. Llegan equipos nuevos y cada uno actúa su tool.
4. Por voz: "Hermes, trabaja en el proyecto X…" (`work_on_project`). Aparece otro personaje.
5. Clic en uno: su salida en vivo. Espera el ✓ y el confeti.

Los prompts de `oficina-demo.sh` terminan en 10 a 20 s. Para un demo más largo, contrata con una tarea de varios pasos, por ejemplo "revisa X, corre los tests y propón un arreglo sin editar".

## Seams de QA

| Seam | Uso |
| --- | --- |
| `__hermesOficinaSim(state \| "demo" \| null)` | Sustituye el estado real, siempre marcado como simulación |
| `__hermesOficinaDebug()` | Personajes, asientos, selección, escritorios y fps |
| `__hermesOficinaScreenOf(hit)` | Posición en pantalla de un escritorio o personaje, para clics reales |
| `__hermesOficinaFocus(hit)` | Lleva la cámara a un escritorio o personaje |

## Pendiente (stretch)

- Salida con caja por la puerta, como en agent-office. Hoy el personaje se encoge y desaparece.
- Nombre del personaje escrito por Haiku, debounced. Hoy son las primeras palabras de la tarea.
- `taskId` en los turnos de chat, para que la consola de texto también tenga personaje.
- Voz al hacer clic en un personaje: `useVoiceConnect.switchTo` con el proyecto como scope.
