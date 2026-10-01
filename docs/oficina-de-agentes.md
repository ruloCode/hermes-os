# Oficina de agentes 3D (`/oficina`)

2026-09-29 · para el workshop de la comunidad de Anthropic (2026-10-01)

Una oficina 3D con estilo de caricatura donde cada sesión **viva** del Claude Agent SDK o run de `claude -p` que corre en Hermes es un personaje sentado en un escritorio. Los personajes se agrupan por proyecto del vault. Cada uno actúa su tool real, su bombilla dice su estado y su laptop muestra sus últimas líneas. Desde la misma oficina se contrata un agente y se abre la salida de cualquiera.

Inspirada en [agent-office](https://github.com/AgentSystemLabs/agent-office) (AgentSystemLabs, MIT). De ahí se portó el **motor visual**, no la infraestructura: el look toon (`MeshToonMaterial` con rampa de 3 pasos más `OutlineEffect`), el personaje con sus poses, la laptop, el confeti y el mapeo tool → pose (`actions.ts`). Cada archivo portado lo dice en su cabecera. agent-office corre CLIs en PTYs y lee su estado con hooks de Claude Code. Hermes ya tenía el bus de actividad del SDK, así que el estado sale de ahí.

![Vista aérea en simulación, tema oscuro](img/oficina-aerea-oscuro.png)

![Explorando junto a un agente, tema claro](img/oficina-cerca-claro.png)

## Recorrer la oficina

El dueño es un personaje dentro de la oficina, un humano portado del `Person` de agent-office. Su nombre sale de `NEXT_PUBLIC_HERMES_OWNER_NAME` y su apariencia se elige en **Tu personaje** (piel, pelo, peinado, camiseta y rasgos: barba, gafas, collar y arete), guardada en el navegador. El default es el avatar del dueño: **rulos** con volumen arriba y reflejos cobrizos, piel trigueña, barba corta con bigote, gafas de marco transparente con patillas azules, arete, collar con dije azul y camiseta blanca.

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

## El agente levanta la mano (aprobaciones)

Cuando un agente va a hacer algo con efectos (un `git push`, un `pnpm install`, borrar un archivo), **se pausa de verdad** y te pide permiso en la Oficina. El personaje medio se pone de pie y saluda con un guante blanco por encima de la cabeza, su bombilla late en terracota, su tarjeta dice "✋ te necesita" con el comando, el HUD cuenta "N te necesitan", sale un aviso y el control vibra.

- **Decidir:** acércate y abre su panel (**E** o **A**, o clic en vista aérea). Arriba ves el comando EXACTO que va a ejecutar y cuánto falta para que se niegue solo. **Aprobar** (o **A**) lo deja correr; **Negar** (o **B**) se lo niega. El panel no prende el micrófono: lo que toca es decidir.
- **Lo que recibe el modelo al negar:** que el humano lo negó y que no lo repita igual, así cambia de plan en vez de reintentar. Si nadie responde en **10 minutos**, se niega solo y el modelo lo sabe.
- **Solo pregunta si alguien está mirando la Oficina** (una conexión viva a `/office/events`). Sin nadie, todo se comporta como antes: las tareas del SDK las decide el guardrail y los runs de `claude -p` niegan lo que pediría permiso, ahora diciendo por qué. Una tarea por voz a las 3 a. m. no se queda colgada. Ojo: una pestaña de la Oficina olvidada abierta cuenta como alguien mirando.
- **Qué pide permiso:** Bash que no sea de solo lectura (`isReadOnlyBash` en `packages/shared/src/office-approvals.ts`: `ls`, `cat`, `git status/log/diff`… pasan; lo que no se reconoce, pregunta; redirigir a un archivo ya es escribir). En los runs de `claude -p` también pregunta lo que el modo de permisos del CLI haría preguntar (con `acceptEdits`, que es el default de la consola, las ediciones pasan solas).

**Dos caminos, un mismo personaje** (`apps/agent/src/office/approvals.ts` guarda las solicitudes vivas en memoria):

| Camino | Cómo se pausa |
| --- | --- |
| Tareas del SDK (General, `POST /tasks`) | `canUseTool` en `session.ts` espera `requestApproval()` |
| Runs de `claude -p` (pods de proyecto) | `--permission-prompt-tool mcp__hermes-approval__ask`: el CLI le pregunta al puente `office/approval-mcp.mjs` (MCP por stdio, sin dependencias), que hace `POST /office/approvals/ask` y consulta la decisión. El puente va oculto al modelo con `--disallowedTools` |

**Seguridad:** cada run recibe un token propio (`--mcp-config`) que solo sirve para **pedir** y leer sus propias decisiones; **decidir** (`POST /office/approvals/:id/decide`) exige la credencial del dashboard, y un request con token de run se rechaza aunque traiga más. El hijo no hereda el `.env`, así que el modelo no puede aprobarse a sí mismo. Rutas: `GET /office/approvals` (pendientes + si alguien mira), `GET /office/approvals/:id`, `POST /office/approvals/ask`, `POST /office/approvals/:id/decide {allow, note?}`.

Verificado con runs reales de haiku: sin nadie mirando se niega con motivo; mirando, el run queda en `needs_you` sin ejecutar nada hasta que apruebas (el archivo aparece después); negando con una nota, el modelo la recibe y cambia de plan; decidir dos veces o sin credencial falla. La tarea del SDK en General pasa por el mismo flujo.

## Modos de los agentes (los de Claude Code)

Cada agente de proyecto corre en uno de los cuatro modos de Claude Code. **Auto es el default.** Se elige al contratar (queda guardado en el navegador para los siguientes) y por agente en su panel; **Shift+Tab** los recorre como en la terminal y **View** hace lo mismo con el control, dentro de una conversación. La tarjeta lleva el modo en el chip cuando no es Auto (`✋ te necesita · Plan`) y el panel dice el modo REAL que reportó el CLI.

| Modo | CLI | Qué pasa cuando el agente quiere hacer algo con efectos |
| --- | --- | --- |
| **Auto** | `auto` | El clasificador del CLI decide. Lo seguro pasa; lo riesgoso **lo niega solo, sin preguntar** (el personaje queda "bloqueado" con el motivo: "El modo Auto lo negó: Data Exfiltration"). Solo Opus/Sonnet: con Haiku el CLI arranca en Preguntar y el selector lo avisa |
| **Editar** | `acceptEdits` | Edita sin preguntar; un comando que no esté permitido levanta la mano |
| **Plan** | `plan` | Solo lee. Al terminar levanta la mano con **su plan completo** (markdown en el panel). "Aprobar y ejecutar en X" lo ejecuta en el MISMO run, cambiando la sesión al modo elegido (Auto si el agente estaba en Plan); "Pedir cambios" le manda lo que dictaste y sigue planeando |
| **Preguntar** | `manual` | Levanta la mano para cada edición y cada comando no permitido |

Verificado contra el CLI 2.1.285: el plan pasa por el puente (`ExitPlanMode` → `--permission-prompt-tool`) y aprobarlo con `updatedPermissions: [{type:"setMode", mode:"auto"}]` hace que el CLI reporte `status → auto` y siga editando sin preguntar. Run real en producción: plan con la mano levantada → aprobado → la oficina vio `plan → auto` → archivo editado.

Ojo con `~/.claude/settings.json` del usuario: los runs heredan sus reglas `allow`. Si ahí dice `Bash(git commit *)` o `Bash(git push *)`, esos comandos pasan sin preguntar en Editar y Preguntar.

Las tareas de General (`POST /tasks`, Agent SDK) no tienen modo: las cuida el guardrail y, si miras la oficina, piden permiso para los comandos con efectos.

## Tres pisos

La oficina es un edificio de tres pisos (`FLOOR_Y` en `room.ts`: 0 · 3,6 · 7,2 m):

| Piso | Qué hay |
| --- | --- |
| **1 · Equipos** | Los pods con los agentes, la entrada, el letrero, la pizarra y el reloj. Todo lo de los agentes vive aquí, sin cambios |
| **2 · Café** | La cocina con isla, neón y pizarra de tiza, el lounge con la TV del feed, la cabina telefónica, la estantería y un tapete con pufs en el centro. Balcón de vidrio al frente |
| **3 · Azotea** | Terraza de madera con antepecho de ladrillo, guirnaldas de bombillos, ping-pong, diana en su tablero, futbolín, arcade, sombrilla con sillas y materas |

- **Escaleras en zigzag** contra el muro oeste: la 1 arranca junto a la entrada y sube hacia el fondo, y la 2, al lado, vuelve hacia el frente. Son macizas: cada escalón es una colisión 20 cm más alta y el personaje los sube solo (su paso automático es de 35 cm). Barandas en el lado abierto y guardas alrededor de cada hueco, salvo por donde se llega.
- **Colisiones con base** (`Collider.bottom` en `player.ts`): una caja estorba solo si se cruza con la franja del cuerpo (1,7 m). Por eso se camina debajo de la losa del piso 2 y los muebles de abajo no estorban arriba.
- **Corte de casa de muñecas**: se ven el piso donde estás y los de abajo (el de llegada aparece a mitad de la escalera). Solo se encienden las lámparas de ese piso, y quedan en 0 en vez de quitarse: cambiar cuántas luces hay recompila los shaders y el juego da un tirón.
- **Vista aérea por piso**: abre en el piso donde estás. El selector "1 · Equipos / 2 · Café / 3 · Azotea" del HUD y las teclas **1**, **2** y **3** eligen cuál ver. Viendo el 2 o el 3 no se clickea nada del 1 a través de la losa y las etiquetas de los pods se ocultan.
- **"E" solo alcanza a los agentes en el piso 1** (los NPC con rol, en su piso; ver abajo). "Ir con un agente" (LB/RB o la lista del equipo) te trae abajo desde cualquier piso.
- **QA**: `__hermesOficinaStair(i)` te pone al pie de la escalera `i` mirando hacia arriba, y `__hermesOficinaFloor(n)` abre la vista aérea del piso `n`. `oficina-qa.py` sube las dos escaleras caminando y revisa las alturas, el piso que se ve y las teclas.

## La gente del edificio (interruptor "Ambiente")

2026-09-30. Con pocas sesiones vivas la oficina se veía vacía. Ahora hay **gente de ambiente** que va por café, se sienta en el sofá, juega ping-pong, mira por la ventana y sube y baja las escaleras, y **tres NPC con rol** a los que se les habla. Todo vive detrás del botón **Ambiente** del HUD: se guarda en el navegador (`hermes-oficina-ambiente`) y viene prendido. Apagado, no se crea nada: ni personas, ni atril, ni rejilla, ni colisiones.

**No son agentes y se nota.** Los agentes son los frijoles con audífonos y antena (`worker.ts`). La gente es humana chibi (`Person`, como el dueño), con otras pieles, peinados y camisetas: nunca los rulos ni la camiseta blanca del dueño, y tampoco el peinado "Rizado", que son 70 esferas por persona. No tienen bombilla ni tarjeta, nunca se sientan en un escritorio de pod y no cuentan en el HUD, la lista del equipo ni la pizarra. La regla "una silla por sesión viva" no cambia.

| Quién | Dónde | Qué dice (y de dónde sale) |
| --- | --- | --- |
| **Recepción** | Piso 1, a la derecha de la entrada, con su atril | "¿Qué está pasando?": cuántas sesiones vivas hay y en qué estado, con los mismos conteos del HUD (`officeCounts`), y quién te pide permiso. Preguntas: quién me necesita, quién trabaja y qué terminó, cada agente con su proyecto y un **Ir →** que te lleva a su escritorio. Sin conexión con `/office/events` dice que no sabe. En simulación lo dice |
| **Barista** (con mandil) | Piso 2, detrás de la isla. Se le habla desde las banquetas | La hora local; las ejecuciones terminadas hoy, su costo y sus tokens (`usage` de `GET /dashboard`, que ya trae el `DashboardProvider`: cero polls nuevos); el próximo evento del calendario si está configurado; el clima si el agente lo reporta; y las próximas tareas programadas (`GET /scheduled`, una vez al abrir el diálogo) |
| **Respiro** | Piso 3, junto a las sillas de playa | La hora, una **pausa de 5 minutos** con temporizador real (pastilla "☕ Pausa 4:59" en el HUD, aviso, vibración y voz al terminar) y la ayuda de controles (teclado o control, según lo que estés usando) |

**Honestidad:** cada línea con un dato sale de `packages/shared/src/office-npc.ts` (puro, con tests). Si la fuente no existe o falla, la línea no se dice, y la pregunta que la pide no aparece: sin clima no hay "¿Qué tal el clima?" y, si `/scheduled` falla, no hay "¿Qué hay programado?". Las respuestas se recalculan en cada render, así que no se quedan viejas con el diálogo abierto.

**Hablarles:** acércate (o `__hermesOficinaWalkTo({kind:"npc", id})`) y presiona **E** o **A**. El NPC te mira y saluda. Teclado: **1–3** o **↑↓** y **Enter** eligen, **Esc** cierra. Control: cruceta, **A** y **B**. Mientras el diálogo está abierto el dueño no camina, la cruceta no hace zoom y las teclas 1–3 no cambian de piso. Si **Respuestas** está prendido, la respuesta se lee en voz alta con `speak()`.

**Prioridad de "E":** si hay un escritorio de pod al alcance, gana el escritorio. Un NPC solo entra cuando no hay ninguno, así que "Contratar aquí" y "Hablar con X" no cambian.

### Cómo camina la gente

- **Navegación por capas** (`packages/shared/src/office-nav.ts`, puro y con tests). Cada celda de 25 cm guarda las *superficies* donde se puede estar de pie: el suelo, la losa de cada piso y cada escalón. Una caja es suelo si su tope queda al alcance del paso (35 cm) y estorba si se cruza con la franja del cuerpo (1,7 m), igual que el controlador del dueño. No hay "portales" escritos a mano: la escalera es camino porque sus escalones lo son, el hueco no es camino porque ahí no hay dónde pararse, y si la escalera se mueve en `room.ts` la navegación la sigue sola. La celda es más chica que la huella de un escalón (30 cm), así que dos vecinas difieren a lo sumo un escalón. A\* usa adyacencia precalculada y una heurística ×1,4; el camino se suaviza por línea de vista. Medido: la rejilla tiene unos 37.000 nodos y tarda de 8 a 25 ms en armarse; cada camino tarda unos 4 ms (máximo 7). Se calcula **un camino por frame**.
- **Qué estorba a la gente:** la sala, los escritorios, **cada pod con sus sillas** (nadie camina entre los agentes) y los NPC con rol. La rejilla se rehace cuando cambian la sala o los escritorios, no por frame. Si la sala se reconstruye con el mismo tamaño (llegó un pod), la gente sigue donde estaba.
- **Quién va a dónde** (`packages/shared/src/office-ambient.ts`, puro, con RNG sembrado). La sala exporta 27 lugares con intención (`room.pois`): ventanas, pizarra y cuadro en el piso 1; barra, agua, snacks, banquetas, sofá (dos puestos), sillón, pufs, libros y ventanas en el piso 2; ping-pong y futbolín (de a dos), dardos, arcade, guirnaldas, sillas de playa y vistas en el piso 3. Cada persona elige un lugar, camina, se queda entre 5 y 32 s según la actividad (con su pose: sentada, taza con sorbos, raqueta, manos en el juego, señalando, mirando arriba, lanzando un dardo, manos atrás) y elige otro. Reglas: nunca más gente que puestos; cada piso pesa lo mismo aunque tenga más lugares; cambiar de piso pesa más que quedarse; nadie repite sus últimos lugares; un juego de a dos solo arranca con los dos presentes, y quien espera pareja se rinde a los 22 s. Si un lugar no tiene camino, se evita un minuto.
- **Cuánta gente:** 6 con hasta 2 sesiones vivas, 5 con hasta 5 y 4 desde ahí (`ambientPopulation`). Al abrir, cada uno ya está instalado en algún lugar; los que llegan después entran por la puerta.
- **Escaleras de verdad:** la altura sale de la rejilla escalón por escalón, no por interpolación entre pisos.
- **Con el dueño:** si está en el camino, se detienen, lo miran y, si sigue ahí, se hacen a un lado. Si no hay a dónde (la escalera), a los 3,5 s pasan de largo. El dueño choca solo con quien está quieto en su lugar (`PlayerController.people`), nunca con quien camina, y no queda atrapado si alguien se le mete encima.

> **Ojo:** la primera versión hacía que todos bloquearan al dueño. En la escalera, alguien que bajaba esperaba al dueño y el dueño no podía pasar: los dos quedaban esperándose (el QA de las escaleras lo atrapó a 1 m de altura). Quien camina es quien esquiva.
- **Corte de pisos:** solo se ven los del piso que se ve y los de abajo. Las etiquetas de los NPC, solo en el piso que se ve.

> **Ojo (lo encontró la rejilla):** el pie de la escalera 1 estaba encerrado entre la baranda, la maceta de la esquina suroeste y el muro bajo del frente. Los huecos medían 0,40 y 0,45 m y una persona necesita 0,6 m, así que el dueño solo salía saltando la maceta. El QA no lo veía porque `__hermesOficinaStair(0)` teletransporta al pie. La maceta pasó de 2,6 a 3,3 m del muro oeste.

**QA:** `apps/web/scripts/oficina-npc-qa.py` revisa, en los dos temas, que haya gente en al menos dos pisos y nadie dentro de un pod; que Recepción diga los mismos conteos que la simulación y nombre a los agentes de cada estado; los diálogos de Barista y Respiro y la pausa real; que junto a un agente "E" sea del agente; el interruptor (apagado no queda nadie, se recuerda al recargar); y fps ≥ 55. Una vez, que alguien cruce de piso por la escalera y que a media altura siempre esté sobre una escalera. `?seed=N` en la URL o `__hermesOficinaAmbient({ seed })` fijan la coreografía.

## La sala

`lib/oficina/room.ts` es un **loft de coworking** (look tipo WeWork, 2026-09-30, a partir de una imagen de referencia generada con Higgsfield): ladrillo a la vista en los muros (paño de canvas de 1,6 × 1,2 m repetido según el tamaño de cada tramo, así no se estira), piso de concreto pulido, ventanas industriales con cuadrícula de acero negro y un frente abierto con muro bajo de ladrillo y vidrio, para que la cámara siempre vea adentro. La cocina tiene mesón de madera con repisas abiertas, cafetera con vapor, **neón "Hermes"** (textura con halo + luz rosada real), **pizarra de tiza** del café (sin precios: en la oficina un número siempre es un dato real) y una **isla** con frascos de agua con fruta, grifos de kombucha/cerveza, snacks y cuatro banquetas altas bajo dos lámparas industriales colgantes. El lounge tiene sofá terracota, sillón verde de terciopelo, mesa redonda, puf y la TV del feed; en la esquina noreste hay una **cabina telefónica** de vidrio. Matas colgantes cerca de las ventanas y un afiche tipográfico. Sin lámparas sobre los pods: desde la vista aérea tapaban los escritorios.

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

Cada estado sale de algo que pasó de verdad. "Te necesita" existe solo mientras hay una solicitud de permiso viva y el run está pausado esperándote:

| Estado | Cuándo |
| --- | --- |
| Arrancando | Registrado o `task_start`, sin tools todavía |
| Trabajando | Llegó una tool o texto en los últimos 12 s |
| Pensando | Sigue vivo pero lleva 12 s sin eventos (`THINKING_AFTER_MS`) |
| Bloqueado | Un guardrail o el Chrome CDP negaron una tool. Dura hasta la siguiente tool |
| Te necesita | Hay una solicitud de permiso abierta (`office/approvals.ts`). Ni el silencio ni una tool tardía le bajan la mano: solo tu decisión, el tope de 10 min o el fin del run |
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
6. La mano levantada con un plan: contrata en un proyecto en modo **Plan** (Shift+Tab o View en el diálogo), por ejemplo "agrega una sección de FAQ al README". Lee, planea y levanta la mano con el plan; acércate, muéstrales el plan en el panel y apruébalo con **A**: lo ejecuta ahí mismo en Auto y la tarjeta cambia de modo. Para "Pedir cambios", dicta qué cambiar (**X**) y presiona **B**. Ojo: `git checkout`/`commit`/`push` NO sirven para mostrar la mano en Editar/Preguntar porque tu `~/.claude/settings.json` los permite. Ensayo sin tokens: `__hermesOficinaSim("demo")` trae a "Agrega modo oscuro" con un plan y a "Publica la rama" pidiendo un comando.

Los prompts de `oficina-demo.sh` terminan en 10 a 20 s. Para un demo más largo, contrata con una tarea de varios pasos, por ejemplo "revisa X, corre los tests y propón un arreglo sin editar".

## Seams de QA

| Seam | Uso |
| --- | --- |
| `__hermesOficinaSim(state \| "demo" \| null)` | Sustituye el estado real, siempre marcado como simulación |
| `__hermesOficinaDebug()` | Personajes, asientos, selección, escritorios y fps. Con el ambiente, `npcs` (`{id, role, floor, x, y, z, activity, state}`), `ambient`, `seed`, `floorChanges`, `navNodes`, `pois` (lugares que quedaron y descartados) y `npcDialog` |
| `__hermesOficinaAmbient({ on?, seed? })` | Prende o apaga la gente del edificio y siembra su coreografía (también `?seed=N` en la URL) |
| `__hermesOficinaScreenOf(hit)` | Posición en pantalla de un escritorio o personaje, para clics reales |
| `__hermesOficinaFocus(hit)` | Lleva la cámara a un escritorio o personaje (vista aérea) |
| `__hermesOficinaMode("explore" \| "aerial")` | Cambia de vista |
| `__hermesOficinaWalkTo(hit)` | Pone al dueño junto a un escritorio, un personaje o un NPC (`{kind: "npc", id: "reception" \| "barista" \| "rooftop"}`) |
| `__hermesOficinaDictate(text)` | Deja `text` como lo dictado, listo para enviar (QA sin micrófono) |
| `__hermesOficinaTeam.say(text)` / `.debug()` | Le habla al equipo sin micrófono / reparto de voces, runs vigilados, cola y avisos |

QA del control sin control físico: `apps/web/scripts/oficina-pad-qa.py` inyecta un Xbox simulado en `navigator.getGamepads()`, con el mismo id y mapeo que entrega Chrome, y recorre la ruta real con 26 comprobaciones.

## Pendiente (stretch)

- Fase 2 de la gente: que un agente **listo** camine al café durante su gracia de 3 minutos y uno **pensando** dé unos pasos junto a su escritorio (nunca uno trabajando o que te necesita). Se dejó fuera para no arriesgar la demo: el "near" y el clic de los agentes dependen de que sigan en su silla.
- Que la gente se aparte entre sí. Hoy solo esquiva al dueño; dos personas que se cruzan pueden atravesarse un instante.

- Salida con caja por la puerta, como en agent-office. Hoy el personaje se encoge y desaparece.
- Nombre del personaje escrito por Haiku, debounced. Hoy son las primeras palabras de la tarea.
- `taskId` en los turnos de chat, para que la consola de texto también tenga personaje.
- Voz al hacer clic en un personaje: `useVoiceConnect.switchTo` con el proyecto como scope.
- Techo con lámparas colgantes (hoy la sala es una casa de muñecas sin techo, para que la vista aérea funcione).
