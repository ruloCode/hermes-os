# liga-betplay

Tabla de posiciones de una liga de fútbol con los 8 equipos y **resultados de prueba** (no son los resultados reales).

- `data/partidos.csv`: un partido por línea (fecha, local, visitante, goles).
- `src/tabla.js`: `tablaDePosiciones(partidos)`. Reglas: 3 puntos por victoria, 1 por empate a cada uno, 0 por derrota. Desempate: puntos → diferencia de gol → goles a favor → nombre.
- `npm run tabla` la imprime (clasifican los 4 primeros); `npm test` corre los tests (son la especificación: no se tocan).
