# Despertar con puntos (2026-10-22)

La mañana empieza cuando **confirmas que estás de pie**, no cuando suena la alarma.
Hasta entonces el cuarto no pone meditación ni música.

## Flujo de la escena `despertar` (`~/.hermes-os/escenas.json`)

1. `amanecer` (15 min antes de tu hora): luz cálida de 1 a 60 %.
2. `despertar` (`before_alarm_min: 0`, a tu hora) abre la **sesión** con la hora objetivo congelada.
3. Saludo en la TV: fecha, semana ISO, clima, agenda, pendientes y hábitos → **frase del día + discurso**
   (`DAILY_QUOTES[].talk` en `tv/plan.ts`: la cita es verificable y el discurso lo escribe Hermes, dicho como suyo)
   → "Tu alarma era a las…; ponte de pie y presiona OK".
4. `wait-awake`: Hermes TV abre **WakeActivity** ("¿Ya estás de pie?": hora, minutos que van, puntos que valdría
   levantarte YA). **OK en el control** confirma; también `wake_up confirm` en el chat ("ya me levanté").
   Insiste a los 5, 10, 20, 30, 45, 60, 75 y 90 min. Sin confirmación en `max_ms` (90 min) → 0 puntos y la escena
   se detiene.
5. Al confirmar dice los puntos y sigue: meditación → música.

## Hora objetivo

`compromiso` ("mañana me levanto a las 5:20", tool `wake_up commit`, `POST /wake/commit {time}`) manda sobre
la **alarma del teléfono** (la que pone tu calculadora de sueño; llega por `POST /day/alarm`). Al sonar,
Android avisa YA la alarma de mañana: la de hoy queda en `alarm.json.prev`. Sin ninguna a ±3 h, la hora de la escena.

## Puntos (`wake/plan.ts`, con tests)

- Hasta 2 min de diferencia (o antes): **100**. Después, −2 por minuto, piso **10** (levantarse siempre cuenta).
- Racha = mañanas seguidas a ≤10 min. Bono +5 por día de racha previa, tope +30.
- No confirmar = 0 y corta la racha.

Registro en `~/.hermes-os/wake/` (`state.json` sesión + compromiso, `history.json` una fila por mañana; sin migración).
Rutas: `GET /wake` · `POST /wake/confirm` (el token de la TV abre estas dos) · `POST /wake/commit`.

## En Hermes Phone (inicio v2, 2026-10-22)

La tarjeta **Despertar** abre el inicio (`ui/WakeCard.kt`, `room/Wake.kt`): tu hora en grande, de dónde sale,
racha, puntos de la semana y cuánto dormirías si te duermes ya. Tocarla abre el editor: hora y minutos con
flechas, ±5/±15, **calculadora de sueño** (ciclos de 90 min + 15 para dormirte; estimación, no medición) y
"poner también la alarma del reloj" (`AlarmClock.ACTION_SET_ALARM` sin abrir el Reloj). Guardar =
`POST /wake/commit`. Durante el despertar la tarjeta pasa a "¿Ya estás de pie?" con **Ya me levanté**
(`POST /wake/confirm {by:"phone"}`). Referencias de diseño tomadas de Matiz: Cake (valor principal en
superficie teñida), Stripe (cifras grandes en peso regular separadas por líneas finas), Mercury (neutros fríos).
