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
