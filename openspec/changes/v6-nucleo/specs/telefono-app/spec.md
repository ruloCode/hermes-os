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
