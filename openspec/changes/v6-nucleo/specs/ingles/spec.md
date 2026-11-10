# Capacidad: ingles

## ADDED Requirements

### Requirement: Repaso diario con los errores propios
Hermes DEBE ofrecer cada día un repaso de hasta 8 tarjetas hechas con los errores reales del dueño
(lo que dijo → cómo se dice | la regla), sin llamar a ningún modelo.

#### Scenario: Hay errores registrados
- CUANDO existen sesiones con errores anotados
- ENTONCES el repaso de hoy trae primero las tarjetas vencidas y completa con nuevas hasta 8

#### Scenario: Sin errores registrados
- CUANDO no hay errores
- ENTONCES no hay repaso y la interfaz dice de dónde salen las tarjetas

#### Scenario: Error ambiguo
- CUANDO un error no trae la versión correcta o es igual a lo que se dijo
- ENTONCES no se convierte en tarjeta

#### Scenario: Mismo error dos veces
- CUANDO el mismo error aparece en dos sesiones
- ENTONCES hay una sola tarjeta y cuenta las dos apariciones

### Requirement: Repetición espaciada
Cada tarjeta DEBE volver según cómo se respondió: acierto la pasa a la caja siguiente (1, 3, 7, 16 y
35 días); fallo la devuelve a la primera.

#### Scenario: Acierto
- CUANDO se responde bien una tarjeta de la caja de 3 días
- ENTONCES vuelve a los 7 días

#### Scenario: Fallo
- CUANDO se responde mal
- ENTONCES vuelve mañana

#### Scenario: Dominada
- CUANDO se acierta en la caja de 35 días
- ENTONCES la tarjeta queda dominada y solo vuelve si el mismo error reaparece en una sesión

### Requirement: Dos formas de responder
Una tarjeta se responde escribiendo la frase correcta o eligiendo la correcta entre opciones.

#### Scenario: Escribir con diferencias menores
- CUANDO la respuesta escrita difiere solo en mayúsculas, puntuación, espacios o contracciones equivalentes
- ENTONCES cuenta como acierto

#### Scenario: Elegir
- CUANDO la tarjeta es de elegir
- ENTONCES las opciones incluyen lo que el dueño dijo y la versión correcta, en orden que cambia

### Requirement: Racha y avance
El repaso DEBE mostrar cuántas tarjetas faltan hoy, la racha de días con el repaso completo y cuántas
están dominadas, todo calculado del registro.

#### Scenario: Repaso completo
- CUANDO se responden todas las de hoy
- ENTONCES el día cuenta para la racha y se marca el hábito de práctica de inglés una sola vez

### Requirement: Disponible en la web y en el teléfono
El repaso DEBE estar en `/ingles` y en Hermes Phone, y en el teléfono debe poder hacerse sin conexión.

#### Scenario: Teléfono sin conexión
- CUANDO el teléfono ya descargó el repaso de hoy y pierde la conexión
- ENTONCES se puede responder y las respuestas suben al reconectar, sin duplicarse
