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

const nextConfig: NextConfig = {};

export default nextConfig;
