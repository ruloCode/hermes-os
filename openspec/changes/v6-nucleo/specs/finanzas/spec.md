# Capacidad: finanzas

## ADDED Requirements

### Requirement: Disponible hoy
Hermes DEBE calcular cuánto puede gastar hoy el dueño sin salirse de su plan del mes, y decir el método
en una frase.

#### Scenario: Plan confirmado
- CUANDO hay un plan mensual confirmado con ingresos y gastos fijos
- ENTONCES disponible hoy = (ingresos del plan − gastos fijos del plan − gasto variable del mes) ÷ días que quedan, incluido hoy

#### Scenario: Sin plan
- CUANDO no hay plan confirmado
- ENTONCES no se muestra un número: se dice que falta confirmar el plan

#### Scenario: Ya se pasó
- CUANDO el gasto variable del mes ya supera lo que el plan dejaba
- ENTONCES el disponible es cero y se dice por cuánto se pasó

#### Scenario: Transferencias propias
- CUANDO hay movimientos de la categoría `transferencia`
- ENTONCES no cuentan como gasto ni como ingreso

#### Scenario: Dos monedas
- CUANDO hay movimientos en USD y en COP
- ENTONCES se suman en la moneda del plan con la tasa del día y la respuesta dice qué tasa usó

### Requirement: Ritmo del día
Hermes DEBE decir cuánto se ha gastado hoy contra el disponible de hoy.

#### Scenario: Día en curso
- CUANDO ya hubo gastos hoy
- ENTONCES muestra lo gastado, lo disponible y lo que queda, sin redondear a favor

### Requirement: Cargos repetidos
Hermes DEBE listar los cargos que se repiten: mismo comercio con monto parecido en dos meses o más.

#### Scenario: Suscripción
- CUANDO un comercio cobra un monto parecido (±10 %) en dos o más meses distintos
- ENTONCES aparece como cargo repetido con su monto mensual, la última fecha y el total del año en curso

#### Scenario: Compra repetida que no es suscripción
- CUANDO un comercio aparece varias veces con montos muy distintos
- ENTONCES no se lista como cargo repetido

### Requirement: Gastos hormiga
Hermes DEBE mostrar los comercios con muchas compras pequeñas en el mes y cuánto suman.

#### Scenario: Muchas compras chicas
- CUANDO un comercio tiene cinco o más compras en el mes, cada una por debajo del umbral de compra pequeña
- ENTONCES aparece con el número de compras y el total

### Requirement: Desvíos por categoría
Hermes DEBE avisar cuando una categoría va por encima de lo habitual.

#### Scenario: Categoría disparada
- CUANDO el gasto del mes en una categoría supera su mediana de los tres meses anteriores, ajustada al día del mes
- ENTONCES aparece con cuánto va de más y la base del cálculo

#### Scenario: Sin historia
- CUANDO hay menos de tres meses de datos en esa categoría
- ENTONCES no se evalúa y no se muestra

### Requirement: Visible en la web y en el teléfono, con el candado
Lo anterior DEBE verse en `/finanzas` y en Finanzas de Hermes Phone. En el teléfono sigue detrás de
la huella y el chat sin huella no accede a estas cifras.

#### Scenario: Teléfono sin huella
- CUANDO el chat del teléfono pregunta por el disponible de hoy sin haber desbloqueado finanzas
- ENTONCES la tool no existe en ese turno y Hermes dice por qué

## Notas de implementación

Lógica pura en `packages/shared/src/finance-today.ts`; agente en `apps/agent/src/finance/today.ts`
(lee plan + 400 días de movimientos + tasa), `today-routes.ts`, `today-tools.ts`; tests (uno por
escenario + bordes) en `apps/agent/src/finance/today.test.ts`; web en
`apps/web/src/components/vida/FinanceToday.tsx` + `apps/web/src/lib/finance-today-api.ts`.

### Decisiones

- **Fijo y variable.** «Fijo» = toda partida de gasto del plan confirmado. El plan **reserva** por
  categoría la suma de sus partidas; un gasto real en esa categoría consume la reserva y solo lo que
  la pasa es «variable». Lo que cae en una categoría que el plan no tiene es variable entero. Así un
  gasto fijo ya pagado (arriendo en `vivienda`) no se resta dos veces. `plan.ts` no empareja partidas
  con movimientos, por eso la regla es por categoría y va escrita en `method`.
- **Ingresos = los del plan**, no lo que entró de verdad: el plan es la promesa con la que se vive el
  mes. Plan sin ingresos → sin número (`missing: "income"`).
- **El gasto de hoy no achica el disponible de hoy**: disponible = (ingresos − fijos − variable del mes
  ANTES de hoy) ÷ días que quedan incluido hoy. Lo de hoy se muestra contra él (`spentToday`,
  `remaining`); mañana entra al gasto del mes. Lo que hoy cubrió una reserva del plan va aparte en
  `spentTodayPlanned` y no resta.
- **Ya se pasó**: si (ingresos − fijos) − variable antes de hoy ≤ 0, `available = 0`. `overBy` aparece
  cuando el variable del mes CONTANDO hoy pasa lo que el plan deja libre.
- **Sin redondear a favor**: `available` hacia abajo, `spentToday` y `overBy` hacia arriba, `remaining`
  = `available − spentToday` sin recortar (puede ser negativo). Pesos enteros, dólares con centavos.
- **Moneda del plan** = la de sus gastos (si mezclan, COP). Lo demás se pasa con la tasa del día
  (`finance/fx.ts`); sin tasa y con monedas distintas no hay número (`missing: "fx"`). `fx` solo
  aparece si hubo conversión.
- **Comercio** (`merchantKey`): minúsculas sin tildes, sin lo que va entre paréntesis (el banco de
  destino de los avisos), sin números de 1-4 dígitos (sucursal; un número de cuenta largo sí
  distingue), sin asteriscos, letras sueltas ni sufijos (SAS, Ltda…). Las notas que no nombran a nadie
  («Envío desde Nequi», «Transferencia a cuenta», «Aviso del banco») no se agrupan.
- **Cargos repetidos**: grupo de montos a ±10 % de la mediana del grupo, en ≥2 meses distintos y **un
  solo cobro por mes**: eso separa una suscripción del café diario que cuesta siempre igual (eso es
  hormiga). `recurringCharges(txs, hoy)` recibe «hoy» para el total del año. Un comercio puede dar dos
  cargos si cobra dos montos distintos cada mes.
- **Umbral de compra pequeña** = mediana (percentil 50, rango más cercano: siempre es una compra real)
  de los gastos del dueño en los 90 días hasta hoy, por moneda; con menos de 20 compras no hay umbral
  y no hay lista. Se eligió la mediana y no el p25 porque «pequeña» es la mitad de abajo de lo que el
  dueño gasta; con sus datos de hoy ningún comercio llega a 5 compras bajo ese umbral y la lista no
  aparece (correcto: no hay dato que mostrar).
- **Desvíos**: esperado = mediana de los 3 meses anteriores × (día de hoy ÷ días del mes). Solo se
  evalúa una categoría con gasto en CADA uno de esos 3 meses. Por moneda.
- Transferencias propias (`isTransfer`) y anulados no cuentan en ningún cálculo (tests explícitos).
- **Candado**: `get_finance_today` está en `FINANCE_TOOLS` de `guard.ts`; desde el teléfono sin huella
  la tool no existe y la nota del turno dice por qué.

### Contrato JSON (lo consume Hermes Phone tal cual)

Ambas rutas responden 200 siempre.

`GET /finance/today`

```jsonc
// con número (cifras de ejemplo, de los tests)
{ "ok": true,
  "today": {
    "available": 90476,            // número, moneda de `currency`; 0 si ya se pasó
    "spentToday": 0,                // gasto de hoy que cuenta contra el disponible
    "spentTodayPlanned": 0,         // gasto de hoy cubierto por una reserva del plan
    "remaining": 90476,            // available − spentToday (puede ser < 0)
    "daysLeft": 21,                 // incluido hoy
    "currency": "COP",              // "COP" | "USD": la moneda del plan
    "overBy": 50000,                // OPCIONAL: solo si el mes ya pasó lo libre del plan
    "plan": { "income": 0, "fixed": 0, "variable": 0 }, // base; variable = antes de hoy
    "method": "Disponible hoy = (…) ÷ 21 días que quedan, incluido hoy. …",
    "fx": { "usdCop": 4000, "asOf": "Mon, 09 Nov 2026 00:02:31 +0000", "converted": 2 }, // OPCIONAL
    "asOf": "2026-11-10"            // día (zona del dueño) al que corresponde
  } }
// sin número
{ "ok": true, "today": null, "missing": "plan" | "income" | "fx", "reason": "Falta confirmar el plan mensual: …" }
// fallo de lectura
{ "ok": false, "error": "No se pudieron leer los movimientos: …" }
```

`GET /finance/insights`

```jsonc
{ "ok": true,
  "asOf": "2026-11-10",
  "recurring": [ { "merchant": "Nota del último cobro", "key": "llave normalizada", "currency": "COP",
                   "monthly": 27400, "months": 4, "lastDate": "2026-03-05", "yearTotal": 82700, "method": "…" } ],
  "ant":       [ { "merchant": "…", "key": "…", "currency": "COP", "count": 5, "total": 35000,
                   "threshold": 16000, "method": "…" } ],
  "drift":     [ { "category": "restaurantes", "currency": "COP", "spent": 160000, "expected": 100000,
                   "over": 60000, "median": 300000, "baseMonths": ["2026-08","2026-09","2026-10"], "method": "…" } ] }
// o { "ok": false, "error": "…" }
```

Listas vacías = no hay dato: no se muestran. Orden: repetidos por última fecha, hormiga por total,
desvíos por exceso.

### Límites conocidos

- La web no tiene editor del plan: sin plan, la tarjeta dice que se arma y confirma en Hermes Phone
  (Finanzas → «Arma tu plan mensual»).
- La tasa es la de `open.er-api.com` (caché 6 h, última conocida si falla); su fecha es la de la fuente.
- Los avisos del banco llegan con la categoría `otros`: hoy casi todo el gasto real es variable y los
  desvíos por categoría no tienen tres meses de historia, así que esa lista no aparece todavía.
- Al montar la sección se corrigió en `FinanzasView` un error previo: `xl:col-span-4${…}` pegado a la
  expresión impedía que Tailwind generara `xl:col-span-4`; el riel quedaba en 5 columnas (8 + 5 > 12),
  bajaba a otra fila y el centro medía 0 de alto en pantallas ≥1280 px. Además `min-w-0` en las dos
  columnas y `gap-x-8` solo desde `lg` (12 columnas × 32 px de hueco desbordaban a 420 px).
