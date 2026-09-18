# Tótem de estación · especificación de interfaz

2026-09-18 · referencia de construcción para `/estacion`

Los mockups viven en `docs/ui/estacion-mockups.html` y se rinden con Playwright a
`docs/img/estacion-opcion-{a,b,c}.png`. Cada `<section>` mide exactamente
1080×1920: **el HTML es la referencia, no la imagen** — al construir se copian
tamaños y espaciados de ahí, no se estiman desde el PNG.

```bash
~/.cache/hermes-pw-venv/bin/python - <<'EOF'
# ver el bloque de render en el historial; produce docs/img/estacion-opcion-*.png
EOF
```

## Lo que las tres comparten

Esto no se discute por opción: es el sistema.

| Elemento | Regla |
| --- | --- |
| Lienzo | 1080×1920, sin scroll. Todo cabe o no entra. |
| Fondo | Verde montaña `#1F4D3A` con curvas de nivel en SVG al 6-7 % de opacidad. Nunca una foto. |
| Color de línea | **Del GTFS** (`route_color`): A `#0960A7`, K `#CBD308`, L `#A36A18`. Ningún color de línea se define en el código. |
| Texto sobre lima (K) | Tinta `#12261D`, no blanco: el lima no pasa contraste con blanco. |
| Tipografía | Baloo 2 para lo que se dice y para los números grandes; Inter para datos y metadatos. |
| Margen lateral | 56 px. Nada toca el borde. |
| Anfitriones | Dos círculos con dos puntos, nunca caras humanas. El que habla lleva un aro de 12 px y crece hasta 1,12×. |
| Subtítulos | Siempre visibles, mínimo 26 px, con el nombre en el color de quien habla. |
| Privacidad | Siempre visible al pie, 19 px al 50 % de opacidad. |
| Idiomas | Tres chips; el activo en mantequilla sólida. |
| QR | Solo cuando hay una ruta en pantalla. Tarjeta mantequilla, código de 132 px, con su plazo visible. |

**Tamaño mínimo legible a tres metros**: 30 px. Todo lo que esté por debajo es
metadato, no información que el viajero necesite para moverse.

## Opción A · Andén

**La idea**: la ruta es el héroe. Un riel vertical continuo, un tramo por
bloque, con el color de la línea recorriendo el eje. Es el gesto de Transit y
de Navan: el ojo baja por el riel y entiende el viaje sin leer.

**Jerarquía de arriba abajo**

| Zona | Alto | Contenido |
| --- | --- | --- |
| Cabecera | 140 px | Badge de línea 96 px · estación 54 px · reloj 56 px |
| Pregunta | 96 px | Lo que dijo el viajero, entrecomillado, 40 px |
| Titular | 220 px | **34 min** en 104 px + "2 transbordos · sale en 4 min" en 34 px |
| Riel | resto | Un bloque por tramo: círculo 96 px, destino 56 px, meta 30 px, estaciones intermedias 25 px al 45 % |
| Pie | 520 px | Anfitriones + QR · subtítulos · privacidad |

**Detalles que hacen que funcione**
- El número de minutos es lo más grande de la pantalla. Es la única cifra que el viajero necesita para decidir.
- Entre tramos va una píldora "↕ Transbordo · 2 min" indentada a 128 px, alineada con el riel.
- Las estaciones intermedias se listan en una línea al 45 % de opacidad: quien quiere contarlas puede, y quien no, no las ve.
- El riel se estira con `flex:1` para repartir el alto sobrante; los tallos tienen `min-height:120px`.

**Cuándo elegirla**: si el jurado tiene que entender en dos segundos que esto da
una ruta real. Es la que más se parece a un producto de transporte.

## Opción B · Conversación

**La idea**: lo que se dice es el héroe. La frase del anfitrión ocupa el centro
en 76 px, y la ruta se resume en una tira de badges. Es el gesto de Pi y de
State Farm: el texto grande *es* la interfaz.

**Jerarquía**

| Zona | Contenido |
| --- | --- |
| Cabecera | Igual que A, con el próximo tren en el subtítulo |
| Centro | Frase en 76 px con la parte clave en blanco puro · tira `A → K → L · 34 min` · "Habla Hermes" con onda |
| Tres datos | Sale en · Pasajes · Llegas, en tarjetas de 24 px/34 px |
| Pie | Igual que A |

**Detalles**
- La tira de badges es la ruta completa en 80 px de alto: se fotografía bien y se lee de lejos.
- La onda usa el color de quien habla y se mueve con el volumen real (`getOutputVolume`).
- El halo circular al 3 % detrás del centro da foco sin decorar.

**Cuándo elegirla**: para el stand, si lo que quieres demostrar es la
conversación y no el planificador. Es la más fotogénica y la que menos datos da.

## Opción C · Panel de estación

**La idea**: hablar el idioma del sistema de transporte. Banda de líneas arriba,
diagrama horizontal de la ruta sobre fondo mantequilla, módulos de dato
alrededor y los lugares como tres bloques de color (la retícula de la silleta,
sin dibujar la silleta).

**Jerarquía**

| Zona | Contenido |
| --- | --- |
| Banda | 18 px con los colores de las líneas del viaje, en proporción a su duración |
| Cabecera | Badge · estación · fecha · reloj |
| Alerta | Banner naranja, solo si hay novedad vigente |
| Diagrama | Tarjeta mantequilla: origen → destino, resumen y línea horizontal con un punto por transbordo |
| Módulos | Próximo tren · Después · tres bloques de lugares con horario |
| Pie | Banda más oscura: anfitriones, QR, subtítulos, idiomas |

**Detalles**
- Los tramos del diagrama se reparten el ancho **en proporción a los minutos** (52/27/21), no a partes iguales: la forma ya cuenta dónde está el viaje largo.
- La primera etiqueta se alinea a la izquierda y la última a la derecha (`translateX(0)` y `translateX(-100%)`), o se pisan.
- Los tres bloques de lugares llevan el horario y son del mismo alto: es una retícula, no tarjetas sueltas.

**Cuándo elegirla**: si esto se le va a enseñar al Metro o a la Alcaldía. Es la
que parece infraestructura y no demo.

## Mi recomendación

**A para el demo, con dos cosas de C.** El riel vertical es lo que hace evidente
en dos segundos que la ruta es real, y el titular de minutos da el remate. De C
me llevaría la **banda de líneas de 18 px** arriba (ubica sin leer) y el
**banner naranja de novedad**, que ya está implementado y hoy no se luce.

B no la descartaría: es el **estado de reposo y de escucha**. La pantalla puede
vivir en B mientras nadie ha preguntado nada y saltar a A cuando hay ruta. Eso
no es mezclar dos diseños, es usar cada uno en el momento para el que sirve.

## Mapa de construcción

| Mockup | Dónde va en el código |
| --- | --- |
| Cabecera + banda | `components/estacion/StationBar.tsx` |
| Riel de tramos (A) | `components/estacion/RouteCard.tsx` |
| Tira de badges y frase (B) | vista `idle`/`listening` de `app/estacion/page.tsx` |
| Bloques de lugares | `components/estacion/PlacesGrid.tsx` (ya son tres bloques; falta igualar alto) |
| Anfitriones y onda | `components/estacion/Hosts.tsx` |
| Subtítulos | `components/estacion/Subtitles.tsx` |
| QR | `components/estacion/HandoffQr.tsx` |
| Tokens | `lib/estacion/theme.ts` — los hex de este documento salen de ahí |

Al construir: copiar los valores del HTML (tamaños de fuente, radios, paddings)
a las clases de Tailwind con la misma cifra. Nada de "parecido": el mockup tiene
los números exactos.
