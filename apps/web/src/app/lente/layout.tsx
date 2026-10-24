import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lente",
  description: "Las sugerencias de la junta en vivo, para mirar sin dejar de mirar a la persona",
};

export default function LenteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
