# Tótem de estación del Metro · producto, diseño y prompt de arranque

2026-09-18 · Rulo y Daniela · Build Day (sábado)

Informe visual completo (renders, pantallas del tótem y del móvil, propuestas diferenciales): https://claude.ai/artifact/EiCZLkBRHmtZzrYLVnTeux

## La base en una frase

Una pantalla donde dos personajes de IA con personalidad propia (Hermes = la ruta y el sistema · Iván = la ciudad) conversan contigo a la vez, con voces distintas, se dirigen a quien los nombra y no se pisan: UN agente ElevenLabs multi-voz (el elenco, `sala.json.cast`) sobre la Sala de Agentes 3D (`/sala`). La captura del cuerpo deja de ser el centro; el producto son las dos personalidades y lo que saben hacer con datos reales.

## Propuestas diferenciales

| # | Lo que vive el viajero | Cómo funciona |
|---|---|---|
| 1 · Dos personalidades, una conversación | Hermes da el dato (rutas, tiempos, novedades); Iván la ciudad (barrios, comida, acento). Se replican entre sí como dos amigos que te reciben. | Un solo agente multi-voz con prompt de director que reparte turnos por rol. Un solo cerebro: contexto total, nunca hablan encima del otro. |
| 2 · Le hablas al que quieras, con el nombre | «Iván, ¿dónde almuerzo?» responde Iván; «¿qué opinan los dos?» responden en secuencia. Sin botones ni gestos. | El director interpreta el destinatario en la pregunta; el cliente reconstruye quién suena (etiquetas de voz + alineación del audio) para encender figura y subtítulo. |
| 3 · Datos reales, no un guion | La ruta es la del Metro de hoy: líneas, transbordos, tiempos, novedades. | Tools sobre el GTFS abierto del Metro, estado del servicio y fuentes de turismo. Regla: todo dato visible es real; sin fuente, sin tarjeta. |
| 4 · Sigue en tu celular | Un código en pantalla abre la misma conversación en el móvil con los mismos anfitriones. | Enlace efímero con el contexto (ruta, idioma, personaje); nueva sesión del elenco con contextual update. |
| 5 · Privacidad por diseño | La cámara no graba; la voz solo se usa para responderte. | Procesamiento de imagen en el navegador (si se usa); audio al proveedor sin identidad; aviso visible; Ley 1581. |
| 6 · Habla tu idioma, con acento de aquí | Español paisa, inglés, portugués; subtítulos en vivo siempre. | Detección de idioma del agente; Iván mantiene el carácter; Hermes da el dato en neutro. |

## Recomendación para el sábado

Contar la **estación de metro** como historia principal montada como stand (que es lo que será el sábado), con la ruta real del GTFS, y cerrar con el **stand de empresa** como producto que ya se vende. Micrófono de solapa, no el de la laptop; aviso en pantalla de que el video no se guarda.

# Mercado y competencia (investigación del 17 de septiembre de 2026)

## 1. Mercado

| Segmento | Cifra | Fuente |
|---|---|---|
| Kioscos interactivos (global) | USD 37,68 B (2025) → 40,80 B (2026) | [Fortune Business Insights](https://www.fortunebusinessinsights.com/interactive-kiosk-market-104785) |
| Kioscos con IA | USD 8,9 B (2025), CAGR 16,6 % 2026-2036 | [Fact.MR](https://www.factmr.com/report/ai-kiosk-market) |
| Kioscos smart city (incluye transporte) | USD 2.688 M (2025) → 7.777 M (2033); transporte inteligente = 29 % del impulso | [Congruence](https://www.congruencemarketinsights.com/report/smart-city-interactive-kiosk-market) |
| Digital humans / avatares | USD 7,4-9 B (2025); CAGR de 32-50 % según la firma (dispersión alta: tomar con cautela) | [MRFR](https://www.marketresearchfuture.com/reports/digital-human-ai-avatars-market-12224), [Technavio](https://www.technavio.com/report/digital-human-avatar-market-industry-analysis) |
| Agentes de voz IA | USD 3,5 B (2026) → 35 B (2033), CAGR 39 % | [Ringly](https://www.ringly.io/blog/voice-ai-statistics-2026) |

Tendencia clave: la capa de voz se abarató hasta ser commodity (ver §6), mientras los proveedores "premium" de digital humans colapsan. **Soul Machines entró en receivership el 5 de febrero de 2026** tras levantar más de USD 135 M ([NZ Gazette](https://gazette.govt.nz/notice/id/2026-ar623), [NZ Herald](https://www.nzherald.co.nz/business/ai-casualty-once-high-flying-soul-machines-in-receivership/YCN66TQ7BJDFLAMSWGKQCIJNN4/)) y **ARHT Media cerró en 2024** ([Holoconnects](https://holoconnects.com/best-hologram-displays)). El valor migró del render facial al agente con herramientas, exactamente donde está la Sala.

## 2. Competencia

| Empresa | Qué hace | Precio público | Diferencia frente a la Sala |
|---|---|---|---|
| [UneeQ](https://www.digitalhumans.com/use-cases/kiosks) | Digital humans fotorrealistas, kiosco on-premise | desde USD 899/mes + setup 10-50 k ([SoftwareFinder](https://softwarefinder.com/artificial-intelligence/uneeq)) | Un avatar; sin multi-personaje ni cuerpo del visitante |
| Soul Machines | Digital Iris en el aeropuerto DFW (con IBM Watson) | n/d, en receivership | Fuera de juego |
| [Proto Hologram](https://protohologram.com/retail) | Cajas holográficas + avatar IA | Proto M ~USD 5.900-6.900; Epic/Luma USD 29-65 k ([Entrepreneur](https://www.entrepreneur.com/business-news/proto-hologram-boxes-project-3d-images-like-the-jetsons/480494)) | Hardware caro; la Sala corre en cualquier pantalla |
| [HeyGen LiveAvatar](https://anam.ai/blog/heygen-pricing) | Avatar en video en tiempo real | ~USD 0,10-0,20/min | Video 2D, sin escena 3D ni tools locales |
| [Tavus CVI](https://www.tavus.io/blog/heygen-pricing-breakdown-best-alternatives) | Avatar conversacional con latencia menor a 1 s | desde USD 59/mes | Ídem |
| [D-ID Agents 2.0](https://aloa.co/ai/comparisons/ai-video-comparison/heygen-vs-d-id) | Agentes con cara | desde USD 4,70/mes | 2D, un personaje |
| [Anam](https://anam.ai/pricing) | Personas en tiempo real | USD 0,12/min (efectivo ~0,20) ([Spatius](https://www.spatius.ai/blog/cheapest-real-time-ai-avatar-api-2026/)) | 2D |
| [Ravatar](https://ravatar.com/pricing/) | Avatares 3D + kioscos de hospitalidad | PoC €5.000; planes €199-499/mes | El más parecido; sin marioneta del visitante ni elenco |
| [Convai](https://convai.com/pricing) / [Inworld](https://inworld.ai/resources/voice-agent-cost-per-minute-2026) | Personajes 3D para juegos y XR | Convai USD 22-99/mes; Inworld TTS USD 5-25 por millón de caracteres | Motores de NPC, no producto de atención |
| [NVIDIA ACE](https://www.nvidia.com/en-us/use-cases/digital-humans/) | Microservicios (animación, voz) | Requiere GPU propia | Infraestructura, no producto |
| Sensely, Hippo | — | No se encontraron precios ni despliegues públicos recientes | — |

Casos en transporte y turismo: DFW (Soul Machines + IBM, 2021-22), Seoul Metro (traducción con IA en 11+ estaciones), Tokio Metro (chatbot de IA generativa con Allganize, [caso](https://www.allganize.ai/en/blog/tokyo-metro-has-adopted-allganizes-generative-ai-and-llm-solutions-for-customer-facing-ai-equipped-chatbots-and-customer-service-center-operations)), Jacksonville (holograma Proto). Detalle en §4.

## 3. Medellín y Colombia

- **Metro de Medellín**: 310,2 M de viajes en 2025 (308,3 M en 2024) ([Metro](https://www.metrodemedellin.gov.co/al-dia/noticias/asi-movio-el-metro-el-desarrollo-de-la-ciudad-region-en-2025)); ~1,07 M usuarios en un día laboral típico ([Metro](https://www.facebook.com/metrodemedellin/photos/el-promedio-diario-en-d%C3%ADa-t%C3%ADpico-laboral-fue-de-107-millones-de-usuarios-moviliz/1125509272953274/)). **Datos abiertos** en ArcGIS Hub, con **GTFS** ([portal](https://datosabiertos-metrodemedellin.opendata.arcgis.com/)). **App Cívica**: pago, saldo, planificador de viaje, más de 367.000 registrados, uso sin datos móviles ([Metro](https://www.metrodemedellin.gov.co/al-dia/noticias/ahora-la-app-civica-tambien-se-puede-usar-sin-consumo-de-datos-moviles)). **Wi-Fi gratis** en todas las estaciones de las líneas A y B, 400.000 conexiones al día ([Infobae](https://www.infobae.com/colombia/2025/04/28/metro-de-medellin-extiende-su-wifi-gratuito-a-nuevas-plazoletas-y-estaciones-asi-puede-usar-el-servicio/)): la conectividad para un kiosco ya existe. **Innovación abierta**: la Dirección de Investigación, Desarrollo e Innovación (IDI) convoca retos a startups; el reto #1 de 2024 era estimular canales de recarga y pago ([Metro IDI](https://www.metrodemedellin.gov.co/en/idi/innovation-open)). No se encontraron pantallas conversacionales ni kioscos con IA en estaciones; **MetroBot/MetroMedAR** (voz y texto sobre información oficial) es un proyecto **independiente** de una jam, no del Metro ([itch.io](https://patrigilar.itch.io/metromedar)).
- **Turismo**: récord de ~1,2 M de extranjeros no residentes en 2025 (+11,7 %), 32 % de EE. UU. ([El Colombiano](https://www.elcolombiano.com/medellin/record-historico-rompe-medellin-en-turismo-BA33331330)). **Centro de Turismo Inteligente** en Parques del Río (2022): hologramas, realidad aumentada, 3 pantallas táctiles y 50 beacons reemplazando los puntos de información físicos ([Alcaldía](https://www.medellin.gov.co/es/sala-de-prensa/noticias/medellin-tiene-el-primer-centro-de-turismo-inteligente-del-pais-una-experiencia-4-0-para-visitantes/)). **Medellín.Travel** lanzó en noviembre de 2025 un planificador con IA, chatbot 24/7 por web y WhatsApp y micrositios ([Alcaldía](https://www.medellin.gov.co/es/sala-de-prensa/noticias/medellin-se-pone-a-la-vanguardia-del-turismo-digital-con-innovaciones-de-ia-al-servicio-del-viajero/)): hay un **cerebro conversacional oficial sin cuerpo físico**, el hueco natural para la Sala.
- **Antecedente nacional**: Bogotá lanzó mapas turísticos interactivos conectados con TransMilenio con la asistente conversacional "Candelaria" ([TransMilenio](https://www.transmilenio.gov.co/comunicaciones/noticias-de-transmilenio/comunicados-oficiales/bogota-lanza-mapas-turisticos-interactivos-conectados-con-transmilenio)).
- **Ruta N y Alcaldía**: foco en formación en IA (20.000 cupos con Google y C4IR, 30.000 con AWS) ([Ruta N](https://rutanmedellin.org/noticias/google-el-c4ir-medell%C3%ADn-y-ruta-n-abren-20.000-cupos-sin-costo-para-formarse-en-inteligencia-artificial), [Alcaldía](https://www.medellin.gov.co/es/sala-de-prensa/noticias/30-000-personas-aprenderan-de-inteligencia-artificial-y-computacion-en-la-nube-gracias-al-distrito-y-amazon/)).
- **Áreas de contacto**: Metro → Dirección IDI (contactenos@metrodemedellin.gov.co); Alcaldía → Secretaría de Turismo y Entretenimiento ([sitio](https://www.medellin.gov.co/es/secretaria-de-turismo-y-entretenimiento/)) y Sistema de Inteligencia Turística; Greater Medellín Convention & Visitors Bureau ([bureaumedellin.com](https://bureaumedellin.com/trends-2026-artificial-intelligence-redefines-the-way-we-travel/?lang=en)); Ruta N / C4IR.

## 4. Casos desplegados y qué pasó

| Caso | Resultado | Fallos y lecciones |
|---|---|---|
| **DFW, Digital Iris** (2021-22) | "Miles" de pasajeros atendidos en la terminal B; decisión de expandir a todas las terminales ([Voicebot](https://voicebot.ai/2022/10/11/soul-machines-and-ibm-watson-powered-virtual-human-concierge-expanding-at-dallas-airport/)) | Kiosco con **micrófono direccional** y cámara; el proveedor quebró después (riesgo de dependencia) |
| **Seoul Metro, traducción con IA** (Myeongdong, dic. 2023 → 11 estaciones) | 13 idiomas, pantalla OLED transparente; expansión tras un piloto de 3-4 meses ([Seoul Gov](https://english.seoul.go.kr/seoul-metro-expands-ai-translation-services-available-in-13-languages-to-11-stations/)) | El piloto obligó a **entrenar nombres de estaciones y jerga ferroviaria** y a añadir **cancelación de ruido** ([Korea Times](https://www.koreatimes.co.kr/southkorea/society/20231204/seoul-metro-begins-real-time-translation-service-for-foreign-tourists-at-myeong-dong-station)); sin cifras públicas de uso |
| **Jacksonville, holograma de la alcaldesa** (dic. 2024 → feb. 2026) | Retirado; costó USD 75 k frente a los 30 k anunciados; críticas del Concejo ([Action News Jax](https://www.actionnewsjax.com/news/local/send-damn-thing-back-jacksonville-city-council-finds-mayor-airport-hologram-really-cost-75k/KPAIJFJGEVG6POBVJ6VZVQSFVM/)) | Un avatar **sin utilidad conversacional real** se percibe como gasto vanidoso |
| **Museos** (Accademia Carrara 2025; revisión EVA 2025) | La corporeidad mejora la presencia percibida, pero exige control, inclusividad y **anclaje factual** ([ScienceOpen](https://www.scienceopen.com/hosted-document?doi=10.14236%2Fewic%2FEVA2025.13)) | Alucinaciones en contenido cultural |
| **Hoteles** (kioscos de autoservicio) | 60-70 % de check-ins sin personal; 73 % de huéspedes prefieren autoservicio ([Touchkiosk](https://www.touchkiosk.com/news/hotel-digital-concierge-and-check-in-screens.html)) | Cifras de proveedores, no auditadas |

Guía práctica para ferias: probar el reconocimiento de voz con ruido de multitud, medir la latencia pregunta→respuesta con la red real del lugar, subtítulos visibles, límite de tiempo por persona y **un anfitrión humano** que convierta la fila en parte del show ([Yepic](https://www.yepic.ai/blog/real-time-ai-avatars-public-spaces)).

## 5. Precios comparables por producto

| Producto | Cliente | Modelo | Precio comparable en el mercado |
|---|---|---|---|
| Estación de metro turística | Metro (IDI) + Secretaría de Turismo | Licencia anual por estación + soporte; se entra **por innovación abierta**, no por venta directa | UneeQ USD 899/mes + setup 10-50 k; Ravatar PoC €5 k |
| Punto turístico (Parques del Río, Plaza Botero, aeropuerto JMC) | Secretaría de Turismo, Bureau, Airplan | Por instalación + por minuto; ofrecer **upgrade** del centro de 2022, no reemplazo | Ídem |
| Lobby de hotel multi-idioma | Cadenas y boutiques en El Poblado | SaaS por sitio + minutos | Ravatar €199-499/mes; Anam ~USD 0,12-0,20/min |
| Museo con elenco | Museos y fundaciones | Licencia por exposición | Enterprise: "decenas a cientos de miles de USD al año" ([Kings Research](https://www.kingsresearch.com/blog/how-digital-humans-are-transforming-business)) |
| Stand de feria / Cámara de Comercio | Empresas expositoras | Alquiler por evento | Proto cobra 29-65 k de hardware; aquí se cobra la experiencia |
| Recepción de empresa | Corporativos, coworkings | SaaS por sede | UneeQ USD 899/mes |
| Aula / tutor multi-voz | Colegios, Ruta N | Por aula al mes | Convai USD 22-99/mes |

## 6. Riesgos y regulación

- **Datos personales (Ley 1581 de 2012)**: las imágenes captadas por cámaras son datos personales; la SIC considera las de videovigilancia **biométricas y sensibles**: autorización previa, expresa e informada, aviso de privacidad visible, retención limitada (~30 días) y multas de hasta 2.000 SMMLV ([SIC](https://sedeelectronica.sic.gov.co/boletin-juridico/conceptos/tratamiento-de-datos-personales-traves-de-camaras-de-videovigilancia), [Asuntos Legales](https://www.asuntoslegales.com.co/analisis/maria-alejandra-de-los-rios-531421/proteccion-de-datos-personales-en-sistemas-de-videovigilancia-2522413)). **Mitigación que la Sala ya tiene**: MediaPipe corre en el navegador; procesar los puntos del cuerpo localmente y **no almacenar ni transmitir video** reduce el riesgo, y hay que decirlo en pantalla. La voz sí sale a ElevenLabs (un tercero fuera del país): va en el aviso.
- **Accesibilidad (Ley 1618 de 2013)**: obliga a accesibilidad en información y comunicaciones en obras públicas y privadas ([Secretaría del Senado](http://www.secretariasenado.gov.co/senado/basedoc/ley_1618_2013.html)); no hay norma técnica específica para kioscos. Subtítulos en vivo (ya hay transcript), altura de pantalla y una alternativa táctil cubren lo básico.
- **Ruido**: Seúl añadió cancelación de ruido y DFW usó micrófono direccional; en feria, probar con multitud y llevar micrófono de mano o de solapa para el visitante.
- **Costo por minuto**: ElevenLabs Agents cobra **USD 0,08/min** adicional (0,16 en ráfaga sobre la concurrencia); plan Pro USD 99/mes con 1.238 min y 20 conversaciones concurrentes; Business USD 990/mes con 12.375 min; **el LLM se factura aparte** ([precios](https://elevenlabs.io/pricing/agents)). Multi-voz oficial: [docs](https://elevenlabs.io/docs/eleven-agents/customization/voice/multi-voice-support). Alternativa: OpenAI Realtime ≈ USD 0,05/min ([Forasoft](https://www.forasoft.com/blog/article/openai-realtime-api-pricing)). Seis horas de feria con conversación continua ≈ 360 min ≈ USD 29 más el LLM: despreciable. El límite real es la concurrencia del plan si hay varias salas.
- **Dependencia del proveedor**: las quiebras de Soul Machines y ARHT muestran que el cliente institucional teme quedarse con hardware huérfano. La arquitectura de la Sala (navegador + agente local + voz intercambiable) es un argumento de venta.

**No se encontró**: cifras de uso o satisfacción de Seoul Metro ni de DFW más allá de "miles"; precios de Sensely y Hippo; precio actual de Proto M2; evidencia de kioscos o asistentes con IA instalados en estaciones del Metro de Medellín.


## Base de la propuesta de diseño: lo que ha ganado y lo que rige en Medellín (2025-2026)

**Lo primero que encontré es una ausencia:** en los premios de diseño gráfico e identidad del último año no hay ganadores de Medellín. En el Lápiz de Acero 2026 (447 inscritos, 63 premios) los dos únicos ganadores de la ciudad son biomateriales de la Universidad de Medellín ([abc economía](https://abceconomia.co/2026/06/13/universidad-de-medellin-gana-dos-premios-lapiz-de-acero/)); la tipografía premiada es de Popayán (Alt y LPT Lucerna Sans, de Yesid Pizo, [ganadores](https://www.lapizdeacero.org/ganadores/)); el branding y la ilustración premiados en los LAD Awards 2025 (Arrebol, Festival Cordillera, Estéreo Picnic) son de estudios de Bogotá ([LAD Awards](https://ladawards.org/2026/en/page/ganadores-profesionales-2025)). El Salón de Ilustración de Medellín 2025 es muestra, no concurso ([El Colombiano](https://www.elcolombiano.com/cultura/salon-ilustracion-medellin-2025-tragaluz-artistas-y-obras-CO30496631)). Conclusión útil: no hay un "estilo ganador de Medellín" que copiar; lo que sí hay es una **identidad de ciudad oficial y reciente** con criterios claros, y de ahí sale la propuesta.

| Referencia | Qué aporta | Fuente |
|---|---|---|
| Marca ciudad **"Medellín, aquí todo florece"** (2021, votada por ciudadanos, diseño de Jaime Uribe y Asociados; licenciable desde diciembre de 2025) | El concepto **"topografía en tipografía"**: las letras dibujan montañas, valle y edificios. Paleta con nombres locales: **guayaba** y **verde montaña** como principales, más guarapo, guayacán, cielo y mantequilla | [Behance](https://www.behance.net/gallery/189929051/Medellin-Aqui-todo-florece) · [Medellín.Travel](https://www.medellin.travel/flores-para-la-nueva-marca-ciudad-de-medellin/) · [marcamedellin.com](https://marcamedellin.com/) |
| **Metro de Medellín**, 30 años (nov. 2025) | Colores por línea: **A azul #0065B3**, **B naranja #F8821E**, **K lima #B2D459**, J amarillo, **L marrón #9C6918**, H rosa, M morado, P rojo. "Cultura Metro" desde 1988 | [mapas oficiales](https://www.metrodemedellin.gov.co/viaje-con-nosotros/mapas) · [30 años](https://www.metrodemedellin.gov.co/trigesimo-aniversario) |
| Campaña **"¡Qué orgullo Medellín!"** (vagón intervenido, ago. 2025) | Tono en primera persona y seis rasgos: amabilidad, pujanza, solidaridad, hospitalidad, talento, pertenencia. Sirve de guía de voz para los agentes | [El Colombiano](https://www.elcolombiano.com/cultura/que-orgullo-medellin-campana-metro-30-anos-HM28711996) |
| **Alumbrados 2025** (25.000 figuras tejidas a mano por 150 artesanas) | Lo hecho a mano y los símbolos concretos (carriel, orquídea, corregimientos) en vez de la postal | [Alcaldía](https://www.medellin.gov.co/es/sala-de-prensa/noticias/con-ocho-millones-de-bombillas-led-epm-encendio-los-alumbrados-en-navidad-medellin-te-quiere/) |
| **"Quiero a Medellín"** (1980, Michel Arnau) | La flor con pétalos-corazón: el antecedente afectivo de "florece" | [El Colombiano](https://www.elcolombiano.com/antioquia/mas-de-un-siglo-de-campanas-de-amor-por-medellin-KL12084086) |

**Sistema propuesto.** Paleta: verde montaña (#1F4D3A) como base de las pantallas de estación, guayaba (#C4553A) para Iván y para la acción principal, azul Metro (#0065B3) para Hermes y el dato de sistema, lima K (#B2D459) para confirmaciones, naranja B (#F8821E) para alertas, mantequilla (#F6E7C1) para el móvil y las tarjetas. Los hex del Metro son públicos; los de la marca ciudad son derivados de sus nombres porque el manual no publica valores. Tipografía: **Baloo 2** para titulares y la voz de los agentes (redonda y amable, como las letras del logotipo de la marca ciudad y el corazón de "Quiero a Medellín") con **Inter** para datos y UI. Motivos: curvas de nivel como fondo, el trazado del SITVA como sistema de color de estados, la silleta como retícula de bloques (nunca dibujada), textura de tejido para superficies, y la flor-corazón como reacción de los agentes.

**Qué no hacer**: las gordas de Botero como mascota, estética narco, cursivas "Medellín Script" de stock, silletas y orquídeas de banco de imágenes, imitar el grafiti de la Comuna 13 (obra de artistas vivos), las diez líneas de color a la vez, usar "Medellín te quiere" (marca de gobierno que termina en 2027; la marca ciudad rige diez años) y los brillos neón "tech".

**Corrección sobre los mockups anteriores:** la Línea A del Metro es **azul**, no verde. Las pantallas nuevas ya lo usan bien.


## Prompt de arranque para construir el tótem (sesión nueva de Claude Code)

Ver `docs/estacion-metro-prompt.md`.
