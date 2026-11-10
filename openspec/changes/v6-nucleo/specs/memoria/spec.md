# Capacidad: memoria

## ADDED Requirements

### Requirement: Índice local híbrido
La búsqueda de conocimiento DEBE funcionar sin ningún proveedor externo, combinando búsqueda léxica
(BM25) y vectores locales, sobre un índice en `~/.hermes-os/memoria/v2/`.

#### Scenario: Sin internet ni OpenAI
- CUANDO OpenAI no responde y el motor local de vectores está disponible
- ENTONCES la búsqueda devuelve resultados híbridos

#### Scenario: Sin vectores
- CUANDO ningún motor de vectores está disponible
- ENTONCES la búsqueda devuelve resultados léxicos y el estado dice que está en modo léxico

#### Scenario: Pregunta en español, texto en inglés
- CUANDO la pregunta está en español y el fragmento relevante en inglés
- ENTONCES el fragmento aparece por la parte de vectores

#### Scenario: Diversidad
- CUANDO una sola fuente domina los resultados
- ENTONCES ninguna fuente ocupa más de la mitad de la respuesta

### Requirement: Una sola búsqueda sobre todos los almacenes
El índice DEBE cubrir memorias, reuniones, ejecuciones, conversaciones y vault, y además gimnasio,
inglés, metas y actas del compañero, Upwork, pendientes del día y tutor.

#### Scenario: Dato que solo vivía en un JSON local
- CUANDO se pregunta por algo que solo está en una repetición del gimnasio o en una meta
- ENTONCES aparece en los resultados con su fuente

#### Scenario: Fuentes excluidas
- CUANDO se indexa
- ENTONCES finanzas y composición quedan fuera

### Requirement: Las memorias nuevas se pueden buscar al instante
Guardar una memoria DEBE dejarla en el índice local sin esperar a la sincronización.

#### Scenario: Guardar y buscar
- CUANDO se guarda una memoria y se busca enseguida por su contenido
- ENTONCES aparece, aunque OpenAI esté caído

### Requirement: Sincronización incremental
El índice DEBE sincronizarse solo, re-embebiendo únicamente lo que cambió.

#### Scenario: Nada cambió
- CUANDO corre la sincronización y ninguna fuente cambió
- ENTONCES no se calcula ningún vector

#### Scenario: Un documento cambió
- CUANDO cambia el texto de un documento
- ENTONCES solo ese documento se vuelve a embeber

#### Scenario: Reconstrucción
- CUANDO se corre `pnpm memoria:build`
- ENTONCES el índice se rehace completo desde las fuentes

### Requirement: Vigencia de los hechos y consolidación nocturna
Un hecho reemplazado NO DEBE borrarse: deja de aparecer en la búsqueda y guarda desde cuándo y por
cuál fue reemplazado. La consolidación nocturna propone fusiones y reemplazos; solo aplica sin
preguntar con `HERMES_LEARNING=auto`.

#### Scenario: Dato viejo contra dato nuevo
- CUANDO dos memorias se contradicen y la nueva reemplaza a la vieja
- ENTONCES la búsqueda devuelve la nueva y la vieja se puede consultar como historial

#### Scenario: Sin aprobación
- CUANDO `HERMES_LEARNING` no es `auto`
- ENTONCES la consolidación deja propuestas y no cambia nada

### Requirement: Salud visible
`GET /memoria/status` DEBE decir cuántos documentos hay por fuente, qué parte tiene vector, qué motor
está activo, cuándo fue la última sincronización y por qué falló el motor que no está.

#### Scenario: El motor de vectores se cae
- CUANDO el motor deja de responder
- ENTONCES sale UN aviso con el motivo, no uno por cada intento

#### Scenario: OpenAI sin crédito
- CUANDO OpenAI responde `insufficient_quota`
- ENTONCES no se le vuelve a llamar durante 6 horas

### Requirement: Evaluación con preguntas reales
DEBE existir un comando que mida recall@5 y MRR con preguntas del dueño, comparando el modo viejo
con el nuevo.

#### Scenario: Comparación
- CUANDO se corre `pnpm memoria:eval`
- ENTONCES imprime los dos números por modo (léxico, vectores, híbrido y el camino anterior) y qué preguntas fallaron

## Notas de implementación

Código: `packages/shared/src/memory-index.ts` (puro), `apps/agent/src/memoria/` (`embedder`, `cooldown`,
`store`, `sources`, `sync`, `service`, `dream`, `eval`, `status`, `routes`, `jobs`), `knowledge.ts`,
`memory.ts`, `embeddings.ts`, `scripts/memoria-{build,eval}.ts`; web `components/memoria/MemoryHealth.tsx`
+ `lib/memoria-api.ts`. Tests: `src/memoria/memory-index.test.ts` (lógica pura) y
`src/memoria/memoria.test.ts` (un test por escenario).

Decisiones:
- **Fusión por documento.** RRF (k = 60) sobre las dos vías, pero cada vía aporta solo el MEJOR fragmento
  de cada documento: sin eso, una nota larga del vault ocupaba varios puestos de una lista. Medido con las
  38 preguntas: híbrido 94,7 % / 0,825 → 92,1 % / 0,833 (una pregunta de diferencia: ruido; se queda por
  principio, no por el número).
- **Impulso suave y acotado en «puestos»**: recencia (vida media 60 días) + importancia valen como mucho
  ~2 puestos en la punta de una lista. El RPC anterior daba 15-25 % del puntaje a la recencia y los chats
  del día tapaban actas; un test comprueba que el hecho viejo que es LA respuesta no se entierra.
- **Diversidad estricta**: ninguna fuente pasa de la mitad de lo DEVUELTO; si las demás fuentes se acaban,
  la dominante se recorta (puede devolver menos que `limit`). Pedir una sola fuente no tiene tope.
- **Tokenizador**: plegado de plural tosco y simétrico (quita la cola de «s»/«e»): no es un lematizador,
  solo hace que singular y plural caigan igual. Siglas en mayúsculas se conservan aunque sean palabras
  vacías («IA»). Caché por palabra cruda: cargar 30.012 fragmentos pasó de 1,6 s a 0,92 s.
- **Modelo del índice fijo**: la sincronización incremental nunca cambia de motor; si el del índice está
  caído, lo nuevo queda sin vector (sale por léxico) y se completa cuando vuelve. Cambiar de motor =
  `pnpm memoria:build`. Nunca se comparan vectores de modelos distintos; `embeddings.ts` sigue siendo solo
  OpenAI (1.536) para las columnas de Supabase y respeta el mismo enfriamiento en disco.
- **Chats de menos de 15 caracteres** («ok», «dale») no se indexan: ruido para buscar.
- **Propuestas del sueño en `~/.hermes-os/memoria/v2/proposals.json`**, no en `learning_proposals`: su
  `kind` tiene un CHECK y el valor «memory» ya significa «guardar una memoria nueva» (lo aplica el curador
  con `saveMemory`). Aplicar = marcar reemplazadas en state.json; nada se borra ni se escribe en Supabase.
  Tope: 8 grupos por llamada, 2 llamadas por noche (`HERMES_MEMORY_DREAM_MAX_CALLS`).
- **Aviso único** = una línea `[memoria]` al pasar un motor de responder a fallar (y otra al volver) +
  `notices` en `/memoria/status`. No se llama a `notifyMac` ni al teléfono en esta fase.
- **saveMemory**: la dedup (coseno ≥ 0,9, mismo tipo) usa primero el índice local; solo sin vectores
  locales cae al RPC `match_memories`. Al actualizar una memoria ya no se escribe `embedding: null` (borraba
  el vector viejo del RPC). La memoria entra al índice al instante (persistencia agrupada a 1,5 s).

Límites conocidos:
- Throughput del motor local con fragmentos reales (~350 tokens): ~16 fragmentos/s en el M4; la
  reconstrucción completa de hoy (5.017 fragmentos) tarda ~5,5 min. 16 slots en vez de 4 no lo mejora
  (medido: 256 fragmentos en 19,6 s contra 20,9 s).
- La vía de vectores con preguntas generadas desde el texto rinde menos que la léxica (MRR 0,69 contra
  0,86): las preguntas repiten palabras del documento. Falta un `eval.jsonl` escrito por el dueño.
- `conversation_messages` del proyecto «vida» traen saldos dichos en el chat: finanzas está excluida como
  almacén, pero lo hablado de finanzas en un chat sigue indexado (igual que en el RPC anterior).
- `vault_docs` llega truncado a 16.000 caracteres por nota desde Supabase (lo trunca el job de vault).
- Primera búsqueda con el motor frío: ~1,3 s (arranque de llama-server); luego ~50 ms. Si el motor tarda
  más de 8 s (`HERMES_MEMORY_QUERY_TIMEOUT_MS`), esa búsqueda sale léxica.
