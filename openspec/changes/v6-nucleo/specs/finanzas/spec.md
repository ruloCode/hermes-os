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
