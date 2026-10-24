// Registro de las máquinas del Dojo: id de lección → figura. Cada máquina vive
// en su carpeta y exporta su propio FIGURES; aquí solo se juntan, así cada una
// se construye sin tocar las demás.
//
// Las siete máquinas (una por idea, alimentada con los datos de cada ejercicio):
//   prensa      — funciones y return (entra → sale)
//   compuertas  — if / elif / else (la primera compuerta que se cumple)
//   cinta       — bucles y el acumulador
//   tipos       — listas y textos (posiciones, rebanadas, dos punteros)
//   pines       — complejidad: n contra n², la fórmula contra el bucle
//   ventana     — una sola pasada y la ventana deslizante
//   casilleros  — hash map: dict y set
import type { FigureEntry } from "./types";
import { FIGURES as prensa } from "./prensa";
import { FIGURES as compuertas } from "./compuertas";
import { FIGURES as cinta } from "./cinta";
import { FIGURES as tipos } from "./tipos";
import { FIGURES as pines } from "./pines";
import { FIGURES as ventana } from "./ventana";
import { FIGURES as casilleros } from "./casilleros";

export const DOJO_FIGURES: Record<string, FigureEntry> = {
  ...prensa,
  ...compuertas,
  ...cinta,
  ...tipos,
  ...pines,
  ...ventana,
  ...casilleros,
};

/** Qué máquina explica cada lección (para el QA y para repartir el trabajo). */
export const FIGURE_PLAN: Record<string, string[]> = {
  prensa: ["f-funciones", "f-doble", "f-saludo", "f-segundos"],
  compuertas: ["f-decidir", "f-es-par", "f-etapa", "f-bisiesto"],
  cinta: ["f-repetir", "f-suma-hasta", "f-contar-pares", "f-mayor", "f-fizzbuzz"],
  tipos: ["f-listas", "f-textos", "f-vocales", "f-palindromo", "f-invertir-palabras"],
  pines: ["c-pasos", "c-crece", "c-suma-gigante"],
  ventana: ["c-ganancia", "c-ventana"],
  casilleros: ["h-dicts", "h-sets", "h-contar-palabras", "h-repetidos", "h-anagramas", "h-primera-unica", "h-dos-suma", "h-agrupar"],
};
