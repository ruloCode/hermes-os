// Lo que se dicen las personas del edificio entre ellas (puro). Dos tipos de
// frase:
//  - FIJAS: trivialidades sin un solo número ni dato (saludos, el café, la
//    gata, la vista). Tienen id estable: son las que pueden sonar con una voz
//    pregrabada.
//  - CON DATO: la hora, el clima, cuántos agentes trabajan o quién terminó.
//    Solo existen si el dato llega en el contexto (de una fuente real); si no,
//    la frase no se dice. Suenan con la voz del sistema de esa persona.
//
// Regla del dashboard: nada inventado. Una frase fija jamás lleva un dígito
// (los tests lo revisan) y una con dato solo repite lo que trae `ctx`.

import { mulberry32 } from "./office-ambient.js";

export interface ChatContext {
  /** Hora local "HH:MM" (siempre real). */
  time?: string;
  /** Temperatura actual de /weather, si existe y no está vieja. */
  tempC?: number;
  /** Agentes trabajando ahora (estado real de /office/events). */
  working?: number;
  /** Apodo de un agente que terminó hace poco. */
  doneNick?: string;
  /** Qué hacen donde se juntaron (café, sofá, ventana…) o "walk" si se cruzaron caminando. */
  place: string;
  /** La gata anda cerca. */
  cat?: boolean;
  /** Piso (0 equipos · 1 café · 2 azotea). */
  floor: number;
}

export interface ChatTurn {
  /** Índice del que habla dentro de la charla (0, 1 o 2). */
  speaker: number;
  text: string;
  /** "fixed": sin datos, tiene `line` · "data": lleva un dato real del contexto. */
  kind: "fixed" | "data";
  line?: string;
}

/** Frases fijas: id → texto. Sin números ni datos. */
export const CHAT_LINES: Record<string, string> = {
  hola: "¡Hola! ¿Cómo vas?",
  bien: "Bien, bien. ¿Y tú?",
  todo_bien: "Todo bien, aquí andamos.",
  quiubo: "¡Quiubo! Qué gusto verte.",
  igual: "Igual. ¿Qué más?",
  cafe_rico: "Qué rico huele ese café.",
  cafe_otro: "Voy por otro cafecito.",
  cafe_invito: "¿Te provoca un tinto?",
  cafe_dale: "¡Dale, de una!",
  cold_brew: "¿Ya probaste el cold brew?",
  todavia_no: "Todavía no, ¿está bueno?",
  buenisimo: "Buenísimo, pruébalo.",
  vista: "Qué buena vista desde aquí.",
  cerros: "Los cerros se ven divinos hoy.",
  si_verdad: "Sí, ¿verdad?",
  gata: "Esa gata se adueñó de la oficina.",
  gata_jefa: "Ella es la que manda aquí.",
  pingpong: "¿Una partida de ping-pong ahorita?",
  te_gano: "Te gano, ya verás.",
  jaja: "Jaja, ya veremos.",
  agentes: "Los agentes no paran hoy.",
  ni_un_cafe: "Y ni un café se toman.",
  sofa: "Este sofá está demasiado cómodo.",
  no_me_paro: "No me paro de aquí en un buen rato.",
  libro: "¿Qué estás leyendo?",
  uno_de_agentes: "Uno sobre agentes, buenísimo.",
  nos_vemos: "Bueno, nos vemos ahorita.",
  chao: "¡Chao, chao!",
  de_una: "De una.",
  bravo: "¡Bravo!",
  eso: "¡Eso!",
  bailando: "¡Uy, qué pasos!",
  wow: "¡Wow!",
};

/** Las frases con dato, armadas solo con lo que trae el contexto. */
function dataLines(ctx: ChatContext): { text: string; reply: string }[] {
  const out: { text: string; reply: string }[] = [];
  if (ctx.time) out.push({ text: `¿Ya viste? Son las ${ctx.time}.`, reply: "todo_bien" });
  if (typeof ctx.tempC === "number" && Number.isFinite(ctx.tempC)) out.push({ text: `Afuera hacen ${Math.round(ctx.tempC)} grados.`, reply: "si_verdad" });
  if (typeof ctx.working === "number" && ctx.working > 0)
    out.push({ text: ctx.working === 1 ? "Hay un agente trabajando abajo." : `Hay ${ctx.working} agentes trabajando abajo.`, reply: "ni_un_cafe" });
  if (ctx.doneNick) out.push({ text: `${ctx.doneNick} acaba de terminar su tarea.`, reply: "eso" });
  return out;
}

/** Temas fijos por lugar: [abre, responde, (cierra)]. */
const TOPICS: Record<string, string[][]> = {
  coffee: [
    ["cafe_rico", "cafe_otro"],
    ["cold_brew", "todavia_no", "buenisimo"],
    ["cafe_invito", "cafe_dale"],
  ],
  water: [["cafe_invito", "cafe_dale"]],
  snack: [["cafe_invito", "cafe_dale"]],
  sit: [["sofa", "no_me_paro"]],
  tv: [["sofa", "no_me_paro"]],
  books: [["libro", "uno_de_agentes"]],
  window: [["vista", "si_verdad"], ["cerros", "si_verdad"]],
  view: [["vista", "si_verdad"], ["cerros", "si_verdad"]],
  lights: [["vista", "si_verdad"]],
  board: [["agentes", "ni_un_cafe"]],
  pingpong: [["pingpong", "te_gano", "jaja"]],
  foosball: [["pingpong", "te_gano", "jaja"]],
  darts: [["pingpong", "te_gano", "jaja"]],
  arcade: [["pingpong", "te_gano", "jaja"]],
  walk: [["quiubo", "igual"], ["hola", "bien", "todo_bien"]],
};

/**
 * Una charla corta (3 a 5 turnos) entre `members` personas: saludo, un tema
 * del lugar (o un dato real, si hay) y despedida. Determinista con `seed`.
 */
export function chatScript(ctx: ChatContext, members: number, seed: number): ChatTurn[] {
  const rng = mulberry32(seed);
  const n = Math.max(2, Math.min(3, members));
  const turns: ChatTurn[] = [];
  let speaker = 0;
  const say = (line: string, who = speaker) => {
    turns.push({ speaker: who, text: CHAT_LINES[line], kind: "fixed", line });
    speaker = (who + 1) % n;
  };
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  // Saludo (si se cruzaron caminando, el tema ya es el saludo).
  if (ctx.place !== "walk") say(pick(["hola", "quiubo"]));
  const data = dataLines(ctx);
  const topics = TOPICS[ctx.place] ?? TOPICS.walk;
  if (ctx.cat && rng() < 0.5) {
    say("gata");
    say("gata_jefa");
  } else if (data.length && rng() < 0.45) {
    const d = pick(data);
    turns.push({ speaker, text: d.text, kind: "data" });
    speaker = (speaker + 1) % n;
    say(d.reply);
  } else for (const line of pick(topics)) say(line);
  // En un trío, el tercero también dice algo.
  if (n === 3 && !turns.some((t) => t.speaker === 2)) say(pick(["de_una", "jaja", "si_verdad"]), 2);
  if (rng() < 0.6) say(pick(["nos_vemos", "chao"]));
  return turns;
}

/** Reacción corta a algo que pasó (un agente terminó, el dueño baila): siempre fija. */
export function reactionLine(kind: "done" | "dance", seed: number): ChatTurn {
  const rng = mulberry32(seed);
  const pool = kind === "done" ? ["bravo", "eso", "wow"] : ["bailando", "wow", "jaja"];
  const line = pool[Math.floor(rng() * pool.length)];
  return { speaker: 0, text: CHAT_LINES[line], kind: "fixed", line };
}
