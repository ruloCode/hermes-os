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
