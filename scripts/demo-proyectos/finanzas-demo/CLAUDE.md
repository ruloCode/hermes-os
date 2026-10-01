# finanzas-demo

Finanzas personales con **datos de prueba** (ficticios): movimientos de septiembre y octubre de 2026 en Bancolombia, Nequi, Nu y Ontop (en dólares).

- `data/movimientos.csv`: un movimiento por línea. Monto positivo = entra, negativo = sale. `moneda` es COP o USD.
- `data/trm.json`: la TRM de prueba (COP por USD) con que se convierten los dólares.
- `src/finanzas.js`: `resumenMes(movimientos, "AAAA-MM", trm)` → ingresos, gastos, ahorro y gasto por categoría, en pesos.
- `npm test` corre los tests; `npm run reporte -- 2026-09` imprime el resumen.

Reglas del negocio:
- Las **transferencias entre cuentas propias** (categoría `transferencia`) no son ni ingreso ni gasto.
- Los movimientos en USD se convierten a pesos con la TRM antes de sumar.
- Los tests son la especificación: no se tocan.
