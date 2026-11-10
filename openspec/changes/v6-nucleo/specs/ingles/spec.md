# Capacidad: ingles

## ADDED Requirements

### Requirement: Repaso diario con los errores propios
Hermes DEBE ofrecer cada día un repaso de hasta 8 tarjetas hechas con los errores reales del dueño
(lo que dijo → cómo se dice | la regla), sin llamar a ningún modelo.

#### Scenario: Hay errores registrados
- CUANDO existen sesiones con errores anotados
- ENTONCES el repaso de hoy trae primero las tarjetas vencidas y completa con nuevas hasta 8

#### Scenario: Sin errores registrados
- CUANDO no hay errores
- ENTONCES no hay repaso y la interfaz dice de dónde salen las tarjetas

#### Scenario: Error ambiguo
- CUANDO un error no trae la versión correcta o es igual a lo que se dijo
- ENTONCES no se convierte en tarjeta

#### Scenario: Mismo error dos veces
- CUANDO el mismo error aparece en dos sesiones
- ENTONCES hay una sola tarjeta y cuenta las dos apariciones

### Requirement: Repetición espaciada
Cada tarjeta DEBE volver según cómo se respondió: acierto la pasa a la caja siguiente (1, 3, 7, 16 y
35 días); fallo la devuelve a la primera.

#### Scenario: Acierto
- CUANDO se responde bien una tarjeta de la caja de 3 días
- ENTONCES vuelve a los 7 días

#### Scenario: Fallo
- CUANDO se responde mal
- ENTONCES vuelve mañana

#### Scenario: Dominada
- CUANDO se acierta en la caja de 35 días
- ENTONCES la tarjeta queda dominada y solo vuelve si el mismo error reaparece en una sesión

### Requirement: Dos formas de responder
Una tarjeta se responde escribiendo la frase correcta o eligiendo la correcta entre opciones.

#### Scenario: Escribir con diferencias menores
- CUANDO la respuesta escrita difiere solo en mayúsculas, puntuación, espacios o contracciones equivalentes
- ENTONCES cuenta como acierto

#### Scenario: Elegir
- CUANDO la tarjeta es de elegir
- ENTONCES las opciones incluyen lo que el dueño dijo y la versión correcta, en orden que cambia

### Requirement: Racha y avance
El repaso DEBE mostrar cuántas tarjetas faltan hoy, la racha de días con el repaso completo y cuántas
están dominadas, todo calculado del registro.

#### Scenario: Repaso completo
- CUANDO se responden todas las de hoy
- ENTONCES el día cuenta para la racha y se marca el hábito de práctica de inglés una sola vez

### Requirement: Disponible en la web y en el teléfono
El repaso DEBE estar en `/ingles` y en Hermes Phone, y en el teléfono debe poder hacerse sin conexión.

#### Scenario: Teléfono sin conexión
- CUANDO el teléfono ya descargó el repaso de hoy y pierde la conexión
- ENTONCES se puede responder y las respuestas suben al reconectar, sin duplicarse

## Notas de implementación

Código: lógica pura en `packages/shared/src/english-review.ts`; servicio y almacén en
`apps/agent/src/english/review.ts`; rutas en `apps/agent/src/english/review-routes.ts`; tests en
`apps/agent/src/english/review.test.ts` (uno por Scenario + `checkTyped` + contrato). Web:
`apps/web/src/components/ingles/DailyReview.tsx` + `apps/web/src/lib/english-review-api.ts`.

### De dónde salen las tarjetas
- Errores de TODAS las sesiones guardadas (`english_sessions.errors`, tutora y clases; hasta 500
  sesiones), en solo lectura. Las tarjetas se recalculan en cada pedido: un error nuevo entra solo.
- Se descarta (`discardReason`): sin corrección · corrección igual a lo dicho (o lo dicho ya la
  contiene y le sobran ≥3 palabras: el corrector recortó un pedazo) · lo dicho >90 caracteres o la
  corrección >110 · nota que empieza por `Directo:` (regla de ARTICULACIÓN del corrector, no un
  error de inglés) · nota de repetición/redundancia/vacilación sin ningún patrón gramatical · nota
  que menciona STT/transcripción · corrección con `→`/`|` o nota de frase reconstruida · resto del
  corte del transcript que quedó con <40 % de las palabras de la corrección.
- Medido el 2026-11-10 con los datos reales (21 sesiones, 180 errores): **126 tarjetas**,
  3 errores repetidos fusionados (`seen: 2`), **51 descartados**: 25 articulación, 11 largos,
  10 STT, 3 confusos, 2 iguales. 23 tarjetas sin patrón del plan (se repasan igual, van al final).
- Alternativas del corrector («a, or b», «a / b», «a o b») → `better` = la primera y `accept` = las
  demás que no son un pedazo (≥60 % de las palabras de la primera).
- `id` = huella FNV del par (dicho, correcto) normalizado con `canonicalEnglish` (estable entre
  sesiones y entre reinicios). `pattern` = primer patrón de `patternHits` del plan.

### Reglas
- Cajas: índice 0..4 → 1, 3, 7, 16, 35 días. Nueva = caja 0 con vencimiento hoy. Acierto → caja
  siguiente, vence `día de la respuesta + intervalo`. Fallo → caja 0, vence mañana. Acierto en la
  caja 4 → dominada (`masteredAt`).
- Reaparición: si el mismo error sale en una sesión POSTERIOR a la última respuesta (o a dominarla),
  vuelve a la caja 0 y vence el día en que reapareció. Se aplica también a tarjetas no dominadas
  (la spec lo pide solo para dominadas; volver a cometerlo es un fallo).
- Set del día (máx. 8): vencidas (más atrasada primero), luego nuevas **intercaladas por patrón**
  (turnos del patrón con más apariciones al de menos; sin patrón al final; dentro de cada uno la
  más reciente). Decisión: con datos reales, ordenar solo por peso daba 8 tarjetas de la misma
  regla seguidas. El set se CONGELA en `state.json` la primera vez que se pide en el día
  (`GET /today` escribe): responder 3 y volver deja las otras 5.
- Tipo por tarjeta y día: `fnv(id|día|kind) % 2` → `type` o `choose`; frase correcta >80 caracteres
  o >14 palabras → siempre `choose`.
- Opciones de `choose`: lo dicho + la correcta + un distractor SOLO si otro error del mismo patrón
  difiere en una palabra (cambiada o faltante) y esa palabra está en esta frase: se le aplica el
  mismo error. Orden barajado con semilla `fnv(id|día|opts)`. Se guardan en el set del día.
- Una respuesta por tarjeta y día. Se corrige SIEMPRE con `checkTyped(answer, better, accept)`, en
  los dos tipos (en `choose`, el texto de la opción elegida).
- `checkTyped` (`canonicalEnglish` en los dos lados y comparación exacta): NFKC → minúsculas → sin
  tildes → apóstrofos `’‘\`´ʼ` → `'` y comillas `“”«»` → `"` → contracciones expandidas
  (`can't|cannot`→`can not`, `won't`→`will not`, `shan't`→`shall not`, `ain't`→`is not`,
  `let's`→`let us`, `Xn't`→`X not`, `'m`→` am`, `'re`→` are`, `'ve`→` have`, `'ll`→` will`,
  `'d`→` would`, y `'s`→` is` SOLO tras he/she/it/that/there/here/what/who/where/how/this) →
  `- – — /` a espacio → todo lo que no sea `[a-z0-9' ]` a espacio → quitar apóstrofos sueltos →
  un espacio. El posesivo (`people's`) se conserva. Límite conocido: `'d` = would y `'s` = is
  (`I'd seen` / `it's been` no casan con `I had seen` / `it has been`).
- Completar el set del día (todas respondidas) sella `completedAt` y marca el hábito
  «Práctica de inglés» con la fecha DEL SET (una vez; además el check-in es idempotente por día).
  Racha = días seguidos con `completedAt`, desde hoy o desde ayer si hoy aún no.
- Fechas: «día» = AAAA-MM-DD de Bogotá (UTC−5 fijo).

### Almacén (`$HERMES_HOME/english-review/`, default `~/.hermes-os/english-review/`)
- `state.json`: `{ version: 1, cards: { [id]: { box, due, masteredAt?, lastAnsweredAt?, right, wrong } }, days: { [AAAA-MM-DD]: { items: [{ id, kind, options? }], results: { [id]: boolean }, completedAt? } } }` (escritura atómica tmp+rename; se guardan 400 días).
- `answers.jsonl`: una línea por respuesta aceptada `{ clientId, cardId, day, kind, answer, correct, answeredAt, receivedAt }`.
- `HERMES_ENGLISH_REVIEW_DRY=1`: corrige pero no escribe ni marca el hábito (estado en memoria del
  proceso, sembrado del disco). **Ojo: cualquier agente de ensayo SIN esta variable que llame
  `GET /english/review/today` escribe el set del día en el `~/.hermes-os` real.**

### Contrato HTTP (todas con `Authorization: Bearer …`; errores de validación = 200 `{ ok:false, error }`)

`GET /english/review/today`
```json
{ "ok": true, "review": {
  "day": "2026-11-10",
  "cards": [
    { "id": "c4bp3r211rttln", "kind": "type", "said": "the person that works as a medical",
      "pattern": "forma-palabra", "patternTitle": "La palabra exacta", "seen": 1,
      "answered": null, "reveal": "eyJzYWlkIjoi…" },
    { "id": "c151ryh9amuqnm", "kind": "choose", "options": ["retrace my point", "restate my point"],
      "pattern": "forma-palabra", "patternTitle": "La palabra exacta", "seen": 1,
      "answered": { "correct": false }, "reveal": "eyJzYWlkIjoi…" }
  ],
  "done": 1, "correct": 0, "total": 8, "complete": false,
  "streak": 0, "mastered": 0, "totalCards": 126,
  "dueTomorrow": 1, "nextDue": "2026-11-11", "byBox": [1, 0, 0, 0, 0]
} }
```
- `kind: "type"` trae `said` y NO trae `options`; `kind: "choose"` trae `options` (2 o 3, en orden de
  pantalla) y NO trae `said` (no se marca cuál es lo que dijiste antes de responder).
- `pattern` ∈ `pasado | tercera-s | sujeto | preposiciones | articulos | forma-palabra | estructura | null`.
- `reveal` = base64 ESTÁNDAR de un JSON UTF-8 `{ "said", "better", "accept": [], "rule": string|null, "source": { "sessionId", "date", "kind": "class"|"practice", "label": "Clase · 3 nov" } }`.
  Existe para corregir y mostrar el veredicto SIN conexión; decodificar solo después de responder.
  La web no lo usa (corrige el servidor).
- `answered: null` = sin responder hoy. Sin errores registrados: `totalCards: 0`, `cards: []`,
  `total: 0` → la interfaz explica de dónde salen las tarjetas. `total: 0` con `totalCards > 0` = al día
  (`nextDue` dice cuándo vuelve algo; `null` = nada programado).
- `dueTomorrow` = tarjetas que vencen mañana; `byBox` = no dominadas por caja (1, 3, 7, 16, 35 días).

`POST /english/review/answer` — cuerpo `{ "cardId", "kind", "answer", "clientId", "answeredAt"?, "day"? }`
```json
{ "ok": true, "cardId": "c4bp…", "clientId": "6f1c…", "correct": false,
  "duplicate": false, "already": false,
  "said": "the person that works as a medical", "better": "a doctor", "accept": ["a physician"],
  "rule": "\"as a medical\" no existe; \"medical\" es adjetivo, no profesión",
  "source": { "sessionId": 27, "date": "2026-10-28", "kind": "class", "label": "Clase · 28 oct" },
  "next": { …mismo objeto que `review` de GET /today… } }
```
- `clientId` (obligatorio, ≤100 chars, uno por respuesta): repetirlo devuelve el registro original
  con `duplicate: true` y no cuenta otra vez. Otra respuesta a una tarjeta ya respondida ese día
  devuelve la primera con `already: true`.
- `kind` se ignora: manda el tipo guardado en el set del día. `answer` ≤400 chars, no vacío.
- `answeredAt` (ISO, opcional): más de 7 días atrás → `{ ok:false, error }`; en el futuro (>5 min) o
  inválido → se toma la hora del servidor. La caja se mueve desde el día de `answeredAt`.
- `day` (opcional): el día del set al que pertenece la tarjeta (mandarlo siempre desde el
  teléfono: un set bajado antes de medianoche y respondido después). Sin `day` se usa el día de
  `answeredAt` y, si la tarjeta no está ahí, el set más reciente (≤7 días) donde siga sin responder.
- Fallo: `{ "ok": false, "cardId"?, "clientId"?, "error": "…", "next": {…} }`.

`POST /english/review/answers` — cuerpo `{ "answers": [ {…igual que /answer…}, … ] }` (≤200)
```json
{ "ok": true, "results": [ { …respuesta de /answer sin `next`… } ], "next": { …review… } }
```
- `results[i]` ↔ `answers[i]`. Se aplican en orden de `answeredAt`. Idempotente por `clientId`:
  reintentar el lote entero es seguro. Un elemento inválido da su `{ ok:false, error }` en su
  posición sin tumbar el lote.

`GET /english/review/stats`
```json
{ "ok": true, "totalCards": 126, "mastered": 0,
  "discarded": { "articulacion": 25, "largo": 11, "stt": 10, "confuso": 3, "igual": 2 },
  "patterns": [ { "pattern": "forma-palabra", "title": "La palabra exacta", "cards": 26,
                  "mastered": 0, "answered14": 0, "accuracy14": null } ] }
```
- `accuracy14` ∈ [0,1] sobre las respuestas de los últimos 14 días (incluido hoy); `null` sin respuestas.

### Para el teléfono (sin conexión)
Bajar `GET /today` y guardarlo. Para responder sin red: decodificar `reveal`, corregir con las reglas
de `checkTyped` de arriba, mostrar el veredicto y encolar `{ cardId, kind, answer, clientId, answeredAt, day }`
con un `clientId` generado UNA vez por respuesta. Al reconectar, `POST /answers` con la cola y
reemplazar el estado local por `next`. El veredicto local es provisional: si el servidor dice otra
cosa (no debería: misma regla), manda el servidor.

### Límites conocidos
- Respuestas de más de 7 días se rechazan. Si se borra la sesión de donde salió una tarjeta, la
  tarjeta desaparece del set (y sus respuestas siguen en el jsonl).
- Si el día se armó sin tarjetas (no había errores) no se congela: un error nuevo ese mismo día
  arma el set al siguiente pedido.
- La web no tiene cola sin conexión: un fallo de red muestra el motivo y se reintenta con el mismo `clientId`.
