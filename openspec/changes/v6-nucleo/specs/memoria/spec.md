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
