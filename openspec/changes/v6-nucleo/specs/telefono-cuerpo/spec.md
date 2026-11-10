# Capacidad: telefono-cuerpo

Repo `hermes-phone` (`body/`, `link/`, `net/`, `voice/`, `:core`) y el lado del agente
(`apps/agent/src/phone/`).

## ADDED Requirements

### Requirement: Actuar devuelve la pantalla
`tap`, `type`, `scroll` y `global` DEBEN responder con la pantalla ya estable y si cambió respecto a
la anterior.

#### Scenario: Toque que cambia de pantalla
- CUANDO un toque abre otra pantalla
- ENTONCES la respuesta trae la pantalla nueva y `changed: true`, sin otra llamada

#### Scenario: Toque sin efecto
- CUANDO el toque no cambia nada
- ENTONCES la respuesta trae `changed: false`

#### Scenario: Agente viejo
- CUANDO el agente no anuncia que entiende la respuesta nueva
- ENTONCES el teléfono responde `"ok"` como antes

### Requirement: Pasos en lote
`act_batch` DEBE ejecutar varios pasos seguidos y detenerse en el primero que exige confirmación, no
encuentra su objetivo o falla.

#### Scenario: Lote limpio
- CUANDO tres pasos de navegación no exigen confirmación
- ENTONCES se ejecutan los tres y la respuesta trae la pantalla final

#### Scenario: Paso con efecto en medio
- CUANDO el segundo paso es un toque con efecto (enviar, pagar, borrar)
- ENTONCES se pide confirmación al dueño para ese paso; si la niega, el lote se detiene y dice que llegó hasta el primero

#### Scenario: Objetivo que desapareció
- CUANDO la referencia de un paso ya no existe en la pantalla
- ENTONCES el lote se detiene ahí y devuelve la pantalla actual

### Requirement: Intents
`intent` DEBE permitir abrir un enlace, navegar a un lugar, marcar un número, compartir un texto y
buscar dentro de una app, sin tocar la pantalla.

#### Scenario: Abrir un enlace
- CUANDO se pide abrir una URL https
- ENTONCES se abre sin confirmación

#### Scenario: Marcar
- CUANDO se pide marcar un número
- ENTONCES se abre el marcador con el número puesto; la llamada la inicia el dueño

#### Scenario: Esquema no permitido
- CUANDO el intent no es de los tipos permitidos
- ENTONCES se rechaza con el motivo

### Requirement: Plazo de confirmación compartido
Cuando una acción espera la confirmación del dueño, el teléfono DEBE avisarlo con su plazo y el
agente DEBE esperar hasta ese plazo. Fuera de plazo no se ejecuta nada.

#### Scenario: «Más tiempo»
- CUANDO el dueño pide más tiempo en la hoja
- ENTONCES el teléfono avisa el plazo nuevo y el agente sigue esperando

#### Scenario: Aprobación tardía
- CUANDO el dueño aprueba después de que el agente dejó de esperar
- ENTONCES el toque no se ejecuta y la hoja dice que el pedido venció

### Requirement: Conexión por la primera ruta buena
El teléfono DEBE quedarse con la primera ruta de mayor prioridad que responde, sin esperar a las lentas.

#### Scenario: La red local responde
- CUANDO la ruta de red local responde y el túnel tarda
- ENTONCES la conexión se establece por la red local sin esperar al túnel

#### Scenario: La de mayor prioridad tarda poco
- CUANDO una ruta de menor prioridad responde primero y la de mayor prioridad responde dentro del margen
- ENTONCES gana la de mayor prioridad

### Requirement: Chat sin conexión
Un mensaje escrito sin conexión DEBE quedar en cola y salir al reconectar.

#### Scenario: Mensaje sin la Mac
- CUANDO se envía un mensaje y no hay ruta al agente
- ENTONCES queda marcado «se enviará al reconectar» y sale solo, una vez

### Requirement: La voz recibe pantallas completas y válidas
La salida de una tool para la voz DEBE recortarse por líneas de pantalla, nunca a mitad de un JSON.

#### Scenario: Pantalla grande
- CUANDO la pantalla supera el tope de la voz
- ENTONCES llegan las primeras líneas completas y una nota de cuántas faltan

### Requirement: Desplazar el contenedor correcto
`scroll` DEBE poder dirigirse a un contenedor concreto.

#### Scenario: Carrusel antes de la lista
- CUANDO hay un carrusel horizontal antes de la lista principal y se pide bajar
- ENTONCES se desplaza la lista vertical
