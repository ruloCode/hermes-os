import type { Metadata } from "next";
import { Baloo_2 } from "next/font/google";

/**
 * Misma tipografía del tótem (Baloo 2 para lo que dicen los anfitriones), para
 * que el celular se sienta la continuación de la pantalla y no otra app.
 */
const baloo = Baloo_2({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-baloo",
  display: "swap",
  // Sin red en build, Next cae a la fallback y la pantalla sigue legible.
  fallback: ["Trebuchet MS", "Verdana", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Tu ruta",
  description: "La conversación de la estación, en tu bolsillo",
};

export default function MovilLayout({ children }: { children: React.ReactNode }) {
  return <div className={baloo.variable}>{children}</div>;
}
