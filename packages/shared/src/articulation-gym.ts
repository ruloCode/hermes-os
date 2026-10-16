/**
 * Gimnasio de articulación: entrenar a diario, en español y en inglés, a decir
 * las ideas con el punto primero y con convicción. Lógica pura que comparten el
 * agente (plan del día, puntaje, racha) y el dashboard (escenarios, progreso).
 *
 * Una sesión son cuatro repeticiones (dos en español, dos en inglés, alternadas)
 * de ~30-45 s cada una: escenario → hablas → te devuelve tu frase dicha mejor
 * y una nota por hábito → "otra vez" hasta que suene a ti en tu mejor día. Con
 * los reintentos son ~9 minutos.
 *
 * Los escenarios son situaciones de trabajo reales y genéricas (abrir una
 * junta, un cliente que empuja la fecha, dar una mala noticia…): las frases las
 * pones tú, así que lo que se entrena son TUS frases.
 */

export type GymLang = "es" | "en";

/** Los cinco hábitos que se puntúan en cada repetición (1-5). */
export type GymHabit = "punto" | "permiso" | "pero" | "conviccion" | "concreto";

export const GYM_HABITS: { key: GymHabit; label: string; hint: string }[] = [
  { key: "punto", label: "El punto primero", hint: "La conclusión o la postura en la primera frase." },
  { key: "permiso", label: "Sin pedir permiso", hint: "Sin «solo quería…», sin disculparte por hablar." },
  { key: "pero", label: "Sin «pero» que borra", hint: "«Entiendo X, y por eso…» en vez de «entiendo, pero…»." },
  { key: "conviccion", label: "Convicción", hint: "Verbo firme; nada de «creo que tal vez»." },
  { key: "concreto", label: "Concreto", hint: "Un número, un nombre o un ejemplo; frases cortas." },
];

export type GymKind =
  | "abrir"
  | "rechazo"
  | "mala-noticia"
  | "defender"
  | "pedir"
  | "cerrar"
  | "presentarte"
  | "pregunta-dificil"
  | "explicar"
  | "decir-no";

export const GYM_KIND_LABEL: Record<GymKind, string> = {
  abrir: "Abrir una junta",
  rechazo: "Te empujan la fecha",
  "mala-noticia": "Dar una mala noticia",
  defender: "Defender tu propuesta",
  pedir: "Pedir algo",
  cerrar: "Cerrar con un compromiso",
  presentarte: "Presentarte",
  "pregunta-dificil": "Pregunta difícil",
  explicar: "Explicar algo técnico",
  "decir-no": "Decir que no",
};

export interface GymScenario {
  id: string;
  lang: GymLang;
  kind: GymKind;
  /** La situación, en el idioma del escenario. */
  situation: string;
  /** Lo que te acaban de decir (o la consigna si nadie habla antes). */
  prompt: string;
  /** El hábito que este escenario pone a prueba. */
  focus: GymHabit;
  /** Duración que debería tomar una buena respuesta. */
  targetSec: number;
  /** Ausente = del catálogo escrito a mano · "generated" = lo escribió Hermes con tu contexto. */
  source?: "generated";
  /** Los generados traen su referencia; los del catálogo la tienen en GYM_REFERENCES. */
  reference?: GymReference;
}

export const GYM_SCENARIOS: GymScenario[] = [
  // ── Español ──
  {
    id: "es-abrir-sprint",
    lang: "es",
    kind: "abrir",
    situation: "Eres quien convoca la junta semanal del proyecto. Hay 5 personas conectadas esperando.",
    prompt: "Abre la junta: para qué estamos aquí y qué tiene que salir decidido.",
    focus: "punto",
    targetSec: 30,
  },
  {
    id: "es-rechazo-fecha",
    lang: "es",
    kind: "rechazo",
    situation: "Le diste al cliente una fecha de entrega realista. Te llama y no le gusta.",
    prompt: "«Necesitamos esto para el viernes, no para el 30. ¿Se puede o no?»",
    focus: "pero",
    targetSec: 35,
  },
  {
    id: "es-mala-noticia-bug",
    lang: "es",
    kind: "mala-noticia",
    situation: "Un error en producción afectó a usuarios ayer. Ya está mitigado. Tu jefa no lo sabe todavía.",
    prompt: "Cuéntale lo que pasó en la junta de la mañana.",
    focus: "permiso",
    targetSec: 40,
  },
  {
    id: "es-defender-arquitectura",
    lang: "es",
    kind: "defender",
    situation: "Propusiste usar una cola para procesar pagos. Alguien del equipo prefiere hacerlo síncrono.",
    prompt: "«Eso es sobreingeniería, lo hacemos directo y ya.» Defiende tu propuesta.",
    focus: "conviccion",
    targetSec: 40,
  },
  {
    id: "es-pedir-aumento",
    lang: "es",
    kind: "pedir",
    situation: "Llevas un año en el proyecto, lideraste dos entregas clave. Tienes 1:1 con tu jefe.",
    prompt: "Pide la revisión de tu tarifa (o salario).",
    focus: "concreto",
    targetSec: 40,
  },
  {
    id: "es-cerrar-junta",
    lang: "es",
    kind: "cerrar",
    situation: "La junta dio vueltas 40 minutos. Quedan 2 minutos y nadie ha dicho quién hace qué.",
    prompt: "Ciérrala: qué se decidió y quién hace qué para cuándo.",
    focus: "concreto",
    targetSec: 30,
  },
  {
    id: "es-presentarte-cliente",
    lang: "es",
    kind: "presentarte",
    situation: "Primera llamada con un cliente potencial. Te dicen: «Cuéntanos un poco de ti».",
    prompt: "Preséntate en 30 segundos: qué haces y por qué te deberían contratar.",
    focus: "punto",
    targetSec: 30,
  },
  {
    id: "es-pregunta-costo",
    lang: "es",
    kind: "pregunta-dificil",
    situation: "Presentas una propuesta de agentes de IA a un gerente escéptico.",
    prompt: "«¿Y qué pasa si el agente se equivoca con un cliente real?»",
    focus: "conviccion",
    targetSec: 35,
  },
  {
    id: "es-explicar-rag",
    lang: "es",
    kind: "explicar",
    situation: "La dueña de un negocio (no técnica) te pregunta en qué consiste lo que le vas a construir.",
    prompt: "Explícale qué es un RAG y por qué le sirve, sin jerga.",
    focus: "concreto",
    targetSec: 40,
  },
  {
    id: "es-decir-no-alcance",
    lang: "es",
    kind: "decir-no",
    situation: "A mitad del sprint el cliente pide «una cosita más» que son tres días de trabajo.",
    prompt: "«¿Le pueden meter también el módulo de reportes? Es pequeño.»",
    focus: "permiso",
    targetSec: 30,
  },
  {
    id: "es-perdida-trimestre",
    lang: "es",
    kind: "mala-noticia",
    situation: "Los números del trimestre salieron por debajo de la meta. Te toca abrir la presentación.",
    prompt: "Tu primera frase frente al comité. Sin «obviamente, como pueden ver».",
    focus: "punto",
    targetSec: 30,
  },
  {
    id: "es-pedir-ayuda",
    lang: "es",
    kind: "pedir",
    situation: "Estás bloqueado hace dos días con una integración. Otra persona del equipo la conoce bien.",
    prompt: "Pídele 30 minutos de su tiempo.",
    focus: "permiso",
    targetSec: 25,
  },
  // ── English ──
  {
    id: "en-open-standup",
    lang: "en",
    kind: "abrir",
    situation: "You're running the weekly sync with an international team. Everyone just joined.",
    prompt: "Open the meeting: why we're here and what we need to decide today.",
    focus: "punto",
    targetSec: 30,
  },
  {
    id: "en-pushback-deadline",
    lang: "en",
    kind: "rechazo",
    situation: "You gave a client a realistic timeline. They push back hard.",
    prompt: "\"We really need this by Friday, not the end of the month. Can you make it happen?\"",
    focus: "pero",
    targetSec: 35,
  },
  {
    id: "en-bad-news-outage",
    lang: "en",
    kind: "mala-noticia",
    situation: "Yesterday's deploy broke checkout for an hour. It's fixed. Your manager hasn't heard yet.",
    prompt: "Tell your manager what happened.",
    focus: "permiso",
    targetSec: 40,
  },
  {
    id: "en-defend-approach",
    lang: "en",
    kind: "defender",
    situation: "You proposed adding automated evals before shipping the AI agent. A teammate thinks it's a waste of time.",
    prompt: "\"Evals will slow us down. Let's just ship and see.\" Defend your approach.",
    focus: "conviccion",
    targetSec: 40,
  },
  {
    id: "en-ask-rate",
    lang: "en",
    kind: "pedir",
    situation: "A US client wants to extend your contract. Your rate hasn't changed in a year.",
    prompt: "Ask for a higher rate for the next contract.",
    focus: "concreto",
    targetSec: 40,
  },
  {
    id: "en-close-meeting",
    lang: "en",
    kind: "cerrar",
    situation: "The discussion went in circles. Two minutes left and no owners assigned.",
    prompt: "Close the meeting: what we decided, who does what, by when.",
    focus: "concreto",
    targetSec: 30,
  },
  {
    id: "en-intro-interview",
    lang: "en",
    kind: "presentarte",
    situation: "Job interview for a senior AI engineer role. First question.",
    prompt: "\"So, tell me about yourself.\"",
    focus: "punto",
    targetSec: 40,
  },
  {
    id: "en-hard-question-hallucination",
    lang: "en",
    kind: "pregunta-dificil",
    situation: "You're demoing an AI agent to a skeptical CTO.",
    prompt: "\"How do you know it won't hallucinate in front of a customer?\"",
    focus: "conviccion",
    targetSec: 35,
  },
  {
    id: "en-explain-agents",
    lang: "en",
    kind: "explicar",
    situation: "A non-technical founder asks what an AI agent actually is.",
    prompt: "Explain it in plain words, with one example from their business.",
    focus: "concreto",
    targetSec: 40,
  },
  {
    id: "en-say-no-scope",
    lang: "en",
    kind: "decir-no",
    situation: "Mid-sprint, the product owner asks for one more feature that would take three days.",
    prompt: "\"Could you squeeze in the export feature too? It's small.\"",
    focus: "permiso",
    targetSec: 30,
  },
  {
    id: "en-quarterly-loss",
    lang: "en",
    kind: "mala-noticia",
    situation: "The quarter came in below target. You're opening the review with leadership.",
    prompt: "Your first sentence. No \"so obviously, as you can see from the deck…\".",
    focus: "punto",
    targetSec: 30,
  },
  {
    id: "en-ask-feedback",
    lang: "en",
    kind: "pedir",
    situation: "You just delivered a big presentation to your team lead.",
    prompt: "Ask for direct feedback on how you came across.",
    focus: "permiso",
    targetSec: 25,
  },
];

const BY_ID = new Map(GYM_SCENARIOS.map((s) => [s.id, s]));
export function gymScenario(id: string): GymScenario | undefined {
  return BY_ID.get(id);
}

/** Repeticiones del día: dos en español y dos en inglés, alternadas. */
export const GYM_PLAN_ORDER: GymLang[] = ["es", "en", "es", "en"];

/** Días desde 1970 de una fecha YYYY-MM-DD (calendario puro). */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
}

/**
 * El plan de un día: determinista por fecha (el mismo día da el mismo plan en
 * la Mac y en otro navegador) y rotando el catálogo de cada idioma de a dos
 * escenarios consecutivos, así que uno no vuelve hasta que salieron los demás.
 * El inglés va desfasado medio catálogo para que el mismo día no se repita el
 * tipo entre idiomas (los dos catálogos traen los tipos en el mismo orden).
 * Nada de saltar escenarios: un salto deja escenarios que nunca salen.
 */
export function dailyPlan(date: string): GymScenario[] {
  const day = dayNumber(date);
  const perLang: Record<GymLang, number> = { es: 0, en: 0 };
  return GYM_PLAN_ORDER.map((lang) => {
    const pool = GYM_SCENARIOS.filter((s) => s.lang === lang);
    const slotsPerDay = GYM_PLAN_ORDER.filter((l) => l === lang).length;
    const offset = lang === "en" ? Math.floor(pool.length / 2) : 0;
    const i = (day * slotsPerDay + perLang[lang] + offset) % pool.length;
    perLang[lang] += 1;
    return pool[i];
  });
}

export interface GymFeedback {
  /** 1-5 por hábito. */
  scores: Record<GymHabit, number>;
  /** Una línea por hábito: qué pasó en ESTA respuesta (cita lo que dijiste). */
  notes: Record<GymHabit, string>;
  /** La misma respuesta dicha mejor, en el idioma del escenario. */
  better: string;
  /** Lo que más le restó, una frase concreta para el siguiente intento. */
  tip: string;
  /** Intento 2+: qué mejoró o empeoró respecto al anterior. */
  progress?: string;
}

export interface GymRep {
  id: string;
  /** YYYY-MM-DD (Bogotá). */
  date: string;
  scenarioId: string;
  lang: GymLang;
  /** 1 = primera vez hoy con este escenario; 2+ = "otra vez". */
  attempt: number;
  transcript: string;
  durationSec: number;
  words: number;
  wpm: number;
  fillers: number;
  /** Fragmentos débiles que detectó el regex (shared/articulation). */
  weak: string[];
  feedback: GymFeedback;
  /** 0-100: promedio de los cinco hábitos. */
  score: number;
  createdAt: string;
}

/** 0-100 a partir de los cinco hábitos (1-5). */
export function gymScore(scores: Record<GymHabit, number>): number {
  const vals = GYM_HABITS.map((h) => Math.min(5, Math.max(1, Number(scores[h.key]) || 1)));
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(((avg - 1) / 4) * 100);
}

/**
 * ¿Ese día cuenta para la racha? Una repetición en español Y una en inglés:
 * entrenar solo en un idioma no es lo que se pidió.
 */
export function gymDayCounts(reps: Pick<GymRep, "lang">[]): boolean {
  return reps.some((r) => r.lang === "es") && reps.some((r) => r.lang === "en");
}

/**
 * Días seguidos que cuentan, terminando hoy — o ayer, si hoy aún no entrenas
 * (la racha no se rompe a las 8 am).
 */
export function gymStreak(reps: Pick<GymRep, "lang" | "date">[], today: string): number {
  const byDate = new Map<string, Pick<GymRep, "lang">[]>();
  for (const r of reps) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  const counts = (d: string) => gymDayCounts(byDate.get(d) ?? []);
  const shift = (d: string, n: number) =>
    new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  let d = counts(today) ? today : shift(today, -1);
  let streak = 0;
  while (counts(d)) {
    streak += 1;
    d = shift(d, -1);
  }
  return streak;
}

/**
 * Días completos acumulados (español Y inglés el mismo día). Nunca baja:
 * faltar un día no le quita nada a lo entrenado (P7 de Hermes Phone).
 */
export function gymTrainedDays(reps: Pick<GymRep, "lang" | "date">[]): number {
  const byDate = new Map<string, Pick<GymRep, "lang">[]>();
  for (const r of reps) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  return [...byDate.values()].filter(gymDayCounts).length;
}

/** Mejor intento de cada escenario del plan de hoy (null = aún no). */
export function planProgress(
  plan: GymScenario[],
  todayReps: GymRep[],
): { scenario: GymScenario; best: GymRep | null; attempts: number }[] {
  return plan.map((scenario) => {
    const mine = todayReps.filter((r) => r.scenarioId === scenario.id);
    const best = mine.reduce<GymRep | null>((a, r) => (!a || r.score > a.score ? r : a), null);
    return { scenario, best, attempts: mine.length };
  });
}

/**
 * Promedio (1-5) por hábito en las repeticiones dadas, por idioma. null = sin
 * datos (la UI no pinta una barra en cero que parezca un dato).
 */
export function habitAverages(
  reps: GymRep[],
  lang?: GymLang,
): Record<GymHabit, number | null> {
  const pool = lang ? reps.filter((r) => r.lang === lang) : reps;
  const out = {} as Record<GymHabit, number | null>;
  for (const h of GYM_HABITS) {
    const vals = pool.map((r) => r.feedback.scores[h.key]).filter((v) => typeof v === "number");
    out[h.key] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }
  return out;
}

/** El hábito más flojo (para decir "hoy trabaja X"); null sin datos. */
export function weakestHabit(reps: GymRep[]): GymHabit | null {
  const avg = habitAverages(reps);
  let worst: GymHabit | null = null;
  for (const h of GYM_HABITS) {
    const v = avg[h.key];
    if (v == null) continue;
    if (worst == null || v < (avg[worst] ?? Infinity)) worst = h.key;
  }
  return worst;
}

/** Lo que devuelve GET /gym/today. */
export interface GymToday {
  date: string;
  /** La ronda 1 (el plan fijo del día). */
  plan: GymScenario[];
  /** Todas las rondas de hoy: [0] = plan; las demás, pedidas con "Otra ronda". */
  rounds: GymScenario[][];
  /** Temas nuevos ya preparados para la próxima ronda (0 = la próxima tarda en generarse). */
  poolReady: number;
  /** El agente está escribiendo temas nuevos ahora mismo. */
  generating?: boolean;
  reps: GymRep[];
  streak: number;
  /** Días completos acumulados (gymTrainedDays): lo que muestra el teléfono en vez de la racha. */
  trainedDays: number;
  dayDone: boolean;
  /** Últimos 14 días, para el progreso del riel. */
  recent: GymRep[];
}

// ── Respuestas de referencia ───────────────────────────────────────────

/**
 * Cómo suena una buena respuesta ANTES de intentarla: los pasos (la forma) y
 * una respuesta modelo, los dos en el idioma del escenario.
 * Escritas a mano, no generadas: salen al instante, son las mismas en cada
 * máquina y un test garantiza que ninguna trae las señales débiles que el
 * gimnasio penaliza. Completas, sin [huecos]: los datos concretos (cifras,
 * nombres, fechas) son de ejemplo y realistas — se ve la forma entera.
 */
export interface GymReference {
  /** 2-4 pasos cortos: la forma de la respuesta. */
  steps: string[];
  example: string;
}

export const GYM_REFERENCES: Record<string, GymReference> = {
  "es-abrir-sprint": {
    steps: ["Para qué estamos", "Qué sale decidido", "Cómo usamos el tiempo"],
    example:
      "Buenos días. Hoy salimos con una decisión: qué entra en la entrega del 30 de octubre. Tenemos tres candidatos y espacio para dos. Diez minutos para ver el estado, quince para decidir y cerramos con dueños. Arranco con el estado.",
  },
  "es-rechazo-fecha": {
    steps: ["Reconoce lo que necesita", "Tu postura con el porqué", "Ofrece una alternativa concreta"],
    example:
      "Entiendo que el viernes es importante para ustedes, y por eso les propongo esto: el viernes les entrego el módulo de pagos funcionando, y el resto el 30 como acordamos. Si lo comprimo todo al viernes, sale sin pruebas y el riesgo lo corren ustedes.",
  },
  "es-mala-noticia-bug": {
    steps: ["Qué pasó, en una frase", "Impacto real", "Qué ya está hecho", "Qué sigue"],
    example:
      "Ayer tuvimos una falla en producción: durante 40 minutos los usuarios no pudieron pagar. Afectó a unos 300 clientes. Ya está corregido y verificado. Hoy agrego una prueba que lo habría atrapado y el viernes te paso el análisis completo.",
  },
  "es-defender-arquitectura": {
    steps: ["Tu postura", "El riesgo que evita", "Lo que cuesta de verdad"],
    example:
      "Me quedo con la cola. Con pagos, un reintento mal hecho cobra dos veces, y eso no se arregla con un parche. La cola nos da reintentos seguros y trazabilidad. Cuesta un día más de trabajo; un cobro duplicado nos cuesta un cliente.",
  },
  "es-pedir-aumento": {
    steps: ["Lo que pides, con número", "Por qué: resultados concretos", "Desde cuándo"],
    example:
      "Quiero revisar mi tarifa: propongo subirla un 20 % desde el próximo mes. Este año lideré la migración a la nube y el lanzamiento del agente de soporte, que bajó los tickets un 35 %. Hoy hago más que cuando acordamos la tarifa actual, y quiero que el número lo refleje.",
  },
  "es-cerrar-junta": {
    steps: ["Qué se decidió", "Quién hace qué y para cuándo", "Cuándo volvemos a vernos"],
    example:
      "Cerramos así: vamos con la opción B. Andrea arma la migración para el miércoles, yo reviso los costos para el jueves y Camilo le avisa al cliente hoy. El viernes a las 9 confirmamos que todo quedó listo.",
  },
  "es-presentarte-cliente": {
    steps: ["Qué haces, en una frase", "Una prueba concreta", "Qué ganan ellos"],
    example:
      "Construyo agentes de IA que hacen trabajo real dentro de las empresas: responden, buscan y ejecutan con sus propios datos. Hace poco puse un agente a responder el soporte de una tienda y resolvió el 60 % de las consultas sin intervención humana. Si les sirve, salen de esta llamada con dos procesos que podemos automatizar este mes.",
  },
  "es-pregunta-costo": {
    steps: ["Responde de frente", "Cómo lo controlas", "Qué pasa cuando falla"],
    example:
      "Se va a equivocar alguna vez, y por eso lo diseñamos con límites. Solo responde con información de sus documentos, y cuando no está seguro le pasa la conversación a una persona. Cada respuesta queda registrada, así medimos el error y lo corregimos cada semana.",
  },
  "es-explicar-rag": {
    steps: ["Qué es, sin jerga", "Un ejemplo de su negocio", "Qué gana"],
    example:
      "Es un asistente que antes de responder busca en sus propios documentos. Si un cliente pregunta el precio de un producto, lo saca de su lista de precios, no de internet. Así responde como alguien de su equipo, a cualquier hora.",
  },
  "es-decir-no-alcance": {
    steps: ["La respuesta: no en este sprint", "El porqué con el costo real", "Cuándo sí"],
    example:
      "En este sprint no. Los reportes son tres días de trabajo y moverían la entrega que ya prometimos. Lo dejo listo para arrancar el lunes del siguiente sprint, y si es más urgente que el rediseño del login, cambiamos una por otra.",
  },
  "es-perdida-trimestre": {
    steps: ["El número, sin rodeos", "La causa principal", "Qué cambia desde hoy"],
    example:
      "Cerramos el trimestre 12 % por debajo de la meta. La causa principal fue que dos clientes grandes aplazaron sus contratos. Hoy les traigo tres cambios para recuperarlo y el primero ya está en marcha.",
  },
  "es-pedir-ayuda": {
    steps: ["Lo que necesitas", "Por qué esa persona", "Cuánto tiempo y cuándo"],
    example:
      "Necesito tu ayuda con la integración con el sistema de facturación: llevo dos días bloqueado y tú la conoces mejor que nadie. ¿Me das 30 minutos hoy o mañana a primera hora? Llego con el error reproducido.",
  },
  "en-open-standup": {
    steps: ["Why we're here", "The decision we need", "How we'll use the time"],
    example:
      "Good morning, everyone. Today we leave with one decision: what goes into the October 30 release. We have three candidates and room for two. Ten minutes on status, fifteen to decide, and we close with owners. I'll start with status.",
  },
  "en-pushback-deadline": {
    steps: ["Acknowledge their need", "Your position and why", "A concrete alternative"],
    example:
      "I hear that Friday matters to you, and here's what I can do: on Friday you get the payments module working, and the rest by the end of the month as planned. Squeezing everything into Friday means shipping without tests, and that risk lands on you.",
  },
  "en-bad-news-outage": {
    steps: ["What happened, in one sentence", "The real impact", "What's already done", "What's next"],
    example:
      "Yesterday's deploy broke checkout for about an hour. Around 300 customers couldn't pay. It's fixed and verified. Today I'm adding a test that would have caught it, and you'll have the full write-up by Friday.",
  },
  "en-defend-approach": {
    steps: ["Your position", "The risk it prevents", "The real cost"],
    example:
      "I'd keep the evals. Without them, the first time the agent gives a customer a wrong answer, we find out from the customer. A basic eval suite takes two days and catches that before release. Shipping blind is faster this week and slower every week after.",
  },
  "en-ask-rate": {
    steps: ["What you're asking, with the number", "Why: concrete results", "Starting when"],
    example:
      "For the next contract, my rate goes up 20 percent. This year I shipped the support agent that cut tickets by 35 percent and led the cloud migration, and I'm doing more than when we set the current rate. I'd like the new rate to start with the extension.",
  },
  "en-close-meeting": {
    steps: ["What we decided", "Who does what, by when", "When we check back"],
    example:
      "Let's close: we're going with option B. Andrea owns the migration by Wednesday, I'll have the cost numbers by Thursday, and Sam updates the client today. We check in Friday at nine.",
  },
  "en-intro-interview": {
    steps: ["Who you are, in one sentence", "One proof", "Why this role"],
    example:
      "I'm a senior engineer who builds AI agents that do real work in production. Most recently I shipped a support agent that resolves 60 percent of tickets on its own. I'm here because this role is about taking agents from demo to production, and that's exactly what I do best.",
  },
  "en-hard-question-hallucination": {
    steps: ["Answer directly", "How you control it", "What happens when it fails"],
    example:
      "It will be wrong sometimes, so we design for that. It only answers from your own documents, and when it isn't confident it hands off to a person. Every answer is logged and scored, so we measure the error rate and drive it down every week.",
  },
  "en-explain-agents": {
    steps: ["What it is, in plain words", "One example from their business", "What they gain"],
    example:
      "An AI agent is software that doesn't just answer, it acts. In your business, when a customer asks about an order, it checks the order system, finds the shipment and replies with the real status. Your team stops answering the same question fifty times a day.",
  },
  "en-say-no-scope": {
    steps: ["The answer: not this sprint", "Why, with the real cost", "When it can happen"],
    example:
      "Not this sprint. The export feature is three days of work and it would push the release we already committed to. I'll have it ready to start first thing next sprint, and if it's more urgent than the login redesign, we swap them.",
  },
  "en-quarterly-loss": {
    steps: ["The number, plainly", "The main cause", "What changes today"],
    example:
      "We closed the quarter 12 percent below target. The main driver was two large clients delaying their contracts. I'm bringing three changes to recover it, and the first one is already in motion.",
  },
  "en-ask-feedback": {
    steps: ["What you want", "Be specific about the angle", "Make it easy to be honest"],
    example:
      "I want your honest read on that presentation. Specifically: did my main point land in the first minute, and where did I lose the room? Don't soften it, that's the feedback I can use.",
  },
};

export function gymReference(id: string): GymReference | undefined {
  return GYM_REFERENCES[id];
}

/** La referencia de un escenario, venga del catálogo o generada. */
export function referenceOf(s: GymScenario): GymReference | undefined {
  return s.reference ?? GYM_REFERENCES[s.id];
}

/**
 * El escenario con su referencia dentro: lo que viaja por /gym/*. Las del
 * catálogo viven en GYM_REFERENCES (código TS) y un cliente que no es la web
 * —el teléfono— no las tiene.
 */
export function withReference(s: GymScenario): GymScenario {
  const reference = referenceOf(s);
  return reference ? { ...s, reference } : s;
}

/**
 * Quita las comillas que envuelven TODO el texto (el modelo a veces devuelve
 * «"Cerramos…"» con las comillas incluidas). Solo si el interior no trae otra
 * comilla del mismo par: «"A" y "B"» no se toca.
 */
export function stripWrappingQuotes(text: string): string {
  const t = text.trim();
  const pairs: [string, string][] = [['"', '"'], ["“", "”"], ["«", "»"], ["'", "'"]];
  for (const [open, close] of pairs) {
    if (t.length < 3 || !t.startsWith(open) || !t.endsWith(close)) continue;
    const inner = t.slice(open.length, t.length - close.length);
    if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
  }
  return t;
}

/** ¿El texto nombra a alguien de la lista? Palabra completa, sin distinguir mayúsculas. */
export function mentionsName(text: string, names: readonly string[]): boolean {
  return names
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text));
}

// ── Rondas sin límite ──────────────────────────────────────────────────

/**
 * Arma la siguiente ronda (es, en, es, en): primero temas nuevos del pool
 * generado, en orden; si falta alguno, del catálogo lo que no esté en `used`
 * (lo hecho o propuesto en los últimos días). null = no alcanza: hay que
 * generar antes.
 */
export function composeRound(pool: GymScenario[], used: ReadonlySet<string>): GymScenario[] | null {
  const chosen: GymScenario[] = [];
  const free = (s: GymScenario, lang: GymLang) =>
    s.lang === lang && !used.has(s.id) && !chosen.some((c) => c.id === s.id);
  for (const lang of GYM_PLAN_ORDER) {
    const next = pool.find((s) => free(s, lang)) ?? GYM_SCENARIOS.find((s) => free(s, lang));
    if (!next) return null;
    chosen.push(next);
  }
  return chosen;
}

const KINDS = new Set(Object.keys(GYM_KIND_LABEL));
const HABITS = new Set<string>(GYM_HABITS.map((h) => h.key));

/** Lo que devuelve el modelo por escenario, antes de validar. */
export interface GeneratedScenarioDraft {
  lang?: unknown;
  kind?: unknown;
  situation?: unknown;
  prompt?: unknown;
  focus?: unknown;
  targetSec?: unknown;
  steps?: unknown;
  example?: unknown;
}

/**
 * Valida lo que escribió el modelo: idioma y tipo conocidos, textos con
 * largo razonable, referencia de 2-4 pasos en el idioma del escenario y sin
 * las señales débiles que el gimnasio penaliza. Lo que no pasa se descarta
 * (mejor tres temas buenos que cuatro con uno roto). `ownerNames`: el
 * escenario le habla al dueño en segunda persona — uno que lo nombra
 * («Rulo presenta…») se lee como si fuera de otro.
 */
export function sanitizeGenerated(
  drafts: GeneratedScenarioDraft[],
  makeId: () => string,
  detectWeak: (text: string) => unknown[],
  langOf: (text: string) => GymLang,
  ownerNames: readonly string[] = [],
): GymScenario[] {
  const out: GymScenario[] = [];
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length >= 8 && v.trim().length <= max ? v.trim() : null;
  for (const d of drafts) {
    const lang = d.lang === "es" || d.lang === "en" ? d.lang : null;
    const kind = typeof d.kind === "string" && KINDS.has(d.kind) ? (d.kind as GymKind) : null;
    const focus = typeof d.focus === "string" && HABITS.has(d.focus) ? (d.focus as GymHabit) : "punto";
    const situation = str(d.situation, 320);
    const prompt = str(d.prompt, 240);
    const example = str(d.example, 520);
    const steps = Array.isArray(d.steps)
      ? d.steps.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 60))
      : [];
    if (!lang || !kind || !situation || !prompt || !example) continue;
    if (steps.length < 2 || steps.length > 4) continue;
    if (langOf(example) !== lang || langOf(`${situation} ${prompt}`) !== lang) continue;
    if (detectWeak(example).length) continue;
    // Completa, sin [huecos]: una referencia con corchetes no se puede decir tal cual.
    if (/[[\]]/.test(example)) continue;
    if (mentionsName(`${situation} ${prompt} ${example}`, ownerNames)) continue;
    const t = Number(d.targetSec);
    out.push({
      id: makeId(),
      lang,
      kind,
      situation,
      prompt,
      focus,
      targetSec: Number.isFinite(t) ? Math.min(60, Math.max(20, Math.round(t))) : 35,
      source: "generated",
      reference: { steps, example },
    });
  }
  return out;
}

// ── Temas de las rondas generadas ──────────────────────────────────────

/**
 * Temas de tecnología, IA e ingeniería de agentes. Cada tanda generada toma
 * los siguientes de la lista (`topicsFor`), así los temas van cambiando y no
 * se repiten hasta dar la vuelta.
 */
export const GYM_TOPICS: string[] = [
  "evals para agentes: cómo saber si un agente funciona antes de lanzarlo",
  "RAG: cuándo sirve, cuándo no, y qué falla en producción",
  "MCP (Model Context Protocol) y por qué estandarizar las herramientas de un agente",
  "guardrails y permisos: qué puede hacer un agente sin pedir aprobación",
  "costo por tarea de un agente y cómo bajarlo",
  "latencia: por qué el agente tarda y qué se hace al respecto",
  "context engineering: qué información le das al modelo y cuál le sobra",
  "alucinaciones y cómo se controlan con fuentes y verificación",
  "multi-agente vs un solo agente con buenas herramientas",
  "agentes de voz en tiempo real",
  "observabilidad: trazas y logs de lo que hizo el agente",
  "fine-tuning vs prompting vs RAG",
  "seguridad: inyección de prompts y secretos al alcance del agente",
  "elegir modelo: grande y caro vs pequeño y rápido",
  "agentes de código (Claude Code, Cursor) en un equipo real",
  "automatizar un proceso de negocio con un agente: por dónde empezar",
  "human-in-the-loop: dónde debe decidir una persona",
  "medir el ROI de un proyecto de IA",
  "embeddings y búsqueda semántica explicadas a alguien de negocio",
  "por qué un demo de IA funciona y el producto en producción no",
  "memoria de un agente: qué recuerda y qué olvida",
  "open source vs modelos de API",
  "prompt caching y por qué cambia el costo",
  "el futuro del trabajo de los desarrolladores con agentes",
];

/** Los `count` temas de la tanda número `batch` (rotando la lista). */
export function topicsFor(batch: number, count = 4): string[] {
  const n = GYM_TOPICS.length;
  return Array.from({ length: count }, (_, i) => GYM_TOPICS[(((batch * count + i) % n) + n) % n]);
}
