// Vista pública de la Oficina (tarima, mesa de demos): qué proyectos se pueden
// nombrar en un proyector y qué valores son secretos. La redacción es pura
// (office-redact.ts en @hermes/shared); aquí solo se arma su contexto.
//
// ~/.hermes-os/vista-publica.json (opcional):
//   { "publicProjects": ["hermes-os", "rulocode"], "extraHidden": ["Nombre de un cliente"] }
// Sin archivo, solo hermes-os y general son públicos: todo proyecto del vault
// fuera de la lista se oculta (por defecto se niega, que un proyector no perdona).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PUBLIC_PROJECTS, hiddenTermsFor, publicTermsFor, type PublicViewConfig, type PublicViewContext } from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { readProjects } from "../vault/projects.js";

export const PUBLIC_VIEW_PATH = process.env.HERMES_PUBLIC_VIEW_PATH || join(HERMES_HOME, "vista-publica.json");

export async function publicViewConfig(): Promise<{ config: PublicViewConfig; configured: boolean }> {
  try {
    const raw = JSON.parse(await readFile(PUBLIC_VIEW_PATH, "utf8")) as Partial<PublicViewConfig>;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
    return { config: { publicProjects: [...new Set([...list(raw.publicProjects), "general"])], extraHidden: list(raw.extraHidden) }, configured: true };
  } catch {
    return { config: { publicProjects: DEFAULT_PUBLIC_PROJECTS }, configured: false };
  }
}

/** Valores de las variables de entorno con nombre de secreto: se tapan aunque no tengan forma de llave. */
function envSecrets(): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || v.length < 8) continue;
    if (/KEY|TOKEN|SECRET|PASSWORD|ICS_URL|SERVICE_ROLE|CREDENTIAL/i.test(k)) out.push(v);
  }
  return out;
}

/** Lo que el navegador necesita para redactar: la lista pública y los términos a ocultar (nunca los secretos). */
export async function publicViewForClient(): Promise<{ publicProjects: string[]; hiddenTerms: string[]; publicTerms: string[]; configured: boolean; path: string }> {
  const { config, configured } = await publicViewConfig();
  let projects: { slug: string; name?: string }[] = [];
  try {
    projects = (await readProjects()).map((p) => ({ slug: p.slug, name: p.name }));
  } catch {
    /* sin vault: solo los términos extra */
  }
  return { publicProjects: config.publicProjects, hiddenTerms: hiddenTermsFor(projects, config), publicTerms: publicTermsFor(projects, config), configured, path: PUBLIC_VIEW_PATH };
}

/** Contexto del servidor: además de los términos, los secretos exactos del entorno. */
export async function serverPublicContext(): Promise<PublicViewContext> {
  const { hiddenTerms, publicTerms } = await publicViewForClient();
  return { hiddenTerms, publicTerms, exactSecrets: envSecrets() };
}
