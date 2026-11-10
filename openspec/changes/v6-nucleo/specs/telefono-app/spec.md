# Capacidad: telefono-app

Repo `hermes-phone` (`ui/`, `net/`, `:core`).

## ADDED Requirements

### Requirement: Repaso de inglés en el teléfono
Hermes Phone DEBE tener el repaso diario de inglés (capacidad `ingles`).

#### Scenario: Entrada
- CUANDO hay tarjetas pendientes hoy
- ENTONCES el inicio muestra «Inglés · N tarjetas» y lleva al repaso

#### Scenario: Sin conexión
- CUANDO el repaso de hoy ya se descargó
- ENTONCES se puede responder sin conexión y las respuestas suben después

#### Scenario: Agente sin la función
- CUANDO el agente no tiene la ruta del repaso
- ENTONCES la entrada no aparece

### Requirement: Finanzas de hoy en el teléfono
Finanzas (detrás de la huella) DEBE mostrar el disponible de hoy, el ritmo del día, los cargos
repetidos, los gastos hormiga y los desvíos (capacidad `finanzas`).

#### Scenario: Con plan
- CUANDO el agente devuelve el disponible de hoy
- ENTONCES se ve arriba, con la frase del método al tocarlo

#### Scenario: Dato guardado
- CUANDO no hay conexión
- ENTONCES se muestra el último dato con la hora en que se calculó

### Requirement: Preparación de junta en el teléfono
Al iniciar una junta desde el teléfono, DEBE verse la preparación del proyecto si existe.

#### Scenario: Con preparación
- CUANDO el proyecto elegido tiene preparación de hoy
- ENTONCES se muestra antes de empezar a grabar

### Requirement: Novedades al actualizar
La primera vez que se abre una versión nueva, DEBE mostrarse una hoja corta con lo que cambió.

#### Scenario: Primera apertura de 0.2.0
- CUANDO se abre la app por primera vez después de actualizar
- ENTONCES sale la hoja de novedades una sola vez, con enlaces a cada función

### Requirement: Versión y APK
La versión DEBE subir a 0.2.0 (código 2) y el APK DEBE instalarse sobre la versión anterior sin
perder datos.

#### Scenario: Actualizar
- CUANDO se instala el APK nuevo sobre la 0.1.0 con la misma firma
- ENTONCES la app se actualiza y conserva sesión, reglas de foco y colas

### Requirement: Compatibilidad con el agente de producción
El APK nuevo DEBE funcionar contra el agente actual de producción.

#### Scenario: Agente viejo
- CUANDO el agente no anuncia las capacidades nuevas ni tiene las rutas nuevas
- ENTONCES chat, voz, foco, juntas y finanzas funcionan como en la 0.1.0 y lo nuevo que depende del agente no se muestra

## Notas de implementación

Paquete «teléfono: aplicación» (tareas 8.1–8.4). Todo en `hermes-phone-v6`; sin commits.

### Dónde vive
- Lógica pura (`:core`, con tests): `AgentFeature.kt` (¿el agente tiene la función?), `EnglishReview.kt`
  (repaso: regla `checkTyped` portada, cola sin conexión, vista), `FinanceToday.kt`, `MeetingPrep.kt`
  (port de `prepCardState`/`prepSourceText`), `WhatsNew.kt`. Tests: `EnglishReviewTest`, `FinanceTodayTest`,
  `MeetingPrepTest` (+ `WhatsNewTest` en el mismo archivo).
- App: `net/AgentProbe.kt` (pedidos que nunca lanzan), `english/ReviewRepo.kt`, `finance/FinanceTodayRepo.kt`,
  `meet/MeetPrepRepo.kt`; pantallas `ui/EnglishReview.kt`, `ui/FinanceTodayCards.kt`, `ui/MeetPrep.kt`,
  `ui/WhatsNewSheet.kt`.
- Archivos compartidos tocados (mínimo): `HomeActivity.kt` (+17: pantalla del repaso, `LocalOpenEnglish`,
  `WhatsNewHost`, `EXTRA_OPEN=english`), `Home.kt` (+2: la fila del repaso bajo los mosaicos), `Finance.kt`
  (+5), `Meet.kt` (+3), `app/build.gradle.kts` (`versionCode = 2`, `versionName = "0.2.0"`).

### Compatibilidad con el agente de producción
`AgentFeature`: un 404/405, un 200 que no es objeto (el agente viejo responde `[]` a `GET /meetings/prep`
porque lo toma `/meetings/:project`) o que no es JSON = **función ausente** → la entrada, la tarjeta o la
sección no se pintan (ni el hueco). `{ ok:false }` = la función existe pero falló → se usa lo guardado
(no se borra la cola de respuestas). Sin red / 5xx = sin conexión → lo guardado con su hora. Ninguna ruta
nueva puede tumbar una pantalla: `AgentProbe` atrapa todo salvo la cancelación. Nada de lo de la 0.1.0
cambió de camino: Finanzas sigue leyendo sus rutas de antes y su `finance.json` intacto (la caché nueva
es `finance-today.json`).

### Decisiones
- **Repaso sin conexión**: `files/english/review.json` guarda el repaso bajado + las respuestas. Se corrige
  con `reveal` y la MISMA canonicalización del agente (paso a paso; los `\b` de JS se portan como
  lookarounds ASCII porque `\b` de Java no es igual con Unicode). Los 22 casos de `checkTyped` de `review.test.ts` están en
  el test, más rarezas medidas con el `canonicalEnglish` real vía tsx (`don´t`, ancho completo, `İ`).
  `clientId` = UUID por respuesta; la respuesta se escribe a disco ANTES de intentar subirla; el lote se
  empareja por `clientId` (no por posición). Rechazada (`ok:false` con motivo) sale de la cola y la tarjeta
  lo dice. Si el agente corrige el veredicto local, manda el agente y la tarjeta lo avisa.
- **Cuándo sube la cola**: tras cada respuesta, al abrir el inicio (cada 10 min o con cola) y al volver el
  enlace (`Runtime.link` → ONLINE; un colector por proceso arrancado desde la fila del inicio).
- **Racha provisional**: el agente cuenta hasta ayer mientras hoy no está completo; completar sin red suma
  uno y lo marca «se confirma cuando suban tus respuestas».
- **Día del repaso** = Bogotá (como el agente). La fila del inicio solo sale con el repaso de HOY y
  pendientes; un repaso de ayer guardado no se anuncia.
- **Finanzas de hoy**: «Hoy puedes gastar» es el primer bloque de Finanzas; tocarlo muestra `method` (y la
  tasa si hubo conversión). «Lo que se repite» va después del ritmo del mes; cada lista solo con datos;
  tocar una fila muestra su método. No reemplaza «Disponible hasta tu próximo ingreso» (es otra cuenta:
  saldo + plan con días de pago). Un dato de otro día se titula «Disponible del 9 nov», nunca «hoy».
- **Preparación**: en la pantalla de inicio de la junta, entre «Proyecto» e «Idiomas», para cualquier modo
  con proyecto. Muestra objetivo, preguntas, «para abrir» y 3 pendientes; «Ver todo» abre el resto, las
  promesas y los riesgos. «Preparar» corre en el scope de la app con 90 s de paciencia (llega aunque salgas)
  y muestra segundos transcurridos. `stale` → «Rehacer» (`force:true`). Sin red no se ofrece «Preparar».
- **Novedades**: `shouldShow` = la versión tiene notas, no se vieron, y la app viene de una versión anterior
  (`lastUpdateTime > firstInstallTime`; la 0.1.0 no guardaba nada). Se marca vista al mostrarse
  (SharedPreferences `hermes-v6`). Seis puntos; los que dependen de la Mac dicen «Con tu Mac al día». Cada
  uno abre su función (Finanzas pide la huella).

### Límites conocidos
- La firma: el APK de debug se firma con `~/.android/debug.keystore` de ESTA Mac (SHA-256
  `df51b04f…2a34`). Se instala sobre la 0.1.0 solo si esa también salió de esta Mac.
- La hoja de novedades del foco describe lo que dice specs/telefono-foco; si el foco final cambió de nombre
  algo, corregir `WhatsNew.kt`.
- No hay entrada al repaso desde «Tú»: con el repaso completo, la fila del inicio desaparece (el resumen se
  ve al terminar).

### Sin probar en el teléfono real
Nada de lo de arriba se abrió en un teléfono ni en un emulador (prohibido esta noche). Solo compila y pasan
los tests de `:core`. Pasos para el S25:
1. **Actualizar sin perder datos**: `./phone install` sobre la 0.1.0 → la sesión sigue abierta, Foco
   conserva sus reglas, Juntas sus grabaciones pendientes. Ajustes › Apps › Hermes dice 0.2.0.
2. **Novedades**: la primera apertura muestra «Novedades de la 0.2.0»; cerrar y volver a abrir → no sale
   otra vez. Tocar «Foco más fino» abre Foco; «Hoy puedes gastar» pide la huella y abre Finanzas.
3. **Agente de producción (viejo)**: inicio sin fila de inglés; Finanzas igual que antes (sin «Hoy puedes
   gastar» ni «Lo que se repite»); Juntas sin «Preparación» y sin hueco extra; «Repaso de inglés» desde
   novedades dice «Tu Mac todavía no tiene el repaso». Chat, voz, foco y juntas como en la 0.1.0.
4. **Agente de ensayo v6** (URL manual; arrancarlo con `HERMES_ENGLISH_REVIEW_DRY=1` para no escribir el
   set real): el inicio muestra «Inglés · N tarjetas»; responder una de escribir y una de elegir → veredicto
   con la correcta, la regla y «Clase · 28 oct»; en el log del agente, `POST /english/review/answers`.
5. **Sin conexión**: con el repaso abierto, modo avión → responder 2 tarjetas (veredicto inmediato, «Se sube
   a tu Mac cuando haya conexión», aviso ámbar arriba) → quitar el modo avión → en ≤1 min salen solas
   (logcat `HermesReview: subí 2 respuestas; quedan 0`) y el resumen deja de decir «faltan por subir».
   Repetir el lote no duplica (mismo `clientId`: `duplicate:true`).
6. **Finanzas de hoy**: con plan confirmado, «Hoy puedes gastar» arriba; tocarlo → la frase del método. Sin
   plan → el motivo del agente. Modo avión y volver a entrar → el último número con «Calculado a las … · sin
   conexión».
7. **Preparación**: Juntas → elegir un proyecto con actas → «Preparar» → contador de segundos → hoja con
   fuentes («acta del 3 nov · …»). Cambiar de proyecto y volver → la hoja sigue (la guarda el agente).
8. **TalkBack**: la fila del inicio se lee «Inglés · 3 tarjetas, Abrir el repaso de inglés»; las opciones de
   elegir se leen como botones de opción; el veredicto se anuncia solo (región viva).
