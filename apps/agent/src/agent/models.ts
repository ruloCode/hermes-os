/**
 * Catálogo ÚNICO de modelos de Hermes.
 *
 * Antes cada función tenía su id de modelo en env.ts o escrito en su módulo, y
 * donde no había ninguno el CLI elegía (hoy: claude-opus-5-5, el más caro de uso
 * diario). Aquí vive la única tabla: nivel → modelo, y función → nivel + esfuerzo
 * + razonamiento. Ningún otro archivo escribe un id `claude-*`.
 *
 * Verificado con la cuenta en uso el 2026-11-09 (scripts/probe-models.ts, SDK
 * 0.3.322): los cuatro modelos responden y `thinking: disabled` funciona en
 * Sonnet 5.5 y Haiku 5.5.
 */

export type ModelTier = "fast" | "balanced" | "deep" | "frontier";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingMode = "off" | "adaptive";

export interface TierModel {
  id: string;
  label: string;
  /** USD por millón de tokens (precio de lista, para las vistas de gasto). */
  inputUsd: number;
  outputUsd: number;
}

export const TIER_MODELS: Record<ModelTier, TierModel> = {
  fast: { id: "claude-haiku-5-5", label: "Haiku 5.5", inputUsd: 0.1, outputUsd: 0.5 },
  balanced: { id: "claude-sonnet-5-5", label: "Sonnet 5.5", inputUsd: 2, outputUsd: 10 },
  deep: { id: "claude-opus-5-5", label: "Opus 5.5", inputUsd: 4, outputUsd: 20 },
  frontier: { id: "claude-fable-5-2", label: "Fable 5.2", inputUsd: 8, outputUsd: 40 },
};

interface FeatureDef {
  tier: ModelTier;
  /** Sin valor = el del modelo (no se manda la opción). */
  effort?: Effort;
  thinking?: ThinkingMode;
  /** Variables que esta función ya usaba: siguen valiendo y ganan sobre el catálogo. */
  legacyEnv?: string[];
  /** Para qué se usa (lo muestra el panel de gasto). */
  label: string;
}

/**
 * Cada función que llama al modelo. La clave es el `feature` del registro de
 * gasto (usage-ledger): agregar una función = agregar una fila aquí.
 */
export const FEATURES = {
  // ── Conversación y trabajo ────────────────────────────────────────────
  chat: { tier: "balanced", legacyEnv: ["HERMES_MODEL"], label: "Chat" },
  task: { tier: "deep", legacyEnv: ["HERMES_MODEL"], label: "Tareas (/tasks, voz)" },
  scheduled: { tier: "balanced", label: "Tareas programadas (las nuevas; las viejas conservan su modelo)" },
  "executions.analysis": { tier: "fast", label: "Análisis de una ejecución" },
  // ── Juntas ────────────────────────────────────────────────────────────
  "meetings.ingest": { tier: "deep", effort: "medium", label: "Acta de junta" },
  "meetings.strategic": { tier: "balanced", thinking: "off", legacyEnv: ["HERMES_COPILOT_DEEP_MODEL"], label: "Junta: loop estratégico" },
  "meetings.prep": { tier: "balanced", thinking: "off", label: "Preparación de junta" },
  "copilot.fast": { tier: "fast", thinking: "off", legacyEnv: ["HERMES_COPILOT_MODEL"], label: "Junta: capa rápida" },
  "copilot.team": { tier: "balanced", thinking: "off", legacyEnv: ["HERMES_COPILOT_TEAM_MODEL"], label: "Junta de equipo: aportar" },
  "copilot.class": { tier: "balanced", thinking: "off", legacyEnv: ["HERMES_COPILOT_CLASS_MODEL"], label: "Clase de inglés: frase y andamio" },
  "copilot.vision": { tier: "balanced", thinking: "off", legacyEnv: ["HERMES_VISION_MODEL"], label: "Visión en vivo" },
  // ── Aprender ──────────────────────────────────────────────────────────
  "english.report": { tier: "balanced", label: "Inglés: reporte de sesión" },
  "english.drill": { tier: "balanced", thinking: "off", label: "Inglés: evaluación del plan" },
  "gym.analyze": { tier: "balanced", thinking: "off", legacyEnv: ["HERMES_GYM_MODEL"], label: "Gimnasio: devolución" },
  "gym.generate": { tier: "balanced", legacyEnv: ["HERMES_GYM_MODEL"], label: "Gimnasio: escenarios nuevos" },
  "dojo.coach": { tier: "balanced", thinking: "off", legacyEnv: ["HERMES_DOJO_MODEL"], label: "Dojo: coach" },
  tutor: { tier: "balanced", legacyEnv: ["HERMES_TUTOR_MODEL"], label: "Entender (tutor de proyecto)" },
  // ── Crear ─────────────────────────────────────────────────────────────
  "content.generate": { tier: "balanced", label: "Estudio: kit de la pieza" },
  "content.variants": { tier: "balanced", label: "Estudio: variantes" },
  "content.chat": { tier: "balanced", label: "Estudio: chat de la pieza" },
  "content.edit": { tier: "deep", label: "Estudio: edición automática" },
  "composicion.lyrics": { tier: "balanced", thinking: "off", legacyEnv: ["COMPOSICION_LYRICS_MODEL"], label: "Composición: letras" },
  "composicion.summary": { tier: "balanced", label: "Composición: resumen" },
  // ── Fondo ─────────────────────────────────────────────────────────────
  "learning.review": { tier: "fast", legacyEnv: ["HERMES_LEARNING_MODEL"], label: "Aprendizaje: revisión del turno" },
  "office.queue": { tier: "fast", legacyEnv: ["HERMES_QUEUE_MODEL"], label: "Oficina: coordinador de la cola" },
  "office.usage": { tier: "fast", label: "Oficina: consulta de uso del plan (no gasta tokens)" },
  "growth.acta": { tier: "balanced", legacyEnv: ["HERMES_GROWTH_MODEL"], label: "Compañero: acta de la llamada" },
  "upwork.draft": { tier: "balanced", thinking: "off", legacyEnv: ["HERMES_UPWORK_MODEL"], label: "Upwork: borrador de propuesta" },
  "memory.dream": { tier: "fast", thinking: "off", label: "Memoria: consolidación nocturna" },
  "memory.eval": { tier: "fast", thinking: "off", label: "Memoria: preguntas de evaluación" },
  pulse: { tier: "fast", thinking: "off", label: "Pulso" },
  probe: { tier: "fast", label: "Sonda" },
} as const satisfies Record<string, FeatureDef>;

export type Feature = keyof typeof FEATURES;

export interface FeatureModel {
  model: string;
  tier: ModelTier;
  effort?: Effort;
  thinking?: ThinkingMode;
  /** De dónde salió el modelo: el catálogo o una variable (para el panel de gasto). */
  source: "catalog" | "env";
}

type Env = Record<string, string | undefined>;

const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/** `copilot.fast` → `COPILOT_FAST` (sufijo de HERMES_MODEL_* y HERMES_EFFORT_*). */
export function featureEnvKey(feature: string): string {
  return feature.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/** El modelo de un nivel: `HERMES_MODEL_TIER_<NIVEL>` o el del catálogo. */
export function tierModel(tier: ModelTier, env: Env = process.env): string {
  return env[`HERMES_MODEL_TIER_${tier.toUpperCase()}`]?.trim() || TIER_MODELS[tier].id;
}

/**
 * Qué modelo, esfuerzo y razonamiento usa una función.
 * Precedencia: variable heredada de la función → HERMES_MODEL_<FUNCION> →
 * nivel (HERMES_MODEL_TIER_<NIVEL> o catálogo).
 */
export function modelFor(feature: Feature, env: Env = process.env): FeatureModel {
  const def: FeatureDef = FEATURES[feature];
  const key = featureEnvKey(feature);
  const fromEnv = [...(def.legacyEnv ?? []), `HERMES_MODEL_${key}`].map((name) => env[name]?.trim()).find(Boolean);
  const effortEnv = env[`HERMES_EFFORT_${key}`]?.trim().toLowerCase();
  const effort = effortEnv && EFFORTS.includes(effortEnv) ? (effortEnv as Effort) : def.effort;
  return {
    model: fromEnv || tierModel(def.tier, env),
    tier: def.tier,
    ...(effort ? { effort } : {}),
    ...(def.thinking ? { thinking: def.thinking } : {}),
    source: fromEnv ? "env" : "catalog",
  };
}

/** Atajo para quien solo necesita el id. */
export function modelIdFor(feature: Feature, env: Env = process.env): string {
  return modelFor(feature, env).model;
}

/** Alias que el CLI resuelve solo (hoy a la familia 5.5). */
export const MODEL_ALIASES = ["haiku", "sonnet", "opus", "fable"] as const;

/**
 * Modelos anteriores que una tarea programada o un run viejo puede traer
 * congelados: siguen siendo válidos, no se ofrecen por defecto.
 */
export const LEGACY_MODELS = [
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
] as const;

/** Todo id que Hermes acepta cuando alguien elige modelo a mano (consola, Oficina). */
export function knownModels(): string[] {
  return [...MODEL_ALIASES, ...Object.values(TIER_MODELS).map((m) => m.id), ...LEGACY_MODELS];
}

/** El nivel de un id (o alias), para etiquetar el gasto. null = modelo fuera del catálogo vigente. */
export function tierOf(model: string): ModelTier | null {
  const m = model.toLowerCase();
  for (const [tier, def] of Object.entries(TIER_MODELS) as [ModelTier, TierModel][]) {
    if (def.id === m) return tier;
  }
  if (m.includes("haiku")) return "fast";
  if (m.includes("sonnet")) return "balanced";
  if (m.includes("opus")) return "deep";
  if (m.includes("fable") || m.includes("mythos")) return "frontier";
  return null;
}

/** El catálogo resuelto con el entorno actual (ruta /usage/models y el panel de gasto). */
export function catalogView(env: Env = process.env): { feature: Feature; label: string; tier: ModelTier; model: string; effort?: Effort; thinking?: ThinkingMode; source: "catalog" | "env" }[] {
  return (Object.keys(FEATURES) as Feature[]).map((feature) => ({ feature, label: FEATURES[feature].label, ...modelFor(feature, env) }));
}
