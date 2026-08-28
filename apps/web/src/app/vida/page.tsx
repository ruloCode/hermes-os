import { redirect } from "next/navigation";

// /vida se separó en /finanzas, /habitos e /ingles (2026-07). Los enlaces
// viejos (voz, móvil, marcadores) aterrizan en finanzas.
export default function VidaPage() {
  redirect("/finanzas");
}
