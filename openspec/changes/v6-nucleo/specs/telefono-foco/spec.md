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

## Notas de implementación

Teléfono (`hermes-phone-v6`): lógica pura en `core/FocusRules.kt` (extendido), `core/FocusLedger.kt`,
`core/FocusSurfaces.kt`, `core/FocusTemplates.kt`; tests en `core/…/FocusBudgetTest.kt` (un test por
escenario + registro en vivo, resumen del día y compatibilidad). App: `focus/FocusController.kt`,
`focus/SurfaceWatch.kt` (nuevo), `focus/FocusStore.kt`, `focus/FocusSync.kt`, `ui/FocusPause.kt`,
`ui/Focus.kt`, `assets/focus-surfaces.json`, QA en `QaReceiver.kt` + `./phone`. Agente:
`apps/agent/src/focus/store.ts` (`validateUsage` extendido), `focus/weekly-routes.ts`,
`packages/shared/src/focus-weekly.ts`, tests en `apps/agent/src/focus/weekly.test.ts`.

Decisiones:
- **Compatibilidad de reglas**: campos nuevos con valor por defecto (`rising = false`,
  `surfaces = []`) y alcances nuevos con su nombre serializado (`budget`, `always`). Una regla vieja
  (p. ej. `lim-instagram`) se lee y se comporta igual: la fricción creciente es una OPCIÓN de la regla,
  no un cambio del freno «espera» de siempre. Test de lectura de una regla guardada antes de v6.
- **`Brake.INTENT` va entre `WAIT` y `BLOCK`** (para «manda el freno más fuerte»); se serializa por
  nombre, así que el orden no rompe nada guardado. Con `rising`, la intención también espera.
- **`RuleScope.Always`** (nuevo, «cada vez que la abres»): la intención antes de entrar necesitaba un
  alcance de todo el día que frene al abrir; ninguno de los existentes lo era. `Budget` no pausa el reloj
  de una sesión de foco (como `Limit`); `Always` sí cuenta como distracción.
- **`surfaces` es una lista**, no un único `surface`: la plantilla «Sin Reels ni Shorts» cubre las dos.
  También aplica a reglas de límite y presupuesto (el tiempo en la superficie suma a su presupuesto).
- **Uso de hoy en vivo**: registro propio (`Ledger`) desde la app al frente de la accesibilidad +
  superficie; se cierra con `SCREEN_OFF` y se reabre al desbloquear; por app gana el mayor entre el
  registro y UsageTally de hoy. Aperturas = cambios de app (prender la pantalla sobre la misma app no
  cuenta). Archivo aparte `files/focus/ledger.json` (15 días).
- **Detección de superficie por sondeo** (~1,2 s) del árbol de la app vigilada, solo con una regla
  prendida que la nombre y la pantalla prendida. No se tocó la configuración del servicio de
  accesibilidad (del paquete «cuerpo»): escucha solo cambios de ventana y pasar a Reels no los produce.
- **«Salir»** en una hoja de superficie lleva al inicio (no «atrás»): si «atrás» no saliera de Reels, la
  hoja no volvería (el sondeo avisa solo cambios).
- **Al agente sube agregado**: por día, minutos y aperturas por app; por regla, hojas mostradas,
  elecciones, intenciones y (presupuesto) tope y minutos usados. Sin marcas de tiempo por hoja ni
  pantallas. El presupuesto de días pasados se calcula con el tope que la regla tiene al subir.
- **Resumen semanal**: la semana en curso se compara contra el MISMO tramo de la anterior (lunes→mismo
  día); lo no medido es `null` (sin aperturas de un teléfono viejo, sin semana anterior). Ruta siempre
  200 con `{ok}`.
- La firma de lo ya subido pasó a ser el hash del cuerpo: tras actualizar, cada día guardado se reenvía
  una vez (idempotente en el agente).

Sin probar en el teléfono real (prohibido adb esta noche):
- Los **ids de Reels y Shorts** (`assets/focus-surfaces.json`, todos `confirmed: false`): sacados de
  bloqueadores públicos, no vistos en el S25.
- El sondeo de superficie (latencia hasta la hoja, batería), la hoja nueva en el overlay de
  accesibilidad (intención, «pedir más», cifras), TalkBack sobre la cuenta regresiva, el receptor de
  pantalla y la subida real a un agente.

Pasos para confirmar los ids mañana (con el teléfono por USB, build debug):
1. `./phone install` (o `build` + instalar) y prender una plantilla o `./phone qa focus budget com.instagram.android 30`.
2. Abrir Instagram en la pestaña Reels → `./phone qa focus surface`. Debe decir `detectada=reels`.
   Anotar las líneas `surface ids=` y `seleccionados`.
3. Abrir los mensajes de Instagram → `./phone qa focus surface` → debe decir `detectada=ninguna`.
   Repetir con un reel abierto DESDE un mensaje (decidir con el dueño si eso cuenta como Reels).
4. YouTube en Shorts → `detectada=shorts`; YouTube en Inicio → `ninguna`.
5. Si algo no coincide: escribir el override con el id que aparece SOLO en esa superficie
   (`{"surfaces":[{"id":"reels","label":"Reels","package":"com.instagram.android","viewIds":["<id>"],"confirmed":true}]}`),
   `adb push` a `/sdcard/Android/data/os.hermes.phone/files/focus-surfaces.json`,
   `./phone qa focus surface reload` y volver al paso 2. Cuando quede bien, pasar los ids a
   `assets/focus-surfaces.json` con `confirmed: true`.
6. `./phone qa focus ledger` para ver los minutos/aperturas de hoy por app y por superficie; `./phone qa focus clear` al terminar.
