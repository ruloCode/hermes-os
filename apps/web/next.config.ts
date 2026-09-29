import type { NextConfig } from "next";
import { resolve } from "node:path";

// apps/web corre en su propio directorio, pero el `.env` vive en la RAÍZ del
// monorepo (convención del proyecto). Next no lo lee solo, así que lo cargamos
// aquí para exponer NEXT_PUBLIC_* al cliente (p.ej. NEXT_PUBLIC_HERMES_URL) y
// las vars server-side (ELEVENLABS_*) a las rutas API. Sin dependencias:
// process.loadEnvFile existe en Node 20.12+/22.
try {
  (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile?.(
    resolve(process.cwd(), "../../.env"),
  );
} catch {
  /* sin .env raíz o Node antiguo: se usan los defaults del código */
}

const nextConfig: NextConfig = {
  // `next dev` y `next start` comparten .next/ — y el dev lo SOBRESCRIBE.
  //
  // Producción corre `next start` desde este mismo directorio (launchd
  // com.hermes-os.web, :31415) sirviendo el build de .next/. Levantar un dev
  // aquí para QA, aunque sea en otro puerto, pisa ese directorio con artefactos
  // de desarrollo: el proceso de producción se queda sirviendo un árbol a
  // medias (señal inconfundible: .next/ SIN BUILD_ID) y el dashboard "no carga
  // bien" sin un solo error en los logs. Recuperarlo exige build + kickstart.
  //
  // Por eso el dev escribe en .next-dev/ y no toca producción. El QA en el
  // navegador ahora es seguro con producción arriba.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",

  // /orquestador se fusionó al dashboard (tab TAREAS); los links viejos siguen
  // vivos vía redirect permanente.
  redirects: async () => [{ source: "/orquestador", destination: "/", permanent: true }],
  // @hermes/shared se consume como TS crudo (main: src/index.ts) con imports
  // ESM "./types.js": transpilar el package y mapear .js → .ts para que
  // webpack resuelva igual que tsx/tsc. Necesario desde que la web importa
  // VALORES del shared (FINANCE_CATEGORIES), no solo tipos.
  transpilePackages: ["@hermes/shared"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
