import type { ReactNode } from "react";
import type { DojoTrace } from "@hermes/shared";

/** Una ejecución del código del alumno y el paso que se está mirando. */
export interface LiveFrame {
  trace: Extract<DojoTrace, { phase: "done" }>;
  step: number;
  /** Nombre de la función del ejercicio (null en un programa suelto). */
  fn: string | null;
  /** Lo que el ejemplo espera que devuelva (repr de Python), si se sabe. */
  expected?: string;
  /** El código que se corrió (las líneas de la traza apuntan aquí, desde 1). */
  code: string;
}

/**
 * Una figura del Dojo para UNA lección: la máquina de su idea, alimentada con
 * los datos de ese ejercicio.
 *
 * `reveal` es la regla del Dojo hecha contrato: en un PROBLEMA, mientras no lo
 * pasas ni te rindes, la máquina muestra el problema (qué entra, qué sale, los
 * bordes) y NO el mecanismo que lo resuelve; al pasarlo se "desbloquea" y
 * enseña cómo funciona por dentro. En una lección de concepto siempre es true.
 */
export interface FigureContext {
  theme: "light" | "dark";
  reveal: boolean;
  /**
   * Modo en vivo: la máquina pinta lo que hizo EL CÓDIGO DEL ALUMNO en este
   * paso, no un ejemplo grabado. Solo llega si la entrada declara `live`.
   */
  live?: LiveFrame;
}

export interface FigureEntry {
  render: (ctx: FigureContext) => ReactNode;
  /**
   * ¿Esta máquina puede mostrar ESTA ejecución? (p. ej. la cinta necesita una
   * lista recorrida y un número que acumula). Si no está o dice que no, el
   * modo en vivo usa la mesa de trabajo: mejor la mesa que una máquina que
   * pinta algo que el código del alumno no hizo.
   */
  live?: (frame: LiveFrame) => boolean;
}
