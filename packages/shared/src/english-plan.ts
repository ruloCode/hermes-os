/**
 * Plan de estudios de inglés (estilo Duolingo) — lógica pura que comparten el
 * agente (progreso, contexto de la tutora, evaluación) y el dashboard (la ruta).
 *
 * El temario NO es un curso genérico: salió de analizar las 15 sesiones
 * registradas hasta el 2026-10-20 (6 clases reales con la profe + 9 prácticas
 * con la tutora). Los mismos ocho patrones se repiten de la primera a la
 * última sesión, y cada unidad ataca uno, ordenadas por cuánto se repiten y
 * cuánto te cuestan en una entrevista. Detalle en docs/plan-ingles.md.
 *
 * Cada unidad es una ruta de cinco lecciones:
 *   regla (quiz con TUS errores reales) → gimnasio 1 (hablas, te evalúa) →
 *   tutora (práctica de voz en tiempo real enfocada en el patrón) →
 *   gimnasio 2 → prueba de la unidad.
 * La prueba de cualquier unidad está siempre abierta ("saltar aquí"): pasarla
 * da por hecha la unidad entera, como el test de salto de Duolingo.
 *
 * Todo número que se muestra es real: XP y racha salen de los intentos
 * aprobados; "cómo va en tus clases" sale de los errores que anotó el
 * corrector en las clases reales (una clase sin errores anotados es una clase
 * SIN DATOS — falló el audio —, no una clase perfecta).
 */

export type PlanPattern =
  | "pasado"
  | "tercera-s"
  | "sujeto"
  | "preposiciones"
  | "articulos"
  | "forma-palabra"
  | "estructura"
  | "entrevista";

export type LessonKind = "regla" | "gimnasio" | "tutora" | "prueba";

/** Un ejercicio hablado: situación (es) → lo que te preguntan (en) → estructuras a usar. */
export interface PlanDrill {
  situation: string;
  prompt: string;
  /** Estructuras que la respuesta debería usar bien (las evalúa el modelo). */
  targets: string[];
  targetSec: number;
}

export interface PlanExample {
  wrong: string;
  right: string;
  why: string;
}

export interface PlanUnit {
  key: PlanPattern;
  title: string;
  /** Una línea: la regla en corto. */
  subtitle: string;
  /** Por qué esta unidad: lo que se vio en tus sesiones. */
  why: string;
  rule: string[];
  /** Respaldo del quiz cuando tus errores reales de este patrón no alcanzan. */
  examples: PlanExample[];
  /** Frases modelo para decir en voz alta. */
  models: string[];
  drills: [PlanDrill, PlanDrill];
  test: PlanDrill;
  /** Lo que la tutora hace en la lección de voz (en inglés: es su idioma de trabajo). */
  tutor: { goal: string; opener: string };
  /** El corrector de las clases mide este patrón (la unidad de entrevista no sale de errores sueltos). */
  measured: boolean;
}

export const PLAN_UNITS: PlanUnit[] = [
  {
    key: "pasado",
    title: "Pasado en historias",
    subtitle: "Cuando cuentas algo que ya pasó, TODOS los verbos van en pasado.",
    why: "Es el error que más se repite: arrancas la historia en pasado y a la segunda frase vuelves al presente («then I share», «the metrics show», «I roll up the deployment»). En una entrevista suena a que el proyecto todavía no existe.",
    rule: [
      "Historia terminada = pasado en cada verbo principal, no solo en el primero: I checked → I found → I rolled back → it worked.",
      "Regulares con -ed (checked, deployed, tested); irregulares de memoria: broke, told, took, found, built, saw.",
      "Con «Not until… did I…» la primera parte también va en pasado: Not until I checked the logs did I realize…",
      "Truco: antes de contar, di en voz alta los verbos en pasado que vas a usar.",
    ],
    examples: [
      { wrong: "Then I share my perspective with data.", right: "Then I shared my perspective with data.", why: "Historia terminada: share → shared." },
      { wrong: "The metrics show that TypeScript reduced bugs.", right: "The metrics showed that TypeScript reduced bugs.", why: "Todo el relato va en pasado: show → showed." },
      { wrong: "I roll back the deployment and rework the script.", right: "I rolled back the deployment and reworked the script.", why: "Cada verbo de la anécdota lleva pasado." },
      { wrong: "Not until I check the logs did I realize the bug.", right: "Not until I checked the logs did I realize the bug.", why: "«did» no se lleva el pasado de la primera parte." },
    ],
    models: [
      "Last month we had a bug in production: users couldn't add items to their cart.",
      "I checked the logs, found the root cause and rolled back the deployment.",
      "Then I fixed the migration script, tested it in staging and deployed it again.",
    ],
    drills: [
      {
        situation: "Tu entrevistador te pide la historia de un bug real en producción.",
        prompt: "Tell me about a bug you fixed in production. What happened and what did you do?",
        targets: ["had", "checked", "found", "rolled back", "fixed", "deployed"],
        targetSec: 60,
      },
      {
        situation: "Tu jefe quiere saber cómo te fue la semana pasada.",
        prompt: "What did you work on last week, and what did you learn?",
        targets: ["worked on", "built", "learned", "finished", "decided"],
        targetSec: 60,
      },
    ],
    test: {
      situation: "Prueba de la unidad: una historia completa de principio a fin, sin resbalar al presente.",
      prompt: "Tell me about a project you're proud of: how it started, what you built and how it ended.",
      targets: ["started", "built", "took", "solved", "shipped", "learned"],
      targetSec: 90,
    },
    tutor: {
      goal: "Make him narrate three past stories (a production bug, his last week, how he started programming). Correct EVERY verb that slips into the present and have him repeat the sentence in the past.",
      opener: "Let's practice telling stories in the past tense.",
    },
    measured: true,
  },
  {
    key: "tercera-s",
    title: "La -s de tercera persona",
    subtitle: "it, the system, anyone, the user → el verbo lleva -s.",
    why: "Aparece sobre todo cuando describes un sistema: «it's handle», «a window that store tags», «anyone have». Sujetos como anyone, everyone o the team son singulares.",
    rule: [
      "he / she / it / the system / the user + verbo con -s: it handles, it stores, the user jumps.",
      "anyone, everyone, someone y nobody son SINGULARES: everyone has, anyone thinks.",
      "Nunca «it's + verbo»: it's handle ❌ → it handles ✅. «It's» va con sustantivo o adjetivo: it's a trade-off.",
      "En pregunta y negación la -s pasa al auxiliar: does it work? · she doesn't know.",
      "En plural no hay -s: people have, companies don't.",
    ],
    examples: [
      { wrong: "It's handle task automation and context management.", right: "It handles task automation and context management.", why: "it + verbo con -s; «it's» no va antes de un verbo." },
      { wrong: "Everyone have a different idea of AI.", right: "Everyone has a different idea of AI.", why: "everyone es singular." },
      { wrong: "She don't know how it works.", right: "She doesn't know how it works.", why: "she → doesn't." },
      { wrong: "Any task that require multiple steps.", right: "Any task that requires multiple steps.", why: "task es singular → requires." },
    ],
    models: [
      "The agent tracks the process and remembers the context between steps.",
      "When a user jumps between tasks, the state machine stores the previous state.",
      "Everyone on the team has access, but nobody needs to touch the config.",
    ],
    drills: [
      {
        situation: "Te piden que expliques qué hace tu agente de IA.",
        prompt: "Describe what your AI agent does, step by step.",
        targets: ["it handles", "it tracks", "it remembers", "it suggests", "it stores"],
        targetSec: 45,
      },
      {
        situation: "Cuentas cómo trabaja alguien de tu equipo.",
        prompt: "Describe how a teammate works: what does she do every day?",
        targets: ["she starts", "she reviews", "she doesn't", "everyone has"],
        targetSec: 45,
      },
    ],
    test: {
      situation: "Prueba: un sistema entero descrito con sujetos singulares.",
      prompt: "Explain how your dashboard works to a new developer on the team.",
      targets: ["it shows", "the user opens", "the agent runs", "everyone sees", "it doesn't"],
      targetSec: 75,
    },
    tutor: {
      goal: "Ask him to describe systems, tools and people in the third person singular (his AI agent, a teammate, his favorite app). Correct every missing -s and every 'it's + verb'.",
      opener: "Let's practice the third person -s: it handles, she works.",
    },
    measured: true,
  },
  {
    key: "sujeto",
    title: "Sujeto siempre",
    subtitle: "La frase nunca arranca con el verbo: it, there, he, the method…",
    why: "Calco directo del español: «for me is radical», «I think is enough», «was a good experience». Pasa justo cuando opinas, que es cuando más se nota.",
    rule: [
      "Toda frase lleva sujeto, aunque sea obvio: It is important · It was a good experience · There are many options.",
      "«For me is…» ❌ → «For me, the method is…» o «In my opinion, it is…» ✅.",
      "Depende = It depends on… · Hay = There is / There are · Es difícil = It's hard to…",
      "«What I enjoy most about my work is…»: el sujeto es toda la frase con what.",
      "Sin sujeto doble: «It's breakfast is» ❌ → «Breakfast is» ✅.",
    ],
    examples: [
      { wrong: "For me is radical.", right: "For me, he is radical.", why: "Falta el sujeto (he)." },
      { wrong: "I think is enough.", right: "I think it is enough.", why: "I think + it is." },
      { wrong: "Depends if you prefer the coast.", right: "It depends on whether you prefer the coast.", why: "«It depends on…», con sujeto." },
      { wrong: "I enjoy most about my work is the people.", right: "What I enjoy most about my work is the people.", why: "El sujeto es «what I enjoy most»." },
    ],
    models: [
      "In my opinion, it is too early to decide.",
      "There are two options, and it depends on the budget.",
      "What I enjoy most about my work is solving real problems.",
    ],
    drills: [
      {
        situation: "En una junta te piden tu opinión sobre una decisión técnica.",
        prompt: "Should we rewrite the app or keep improving it? Give your opinion.",
        targets: ["In my opinion, it is", "It depends on", "There are", "It would be"],
        targetSec: 45,
      },
      {
        situation: "Te preguntan qué te gusta y qué cambiarías de tu trabajo.",
        prompt: "What do you enjoy most about your work, and what would you change?",
        targets: ["What I enjoy most is", "It is", "There is", "It was"],
        targetSec: 45,
      },
    ],
    test: {
      situation: "Prueba: opinar 90 segundos sin una sola frase sin sujeto.",
      prompt: "Is AI going to replace software engineers? Give your opinion with reasons.",
      targets: ["In my opinion, it", "There are", "It depends on", "It will", "What worries me is"],
      targetSec: 90,
    },
    tutor: {
      goal: "Ask for his OPINION on three topics (a tech decision, AI, life in his city). Every time a sentence starts without a subject ('is important', 'for me is'), stop him and have him repeat it with the subject.",
      opener: "Let's practice giving opinions with a subject in every sentence.",
    },
    measured: true,
  },
  {
    key: "preposiciones",
    title: "Verbo + preposición",
    subtitle: "Se aprenden pegadas: work on, rely on, depend on, respond to, on the internet.",
    why: "La preposición se traduce del español: «working in this feature», «depends of», «rely for», «information in internet». Viene desde la primera sesión.",
    rule: [
      "work on · focus on · rely on · depend on · agree on · take on (no in, of ni for).",
      "respond to · listen to · talk to · introduce you to · communicate with each other.",
      "on the internet · on the market · on my own · on Instagram (no in).",
      "Números grandes sin of: a billion parameters · 10,000 likes (pero millions of users).",
      "Sin preposición: question it · discuss it (no «question about it»).",
    ],
    examples: [
      { wrong: "I have been working in this feature.", right: "I have been working on this feature.", why: "work on." },
      { wrong: "It depends of the capacity.", right: "It depends on the capacity.", why: "depend on." },
      { wrong: "I found it in internet.", right: "I found it on the internet.", why: "on the internet." },
      { wrong: "When I was responding a question.", right: "When I was responding to a question.", why: "respond to." },
      { wrong: "It has a billion of parameters.", right: "It has a billion parameters.", why: "billion sin of." },
    ],
    models: [
      "I've been working on the memory system and focusing on latency.",
      "We rely on a queue, and the speed depends on the cache.",
      "Let me introduce you to the team: we communicate with each other every day.",
    ],
    drills: [
      {
        situation: "Daily standup: cuentas en qué estás.",
        prompt: "Give your standup update: what are you working on, and what does it depend on?",
        targets: ["working on", "focusing on", "depends on", "rely on", "waiting for"],
        targetSec: 45,
      },
      {
        situation: "Le presentas un producto a un cliente.",
        prompt: "Introduce your product to a client in 45 seconds.",
        targets: ["introduce you to", "on the market", "on the internet", "communicate with"],
        targetSec: 45,
      },
    ],
    test: {
      situation: "Prueba: una explicación donde cada verbo lleva su preposición.",
      prompt: "Explain how your team works together and what your project depends on.",
      targets: ["work on", "rely on", "depend on", "talk to", "agree on", "on my own"],
      targetSec: 75,
    },
    tutor: {
      goal: "Steer the conversation to his work (standups, his team, his tools) so he needs verb + preposition combos: work on, rely on, depend on, respond to, agree on, on the internet. Correct every wrong preposition and have him repeat the sentence.",
      opener: "Let's practice verbs with their prepositions: work on, rely on, depend on.",
    },
    measured: true,
  },
  {
    key: "articulos",
    title: "Artículos, plurales y contables",
    subtitle: "a/the donde toca, -s en los plurales, much/many y those.",
    why: "Se cae la palabra pequeña: «complete purchase on platform», «the three option», «too many confidence», «access to the healthcare». El español te deja omitirla, o te sobra el «the».",
    rule: [
      "Sustantivo contable singular siempre con a/an/the: a purchase · the platform · a senior engineer.",
      "Incontables en general SIN the: education, healthcare, information, software, life, news.",
      "Después de un número o una cantidad, plural: three options · millions of records · a high volume of notifications.",
      "much + incontable (much confidence) · many + plural (many users).",
      "that → those en plural: those accounts · those kinds of changes.",
    ],
    examples: [
      { wrong: "Users couldn't complete purchase on platform.", right: "Users couldn't complete a purchase on the platform.", why: "Contable singular → a / the." },
      { wrong: "The three option that you said.", right: "The three options that you said.", why: "Número → plural." },
      { wrong: "Access to the healthcare is a right.", right: "Access to healthcare is a right.", why: "Incontable en general: sin the." },
      { wrong: "Too many confidence.", right: "Too much confidence.", why: "confidence es incontable → much." },
      { wrong: "Those kind of changes.", right: "Those kinds of changes.", why: "those + plural." },
    ],
    models: [
      "We handle a high volume of notifications from millions of users.",
      "Education and healthcare matter, and software can help with both.",
      "I see myself as a more senior engineer in two years.",
    ],
    drills: [
      {
        situation: "Describes la escala de un sistema que construiste.",
        prompt: "Describe the scale of a system you built: users, data and traffic.",
        targets: ["millions of users", "a database", "the platform", "thousands of requests"],
        targetSec: 45,
      },
      {
        situation: "Opinas sobre un tema social.",
        prompt: "Why do education and healthcare matter for your generation?",
        targets: ["education", "healthcare", "information", "those kinds of", "much"],
        targetSec: 45,
      },
    ],
    test: {
      situation: "Prueba: contables, incontables y cantidades bien puestos.",
      prompt: "Describe your ideal job: the company, the team and the projects.",
      targets: ["a company", "the team", "many projects", "much freedom", "those kinds of"],
      targetSec: 75,
    },
    tutor: {
      goal: "Talk about quantities, products and general topics (the scale of his systems, shopping, education). Correct missing a/the, an extra 'the' before uncountable nouns, missing plurals and much/many.",
      opener: "Let's practice articles and plurals: a, the, much, many.",
    },
    measured: true,
  },
  {
    key: "forma-palabra",
    title: "La palabra exacta",
    subtitle: "Sustantivo, adjetivo o adverbio: growth, differently, security, concerns.",
    why: "Armas la palabra por lógica del español o por cómo suena: «personal grow», «I think different», «they're really technician», «presenting my corners» (concerns). Es la fuga que más claridad te quita.",
    rule: [
      "Después de un posesivo va sustantivo: my growth · your security · our confidence.",
      "Para decir CÓMO, adverbio: think differently · work efficiently.",
      "Falsos amigos: sensible = sensitive · actual = real o current · technician es la persona (technical = técnico).",
      "Palabras de entrevista: concerns /kənˈsɜːrnz/, trade-off, root cause, break down the problem, carry out.",
      "Si dudas, pausa dos segundos y parafrasea: mejor eso que una palabra aproximada por sonido.",
    ],
    examples: [
      { wrong: "It helps your personal grow.", right: "It helps your personal growth.", why: "Posesivo + sustantivo: growth." },
      { wrong: "I think different.", right: "I think differently.", why: "Cómo piensas → adverbio." },
      { wrong: "They're really technician.", right: "They're really technical.", why: "technician es la persona." },
      { wrong: "I presented my corners.", right: "I presented my concerns.", why: "concerns = preocupaciones." },
      { wrong: "My stomach is very sensible.", right: "My stomach is very sensitive.", why: "Falso amigo: sensible = sensato." },
    ],
    models: [
      "I raised my concerns and we discussed the trade-offs.",
      "Let me break down the problem: the root cause was the cache.",
      "Working abroad would be great for my career growth.",
    ],
    drills: [
      {
        situation: "Te piden contar un desacuerdo técnico.",
        prompt: "Tell me about a time you disagreed with a teammate. How did you raise your concerns?",
        targets: ["concerns", "trade-off", "differently", "root cause"],
        targetSec: 60,
      },
      {
        situation: "Hablas de tu crecimiento profesional.",
        prompt: "What would help your career growth the most in the next two years?",
        targets: ["growth", "security", "confidence", "efficiently"],
        targetSec: 45,
      },
    ],
    test: {
      situation: "Prueba: una respuesta técnica con el vocabulario exacto.",
      prompt: "Walk me through how you would break down a complex problem at work.",
      targets: ["break down", "root cause", "trade-offs", "concerns", "carry out"],
      targetSec: 75,
    },
    tutor: {
      goal: "Focus on word forms and exact vocabulary: noun vs adjective vs adverb (growth, security, differently, technical) and interview keywords (concerns, trade-off, root cause, break down). When he approximates a word by its sound, give him the exact word, have him use it in a sentence and save it with save_vocab.",
      opener: "Let's practice word forms and the exact words for interviews.",
    },
    measured: true,
  },
  {
    key: "estructura",
    title: "Orden y forma del verbo",
    subtitle: "Preguntas indirectas, need you to, avoid -ing e inversión.",
    why: "Cuando la frase se complica se cuela el orden del español: «what is the best approach» dentro de otra frase, «I need that you», «avoid to talk», «Never I have seen». En el ejercicio lo sabes; falla en el primer intento hablando.",
    rule: [
      "Pregunta indirecta = orden de afirmación: I know what you're thinking · I explained what the problem was.",
      "need / want / ask + persona + to: I need you to review it (nunca «need that»).",
      "suggest / recommend + that + sujeto: She suggested that I refactor it.",
      "avoid / keep / finish / enjoy + -ing · prefer / decide / plan + to: avoid talking · prefer to be specific.",
      "Inversión para dar énfasis: Never have I seen… · Not until… did I… · Should it fail, …",
    ],
    examples: [
      { wrong: "I showed them what is the best approach.", right: "I showed them what the best approach is.", why: "Indirecta: el sujeto va antes del verbo." },
      { wrong: "I need that you tell me the plan.", right: "I need you to tell me the plan.", why: "need + persona + to." },
      { wrong: "How can I avoid to talk too much?", right: "How can I avoid talking too much?", why: "avoid + -ing." },
      { wrong: "Never I have seen anything like that.", right: "Never have I seen anything like that.", why: "Inversión: auxiliar antes del sujeto." },
      { wrong: "She suggested me to refactor.", right: "She suggested that I refactor.", why: "suggest that + sujeto." },
    ],
    models: [
      "I explained to the PM why the model was overfitting.",
      "I need you to review the pull request before Friday.",
      "Not until we checked the logs did we see the real problem.",
    ],
    drills: [
      {
        situation: "Le explicas a alguien no técnico qué salió mal.",
        prompt: "Explain to a non-technical manager what went wrong in a project and what you need from them.",
        targets: ["what the problem was", "why it failed", "I need you to", "I'd suggest that we"],
        targetSec: 60,
      },
      {
        situation: "Le das consejos a alguien que empieza a programar.",
        prompt: "What should a junior developer avoid doing, and what should they keep doing?",
        targets: ["avoid", "keep", "I'd recommend that", "prefer to"],
        targetSec: 45,
      },
    ],
    test: {
      situation: "Prueba: énfasis con inversión y preguntas indirectas bien ordenadas.",
      prompt: "Tell me about the hardest lesson you learned at work. Use at least two inversions.",
      targets: ["Never have I", "Not until", "did I realize", "what the problem was"],
      targetSec: 90,
    },
    tutor: {
      goal: "Drill embedded questions (I know what you're thinking), need/want + person + to, suggest that, verb + -ing vs to, and inversion (Never have I…, Not until… did I…). Ask questions that force those structures; when the order is wrong, have him say it right on the first try.",
      opener: "Let's practice word order: indirect questions and inversions.",
    },
    measured: true,
  },
  {
    key: "entrevista",
    title: "Entrevista en inglés",
    subtitle: "Respuestas STAR de 60-90 s, concisas, sin «so yeah» y sin pasarte al español.",
    why: "Tu profe marcó «too long, not concise enough», cierras con «so yeah», abres casi todo con «Yeah,» y en las prácticas te pasas al español cuando te trabas. El contenido técnico ya está: falta la forma.",
    rule: [
      "STAR: Situation → Task → Action → Result, con un número en el resultado.",
      "Abre con el punto, no con «Yeah»: «The biggest challenge was…».",
      "Para ganar tiempo: «That's a good question — let me think for a second.» · «Let me rephrase that.»",
      "Cierra fuerte: «…and that's how I solved it.» (no «so yeah»).",
      "Si no te ha pasado: «I haven't been in that situation yet, but if it happened, I would…»",
    ],
    examples: [
      { wrong: "Yeah, so, we had a bug and… so yeah.", right: "We had a critical bug in checkout, and that's how I solved it.", why: "Sin «yeah» al abrir ni al cerrar." },
      { wrong: "¿Cómo se dice…? Bueno, I…", right: "Let me rephrase that: I…", why: "El puente va en inglés, nunca en español." },
      { wrong: "I never had that problem.", right: "I haven't been in that situation yet, but if it happened, I would…", why: "El molde para lo que no te ha pasado." },
      { wrong: "Uh… I don't know… maybe…", right: "That's a good question — let me think for a second.", why: "Pausa con una frase, no con muletillas." },
    ],
    models: [
      "The biggest challenge was a checkout bug that blocked fifteen percent of orders.",
      "I traced it to the migration, rolled it back and fixed the script in two hours.",
      "Orders went back to normal, and we added a test so it doesn't happen again.",
    ],
    drills: [
      {
        situation: "Pregunta clásica de entrevista técnica.",
        prompt: "Tell me about a technically challenging problem you solved.",
        targets: ["The challenge was", "I decided to", "As a result", "that's how I solved it"],
        targetSec: 60,
      },
      {
        situation: "Pregunta de comportamiento.",
        prompt: "Tell me about a time you disagreed with your manager.",
        targets: ["The situation was", "I raised my concerns", "We agreed on", "In the end"],
        targetSec: 60,
      },
    ],
    test: {
      situation: "Prueba: una respuesta STAR completa, de 60 a 90 segundos, sin muletillas de cierre.",
      prompt: "Why should we hire you for a senior engineer role? Give a concrete example.",
      targets: ["I have", "For example", "As a result", "that's why"],
      targetSec: 90,
    },
    tutor: {
      goal: "Run a short mock interview (three questions: a technical challenge, a conflict, why hire you). Demand STAR answers of 60-90 seconds with a number in the result. Flag 'Yeah' at the start, 'so yeah' at the end and any switch to Spanish; give feedback on content AND English after each answer.",
      opener: "Let's do a mock interview from my study plan.",
    },
    measured: false,
  },
];

export function planUnit(key: string): PlanUnit | undefined {
  return PLAN_UNITS.find((u) => u.key === key);
}

// ── Lecciones ──────────────────────────────────────────────────────────

export interface PlanLesson {
  id: string;
  unit: PlanPattern;
  kind: LessonKind;
  title: string;
  /** Solo gimnasio y prueba. */
  drill?: PlanDrill;
}

/** Las cinco lecciones de una unidad, en orden. */
export function unitLessons(u: PlanUnit): PlanLesson[] {
  return [
    { id: `${u.key}-regla`, unit: u.key, kind: "regla", title: "La regla con tus errores" },
    { id: `${u.key}-gym1`, unit: u.key, kind: "gimnasio", title: "Gimnasio", drill: u.drills[0] },
    { id: `${u.key}-tutora`, unit: u.key, kind: "tutora", title: "Con la tutora" },
    { id: `${u.key}-gym2`, unit: u.key, kind: "gimnasio", title: "Gimnasio", drill: u.drills[1] },
    { id: `${u.key}-prueba`, unit: u.key, kind: "prueba", title: "Prueba de la unidad", drill: u.test },
  ];
}

export const PLAN_LESSONS: PlanLesson[] = PLAN_UNITS.flatMap(unitLessons);

export function planLesson(id: string): PlanLesson | undefined {
  return PLAN_LESSONS.find((l) => l.id === id);
}

/** Nota mínima para aprobar (regla = % de aciertos del quiz). */
export const PASS_SCORE: Record<LessonKind, number> = {
  regla: 70,
  gimnasio: 70,
  tutora: 0,
  prueba: 80,
};

/** XP del primer aprobado; repetir una lección aprobada da REPEAT_XP. */
export const LESSON_XP: Record<LessonKind, number> = { regla: 10, gimnasio: 15, tutora: 25, prueba: 30 };
export const REPEAT_XP = 5;
/** Meta diaria: ~una lección de voz o dos cortas. */
export const PLAN_DAILY_XP = 30;
/** Una práctica con la tutora cuenta como lección si dura al menos esto. */
export const TUTOR_MIN_SEC = 180;

// ── Intentos y progreso ────────────────────────────────────────────────

export interface PlanDrillError {
  quote: string;
  correction: string;
  note_es?: string;
}

export interface PlanDrillResult {
  score: number;
  /** Estructuras objetivo que usó BIEN. */
  targetsUsed: string[];
  errors: PlanDrillError[];
  /** Su respuesta dicha mejor, en inglés, lista para decirse tal cual. */
  better: string;
  /** Una instrucción para el siguiente intento (es). */
  tip: string;
}

export interface PlanAttempt {
  id: string;
  lessonId: string;
  kind: LessonKind;
  /** AAAA-MM-DD en la zona del dueño. */
  date: string;
  score: number;
  passed: boolean;
  createdAt: string;
  quiz?: { correct: number; total: number };
  drill?: PlanDrillResult & { transcript: string; durationSec: number; words: number };
  tutor?: { sessionId: number; durationSec: number; patternErrors: number; totalErrors: number };
}

export type LessonStatus = "done" | "skipped" | "current" | "available" | "locked";

export interface LessonView {
  lesson: PlanLesson;
  status: LessonStatus;
  best: number | null;
  attempts: number;
}

export interface UnitView {
  key: PlanPattern;
  lessons: LessonView[];
  /** Lecciones hechas (o saltadas con la prueba). */
  done: number;
  mastered: boolean;
}

/**
 * Estado de la ruta. Regla de avance: una lección se abre cuando la anterior
 * está hecha; la prueba de cada unidad está siempre abierta y aprobarla da por
 * hecha la unidad entera. "current" = la primera lección pendiente.
 */
export function planView(attempts: Pick<PlanAttempt, "lessonId" | "score" | "passed">[]): {
  units: UnitView[];
  current: string | null;
} {
  const passed = new Set(attempts.filter((a) => a.passed).map((a) => a.lessonId));
  const best = new Map<string, number>();
  const count = new Map<string, number>();
  for (const a of attempts) {
    best.set(a.lessonId, Math.max(best.get(a.lessonId) ?? 0, a.score));
    count.set(a.lessonId, (count.get(a.lessonId) ?? 0) + 1);
  }
  const mastered = (u: PlanPattern) => passed.has(`${u}-prueba`);
  const doneish = (l: PlanLesson) => passed.has(l.id) || mastered(l.unit);
  const current = PLAN_LESSONS.find((l) => !doneish(l))?.id ?? null;
  const currentIdx = current ? PLAN_LESSONS.findIndex((l) => l.id === current) : PLAN_LESSONS.length;

  const units = PLAN_UNITS.map((u) => {
    const lessons = unitLessons(u).map((lesson): LessonView => {
      const idx = PLAN_LESSONS.findIndex((l) => l.id === lesson.id);
      const status: LessonStatus = passed.has(lesson.id)
        ? "done"
        : mastered(u.key)
          ? "skipped"
          : lesson.id === current
            ? "current"
            : idx < currentIdx || lesson.kind === "prueba"
              ? "available"
              : "locked";
      return {
        lesson,
        status,
        best: best.has(lesson.id) ? best.get(lesson.id)! : null,
        attempts: count.get(lesson.id) ?? 0,
      };
    });
    return {
      key: u.key,
      lessons,
      done: lessons.filter((l) => l.status === "done" || l.status === "skipped").length,
      mastered: mastered(u.key),
    };
  });
  return { units, current };
}

/** XP total y por día: el primer aprobado de cada lección vale su base, cada repetición aprobada REPEAT_XP. */
export function planXp(
  attempts: Pick<PlanAttempt, "lessonId" | "kind" | "passed" | "date" | "createdAt">[],
): { total: number; byDate: Record<string, number> } {
  const seen = new Set<string>();
  const byDate: Record<string, number> = {};
  let total = 0;
  for (const a of [...attempts].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    if (!a.passed) continue;
    const xp = seen.has(a.lessonId) ? REPEAT_XP : LESSON_XP[a.kind];
    seen.add(a.lessonId);
    total += xp;
    byDate[a.date] = (byDate[a.date] ?? 0) + xp;
  }
  return { total, byDate };
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Días seguidos con al menos una lección aprobada, desde hoy (o desde ayer si hoy aún no). */
export function planStreak(attempts: Pick<PlanAttempt, "passed" | "date">[], today: string): number {
  const days = new Set(attempts.filter((a) => a.passed).map((a) => a.date));
  let d = days.has(today) ? today : shiftDate(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = shiftDate(d, -1);
  }
  return n;
}

/** Últimos `n` días (de más viejo a hoy) con su XP: el calendario del riel. */
export function planDays(byDate: Record<string, number>, today: string, n = 14): { date: string; xp: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const date = shiftDate(today, i - (n - 1));
    return { date, xp: byDate[date] ?? 0 };
  });
}

// ── Errores reales → patrones ──────────────────────────────────────────

export interface SessionErrorsLike {
  id: number;
  started_at: string;
  source: string;
  errors: { quote: string; correction: string; note_es?: string }[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const PREP = "(?:in|on|at|to|for|with|of|about|from)";

/**
 * A qué patrón pertenece un error anotado. Lee la nota del corrector (siempre
 * en español) y, de respaldo, la corrección. El orden importa: lo específico
 * primero. Devuelve null si no lo reconoce (o es un error del STT) — mejor no
 * contar que contar mal.
 */
export function classifyError(e: { quote: string; correction: string; note_es?: string }): PlanPattern | null {
  return patternHits(e)[0] ?? null;
}

/**
 * TODOS los patrones que reconoce la nota, en orden de prioridad. Una nota que
 * cae en dos ("pasado 'said' + plural 'options'") cuenta para el primero en las
 * métricas, pero no sirve de pregunta en el quiz: mezcla dos reglas.
 */
export function patternHits(e: { quote: string; correction: string; note_es?: string }): PlanPattern[] {
  const n = norm(e.note_es ?? "");
  if (/\bstt\b|transcripci/.test(n)) return [];
  const hits: PlanPattern[] = [];
  if (/sujeto (omitido|duplicado|explicito|faltante)|falta(n)? (el )?sujeto|falta sujeto|necesita sujeto|sin sujeto|sujeto \+ verbo/.test(n))
    hits.push("sujeto");
  if (
    /tercera persona|3a persona|sujeto singular|verbo singular|\(singular\)/.test(n) ||
    (/concordancia/.test(n) && !/adjetivo|sintaxis/.test(n))
  )
    hits.push("tercera-s");
  if (/pasado|preterito|tiempo verbal|consistencia de tiempo|\bpast\b/.test(n)) hits.push("pasado");
  if (
    /inversi|gerundio|infinitivo|pregunta indirecta|orden|objeto indirecto|negaci|estructura|condicional|unless|requiere verbo|necesita objeto|\+ (verbo|infinitivo|gerundio|-ing)|-ing/.test(
      n,
    )
  )
    hits.push("estructura");
  if (
    /preposici/.test(n) ||
    new RegExp(`["“']${PREP}["”'] → ["“']${PREP}["”']`).test(n) ||
    new RegExp(`\\bse usa ${PREP}\\b|\\b${PREP},? no ${PREP}\\b|no lleva ["“']?${PREP}\\b`).test(n)
  )
    hits.push("preposiciones");
  if (/articulo|incontable|contable|plural|\bmuch\b|\bmany\b|demostrativo|\bthose\b/.test(n)) hits.push("articulos");
  if (
    /falso amigo|no es idiomatic|sustantivo|adjetivo|adverbio|es (un )?verbo|no existe|significa|no es (una )?palabra|palabra correcta|es una persona|razonable|["'][a-z-]+["'] = /.test(
      n,
    )
  )
    hits.push("forma-palabra");
  return hits;
}

/** Cuántos errores de cada patrón trae una sesión. */
export function patternCounts(errors: SessionErrorsLike["errors"]): Partial<Record<PlanPattern, number>> {
  const out: Partial<Record<PlanPattern, number>> = {};
  for (const e of errors) {
    const p = classifyError(e);
    if (p) out[p] = (out[p] ?? 0) + 1;
  }
  return out;
}

export interface PatternPoint {
  date: string;
  sessionId: number;
  count: number;
}

/**
 * Cómo va cada patrón en tus CLASES reales (de más vieja a más nueva, las
 * últimas `n`). Solo clases con errores anotados: sin anotaciones no hubo
 * corrector (falló el audio), y pintarla como 0 sería mentir.
 */
export function classTrend(sessions: SessionErrorsLike[], n = 6): Record<PlanPattern, PatternPoint[]> {
  const classes = sessions
    .filter((s) => s.source === "class" && s.errors.length > 0)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .slice(-n);
  const out = Object.fromEntries(PLAN_UNITS.map((u) => [u.key, [] as PatternPoint[]])) as Record<
    PlanPattern,
    PatternPoint[]
  >;
  for (const s of classes) {
    const counts = patternCounts(s.errors);
    for (const u of PLAN_UNITS)
      if (u.measured) out[u.key].push({ date: s.started_at.slice(0, 10), sessionId: s.id, count: counts[u.key] ?? 0 });
  }
  return out;
}

/** En cuántas sesiones (de cualquier tipo) apareció cada patrón. */
export function patternReach(sessions: SessionErrorsLike[]): Record<PlanPattern, number> {
  const out = Object.fromEntries(PLAN_UNITS.map((u) => [u.key, 0])) as Record<PlanPattern, number>;
  for (const s of sessions) for (const p of Object.keys(patternCounts(s.errors)) as PlanPattern[]) out[p]++;
  return out;
}

// ── Quiz de la regla ───────────────────────────────────────────────────

export interface QuizItem {
  id: string;
  wrong: string;
  right: string;
  why: string;
  /** "Clase · 20 oct" si salió de tus sesiones; null = ejemplo del temario. */
  source: string | null;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const tidy = (s: string) =>
  s
    // Arranques cortados del transcript: "I was— I— when…" se queda con lo que
    // sigue al último corte; "I am s- outside" pierde solo la sílaba suelta.
    .replace(/^.*[—–]\s+/, "")
    .replace(/(^|\s)[\w']+-(?=\s)/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^((yeah|uh|um|so|well|of course)[,.]?\s+)+/i, "")
    .trim();
const bare = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "");

/** true = mostrar primero la opción correcta (orden estable por item, sin azar entre renders). */
export function rightFirst(item: Pick<QuizItem, "id">): boolean {
  return hash(item.id) % 2 === 0;
}

/**
 * Las preguntas del quiz: primero TUS errores reales de este patrón (los más
 * recientes, cortos y con corrección distinta), y si no alcanzan, los
 * ejemplos del temario.
 */
export function quizItemsFor(unit: PlanUnit, sessions: SessionErrorsLike[], max = 5, min = 4): QuizItem[] {
  const items: QuizItem[] = [];
  const seen = new Set<string>();
  const sorted = [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at));
  for (const s of sorted) {
    for (const e of s.errors) {
      if (items.length >= max) break;
      const hits = patternHits(e);
      if (hits.length !== 1 || hits[0] !== unit.key) continue;
      const wrong = tidy(e.quote);
      const right = tidy(e.correction);
      if (wrong.length < 8 || wrong.length > 90 || right.length > 110) continue;
      if (bare(wrong) === bare(right) || /→|\|/.test(right)) continue;
      const key = bare(right);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `${unit.key}-s${s.id}-${hash(key).toString(36)}`,
        wrong,
        right,
        why: e.note_es?.trim() || "",
        source: `${s.source === "class" ? "Clase" : "Práctica"} · ${shortDate(s.started_at)}`,
      });
    }
  }
  for (const [i, ex] of unit.examples.entries()) {
    if (items.length >= min) break;
    if (seen.has(bare(ex.right))) continue;
    items.push({ id: `${unit.key}-ex${i}`, ...ex, source: null });
  }
  return items;
}

// ── La tutora en modo lección ──────────────────────────────────────────

/**
 * Bloque para {{practice_context}} cuando la práctica es una lección del plan.
 * Va ANTES del contexto normal: es lo que manda en esta sesión.
 */
export function tutorLessonBlock(unit: PlanUnit, realErrors: string[]): string {
  return [
    `THIS SESSION IS A STUDY-PLAN LESSON — unit "${unit.title}" (${unit.key}). Run it, do not just chat.`,
    `Goal: ${unit.tutor.goal}`,
    `The rule he is training (explain it in Spanish only if he asks): ${unit.rule.join(" ")}`,
    realErrors.length ? `His REAL errors of this pattern from classes and practice: ${realErrors.join(" · ")}.` : "",
    `Model sentences: ${unit.models.join(" ")}`,
    "Focus corrections ONLY on this pattern (let other slips go unless they block meaning). After about 5 minutes, or once he has used the structure correctly 5+ times in a row, wrap up: 30 seconds of feedback, then call end_practice_session as usual.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Primer turno que el cliente manda por él (el saludo de la tutora es fijo). */
export function tutorLessonOpening(unit: PlanUnit): string {
  return `I'm starting a lesson from my study plan: "${unit.title}". ${unit.tutor.opener} Please run the lesson.`;
}

// ── Lo que viaja al dashboard ──────────────────────────────────────────

export interface EnglishPlanPayload {
  today: string;
  units: UnitView[];
  current: string | null;
  xp: { total: number; today: number; goal: number };
  streak: number;
  days: { date: string; xp: number }[];
  trend: Record<PlanPattern, PatternPoint[]>;
  reach: Record<PlanPattern, number>;
  sessionsCount: number;
  quizzes: Record<PlanPattern, QuizItem[]>;
  /** Lección con la tutora en curso (esperando que se guarde la práctica). */
  pendingTutor: { lessonId: string; since: string } | null;
  recent: PlanAttempt[];
}
