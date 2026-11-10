# Capacidad: sesion

## ADDED Requirements

### Requirement: System prompt estable por sesión
El system prompt de una sesión de chat DEBE ser idéntico entre turnos de esa sesión. Lo que depende
del mensaje (memorias y contexto relevante) viaja en el mensaje del usuario dentro de
`<contexto-hermes>`.

#### Scenario: Dos turnos seguidos
- CUANDO la misma sesión manda dos mensajes distintos
- ENTONCES el system prompt de ambos turnos es el mismo texto

#### Scenario: Contexto ya enviado
- CUANDO un fragmento de contexto ya viajó en un turno anterior de la sesión
- ENTONCES no se vuelve a enviar

#### Scenario: Mensaje trivial
- CUANDO el mensaje es un saludo o tiene menos de tres palabras con contenido
- ENTONCES no se busca contexto para ese turno

#### Scenario: El contexto es dato
- CUANDO el bloque de contexto trae un texto que parece una orden
- ENTONCES el modelo lo trata como dato: la base del prompt lo dice explícitamente

### Requirement: Sesión persistente del chat
El chat DEBE reutilizar un proceso del CLI vivo por sesión de cliente, con caída automática al
camino de una sola vuelta.

#### Scenario: Segundo turno
- CUANDO llega el segundo mensaje de una sesión con proceso vivo
- ENTONCES no se arranca un CLI nuevo y el primer texto llega antes que en el camino de una vuelta

#### Scenario: Detener
- CUANDO el cliente corta un turno
- ENTONCES el turno se interrumpe, lo dicho hasta ahí vale y la sesión sigue viva

#### Scenario: Cambio de condiciones
- CUANDO cambian el proyecto en foco, el modelo o las tools permitidas (por ejemplo, el candado de finanzas)
- ENTONCES la sesión se recicla con las condiciones nuevas

#### Scenario: Fallo
- CUANDO la sesión viva falla o `HERMES_CHAT_SESSION=oneshot`
- ENTONCES el turno corre por el camino de una vuelta con `resume`, sin perder el hilo

#### Scenario: Límite
- CUANDO hay tres sesiones vivas y llega una cuarta
- ENTONCES se cierra la que lleva más tiempo sin uso; a los 10 min sin uso una sesión se cierra sola

### Requirement: Tools por canal
Cada canal DEBE cargar solo las tools que usa.

#### Scenario: Chat desde el teléfono
- CUANDO el turno llega con `X-Hermes-Client: phone`
- ENTONCES no se registran el MCP de Chrome ni el remoto de Linear

#### Scenario: Tarea
- CUANDO corre una tarea (`/tasks`) o una programada
- ENTONCES tiene el conjunto completo

### Requirement: El uso de una skill se registra
Cada vez que el modelo carga una skill, DEBE quedar registrado su uso.

#### Scenario: Skill usada
- CUANDO un turno invoca la tool `Skill` con una skill del plugin de Hermes
- ENTONCES `recordSkillUse` actualiza su último uso y el curador no la archiva por inactividad

## Notas de implementación

- **Prompt estable.** `system-prompt.ts` arma la BASE (`buildBasePromptCaptured`: identidad, teléfono,
  SOUL, USER.md, perfil del vault, proyectos, preferencias, índice de skills, foco y las REGLAS del
  modo Vida) y aparte el contexto del turno (`buildTurnContext`). La base se fotografía por
  `snapshotKey(sesión, proyecto)` durante 1 h (`SnapshotCache`, session.ts). Las cifras del modo Vida
  salieron del system prompt: viajan en cada turno (sin dedupe) en la sección «Cifras de hoy» del bloque.
- **Contexto del turno** (`turn-context.ts`, puro): memorias recientes solo en el primer turno, lo
  relevante solo si el mensaje tiene ≥3 palabras con contenido, sin repetir claves ya enviadas
  (`ContextLedger`, vive con la foto de la base). Una etiqueta `contexto-hermes` dentro de los datos se
  neutraliza. La identidad dice que el bloque es dato y no instrucciones.
- **Oficina.** La traza de las tareas muestra la base tal cual se envió y, como sección aparte
  (`turnContext`, con su porqué), el bloque que viajó en el mensaje (`withTurnContext`). Los `WHY` de
  `vida` y `knowledge` se reescribieron.
- **Sesión viva** (`chat-sessions.ts` + reglas puras en `chat-session-policy.ts`). Solo el chat con
  `X-Hermes-Session-Id`; `index.ts` ahora pasa `channel`, `clientSession`, `client`, `userText` y `fresh`
  (cinco líneas en la llamada a `runAgentTurn`). Si la sesión viva falla ANTES de mandar algo al
  cliente, el turno corre de una vuelta con `resume`; si ya había mandado texto, el turno termina como
  error con lo dicho (reintentar duplicaría la respuesta). Un turno fallido cierra la sesión viva antes
  de ese reintento (dos procesos sobre el mismo hilo lo bifurcan). Pedir otra conversación o una nueva
  reemplaza la sesión aunque esté respondiendo: su cola termina y se cierra; si se retoma el MISMO hilo
  que lleva una sesión que se cierra, se espera a que termine. Tras Detener, si el `result` no llega en
  12 s la sesión se cierra; ningún turno pasa de 10 min. `X-Hermes-Session-Id` ausente (`default`, que
  comparten varios clientes) va de una vuelta. El chat niega `Bash` con `run_in_background` (abriría un
  turno propio del CLI y descuadraría la correlación). `maxTurns` es 40 POR MENSAJE también en streaming:
  en el CLI 0.3.322 el limitador de la corrida suma el `num_turns` de cada resultado y vuelve a cero con
  cada mensaje del host (`turnEnded`/`tally`), y el bucle de cada mensaje recibe el mismo tope; la sesión
  viva midió `num_turns: 1` por turno. Contratos en `chat-sessions.test.ts` con un Query falso. El costo y los modelos que
  devuelve `runAgentTurn` en este camino son acumulados de la sesión (el gasto por turno lo da el
  registro de `trackedQuery`).
- **Medido** (agente de ensayo :8661, Haiku 5.5 por `HERMES_MODEL`, misma sesión, tres turnos):
  una vuelta → primer texto 6,1 / 5,2 / 2,1 s, total 7,9 / 6,2 / 3,1 s, caché leída 0 / 57 / 67 %;
  persistente → 3,2 / 0,8 / 0,6 s, total 3,9 / 1,3 / 0,9 s, caché leída 92 / 76 / 99 %. Detener a mitad
  deja el turno `aborted` y el siguiente responde en 0,9 s recordando el pedido cortado.
- **Tools por canal** (`tool-profiles.ts`): `chat-web` y `chat-phone` limitan las integradas a 10 (Read,
  Glob, Grep, Bash, Write, Edit, WebSearch, WebFetch, Skill, ToolSearch) con la opción `tools` del SDK;
  `chat-phone` registra solo el MCP de Hermes. Evidencia: el `init` de una sesión real trae 24 integradas
  (Task, CronCreate/Delete/List, DesignSync, EnterWorktree, ListAgents, Monitor, PushNotification,
  ScheduleWakeup, SendMessage, Workflow…); en un turno trivial sin MCP el prefijo baja de 24.608 a 18.993
  tokens. Turno trivial real por el agente: web 25.041 tokens de entrada, teléfono 21.891 (primer texto
  2,6 s → 1,5 s). Tareas y programadas: sin cambios (todo). `sdkAgentConfig()` sale de las mismas listas.
- **Skills.** Hook `PostToolUse` con `matcher: "Skill"` en todos los turnos de `runAgentTurn`;
  `skillUseName` cuenta `hermes:<nombre>` y un nombre sin prefijo solo si existe en el plugin. No se
  verificó con una invocación real (la única skill del plugin tiene efectos en el mundo).
