"use client";

// Firma histórica conservada: los consumidores siguen llamando useHermesData()
// pero ahora leen del poll único del shell (HermesDataProvider) en vez de
// abrir cada uno el suyo.
export type { Stats } from "@/state/HermesDataProvider";
export { useHermesDataContext as useHermesData } from "@/state/HermesDataProvider";
