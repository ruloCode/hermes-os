/**
 * Guiones de los primeros 10 contenidos del mes 1 (estrategia de marca
 * personal 2026). Escritos a mano con los sistemas REALES del dueño — el
 * pilar #1 (Jarvis) ya tiene guion del seed base y aquí no se toca.
 * Cada update espeja el .md al vault (projects/rulocodeshow/contenido/).
 *
 *   pnpm --filter @hermes/agent seed:guiones
 */
import { listPieces, updatePiece } from "../src/content/store.js";

const GUIONES: { title: string; hook: string; script: string }[] = [
  {
    title: "Controlo mi computador con la mano (lo construí yo)",
    hook: "Esto no es CGI — es mi computador real.",
    script: `**Formato:** vertical 30s · TikTok + Reels · grabar pantalla + cámara (PiP)

[0-3s] **[DEMO: mano abierta moviendo el cursor]**
«Esto no es CGI. Estoy moviendo el cursor de mi computador con la mano.»

[3-12s] **[DEMO: pinza índice → click en un link · pinza meñique → copia · pinza anular → pega]**
«Pinza con el índice: click. Meñique: copiar. Anular: pegar. Sí — estoy copiando y pegando EN EL AIRE.»

[12-22s] **[DEMO: dos dedos → scroll · palma empujando → Mission Control]**
«Dos dedos: scroll. Palma a la cámara: todas mis ventanas. Y esto corre con una webcam normal y visión por computador — sin hardware raro.»

[22-30s] (cara a cámara, energía)
«Lo construí yo, es parte de mi Jarvis personal. El sábado subo el tour completo a YouTube. ¿Qué gesto le agregarías tú? Te leo. 👇»

**Notas de grabación:** luz de frente, mano SIEMPRE dentro del encuadre, repetir la demo de la pinza 3 veces (el corte elige la más limpia). El kill switch (puño 1.2s) NO va en este video — es material para otro.`,
  },
  {
    title: "La demo de gestos con hook profesional (LinkedIn)",
    hook: "Esto que ves no es un prototipo de laboratorio: es mi computador de trabajo, hoy.",
    script: `**Formato:** vertical 60-75s · LinkedIn · subtítulos SIEMPRE (se ve en mute)

[0-4s] **[DEMO: cursor con la mano + click de pinza]**
«Esto que ves no es un prototipo de laboratorio. Es mi computador de trabajo, hoy.»

[4-20s] (voz sobre demo)
«Control por gestos con una webcam común: visión por computador detecta 21 puntos de la mano, un motor de gestos los traduce a acciones del sistema — click, copiar, pegar, cambiar de escritorio.»

[20-40s] (cara a cámara)
«¿Por qué importa? Porque la interfaz de los próximos años no va a ser solo teclado y mouse. Voz + gestos + agentes que entienden contexto. Las empresas que diseñen para eso van a jugar otro juego — y esto ya se puede construir con herramientas open source.»

[40-60s] **[DEMO corta: teleport de ventana a otro monitor]**
«Yo lo construí como parte de mi asistente personal. Si lideras un equipo de producto: ¿dónde te ahorraría fricción una interfaz así? Lo conversamos en comentarios.»

**Nota:** cero jerga de modelos; el ángulo es FUTURO DE LA INTERFAZ, no el stack. El link al video largo va en el PRIMER COMENTARIO (nunca en el cuerpo: −19% reach).`,
  },
  {
    title: "Le hablo a mi computador y me agenda las reuniones",
    hook: "—Hermes, agéndame reunión con Samuel el martes a las 4.",
    script: `**Formato:** vertical 30-35s · TikTok + Reels · audio real de la voz (Valeria)

[0-4s] **[DEMO: hablando al aire, respuesta de voz audible]**
«—Hermes, agéndame reunión con Samuel el martes a las 4.
—Listo, agendada.»
**[PANTALLA: el evento aparece en /agenda]**

[4-15s] «No es Siri. Es mi propio asistente con un agente de verdad detrás: entiende contexto, tiene mis proyectos, mi calendario y mi memoria.»
**[DEMO: —¿Cuánto llevo gastado este mes? → respuesta hablada con la cifra]**

[15-27s] «También me abre el navegador donde le pida, controla mis pestañas y hasta navega por mí: —Abre mi LinkedIn. **[PANTALLA: Chrome abre LinkedIn]** Todo por voz, todo local, todo mío.»

[27-33s] «¿La parte loca? Casi todo esto lo escribió un agente de IA — y eso te lo muestro en YouTube el sábado. ¿Qué le pedirías tú a tu asistente? 👇»

**Notas:** el audio de Valeria tiene que escucharse LIMPIO (grabar system audio, no el del mic). Difuminar montos reales si se cuelan en pantalla.`,
  },
  {
    title: "3 aprendizajes construyendo mi propio Jarvis",
    hook: "Llevo meses construyéndole un Jarvis a mi vida. Esto es lo que nadie te cuenta de los agentes de IA:",
    script: `**Formato:** post de texto LinkedIn (el guion ES el post) · sin links en el cuerpo

Llevo meses construyéndole un Jarvis a mi vida: voz, gestos, un copiloto que me asiste en reuniones.

Esto es lo que nadie te cuenta de construir con agentes de IA:

**1. El agente no es el modelo — es el contexto.**
El mismo modelo con acceso a mi calendario, mis notas y mis proyectos vale 100x más que el modelo solo. La ingeniería real está en QUÉ le das a leer y QUÉ herramientas le prestas, no en el prompt mágico.

**2. Los guardrails importan más que el prompt.**
Mi agente puede ejecutar comandos en mi máquina. Cada acción sensible pasa por una capa de permisos que decide qué se puede y qué no. Un agente sin guardrails no es un asistente: es un riesgo con buena conversación.

**3. La latencia ES la experiencia.**
Mi copiloto de reuniones responde en ~2 segundos porque mantengo una sesión viva del agente. A 10 segundos, la sugerencia llega tarde y no sirve. En agentes de tiempo real, la arquitectura se diseña alrededor del reloj.

Todo esto lo estoy construyendo en público — errores y facturas incluidos.

¿Cuál de los tres te sorprende más? ¿O cuál no te cuadra? Te leo. 👇

#InteligenciaArtificial #Agentes #IA #Desarrollo`,
  },
  {
    title: "Mi código es una galaxia 3D y la muevo con las manos",
    hook: "Este es TODO el código de mi proyecto — como una galaxia.",
    script: `**Formato:** vertical 30s · TikTok + Shorts · pantalla protagonista, cara en PiP pequeño

[0-3s] **[PANTALLA: grafo 3D girando, colores violeta/cian]**
«Este es TODO el código de mi proyecto. Cada punto es un archivo o una función. Los cúmulos son módulos que trabajan juntos.»

[3-12s] **[DEMO: mano abierta → hover sobre un nodo, tooltip visible]**
«Y sí — lo navego con las manos. Mano abierta: exploro. **[DEMO: pinza sostenida → orbitar]** Pinza: giro la galaxia.»

[12-22s] **[DEMO: DOS pinzas separándose → zoom]**
«Dos pinzas: zoom. Como Iron Man, pero con mi codebase real. Detrás hay análisis de código puro — sin IA adivinando: el grafo sale del árbol de sintaxis.»

[22-30s] (cara a cámara)
«¿Para qué sirve? Para VER la arquitectura en segundos en vez de leerla en horas. ¿Cómo se vería el código de tu empresa así? 👇»

**Notas:** grabar el tab MEMORIA en 4K con el bloom bien calibrado (violeta/cian, nunca white-out). La toma de las dos pinzas es LA toma — repetirla hasta que salga fluida.`,
  },
  {
    title: "Construí un copiloto que me sopla en las reuniones",
    hook: "Me acaban de hacer una pregunta difícil en una junta. Mira lo que pasa.",
    script: `**Formato:** vertical 35s · TikTok + Reels · pantalla de la Junta EN VIVO + cara

[0-4s] **[PANTALLA: transcripción en vivo, alguien pregunta algo técnico]**
«Me acaban de hacer una pregunta difícil en una junta. Mira lo que pasa.»

[4-14s] **[PANTALLA: la sugerencia aparece streameando en ~2 segundos]**
«Mi copiloto escucha la reunión, detecta la pregunta y me sopla una respuesta en DOS segundos. En mi pantalla, solo para mí.»

[14-26s] «Transcribe con quién-dijo-qué, me marca acuerdos y tareas, y al final me deja el resumen con accionables listos para ejecutar. Yo marco "soy yo" y jamás me responde a mí mismo.»

[26-35s] (cara a cámara)
«Lo construí yo y lo uso en mis juntas reales. Sé lo que vas a preguntar: sí, es un arma de doble filo — y de la ética hablamos en el video largo. ¿Lo usarías en tus reuniones? Honestidad total. 👇»

**Notas:** usar una junta SIMULADA para la grabación (el guion de entrevista del modo fake) — jamás exponer una reunión real de clientes. El ttft de ~2s tiene que verse REAL en pantalla.`,
  },
  {
    title: "El copiloto de reuniones: cuánto vale no perder ningún acuerdo",
    hook: "¿Cuántas decisiones de tu equipo se pierden entre 'creo que quedamos en…' y el acta que nadie escribió?",
    script: `**Formato:** vertical 60-75s · LinkedIn · subtítulos SIEMPRE · ángulo B2B

[0-5s] (cara a cámara)
«¿Cuántas decisiones de tu equipo se pierden entre "creo que quedamos en…" y el acta que nadie escribió?»

[5-25s] **[PANTALLA: transcripción diarizada en vivo]**
«Construí un copiloto que escucha las reuniones y las convierte en activos: transcripción con quién-dijo-qué en tiempo real, resumen automático al cerrar, y los acuerdos convertidos en tareas asignables con un clic.»

[25-45s] **[PANTALLA: resumen + accionables → issue creado]**
«El resultado: cero "¿qué quedamos?", cero reuniones para revisar reuniones. Cada junta deja un documento buscable y tareas con dueño. Para un equipo de 5 personas, son horas recuperadas cada semana — y decisiones que dejan de evaporarse.»

[45-60s] (cara a cámara)
«Esto lo construimos con agentes de IA y lo uso todos los días. Si en tu empresa las reuniones se evaporan: ¿qué es lo primero que automatizarías del ciclo junta → decisión → tarea? Te leo en comentarios.»

**Nota:** este es el primer lead magnet suave de NevadaTech — el CTA es CONVERSACIÓN, no venta. Junta simulada en pantalla, jamás una real.`,
  },
  {
    title: "Mi tutor de inglés es una IA y me corrige en tiempo real",
    hook: "—How do you say… eh… 'agendar'? —You can say: to schedule.",
    script: `**Formato:** vertical 30-35s · TikTok · pantalla LivePractice + audio real

[0-5s] **[PANTALLA: transcripción en vivo de la práctica, audio real]**
«—How do you say… eh… "agendar"?
—You can say: "to schedule". Try it in a sentence.»

[5-15s] (voz sobre pantalla)
«Este es mi tutor de inglés. Es una IA con voz que me corrige EN el momento, guarda cada palabra nueva en mi banco de vocabulario y me la repasa hasta que la aprendo.»

[15-26s] **[PANTALLA: reporte post-sesión con errores recurrentes y drills]**
«Al terminar me deja un reporte: mis errores recurrentes y los ejercicios para la próxima sesión. La siguiente clase ABRE calentando con eso. Es un tutor con memoria.»

[26-33s] (cara a cámara, honesto)
«¿Por qué lo construí? Porque en 2027 quiero crear contenido en inglés — y este es mi entrenamiento. Aprender en público también cuenta. ¿Qué idioma estás peleando tú? 👇»

**Notas:** grabar una práctica real (con errores REALES — eso es el diferencial). Elegir un fragmento donde la corrección se escuche clarita.`,
  },
  {
    title: "5 cosas que un agente de IA ya hace en mi día a día",
    hook: "No es ciencia ficción ni un demo de conferencia: es mi martes.",
    script: `**Formato:** carrusel LinkedIn 8 slides (el guion = los slides) · screenshots reales difuminando datos sensibles

**Slide 1 (hook):**
5 cosas que un agente de IA ya hace en mi día a día.
No es ciencia ficción ni un demo de conferencia: es mi martes. →

**Slide 2:** 🗓️ **Me agenda por voz.**
«Hermes, reunión con Samuel el martes a las 4» — y aparece en mi calendario real. Sin abrir una app.

**Slide 3:** 📝 **Convierte mis reuniones en tareas.**
Escucha la junta, resume, saca los acuerdos y los convierte en issues asignados. Nadie vuelve a preguntar «¿qué quedamos?».

**Slide 4:** 💸 **Lleva mis finanzas.**
«¿Cuánto llevo gastado este mes?» — respuesta hablada, con datos reales en pesos. Registrar un gasto también es una frase.

**Slide 5:** 🧠 **Escribe tareas con TODO el contexto.**
Cuando pido una tarea nueva, el agente junta contexto de mis notas, mi código y mis reuniones — y crea el ticket con criterios de aceptación y el prompt listo para ejecutarla.

**Slide 6:** 🎬 **Edita mis videos.**
Cortes de silencios, subtítulos, formatos vertical y horizontal — orquestado por agentes. Este carrusel existe gracias a ese tiempo recuperado.

**Slide 7 (patrón):**
El patrón de los 5: **contexto propio + herramientas + guardrails.**
No es «usar ChatGPT»: es darle a un agente acceso controlado a TU mundo.

**Slide 8 (CTA):**
Todo esto lo construyo en público — con errores y facturas incluidos.
Sígueme si quieres ver cómo se hace de verdad. ¿Cuál de los 5 te llevas? 👇`,
  },
  {
    title: "Le pedí a mi agente que trabajara mientras iba al gym",
    hook: "Me fui al gym y dejé a alguien trabajando: mi agente.",
    script: `**Formato:** vertical 30s · TikTok · storytelling con pantalla

[0-4s] (cara a cámara, saliendo con la maleta del gym)
«Me fui al gym y dejé a alguien trabajando: mi agente.»

[4-14s] **[PANTALLA: la tarea corriendo — log del run en vivo]**
«Antes de salir le pedí una feature por voz. Mientras yo entrenaba, él: leyó el código, escribió la solución, corrió las pruebas y me dejó el resumen de qué hizo y qué decidió.»

[14-25s] **[PANTALLA: el resultado + el resumen de la ejecución]**
«Volví, revisé el diff con mis propias reglas de revisión, ajusté una cosa y listo. La parte importante: el agente trabaja, pero el criterio sigue siendo mío.»

[25-30s] «¿Delegarías código a un agente mientras entrenas? El flujo completo, con errores incluidos, va en el video largo. 👇»

**Notas:** usar una tarea real de Zylen o Hermes (nada de clientes). El log del run tiene que verse avanzando — eso es lo hipnótico.`,
  },
];

async function main() {
  const pieces = await listPieces();
  let ok = 0;
  for (const g of GUIONES) {
    const piece = pieces.find((p) => p.title === g.title);
    if (!piece) {
      console.error(`  ✗ no encontrada: ${g.title}`);
      continue;
    }
    const updated = await updatePiece(piece.id, {
      hook: g.hook,
      scriptMd: g.script,
      ...(piece.status === "idea" ? { status: "guion" as const } : {}),
    });
    if (updated) ok++;
    else console.error(`  ✗ falló update: ${g.title}`);
  }
  console.log(`guiones: ${ok}/${GUIONES.length} (el pilar #1 ya tenía el suyo del seed base)`);
  // El espejo al vault es fire-and-forget dentro del store; sin esta espera
  // el process.exit corta la escritura del último archivo.
  await new Promise((r) => setTimeout(r, 2000));
}

main().then(() => process.exit(0));
