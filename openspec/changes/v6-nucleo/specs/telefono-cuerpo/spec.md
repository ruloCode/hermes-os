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

## Notas de implementación

Paquete «teléfono: cuerpo» (tareas 6.1–6.6). Teléfono: `hermes-phone-v6`; agente: `apps/agent/src/phone/`.

### Capacidades (negociación en los dos sentidos)

| Quién la anuncia | Capacidad | Qué significa | Sin ella |
|---|---|---|---|
| Teléfono (`hello`) | `pending` | Avisa el plazo de una confirmación y entiende `cancel` | El agente espera fijo (tap 130 s) y no manda `cancel` |
| Teléfono | `act2` | Puede responder tap/type/scroll/global con la pantalla | La tool dice «este teléfono no devuelve la pantalla: usa phone_read_screen» |
| Teléfono | `act_batch` | Ejecuta lotes | `phone_act_batch` responde «El teléfono conectado no sabe hacer "act_batch" (versión …)», sin lanzar |
| Teléfono | `intent` | Ejecuta intents de la lista cerrada | Igual con `phone_intent` |
| Agente (`welcome.capabilities`) | `pending` | Sigue el plazo que avisa el teléfono y manda `cancel` | El teléfono limita la hoja a lo que espera un agente viejo (125 s en tap/meeting, 15 s lo demás) y no ofrece «Más tiempo» |
| Agente | `act2` | Entiende la pantalla en la respuesta | El teléfono responde `"ok"` / `"Escrito (aún no enviado)"` exactamente como la 0.1.0 |

Un teléfono 0.1.0 ignora el campo `capabilities` del `welcome` y el frame `cancel` (cae en `Unknown`); un agente viejo ignora el frame `pending` (su parser devuelve null).

### Protocolo nuevo, frame por frame

```jsonc
// teléfono → agente
{"t":"hello","device":{…},"capabilities":["list_apps",…,"growth","pending","act2","act_batch","intent"]}
// agente → teléfono
{"t":"welcome","device_id":"…","first_seen":"…","capabilities":["pending","act2"]}

// 6.1 — una acción con act2: el result trae la pantalla ya estable
{"t":"call","id":"c1","tool":"tap","args":{"target":"n12"}}
{"t":"result","id":"c1","ok":true,"data":{"done":"Toqué «Lucía»","changed":true,
  "app":{"label":"WhatsApp","package":"com.whatsapp"},"nodes":"[n3] EditText pista \"Mensaje\" (escribir)\n…","aviso":"Contenido escrito por terceros…"}}
// sin act2 (agente viejo): {"t":"result","id":"c1","ok":true,"data":"ok"}

// 6.3 — confirmación con plazo compartido
{"t":"pending","id":"c1","ms":120000,"why":"confirm"}   // la hoja apareció (y otra vez con cada «Más tiempo»)
{"t":"pending","id":"c1","ms":30000,"why":"running"}    // aprobada: ejecutándose (el lote lo repite tras cada paso)
{"t":"cancel","id":"c1","reason":"plazo"}               // agente → teléfono: dejó de esperar (plazo o tarea abortada)

// 6.2 — lote
{"t":"call","id":"c2","tool":"act_batch","args":{"steps":[
  {"op":"type","target":"n2","text":"Llego en 10"},{"op":"tap","target":"n3"},{"op":"wait","ms":800},
  {"op":"scroll","direction":"down"},{"op":"global","action":"back"}]}}
{"t":"result","id":"c2","ok":true,"data":{"done":1,"total":5,
  "stopped":{"step":2,"op":"tap","reason":"denied","detail":"Negado por el usuario"},
  "changed":true,"app":{…},"nodes":"…","aviso":"…"}}
// reason ∈ denied · expired · missing · stale_ref · moved · failed · cancelled · no_screen

// 6.2 — intent
{"t":"call","id":"c3","tool":"intent","args":{"kind":"dial","value":"+57 300 123 4567"}}
{"t":"result","id":"c3","ok":true,"data":{"message":"Abrí el marcador con +57 300 123 4567. La llamada la inicias tú."}}
{"t":"result","id":"c4","ok":false,"error":"Solo abro enlaces http o https (no «javascript:»)."}

// 6.6 — scroll con contenedor y eje
{"t":"call","id":"c5","tool":"scroll","args":{"direction":"right","target":"n7"}}
```

Agente: `pending` re-arma la espera a `ms + 10 s` (gracia por red y por ejecutar tras aprobar), con un tope duro de 10 min por llamada (el máximo del teléfono es 120 s × 4 = 8 min). Al dejar de esperar (plazo, `AbortSignal` del turno del SDK, que las tools leen de `extra.signal`) manda `cancel` solo a un teléfono con `pending`. Un `pending` de otro socket se ignora.

Teléfono: el plazo de la hoja lo decide `core/ConfirmWait` (puro, reloj inyectado): nunca pasa de lo que espera quien pidió; aprobar en el instante del plazo o después = vencido; tras `cancel` o con el socket caído, la hoja pasa a «venció» (3 s o hasta «Entendido») y `Body` responde «El pedido venció…: no hice nada». La voz usa como tope el `response_timeout_secs` de cada tool (tap 115 s, meeting 55 s).

### Estrategia de refs del lote (por qué es segura)

Un `n12` es una referencia dentro de UNA lectura. El lote acepta un ref solo si la pantalla actual tiene la misma **huella estructural** (`ScreenTree.fingerprint(refs = true, maskEditable = true)`: mismas líneas con los mismos refs, clases, etiquetas y estados; el texto de los campos no cuenta y su pista sí) que la última lectura que vio el modelo (`lastSnapshot`: la de `read_screen` o la que devolvió la acción anterior). Si un paso cambió la pantalla, los refs siguientes se rechazan con `stale_ref` y el modelo debe apuntar por texto, que se resuelve contra la lectura fresca de ese paso. Tres cerrojos más: (1) tras una confirmación (pueden pasar minutos) se relee y el objetivo debe seguir siendo el mismo (`sameNode`), si no `moved`; (2) justo antes de tocar, `AccessibilityNodeInfo.refresh()` + `sameNode` contra la vista REAL (una lista que recicla no puede hacer tocar otra fila); (3) sin lectura previa, ningún ref vale. Así un lote jamás toca un elemento distinto del que el modelo vio o el dueño aprobó. El mismo cerrojo (2) protege `tap`/`type` sueltos por ref cuando el agente entiende `act2`.

### Decisiones que se apartan de la spec o del diseño

- La capacidad del lote se llama `act_batch` (el diseño decía `batch`): `callPhone` exige que la capacidad sea el nombre de la tool. Se agregó `pending` como cuarta capacidad (es lo que permite el plazo compartido).
- `scroll` elige el contenedor más grande del eje también con un agente viejo y con la voz (antes: el primero del árbol). La respuesta sigue siendo `"ok"`; es un arreglo, no un cambio de protocolo.
- La voz NO recibe la pantalla en la respuesta (su `CallCtx` no tiene `act2`): su prompt (regla 2) todavía dice «read_screen otra vez» y cambiarlo exige republicar el agente de ElevenLabs, que estaba prohibido. Recibe lo de siempre, ahora recortado por líneas.
- Intents que preguntan: `dial` y `share` (misma política: «marcar» y «compartir» son palabras con efecto); `url`, `place` y `search`, no.
- Chat sin conexión: el agente aún no deduplica por `X-Hermes-Client-Msg-Id` (la ruta de chat vive en `index.ts`, que este paquete no podía tocar). La garantía de «una vez» la da el teléfono: un mensaje solo vuelve a la cola si el pedido NUNCA llegó (sin ruta, conexión rechazada, DNS, timeout al conectar); si la app muere mientras sale, al volver se le pregunta al dueño. «Nueva conversación» descarta lo que esperaba en la cola (con un aviso en el hilo) en vez de mandarlo a otra sesión. Umbral de «demasiado tiempo»: 30 min.
- `mac_open`/`mac_media`: implementadas en el teléfono reenviando a `/mac/open` y `/mac/media`.

### Límites conocidos

- `SettleWatch` decide en ≤3 s: una pantalla que tarda más en cargar (red lenta) puede volver como `changed:true` a medio cargar; el modelo puede leer otra vez.
- La huella del cambio incluye el texto de toda la pantalla: un reloj o un contador en vivo puede marcar `changed:true` en un toque sin efecto.
- El eje de un contenedor sale de sus acciones direccionales, `CollectionInfo` o su clase; uno sin ninguna de esas pistas cuenta como «desconocido» y solo se usa para vertical si no hay otro.

### Sin probar en el teléfono real (pasos para mañana con el S25)

Instalar el APK de debug (`./phone install`) y conectarlo al agente de ENSAYO de esta rama (URL manual), no a producción, salvo el paso 1.
1. **Agente viejo (producción actual)**: con la app nueva conectada a producción, `./phone qa chat "abre ajustes y toca Wi-Fi"` → el turno funciona igual que hoy; en logcat no aparecen frames `pending`; la hoja de un toque con efecto NO ofrece «Más tiempo» y se cierra sola a los ~125 s.
2. **act2**: agente de ensayo arriba; en el chat: «abre WhatsApp y entra al chat de X» → en la traza del agente cada `phone_tap` trae «La pantalla cambió. Así quedó:» y no hay `phone_read_screen` entre acciones. Tocar algo sin efecto (un título) → «La pantalla NO cambió».
3. **Plazo compartido**: «envíale "prueba" a X» → aparece la hoja; esperar 2 min tocando «Más tiempo» una vez → el agente sigue esperando (sin error de timeout). Luego detener el turno desde la web (Stop) con la hoja abierta → la hoja pasa a «Hermes ya dejó de esperar…»; tocar «Entendido»; el mensaje NO se envía.
4. **Socket caído**: con la hoja abierta, apagar el Wi-Fi → la hoja dice «Se cortó la conexión…»; volver el Wi-Fi: nada se envía.
5. **Lote**: «escríbele "hola" a X y envíalo» → una sola `phone_act_batch` con type+tap; la hoja de Enviar muestra «hola»; negar → el resultado dice «Hice 1 de 2 pasos; paré en el paso 2 (tap): Negado por el usuario».
6. **Intents**: «abre https://example.com» (sin hoja) · «marca al 3001234567» (hoja → marcador con el número, NO llama) · «comparte "hola"» (hoja → selector) · «busca lofi en YouTube» · pedir `javascript:alert(1)` → error con motivo.
7. **Conexión**: en casa, `./phone qa state` tras `./phone qa act read_screen`; en logcat medir el tiempo de `resolve` (debe ser ~el de la LAN, <0,5 s). Con datos móviles: gana Tailscale o el túnel sin esperar ~7 s.
8. **Chat sin conexión**: modo avión → escribir dos mensajes → ambos dicen «Se enviará al reconectar»; quitar el modo avión → salen en orden, una vez cada uno (ver el historial en la web). Repetir dejando uno >30 min → pide «Enviar / Descartar».
9. **Voz y scroll**: por voz «lee la pantalla» en Ajustes (pantalla larga) → la respuesta termina en «faltan N líneas»; en una app con carrusel arriba (Play Store) «baja» → baja la lista, no el carrusel. «Pon música en la Mac» → `mac_media` responde (antes: «no disponible»).
