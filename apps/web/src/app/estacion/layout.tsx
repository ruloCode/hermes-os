import type { Metadata } from "next";
import { Baloo_2 } from "next/font/google";

/**
 * El tótem tiene su propia tipografía: Baloo 2, redonda y amable, para lo que
 * dicen los anfitriones y para los titulares. Se carga SOLO en esta ruta (el
 * dashboard sigue con Inter) y los datos siguen en Inter, que es la del shell.
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
  title: "Estación",
  description: "Tótem de estación: la ruta y la ciudad, habladas",
};

export default function EstacionLayout({ children }: { children: React.ReactNode }) {
  return <div className={baloo.variable}>{children}</div>;
}
