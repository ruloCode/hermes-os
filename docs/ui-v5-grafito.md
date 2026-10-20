# Hermes v5 "Grafito" — análisis UX/UI y sistema de diseño (2026-10-16)

Pedido: un análisis profundo de UX y UI del dashboard web y una mejora de TODA la
interfaz, "más organizada, con una UX/UI top de la industria", abierto a cambiar
de branding por algo más limpio, con tema oscuro también.

Este documento tiene tres partes: lo que se encontró (medido sobre las 15
pantallas en los dos temas, capturas de producción en :31415 — no se guardan en
el repo porque muestran datos personales y de clientes), las decisiones
de marca y de sistema, y las reglas que debe seguir cualquier pantalla nueva.

---

## 1 · Diagnóstico

### 1.1 Arquitectura de información y navegación

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| N1 | **15 destinos como iconos sin texto** en un rail de 60px. Saber a dónde ibas exigía pasar el mouse por cada uno. | SideRail v4 | Alta |
| N2 | **Dos iconos idénticos**: Reuniones y Agenda eran el mismo calendario. | `destinations.tsx` | Alta |
| N3 | **Ninguna pantalla decía dónde estabas.** La topbar mostraba "Hermes" en todas; el título de vista existía solo en 5 de 15 pantallas. | capturas | Alta |
| N4 | **Riel de contexto inconsistente**: aparecía en Inicio, Consola, Reuniones, Voz y Memoria, y "desaparecía" en Tareas y Actividad — no por diseño: el contenido sin `min-w-0` lo empujaba fuera de la pantalla. | capturas tareas/actividad | Alta |
| N5 | **Callejón sin salida en Reuniones**: "Enfoca un proyecto en la barra izquierda" — no había ninguna barra izquierda de proyectos (estaba a la derecha). | `MeetingsPanel` | Media |
| N6 | Los tabs del workspace (Consola, Tareas…) no cambian la URL: no se puede enlazar ni volver con ← del navegador. | `WorkspaceContext` | Media (pendiente) |

### 1.2 Cromo y jerarquía

| # | Hallazgo | Severidad |
|---|---|---|
| C1 | **Topbar sobrecargada**: wordmark duplicado (logo en el rail + "Hermes"), pill de estado, CPU/RAM/SSD, tres máquinas en fila, buscar, tema y un reloj en dos líneas. 52px sobre cada vista que no aportaban orientación. | Alta |
| C2 | **RAM 98–100% en ámbar permanente**: alarma que nunca se apaga = fatiga de alarma. | Media |
| C3 | **Barra de voz flotante** al centro del pie: obligaba a `pb-20` (80px) en TODAS las vistas y una esfera granate flotaba sobre listas y tablas. | Alta |
| C4 | **Cortina de arranque en cada recarga** (~2,5 s de animación aunque todo estuviera listo). | Media |
| C5 | Error de hidratación React #418 en cada carga (texto que cambia entre servidor y cliente: el reloj). | Baja |

### 1.3 Sistema visual

| # | Hallazgo | Severidad |
|---|---|---|
| V1 | **Marca prestada**: neutros de papel + el MISMO terracota de Claude (#d97757). Funcionaba como interfaz y fallaba como identidad: Hermes se veía como un tema de otro producto. | Alta |
| V2 | **El acento significaba todo**: pestaña activa, botón, ingreso (donut de Ingresos en terracota), negativo, error, selección. Con el rojo al lado, "negativo" y "acción" eran casi el mismo color. | Alta |
| V3 | **Arcoíris**: cyan, verde, ámbar, rojo, azul y terracota como colores de TEXTO para etiquetas que no son estado (USD en cyan, proyectos en cyan, conteos de memoria en 5 colores). | Alta |
| V4 | Rayitas de color de 2px en cada fila de cada lista (riel, memoria, gimnasio): decoración que no distinguía nada. | Media |
| V5 | Un punto de color delante de cada título de panel ("• Preview", "• Actividad en vivo"). | Baja |
| V6 | Monoespaciada en etiquetas que no son datos (chips `/comando`, metadatos de Composición, fechas de Inglés). | Media |
| V7 | Selectores segmentados hechos a mano en 4 sitios, cada uno distinto. | Media |
| V8 | Chips de "comando" deshabilitados al 40% de opacidad en la primera pantalla: se leían como rotos. | Media |

### 1.4 Vistas

| Vista | Hallazgo |
|---|---|
| Inicio | Orden invertido: saludo → lista "Qué sigue" → caja de config de Claude Code → composer. Lo primero que haces (pedir) quedaba tercero, y la config de ejecución era una segunda caja compitiendo con el composer. |
| Consola | Doble barra (topbar + barra de sesión del terminal); vacío en monoespaciada. |
| Tareas | Fila de chips de proyecto se salía de la pantalla; la lista llegaba al borde derecho. |
| Actividad | Líneas de log sin recorte: desbordaban horizontalmente. |
| Memoria | Cinco contadores con borde de cinco colores; rayitas de color por fila. |
| Finanzas | Donuts al 100% con UNA categoría (un anillo lleno no comunica nada); un "% de ahorro" negativo de cuatro cifras en un gauge; el ingreso pintado en el color del acento. |
| Estudio / Composición | Sin título de vista; selector de sección propio en cada una. |

---

## 2 · Decisiones

### 2.1 Marca "Grafito"

- **Neutros grafito**, fríos con un tinte azul imperceptible (Linear/Vercel), no
  papel. Tres alturas en oscuro: **cromo** `#0e0f11` (barra lateral y fondo de
  ventana) < **lienzo** `#131417` (la hoja donde vive la vista) < **tarjeta**
  `#18191d`. En claro: cromo `#f4f4f5`, lienzo y tarjetas blancos.
- **Un acento índigo "Iris"**: `#7c7ff5` en oscuro, `#5048e5` en claro. Se usa
  para foco, selección, enlaces, el botón primario y el orbe. Nada más.
- **`accent-solid` + `on-accent`** para el FONDO del botón primario: en oscuro el
  índigo legible como texto es demasiado claro para llevar blanco encima
  (3,4:1), así que el sólido es `#5b5bd6` (5,4:1).
- **Semánticos = estado**: verde bien · ámbar atención · rojo mal · cyan en
  curso/info. Desaturados para que una lista no sea un semáforo.
- **Geist + Geist Mono** (par diseñado junto) en lugar de Inter + IBM Plex.
- **Marca**: hoja índigo redondeada con una "H" cuyo travesaño sube — el
  mensajero en marcha (`HermesMark` en `Sidebar.tsx`).

Contraste medido (WCAG, sobre el lienzo): oscuro text 15,9 · dim 7,6 · faint 5,6
· accent 5,45 — claro text 17,9 · dim 7,9 · faint 5,0 · accent 6,3. Todo pasa AA.

### 2.2 Shell

- **Barra lateral con etiquetas** (236px, colapsable a 56px con ⌘B, se colapsa
  sola bajo 1100px): marca + tema + colapsar · selector de máquina (menú) ·
  "Buscar o pedir… ⌘K" · chips de "en curso" (junta, gestos, manos) · destinos
  en **cuatro grupos con nombre** (Agente · Vida · Aprender · Crear) · al pie la
  **voz** (orbe + estado + última frase; el hilo se despliega junto a la barra) y
  el estado del sistema en una línea.
- **Lienzo enmarcado**: cada vista vive en una hoja con borde y radio sobre el
  cromo (patrón Linear 2025). Sin topbar global, sin barra flotante.
- **Cada vista abre con `ViewHeader`** a sangre (título · meta real · pestañas ·
  acciones). Excepción: Inicio (abre con el saludo) y Agenda (su barra de
  calendario ES la cabecera).
- **Riel de contexto** solo en Inicio, Consola y Reuniones.
- Cortina de arranque **una vez por pestaña**.

---

## 3 · Reglas (para cualquier pantalla nueva o que se toque)

**Color**
1. El acento (`text-accent`, `bg-accent/10`) es para lo INTERACTIVO o
   SELECCIONADO. Nunca para etiquetas, conteos ni títulos.
2. Botón primario = `<Button variant="primary">` (o `bg-accent-solid
   text-on-accent`). Uno por zona. Nunca `bg-accent text-white`.
3. `cyan/green/amber/red` solo para ESTADO (en curso, bien, atención, mal) o
   para el signo de un monto (+ verde / − rojo). Una etiqueta de categoría,
   moneda o proyecto va en gris (`text-text-dim`) o como `<Badge tone="neutral">`.
4. Hover/seleccionado con las capas `bg-hover` / `bg-selected` (translúcidas:
   valen sobre cromo, lienzo o tarjeta).

**Tipografía**
5. Geist para todo; `font-mono` SOLO para números alineados, IDs, código.
6. Sin `uppercase` ni `tracking-*` (el CSS los neutraliza, pero no se escriben).
7. Escala: `text-2xs/xs` 12 · `text-sm/base` 14 · `text-md` 16 · `text-lg/xl`
   20 · `text-2xl` 28. Título de vista = el de `ViewHeader` (16 semibold).

**Superficies**
8. Solo lleva marco (`hud-panel` / `Panel`) lo que se OPERA. Lo que se lee va
   sin caja. Nada de cajas dentro de cajas dentro de cajas.
9. Radios: `rounded-xs` 6 controles · `rounded-sm` 8 tarjetas · `rounded-md` 12
   superficies grandes · `rounded-full` píldoras.
10. Filas de lista: `px-2 py-1.5 rounded-sm hover:bg-hover`; separadores
    `border-line`. Sin barras de color por fila.

**Componentes**
11. `ViewHeader` abre cada vista; las secciones de la vista van en su prop
    `tabs` con `<Segmented/>`.
12. `<Button>` (primary/secondary/ghost/danger · sm/md) para botones nuevos.
13. `<PanelState>` para vacío / cargando / error / sin conexión — un vacío
    siempre dice qué hacer a continuación (y ofrece el control si cabe).
14. Toda fila flexible lleva `min-w-0` y su texto `truncate` (o `break-words`).

**Datos**
15. Regla de oro intacta: todo dato visible es real; sin dato, no hay elemento.
16. Un gráfico debe comparar algo: un donut de UNA categoría al 100% no se
    dibuja — se dice el número.

---

## 4 · Lo que se hizo (2026-10-16)

**Base** — `globals.css` (tokens v5 + `chrome`, `accent-solid`, `on-accent`,
`hover`, `selected`; `:focus-visible` y `.md` dentro de `@layer`), Geist en
`layout.tsx`, `app/icon.svg`, orbe de voz con base iris en claro, fallbacks de
canvas al índigo.

**Shell** — `Sidebar.tsx`, `VoiceDock.tsx`, `HermesMark.tsx` nuevos; se borraron
`SideRail`, `TopBar` y `PresenceBar`. `MachineSelector` pasó a menú.
`destinations.tsx` con `NAV_GROUPS`. Cortina de arranque una vez por pestaña.
Sin el reloj de la topbar desapareció el error de hidratación #418.

**Primitivos** — nuevos `Segmented`, `Button`, `IconButton`, `Kbd`;
`ViewHeader` a sangre con `tabs`; `PanelState` con iconos SVG, `icon` y
`action` (y variante compacta solo texto); `StatusPill` con `running`;
`Badge` en píldora; `Rail` sin barras de color; `ScrollArea` con fundido solo
del lado que tiene contenido escondido; `TabBar`, `SlashChip`, `CmdButton`
(`solid` = primario) y los charts sin mayúsculas.

**Inicio** — saludo con fecha (y "buenas noches" de madrugada) → composer de
UNA caja con la config de Claude Code dentro (modelo/esfuerzo/permisos en un
popover) → comandos (los que piden proyecto aparecen al enfocar uno) → "Qué
sigue". Chat con burbuja neutra y firma con la marca.

**Agente** — cada tab con su cabecera: Consola (sesión, estado, Nueva en la
cabecera), Tareas (filas tipo Linear, chips con scroll horizontal, etiquetas
neutras), Reuniones (selector de proyecto en el vacío y en la cabecera vía
`ws.selectProject`), Voz en vivo, Actividad (sin desborde), Memoria (pestañas en
la cabecera, contadores neutros). ⌘K estilo Raycast/Linear.

**Vida** — Finanzas sin donuts de una categoría: fila de cuatro cifras con
contexto real, desglose solo con ≥2 categorías, saldos/presupuestos/asesor sin
cajas anidadas, `Segmented` COP/USD. Hábitos con la misma fila de cifras.
Agenda: barra = ViewHeader, eventos ligeros, días pasados atenuados.

**Aprender** — Inglés en tres columnas sin cajas, botones en la cabecera.
Gimnasio con rondas como pestañas y un solo cuadro de hábitos ES/EN. Entender
con selector de proyecto desplegable y la pizarra como única superficie.

**Crear** — Estudio y Composición con cabecera y secciones en `Segmented`, sin
paneles "hero" redundantes, filtros calmos y progreso neutro.

Verificado: `pnpm typecheck`, `pnpm test` (1139/1139), y las 15 pantallas en
oscuro y claro a 1600×950 (más 1280) sin errores de consola, en dev y en
producción.

## 5 · Pendiente

1. Los tabs del workspace siguen sin URL propia (N6): no se pueden enlazar.
2. Interiores especializados con estilo parcial: Guion/VoiceTab/PublishTab/
   RecordMode/PieceChat del Estudio; editor, acordes y copiloto de Composición;
   las pantallas de junta en vivo y el estado de devolución del Gimnasio no se
   probaron en vivo (requieren una llamada o una repetición real).
3. Primitivos que pidieron las vistas: `FilterPill`, `SidePane` (la columna a
   sangre se repite en Inicio, Estudio y Composición), `Checkbox`, `Input`, y
   subir `Stat/StatStrip/Progress` de `vida/kit.tsx` a `ui/`.
4. `/dev/ui` (galería de QA) no se actualizó; su demo de LivePractice escribe en
   `/english/vocab` de verdad — debería simularlo.
5. Páginas sueltas (`/oficina`, `/sala`, `/estacion`, `/ruloview`) conservan su
   diseño propio; heredan los tokens nuevos. La app Expo (`mobile/`) no se tocó.
   **Hermes Phone ya es Grafito** (2026-10-16): recibe la marca generada desde
   `packages/shared/src/brand.ts` (`pnpm brand:sync`) y sigue estas mismas
   reglas (ver `docs/red-y-unificacion.md`).
