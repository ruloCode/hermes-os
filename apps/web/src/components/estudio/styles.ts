/** Clases compartidas de los formularios del ESTUDIO.
 *  Viven aquí (y no repetidas por archivo) desde que el workspace se partió en
 *  varios tabs: el de publicación necesita exactamente los mismos controles. */

export const inputCls =
  "rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

export const selectCls =
  "rounded-sm border border-line bg-panel px-1.5 py-1 text-xs text-text-dim focus:border-accent focus:outline-none";

// v5: sin mayúsculas ni tracking; mismo aspecto que <Button variant="secondary">
// (borde + fondo de tarjeta) para que los tabs internos no desentonen.
export const btnCls =
  "cursor-pointer rounded-sm border border-line bg-panel px-2.5 py-1 text-xs font-medium text-text transition-colors hover:border-line-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
