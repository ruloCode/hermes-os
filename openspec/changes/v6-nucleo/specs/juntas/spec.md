# Capacidad: juntas

## ADDED Requirements

### Requirement: Preparación de junta
Antes de una reunión, Hermes DEBE poder armar una hoja de preparación para un proyecto: objetivo de
la reunión, hasta tres preguntas para hacer, pendientes abiertos, lo que el dueño prometió y riesgos.
Cada punto cita de dónde salió (acta y fecha, tarea o nota del proyecto).

#### Scenario: Proyecto con actas
- CUANDO se pide la preparación de un proyecto con actas anteriores
- ENTONCES la hoja trae pendientes y promesas con el acta y la fecha de cada uno

#### Scenario: Proyecto sin historia
- CUANDO el proyecto no tiene actas ni tareas
- ENTONCES la hoja lo dice y no inventa puntos

#### Scenario: Un punto sin fuente
- CUANDO el modelo redacta un punto que no se puede atar a una fuente
- ENTONCES ese punto se descarta antes de mostrarse

#### Scenario: Próximo evento
- CUANDO hay un evento de calendario en las próximas horas cuyo título nombra un proyecto
- ENTONCES la preparación se ofrece para ese evento, con su hora

#### Scenario: Segunda consulta el mismo día
- CUANDO se vuelve a pedir la preparación del mismo proyecto el mismo día sin actas nuevas
- ENTONCES se devuelve la guardada, sin otra llamada al modelo

### Requirement: La preparación alimenta al copiloto
Al iniciar una junta en vivo con preparación, el copiloto DEBE conocer el objetivo y las preguntas.

#### Scenario: Junta con preparación
- CUANDO se inicia la junta en vivo de un proyecto que tiene preparación de hoy
- ENTONCES el contexto del copiloto incluye el objetivo, las preguntas y las promesas

### Requirement: La preparación se ve donde se inicia la junta
La tarjeta de inicio de la junta en la web DEBE mostrar la preparación del proyecto elegido, con un
botón para generarla si no existe.

#### Scenario: Sin preparación
- CUANDO el proyecto elegido no tiene preparación de hoy
- ENTONCES la tarjeta ofrece «Preparar» y muestra el avance mientras se genera

### Requirement: La capa rápida usa el modelo rápido vigente
La capa rápida del copiloto DEBE resolver su modelo desde el catálogo (nivel `fast`) y registrar su
tiempo al primer token en el registro de gasto.

#### Scenario: Simulación
- CUANDO corre `live:sim --copilot` con el motor de prueba
- ENTONCES pasan los mismos asserts que antes del cambio
