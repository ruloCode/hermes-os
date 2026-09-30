# Oficina de agentes 3D (`/oficina`)

2026-09-29 · para el workshop de la comunidad de Anthropic (2026-10-01)

Una oficina 3D con estilo de caricatura donde cada sesión **viva** del Claude Agent SDK o run de `claude -p` que corre en Hermes es un personaje sentado en un escritorio. Los personajes se agrupan por proyecto del vault. Cada uno actúa su tool real, su bombilla dice su estado y su laptop muestra sus últimas líneas. Desde la misma oficina se contrata un agente y se abre la salida de cualquiera.

Inspirada en [agent-office](https://github.com/AgentSystemLabs/agent-office) (AgentSystemLabs, MIT). De ahí se portó el **motor visual**, no la infraestructura: el look toon (`MeshToonMaterial` con rampa de 3 pasos más `OutlineEffect`), el personaje con sus poses, la laptop, el confeti y el mapeo tool → pose (`actions.ts`). Cada archivo portado lo dice en su cabecera. agent-office corre CLIs en PTYs y lee su estado con hooks de Claude Code. Hermes ya tenía el bus de actividad del SDK, así que el estado sale de ahí.

![Vista aérea en simulación, tema oscuro](img/oficina-aerea-oscuro.png)

![Explorando junto a un agente, tema claro](img/oficina-cerca-claro.png)

## Recorrer la oficina

El dueño es un personaje dentro de la oficina, un humano portado del `Person` de agent-office. Su nombre sale de `NEXT_PUBLIC_HERMES_OWNER_NAME` y su apariencia se elige en **Tu personaje** (piel, pelo, peinado, camiseta), guardada en el navegador.

| Tecla | Explorar (tercera persona) | Vista aérea |
| --- | --- | --- |
| W A S D / flechas | Caminar, relativo a la cámara | — |
| Shift | Correr | — |
| Espacio | Saltar (se puede subir a un escritorio) | — |
| Arrastrar / rueda | Orbitar / acercar la cámara que lo sigue | Orbitar / zoom |
| E | Interactuar con lo que tiene al alcance: contratar en un escritorio libre o ver a un agente | — |
| Clic | Igual que E, sobre lo que se apunta | Agente o "+" |
| V | Pasar a vista aérea | Volver a explorar |
| Esc | Cerrar panel o diálogo | Igual |

La lista **Equipo** lleva al dueño junto al agente que elijas (en aérea, la cámara va a él). Escribir en un diálogo no mueve al personaje.

## Jugar con el control (Xbox Wireless Controller)

La oficina se juega con un control Bluetooth por la Gamepad API del navegador (mapeo "standard"). Está probada con el **Xbox Wireless Controller** de Microsoft (vendor `045e`, producto `02fd`, el modelo One S) en Chrome sobre macOS. El mapeo es puro y tiene pruebas (`packages/shared/src/gamepad.ts`).

| Control | Acción |
| --- | --- |
| Stick izquierdo | Caminar; más inclinado, más rápido |
| RT | Correr |
| Stick derecho | Mover la cámara (en vista aérea, orbitar) |
| Cruceta ↑ ↓ | Acercar / alejar |
| LT | Recentrar la cámara |
| **A** | Hablar con el agente o contratar en el escritorio cercano · en la conversación: escuchar, parar y enviar |
| X | Saltar · en la conversación: volver a hablar |
| B | Cancelar / cerrar |
| Y | Llamar a Hermes por voz (ElevenLabs) y colgar |
| LB / RB (o cruceta ← →) | Ir al agente anterior / siguiente |
| View | Vista aérea / explorar |
| Menu | Ayuda de controles |

El control vibra al interactuar y cuando un agente te responde. El HUD muestra "🎮 Xbox Wireless Controller" y los atajos pasan a los botones del control apenas lo usas.

**Ojo con Chrome:** el navegador no expone el control hasta que se presiona un botón con la página enfocada (regla de privacidad). Por eso el HUD pide "presiona cualquier botón".

## Hablarle a un agente con la voz

1. **Abrir**: acércate a un agente o a un escritorio libre y presiona **A** (o E, o haz clic). Se abre la conversación con el micrófono ya escuchando.
2. **Hablar**: dices la instrucción y la ves en vivo. Al callarte (1,6 s) se detiene sola.
3. **Enviar**: **A** envía, **X** vuelve a grabar y **B** cancela. Antes de enviar se puede corregir el texto a mano.
4. **Destino**:
   - Con un agente que es un run de Claude, la instrucción **continúa su misma sesión**: el nuevo run hereda su escritorio y su nombre (`continues` en el modelo).
   - Con un agente que sigue trabajando, espera a que termine o detenlo.
   - En un escritorio libre, contrata uno nuevo.
5. **Respuesta**: cuando el agente termina, su resumen se lee en voz alta con la síntesis del sistema (🔊 en el HUD la apaga). Si sigues en su panel, el micrófono vuelve a escucharte: una conversación de ida y vuelta.

El dictado usa dos motores:

| Motor | Cuándo | Detalle |
| --- | --- | --- |
| Reconocedor del navegador | Por defecto | Web Speech en `es-CO`, texto en vivo |
| Transcripción de Hermes | Si el navegador falla (sin red, sin permiso) | Graba hasta el silencio y usa `POST /office/dictate`, la misma cadena STT de las juntas: Scribe, Whisper y local. Unos 1,6 s en la prueba |

**Y** llama a Hermes, el agente de voz de ElevenLabs. Sus tools se montan en la página, así que un "pon a alguien a revisar X en hermes-os" lanza `work_on_project` y el personaje aparece en su pod.

**Antes del taller:**

- Da permiso de micrófono una vez en `localhost:31415`.
- Empareja el control y presiona un botón con la página abierta.
- Sube el volumen para la respuesta hablada.

## Hablarle al equipo entero (elenco de voces)

Con el elenco configurado, **Y** (o el botón 📞 Equipo) abre UNA llamada de ElevenLabs donde cada personaje vivo tiene su propia voz. Le hablas a todos a la vez: "Hermes, contrata dos agentes en hermes-os…", "Iván, ¿cuál es el más largo?", "equipo, corran los tests". Sin elenco, **Y** sigue llamando a Hermes como antes.

| Pieza | Qué hace |
| --- | --- |
| `sala.json` → `office` | Las voces del elenco: `default` es el líder (Hermes) y el resto se reparte entre los runs. Un miembro apagado en la Sala (`enabled:false`) igual presta su voz aquí |
| `pnpm setup:elevenlabs --sala` | Crea el agente multi-voz "Hermes Oficina · Elenco" con sus 4 client tools y escribe `office.agent_id` |
| `packages/shared/src/office-voices.ts` | Reparto puro y probado: pegajoso, una sesión continuada hereda la voz, sin voces libres no hay voz |
| `hooks/useOfficeCast.ts` | La llamada (`CastCall` de la Sala), las tools y los avisos |
| `GET /office/cast` · `/elevenlabs/token?agent=office` | Líder y voces · token de la llamada |

Las tools, todas con datos reales:

| Tool | Qué hace |
| --- | --- |
| `office_team` | Quién tiene qué voz, su proyecto, estado, tarea y lo último que hizo. El modelo la llama al empezar: el reparto cambia y nunca se recuerda |
| `office_tell` | Pasa una instrucción y **continúa la sesión** del agente. Si está trabajando, queda en cola y se le entrega al terminar |
| `office_hire` | Contrata un agente nuevo en un proyecto (o en General) |
| `office_report` | Últimas líneas y texto final completo de un agente |

**El resultado llega con la voz de quien trabajó.** Cuando un run que salió de la llamada termina, la oficina manda un turno `[aviso] Iván terminó…` tras un silencio real de 0,9 s, y el director lo cuenta con esa voz. Nadie dice "listo" antes del aviso. Dos avisos seguidos salen en una sola respuesta a dos voces.

**Honestidad del dato.** En la primera prueba el aviso iba recortado a 600 caracteres, justo a mitad de una tabla, y el modelo le atribuyó las líneas de un archivo a otro. Ahora el aviso lleva hasta 1.800 caracteres y, si corta, lo dice ("recortado: no completes lo que falta"). El prompt exige que cada número y nombre esté escrito tal cual en el aviso o en una tool.

En la escena, la tarjeta de cada personaje dice su voz (🎙 Iván · …) y el cuerpo late con el volumen real mientras su voz suena. QA sin micrófono: `window.__hermesOficinaTeam.say(texto)` y `.debug()` (voces, runs vigilados, cola, avisos pendientes). En simulación no hay llamada con el equipo: esos runs no existen.

## La sala

`lib/oficina/room.ts` recrea a nuestra manera la oficina de agent-office. Tiene piso de tablones, paredes con ventanas y un frente abierto con muro bajo de vidrio y entrada, para que la cámara siempre vea adentro. La cocina tiene mesón, cafetera, nevera, dispensador y mesa con bancos. El lounge tiene sofá, mesa, pufs y TV. Completan la sala una estantería, plantas y lámparas con luz cálida.

Además hay rincones para caminar, todos procedurales como el resto (cero assets):

| Rincón | Qué tiene |
| --- | --- |
| Cocina | Espresso de dos grupos con vapor animado sobre las tazas, molino, fregadero con grifo, microondas, gabinetes altos, salpicadero y máquina de snacks |
| Zona de juegos (suroeste) | Mesa de ping-pong con red, raquetas y pelota, canasta de pelotas y diana de dardos en la pared |
| Esquina sureste | Futbolín (rojo contra azul, varillas 1-2-3-5-5-3-2-1) y máquina arcade con marcianitos en la pantalla |
| Detalles | Dos cuadros en la pared del fondo y un perchero en la entrada |

La pantalla de la arcade es una ilustración: no muestra puntajes, porque en esta oficina un número siempre es un dato real.

Lo que muestra datos es real:

| Objeto | Qué muestra |
| --- | --- |
| TV del lounge | El feed de actividad del agente (`/events`) |
| Pizarra | Los conteos del momento, los mismos del HUD |
| Reloj | La hora local |
| Ventanas y luz | El cielo sigue la hora real: de día manda el sol, de noche las lámparas |
| Letrero | "Oficina de *dueño*" desde la variable de entorno |

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

**Guion con el control (el del jueves):**

1. Control emparejado y página abierta en `localhost:31415/oficina`. Presiona cualquier botón: aparece "🎮 Xbox Wireless Controller".
2. Camina con el stick hasta el escritorio de General, presiona **A** y di: "Cuenta cuántos archivos markdown hay en docs". Cambia el proyecto si hace falta y presiona **A** para enviar.
3. El agente nace en su pod y lee. Al terminar, el control vibra y escuchas su respuesta.
4. Sin soltar el control, dile la siguiente instrucción: "¿Cuál es el más largo?". Presiona **A**: continúa la misma sesión en el mismo escritorio.
5. Presiona **Y**: "Hermes, pon a alguien a revisar los tests de hermes-os". Aparece otro agente.
6. Presiona **View** para la vista aérea y **RB** para recorrer el equipo.

**Guion sugerido (teclado):**

1. Abre `http://localhost:31415/oficina` (en localhost, no por IP ni túnel). Apareces en la entrada; la oficina solo tiene el pod General.
2. Camina hasta el escritorio de General, presiona **E**, elige un proyecto y contrata. Aparece un pod nuevo con su personaje, que empieza a leer. Muéstrales la TV y la pizarra: se actualizan solas.
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
| `__hermesOficinaFocus(hit)` | Lleva la cámara a un escritorio o personaje (vista aérea) |
| `__hermesOficinaMode("explore" \| "aerial")` | Cambia de vista |
| `__hermesOficinaWalkTo(hit)` | Pone al dueño junto a un escritorio o personaje |
| `__hermesOficinaDictate(text)` | Deja `text` como lo dictado, listo para enviar (QA sin micrófono) |
| `__hermesOficinaTeam.say(text)` / `.debug()` | Le habla al equipo sin micrófono / reparto de voces, runs vigilados, cola y avisos |

QA del control sin control físico: `apps/web/scripts/oficina-pad-qa.py` inyecta un Xbox simulado en `navigator.getGamepads()`, con el mismo id y mapeo que entrega Chrome, y recorre la ruta real con 26 comprobaciones.

## Pendiente (stretch)

- Salida con caja por la puerta, como en agent-office. Hoy el personaje se encoge y desaparece.
- Nombre del personaje escrito por Haiku, debounced. Hoy son las primeras palabras de la tarea.
- `taskId` en los turnos de chat, para que la consola de texto también tenga personaje.
- Voz al hacer clic en un personaje: `useVoiceConnect.switchTo` con el proyecto como scope.
- Techo con lámparas colgantes (hoy la sala es una casa de muñecas sin techo, para que la vista aérea funcione).
