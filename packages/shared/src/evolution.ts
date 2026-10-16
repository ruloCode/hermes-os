/**
 * Evolución de Hermes ("Hermes Phone"): en qué etapa va la relación con su
 * dueño, calculada SOLO con métricas reales (días juntos, memorias, skills
 * usadas, ejecuciones terminadas, conversaciones). Lógica pura: el agente
 * junta los números (GET /evolution) y aquí se decide la etapa.
 *
 * Las etapas son SECUENCIALES: para estar en la 3 hay que cumplir la 2 y la
 * 3. Así subir cualquier métrica nunca baja de etapa (monótono) y "lo que
 * falta" siempre es la lista exacta de la siguiente etapa, no un salto.
 */

export type EvolutionMetrics = {
  daysTogether: number;
  memories: number;
  skillsUsed: number;
  executionsDone: number;
  conversations: number;
};

export type EvolutionMetric = keyof EvolutionMetrics;

export type EvolutionStage = {
  level: 1 | 2 | 3 | 4;
  key: "semilla" | "brote" | "hojas" | "companero";
  name: string;
};

export type EvolutionStageDef = EvolutionStage & {
  /** TODAS las condiciones deben cumplirse (métrica >= valor). */
  requires: Partial<Record<EvolutionMetric, number>>;
};

export const EVOLUTION_STAGES: readonly EvolutionStageDef[] = [
  { level: 1, key: "semilla", name: "Semilla", requires: {} },
  { level: 2, key: "brote", name: "Brote", requires: { daysTogether: 7, memories: 25 } },
  {
    level: 3,
    key: "hojas",
    name: "Hojas",
    requires: { daysTogether: 30, memories: 100, skillsUsed: 3 },
  },
  {
    level: 4,
    key: "companero",
    name: "Compañero",
    requires: { daysTogether: 90, skillsUsed: 10, executionsDone: 50 },
  },
];

export type EvolutionMissing = { metric: EvolutionMetric; have: number; need: number };

export type EvolutionResult = {
  stage: EvolutionStage;
  next: null | { stage: EvolutionStage; missing: EvolutionMissing[] };
  /** 0..1 hacia la siguiente etapa: media de have/need (cada uno topado en 1). 1 en la última. */
  progress: number;
};

function plain(def: EvolutionStageDef): EvolutionStage {
  return { level: def.level, key: def.key, name: def.name };
}

/** Un valor no finito o negativo cuenta como 0 (una fuente caída no suma). */
function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function unmet(def: EvolutionStageDef, m: EvolutionMetrics): EvolutionMissing[] {
  const out: EvolutionMissing[] = [];
  for (const [metric, need] of Object.entries(def.requires) as [EvolutionMetric, number][]) {
    const have = safe(m[metric]);
    if (have < need) out.push({ metric, have, need });
  }
  return out;
}

export function evolutionStage(m: EvolutionMetrics): EvolutionResult {
  let current = EVOLUTION_STAGES[0];
  for (const def of EVOLUTION_STAGES.slice(1)) {
    if (unmet(def, m).length) break;
    current = def;
  }
  const nextDef = EVOLUTION_STAGES.find((d) => d.level === current.level + 1);
  if (!nextDef) return { stage: plain(current), next: null, progress: 1 };

  const reqs = Object.entries(nextDef.requires) as [EvolutionMetric, number][];
  const ratios = reqs.map(([metric, need]) => Math.min(1, safe(m[metric]) / need));
  const progress = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
  return {
    stage: plain(current),
    next: { stage: plain(nextDef), missing: unmet(nextDef, m) },
    progress: Math.max(0, Math.min(1, progress)),
  };
}
