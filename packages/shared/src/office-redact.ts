// Vista pública de la Oficina (tarima, mesa de demos, proyector): lo que se ve
// en pantalla pasa por aquí ANTES de llegar al DOM. Puro y con tests.
//
// Qué oculta:
// - Valores que parecen secretos: llaves de API (sk-…, ghp_…, lin_api_…,
//   AKIA…), JWT, "Bearer …", llaves privadas, URLs con usuario:clave@ y el
//   valor de cualquier VARIABLE con nombre de secreto (API_KEY=…, "token": …).
// - Lo leído de un .env (y la salida de `env`/`printenv`): entero.
// - Correos y teléfonos.
// - Proyectos que no están en la lista pública (los de clientes): su nombre y
//   su slug, donde aparezcan.
// - Las secciones personales del system prompt (SOUL.md, USER.md…): queda el
//   título y "oculto en vista pública".
//
// Qué NO toca (y lo prueban los tests): rutas de código, SHAs de git, uuids,
// fechas, puertos, versiones, conteos de tokens, comandos normales.

import type { CapturedPrompt, PromptSection, TraceEvent, TraceInventoryCapture } from "./office-trace.js";

export const HIDDEN = "oculto en vista pública";
export const CLIENT_LABEL = "[cliente]";

export interface PublicViewContext {
  /** Nombres y slugs de proyectos que NO se muestran (los de clientes). */
  hiddenTerms: string[];
  /** Valores exactos de secretos que el servidor conoce (sus variables de entorno). Nunca viajan al navegador. */
  exactSecrets?: string[];
}

export interface PublicViewConfig {
  /** Slugs que sí se muestran. Todo proyecto del vault fuera de esta lista se oculta. */
  publicProjects: string[];
  /** Términos extra a ocultar (nombres de clientes que no son proyectos). */
  extraHidden?: string[];
}

export const DEFAULT_PUBLIC_PROJECTS = ["hermes-os", "general"];

/** Los términos a ocultar: los proyectos que no son públicos (nombre y slug) + los extra. */
export function hiddenTermsFor(projects: { slug: string; name?: string }[], config: PublicViewConfig): string[] {
  const pub = new Set(config.publicProjects.map((s) => s.toLowerCase()));
  const out = new Set<string>();
  for (const p of projects) {
    if (pub.has(p.slug.toLowerCase())) continue;
    for (const t of [p.slug, p.name ?? ""]) if (t.trim().length >= 4) out.add(t.trim());
  }
  for (const t of config.extraHidden ?? []) if (t.trim().length >= 4) out.add(t.trim());
  return [...out];
}

export function isProjectPublic(slug: string, config: PublicViewConfig): boolean {
  return config.publicProjects.some((s) => s.toLowerCase() === slug.toLowerCase());
}

const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|pwd|credential|private[_-]?key|access[_-]?key|auth[_-]?(?:token|key|header)|authorization|cookie|_key)[A-Za-z0-9_.-]*`;

interface Rule {
  re: RegExp;
  replace: (...m: string[]) => string;
}

const mask = (kind: string) => `[${kind} ${HIDDEN}]`;

const RULES: Rule[] = [
  // Llaves privadas completas.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: () => mask("llave privada") },
  // URL con credenciales: esquema://usuario:clave@host → esquema://[…]@host
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@"']+:[^\s/@"']+@/gi, replace: (_m, scheme) => `${scheme}[credenciales ${HIDDEN}]@` },
  // JWT (tres segmentos base64url empezando por eyJ).
  { re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, replace: () => mask("JWT") },
  // Bearer <token>
  { re: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/g, replace: (_m, b) => `${b} ${mask("token")}` },
  // Formatos conocidos de llaves.
  { re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, replace: () => mask("llave") },
  { re: /\bsk_(?:live_|test_)?[A-Za-z0-9]{24,}/g, replace: () => mask("llave") },
  { re: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g, replace: () => mask("token de GitHub") },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: () => mask("token de GitHub") },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => mask("token de Slack") },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => mask("llave de AWS") },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => mask("llave de Google") },
  { re: /\blin_(?:api|oauth)_[A-Za-z0-9]{20,}/g, replace: () => mask("llave de Linear") },
  { re: /\bsbp_[A-Za-z0-9]{20,}/g, replace: () => mask("llave") },
  // "nombre_secreto": "valor"  (JSON)
  {
    re: new RegExp(String.raw`("${SECRET_NAME}"\s*:\s*")([^"\\]{4,}(?:\\.[^"\\]*)*)(")`, "gi"),
    replace: (_m, a, v, c) => (alreadyMasked(v) ? `${a}${v}${c}` : `${a}${mask("valor")}${c}`),
  },
  // ?api_key=valor&… (parámetros de una URL)
  {
    re: new RegExp(String.raw`([?&]${SECRET_NAME}=)([^&\s"'#]{4,})`, "gi"),
    replace: (_m, a, v) => (alreadyMasked(v) ? `${a}${v}` : `${a}${mask("valor")}`),
  },
  // NOMBRE_SECRETO=valor (env) · nombre_secreto: valor (yaml, cabeceras) · x = "valor" (literal).
  // Una asignación de código en minúsculas sin comillas (`const tokens = count(x)`) no es un secreto.
  {
    re: new RegExp(String.raw`\b(${SECRET_NAME})(\s*[=:]\s*)(["']?)([^\s"'\`,;)\]}]{6,})`, "gi"),
    replace: (m, name, sep, q, v) => {
      const envStyle = /^[A-Z0-9_.-]+$/.test(name) || sep.includes(":") || !!q;
      if (!envStyle || alreadyMasked(v) || /^\[/.test(v) || v.includes("(")) return m;
      return `${name}${sep}${q}${mask("valor")}`;
    },
  },
  // --flag-de-secreto valor
  {
    re: new RegExp(String.raw`(--${SECRET_NAME})(\s+)([^\s-][^\s]{5,})`, "gi"),
    replace: (_m, flag, sp, v) => (alreadyMasked(v) ? `${flag}${sp}${v}` : `${flag}${sp}${mask("valor")}`),
  },
  // Correos.
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: () => mask("correo") },
  // Teléfonos: internacional con +, celular colombiano (3xx xxx xxxx) y (xxx) xxx-xxxx.
  { re: /(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?![\w])/g, replace: () => mask("teléfono") },
  { re: /(?<![\w.:/-])3\d{2}[\s.-]\d{3}[\s.-]?\d{4}(?![\w.:-])/g, replace: () => mask("teléfono") },
  { re: /(?<![\w.:/-])3\d{9}(?![\w.:-])/g, replace: () => mask("teléfono") },
  { re: /\(\d{3}\)\s?\d{3}-\d{4}\b/g, replace: () => mask("teléfono") },
];

/** Un valor que ya está tapado, o que es solo un número (max_tokens=100000 no es un secreto). */
function alreadyMasked(v: string): boolean {
  return v.includes(HIDDEN) || /^\d+$/.test(v) || /^(true|false|null|none|undefined)$/i.test(v);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Redacta un texto libre (salida de una tool, una línea de la laptop, un nombre). */
export function redactText(text: string, ctx: PublicViewContext): string {
  if (!text) return text;
  let out = text;
  for (const secret of ctx.exactSecrets ?? []) {
    if (secret.length >= 8) out = out.split(secret).join(mask("secreto"));
  }
  for (const rule of RULES) out = out.replace(rule.re, rule.replace as (substring: string, ...args: string[]) => string);
  const terms = [...ctx.hiddenTerms].filter((t) => t.length >= 4).sort((a, b) => b.length - a.length);
  if (terms.length) {
    // El usuario del sistema en una ruta de home (/Users/<x>/, /home/<x>/) no es un proyecto aunque se llame igual.
    const re = new RegExp(`(?<![A-Za-z0-9])(?<!/Users/)(?<!/home/)(?:${terms.map(escapeRe).join("|")})(?![A-Za-z0-9])`, "gi");
    out = out.replace(re, CLIENT_LABEL);
  }
  return out;
}

/** ¿Este paso leyó un .env o volcó el entorno? Entonces su salida entera se oculta. */
export function readsEnvFile(tool: string | undefined, input: string | undefined): boolean {
  if (!input) return false;
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(input) as Record<string, unknown>;
  } catch {
    return /\.env\b/.test(input);
  }
  const file = String(o.file_path ?? o.path ?? "");
  if (/(^|\/)\.env(\.[\w.-]+)?$/.test(file) || /(^|\/)\.envrc$/.test(file)) return true;
  if (tool === "Bash") {
    const cmd = String(o.command ?? "");
    if (/(^|[\s;&|/'"])\.env(\.[\w.-]+)?(?=$|[\s;&|'"])/.test(cmd)) return true;
    if (/(^|[;&|]\s*)(env|printenv|export|set)\s*($|[;&|>])/.test(cmd)) return true;
  }
  return false;
}

/**
 * Un evento de la traza en vista pública. `envReads` = ids de tool_use que
 * leyeron un .env (su resultado se oculta entero). Devuelve una copia.
 */
export function redactTraceEvent(ev: TraceEvent, ctx: PublicViewContext, envReads?: ReadonlySet<string>): TraceEvent {
  const out: TraceEvent = { ...ev };
  if (out.input) out.input = redactText(out.input, ctx);
  if (out.text) out.text = redactText(out.text, ctx);
  if (out.output !== undefined) {
    const hideAll = ev.kind === "tool_result" && !!ev.id && !!envReads?.has(ev.id);
    out.output = hideAll ? `[contenido de un .env o del entorno: ${HIDDEN}]` : redactText(out.output, ctx);
  }
  if (out.init) {
    out.init = {
      ...out.init,
      cwd: out.init.cwd ? redactText(out.init.cwd, ctx) : out.init.cwd,
      plugins: out.init.plugins.map((p) => ({ ...p, path: p.path ? redactText(p.path, ctx) : p.path })),
    };
  }
  return out;
}

/** Toda una traza en vista pública (detecta solo qué tool_use leyó un .env). */
export function redactTrace(events: readonly TraceEvent[], ctx: PublicViewContext): TraceEvent[] {
  const envReads = new Set<string>();
  for (const ev of events) if (ev.kind === "tool_use" && ev.id && readsEnvFile(ev.tool, ev.input)) envReads.add(ev.id);
  return events.map((ev) => redactTraceEvent(ev, ctx, envReads));
}

/**
 * El system prompt en vista pública: las secciones personales quedan con su
 * título (la primera línea) y "oculto en vista pública"; el resto se redacta
 * como texto. Las subsecciones `## …` que nombran un proyecto oculto se vacían.
 * Devuelve un CapturedPrompt NUEVO con los rangos recalculados.
 */
export function redactPrompt(p: CapturedPrompt, ctx: PublicViewContext, sep = "\n\n---\n\n"): CapturedPrompt {
  let raw = "";
  const sections: PromptSection[] = [];
  p.sections.forEach((s, i) => {
    const text = p.raw.slice(s.start, s.end);
    let body: string;
    if (s.personal) {
      const head = text.split("\n")[0] ?? s.title;
      body = `${head}\n(${HIDDEN})`;
    } else {
      body = redactText(hideClientSubsections(text, ctx), ctx);
    }
    // El separador original entre secciones se conserva tal cual.
    if (i > 0) raw += p.raw.slice(p.sections[i - 1].end, s.start) || sep;
    const start = raw.length;
    raw += body;
    sections.push({ ...s, start, end: raw.length });
  });
  return { kind: "sdk", raw, sections };
}

/** Vacía las subsecciones `## Título` cuyo título nombra un proyecto oculto (deja el encabezado redactado). */
export function hideClientSubsections(text: string, ctx: PublicViewContext): string {
  if (!ctx.hiddenTerms.length) return text;
  const terms = ctx.hiddenTerms.filter((t) => t.length >= 4).map((t) => t.toLowerCase());
  const lines = text.split("\n");
  const out: string[] = [];
  let hiding = false;
  for (const line of lines) {
    const h = /^(#{2,6})\s+(.*)$/.exec(line);
    if (h) {
      const title = h[2].toLowerCase();
      hiding = terms.some((t) => new RegExp(`(?<![a-z0-9])${escapeRe(t)}(?![a-z0-9])`).test(title));
      out.push(line);
      if (hiding) out.push(`(proyecto de cliente: ${HIDDEN})`);
      continue;
    }
    if (!hiding) out.push(line);
  }
  return out.join("\n");
}

/**
 * El inventario en vista pública: las descripciones de tools se redactan como
 * texto; las de skills que NO son del plugin de Hermes (las personales del
 * usuario: pueden nombrar clientes y personas) se ocultan. El nombre queda.
 */
export function redactInventory(inv: TraceInventoryCapture | null, ctx: PublicViewContext): TraceInventoryCapture | null {
  if (!inv) return inv;
  return {
    mcp: inv.mcp.map((sv) => ({
      ...sv,
      server: redactText(sv.server, ctx),
      tools: sv.tools.map((t) => ({ name: t.name, ...(t.description ? { description: redactText(t.description, ctx) } : {}) })),
    })),
    commands: inv.commands.map((c) => ({
      name: c.name,
      description: c.name.startsWith("hermes:") ? redactText(c.description, ctx) : `(descripción ${HIDDEN}: no viene del plugin de Hermes)`,
    })),
  };
}
