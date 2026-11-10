# Capacidad: contexto-dev

## ADDED Requirements

### Requirement: `CLAUDE.md` es un índice corto
`CLAUDE.md` DEBE pesar menos de 12 KB y contener: qué es el proyecto, la arquitectura en diez líneas,
las convenciones, cómo probar y desplegar, y una tabla «función → documento».

#### Scenario: Sesión nueva de desarrollo
- CUANDO se abre una sesión de Claude Code sobre el repo
- ENTONCES el contexto fijo que carga es el índice, no los 155 KB de antes

### Requirement: El detalle de cada función vive en su documento
Cada párrafo de función del `CLAUDE.md` anterior DEBE quedar, sin perder texto, en
`docs/contexto/<función>.md`.

#### Scenario: Nada se pierde
- CUANDO se compara el texto anterior con la suma de los documentos nuevos
- ENTONCES cada párrafo anterior aparece completo en algún documento (un script lo comprueba)

#### Scenario: Encontrar el detalle
- CUANDO una tarea toca una función
- ENTONCES la tabla del índice dice qué documento leer

### Requirement: Regla para lo nuevo
El índice DEBE decir que lo nuevo se documenta en `docs/contexto/` y se enlaza en la tabla, no se
agrega como párrafo al índice.

#### Scenario: Función nueva
- CUANDO se agrega una función
- ENTONCES su documentación va a un archivo propio y el índice gana una fila
