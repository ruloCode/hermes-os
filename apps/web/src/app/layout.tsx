import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_INIT_SCRIPT } from "@/state/theme-init";

// Marca v5 "Grafito" (2026-10): Geist para la interfaz y Geist Mono para los
// datos. Inter + IBM Plex eran dos familias sin relación entre sí; Geist es un
// par diseñado junto (mismas proporciones, misma x-height), así que un número
// en mono al lado de una etiqueta en sans ya no salta de tamaño.
//
// Las vars se llaman --font-geist/--font-geist-mono (no --font-sans/--font-mono)
// porque el @theme de globals.css define estas últimas referenciándolas — si
// compartieran nombre habría una referencia circular.
const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Hermes",
  description: "Sistema operativo personal con agentes",
};

// La barra del navegador (Safari, PWA) toma el color del cromo de cada tema.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e0f11" },
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: el script de tema escribe data-theme antes de
    // que React hidrate (evita el destello claro/oscuro al cargar).
    <html lang="es" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
