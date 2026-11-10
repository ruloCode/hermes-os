# Capacidad: telefono-foco

Repo `hermes-phone` (`core/Focus*.kt`, `focus/`, `ui/Focus*.kt`). Regla que no se rompe: **sin una
regla del dueño no hay intervención.** Todo lo de abajo son opciones de regla y plantillas apagadas.

## ADDED Requirements

### Requirement: Presupuesto diario
Una regla DEBE poder fijar un tope de minutos al día para sus apps.

#### Scenario: Aviso al 80 %
- CUANDO el uso del día en las apps de la regla llega al 80 % del tope
- ENTONCES sale un aviso, una sola vez ese día, con los minutos que quedan

#### Scenario: Tope alcanzado
- CUANDO el uso llega al 100 %
- ENTONCES el freno de la regla sale en cada apertura hasta el día siguiente

#### Scenario: Día nuevo
- CUANDO cambia el día local
- ENTONCES el presupuesto vuelve a estar completo

#### Scenario: Varias apps en una regla
- CUANDO la regla cubre Instagram y TikTok
- ENTONCES los minutos de las dos suman al mismo tope

### Requirement: Fricción creciente
La espera antes de poder entrar DEBE crecer con cada «entrar» del día sobre la misma regla.

#### Scenario: Primera y cuarta vez
- CUANDO el dueño elige entrar por primera vez en el día
- ENTONCES espera 10 s; a la segunda 20 s, a la tercera 40 s y de ahí en adelante 60 s

#### Scenario: Día nuevo
- CUANDO cambia el día local
- ENTONCES la espera vuelve a 10 s

### Requirement: Intención antes de entrar
Una regla DEBE poder pedir la intención: a qué entra y por cuántos minutos.

#### Scenario: Elegir intención
- CUANDO sale la hoja de una regla con freno de intención
- ENTONCES ofrece intenciones cortas (responder un mensaje, publicar, buscar algo, solo mirar) y minutos (2, 5 o 10)

#### Scenario: Se acabó el tiempo
- CUANDO pasan los minutos elegidos y la app sigue al frente
- ENTONCES la hoja vuelve citando la intención y ofrece salir o pedir más (lo que cuenta para la fricción creciente)

#### Scenario: «Solo mirar»
- CUANDO se elige «solo mirar»
- ENTONCES se permite, con los minutos elegidos, y queda registrado como tal

### Requirement: Freno por superficie
Una regla DEBE poder aplicar solo a una superficie de la app (Reels de Instagram, Shorts de YouTube),
dejando libre el resto.

#### Scenario: Mensajes de Instagram
- CUANDO la regla es de Reels y el dueño está en los mensajes
- ENTONCES no sale ningún freno

#### Scenario: Entrar a Reels
- CUANDO el dueño entra a Reels
- ENTONCES sale el freno de la regla y el tiempo ahí cuenta para su presupuesto

#### Scenario: Superficie no reconocida
- CUANDO la app cambió y la superficie ya no se reconoce
- ENTONCES la regla no dispara, y el diagnóstico (`./phone qa focus surface`) dice qué se ve en pantalla

#### Scenario: Identificadores configurables
- CUANDO cambian los identificadores de una superficie
- ENTONCES se actualizan en un archivo de configuración sin recompilar la lógica

### Requirement: La hoja dice cuánto llevas
La hoja de pausa DEBE mostrar las aperturas y los minutos de hoy en esa app, medidos.

#### Scenario: Décima apertura
- CUANDO sale la hoja en la décima apertura del día
- ENTONCES dice «10.ª vez hoy» y los minutos acumulados

### Requirement: Plantillas, no reglas impuestas
Las reglas nuevas DEBEN ofrecerse como plantillas apagadas que el dueño prende con un toque.

#### Scenario: Primera vez tras actualizar
- CUANDO el dueño abre Foco después de actualizar
- ENTONCES ve las plantillas (presupuesto diario de redes, intención antes de entrar, sin Reels) apagadas, cada una con lo que hace

### Requirement: Funciona sin la Mac
Todo lo anterior DEBE decidirse en el teléfono, con lógica pura en `:core` y tests.

#### Scenario: Sin conexión
- CUANDO el teléfono no tiene ruta al agente
- ENTONCES presupuestos, fricción, intención y superficies siguen funcionando

### Requirement: El resumen sube al agente
El agente DEBE recibir, por día, minutos y aperturas por app y los cortes por regla, para el resumen
semanal. Nunca qué se miró.

#### Scenario: Resumen semanal
- CUANDO se pide el resumen de foco de la semana
- ENTONCES trae minutos y aperturas por app, días dentro y fuera de presupuesto y la comparación con la semana anterior
