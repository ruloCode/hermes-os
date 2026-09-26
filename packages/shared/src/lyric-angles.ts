/**
 * ÁNGULOS DE LETRA — "componer 10 temas y con partes de esos armar el mío"
 * solo sirve si las versiones son DISTINTAS de verdad. Pedirle al modelo "5
 * versiones" da cinco variaciones de la misma idea; asignarle a cada versión
 * un ángulo explícito (qué forma toma la letra) las separa. El humano elige y
 * mezcla; el ángulo es la razón por la que dos versiones no se parecen.
 */
import type { Genre } from "./tema.js";

export interface LyricAngle {
  id: string;
  label: string;
  /** Lo que se le pide al modelo, en una frase. */
  brief: string;
  /** Géneros donde este ángulo es natural (vacío = todos). */
  genres?: Genre[];
}

export const LYRIC_ANGLES: LyricAngle[] = [
  {
    id: "pregon",
    label: "Pregón pregunta-respuesta",
    brief: "Una voz lanza la frase y la respuesta repite o contesta corto: pegajoso, para corear.",
    genres: ["dancehall", "reggaeton", "pop-urbano"],
  },
  { id: "imagen", label: "Imagen concreta", brief: "Una escena o un objeto que se VE; nada de explicar el sentimiento." },
  { id: "confesion", label: "Confesión", brief: "Primera persona, lo que no se ha dicho en voz alta, sin adornos." },
  { id: "dialogo", label: "Diálogo", brief: "Le habla a alguien de tú a tú, como un mensaje o una llamada." },
  { id: "doble-sentido", label: "Doble sentido", brief: "Una frase que se lee de dos formas; la segunda lectura es la verdadera." },
  { id: "orgullo", label: "Orgullo", brief: "Desde la dignidad: lo que duele se dice con la cabeza en alto." },
  { id: "reproche", label: "Reproche", brief: "Directo y sin rodeos: lo que el otro hizo y cómo cayó." },
  { id: "promesa", label: "Promesa", brief: "Lo que va a pasar (o no va a volver a pasar), en futuro firme." },
  {
    id: "calle",
    label: "Calle / fiesta",
    brief: "Jerga, energía y movimiento; la frase se canta bailando.",
    genres: ["dancehall", "reggaeton", "pop-urbano"],
  },
  { id: "vulnerable", label: "Vulnerable", brief: "Pocas palabras, pausa y aire; la emoción la carga la melodía." },
  { id: "recuerdo", label: "Recuerdo", brief: "Un momento del pasado contado en presente, con un detalle sensorial." },
  { id: "estribillo-una-palabra", label: "Una palabra que manda", brief: "Una sola palabra se repite y cambia de sentido cada vez." },
];

/**
 * Elige `n` ángulos que todavía no se usaron en este pasaje, prefiriendo los
 * naturales del género. Determinista (mismo estado → mismos ángulos): así
 * "regenerar" no promete variedad al azar, promete ángulos NUEVOS.
 */
export function pickAngles(n: number, used: string[], genre?: Genre): LyricAngle[] {
  const fits = (a: LyricAngle) => !a.genres?.length || (genre ? a.genres.includes(genre) : true);
  const fresh = LYRIC_ANGLES.filter((a) => !used.includes(a.id));
  const ordered = [...fresh.filter(fits), ...fresh.filter((a) => !fits(a))];
  // Si ya se usaron todos, se vuelve a empezar (mejor repetir ángulo que no dar nada).
  const pool = ordered.length >= n ? ordered : [...ordered, ...LYRIC_ANGLES.filter((a) => !ordered.includes(a))];
  return pool.slice(0, Math.max(0, n));
}
