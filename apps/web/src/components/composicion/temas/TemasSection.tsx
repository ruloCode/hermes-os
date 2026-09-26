"use client";

/** Sección TEMAS de /composicion: lista → tema (la gramática de la casa, con Esc para volver). */
import { useTemas } from "./TemasProvider";
import { TemasHome } from "./TemasHome";
import { TemaView } from "./TemaView";

export function TemasSection() {
  const { openId } = useTemas();
  return openId ? <TemaView key={openId} id={openId} /> : <TemasHome />;
}
