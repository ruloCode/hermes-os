# freelance-cafe-alto

Proyecto freelance para **Café Alto**, una tostadora de café de especialidad en Manizales (**cliente ficticio**, datos de prueba).

- `horas/2026-10.csv`: las horas trabajadas en octubre (fecha, tarea, horas).
- `cliente.json`: tarifa por hora en COP y retención en la fuente por honorarios.
- `src/cobro.js`: `cuentaDeCobro(horas, { tarifa, retencion })` → total de horas, subtotal, retención y total a pagar.
- `npm run cobro` escribe la cuenta de cobro en `cobros/`; `npm test` corre los tests.
- `landing/index.html`: la landing del cliente (HTML estático, sin build).

Reglas: el freelancer es persona natural no responsable de IVA (sin IVA). La retención en la fuente **se descuenta** del subtotal. Los tests son la especificación: no se tocan.
