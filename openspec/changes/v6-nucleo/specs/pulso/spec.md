# Capacidad: pulso

Segunda fase del cambio. Reemplaza la idea de «un job por función» por un solo observador.

## ADDED Requirements

### Requirement: Un pulso que decide si algo merece interrumpir
Hermes DEBE revisar cada cierto tiempo el estado agregado (agenda, pendientes, juntas recientes,
metas en marcha, foco, finanzas del día y oportunidades) y decidir si hay algo que el dueño deba saber.

#### Scenario: Nada cambió
- CUANDO el estado es igual al de la revisión anterior
- ENTONCES no se llama a ningún modelo

#### Scenario: Algo cambió
- CUANDO cambió algo relevante desde la última revisión
- ENTONCES un modelo barato recibe solo el cambio y el resumen del estado, y responde «nada» o una tarjeta con título, texto, motivo y fuente

#### Scenario: Apagado
- CUANDO `HERMES_PULSE=off`
- ENTONCES no corre

#### Scenario: Horas de silencio
- CUANDO es de noche (entre las 22:00 y las 7:00 hora local)
- ENTONCES el pulso no llama al modelo ni avisa; lo que cambió se revisa en la primera pasada de la mañana

### Requirement: Bandeja antes que aviso
Lo que el pulso encuentra DEBE ir a una bandeja visible en el dashboard y en el teléfono. Solo lo
urgente gasta un aviso del presupuesto diario.

#### Scenario: Hallazgo normal
- CUANDO el pulso encuentra algo útil pero no urgente
- ENTONCES queda en la bandeja y no suena nada

#### Scenario: Avisos apagados (por defecto)
- CUANDO `HERMES_PULSE` no es `notify`
- ENTONCES nada suena nunca: todo queda en la bandeja, también lo urgente

#### Scenario: Hallazgo urgente con avisos prendidos y presupuesto
- CUANDO `HERMES_PULSE=notify`, el hallazgo es urgente y quedan avisos hoy
- ENTONCES sale un aviso al teléfono, con el motivo

#### Scenario: Sin presupuesto
- CUANDO ya se gastaron los avisos del día
- ENTONCES queda en la bandeja y se anota que no se avisó

### Requirement: Cada tarjeta tiene fuente y se puede descartar
Una tarjeta del pulso DEBE citar de dónde salió, y el dueño puede descartarla o decir «nunca de esto».

#### Scenario: «Nunca de esto»
- CUANDO el dueño marca una clase de tarjeta como no deseada
- ENTONCES el pulso deja de producir esa clase

### Requirement: Tope de gasto
El pulso DEBE respetar un tope diario de llamadas al modelo y registrarse en el gasto como `pulse`.

#### Scenario: Tope alcanzado
- CUANDO se alcanza el tope del día
- ENTONCES el pulso sigue revisando el estado pero no llama al modelo hasta el día siguiente
