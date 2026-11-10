/**
 * Oportunidades de Upwork en disco: `~/.hermes-os/upwork/opportunities.jsonl`
 * (sin migración, como gym/ y focus/).
 *
 * Append-only: cada cambio agrega la versión completa de la oportunidad y al
 * leer gana la ÚLTIMA línea por jobId (`reduceOpportunities`, puro). Cuando
 * el archivo trae el doble de líneas que oportunidades, se compacta.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HERMES_HOME } from "../home.js";
import type { UpworkJob } from "./parse.js";
import type { UpworkVerdict } from "./score.js";

export type OpportunityStatus = "nueva" | "descartada" | "avisada" | "aplicada";
export const OPPORTUNITY_STATUSES: OpportunityStatus[] = ["nueva", "descartada", "avisada", "aplicada"];

export interface ProposalDraft {
  text: string;
  /** Pregunta con la que cierra (la guía exige cerrar con una de verdad). */
  question?: string;
  /** Qué pieza del portafolio la respalda. */
  proof?: string;
  model: string;
  at: string;
}

export interface Opportunity {
  jobId: string;
  mailId: string;
  /** Epoch ms en que llegó el aviso (proxy de "publicada hace…"). */
  receivedAt: number;
  job: UpworkJob;
  score: number;
  verdict: UpworkVerdict;
  reasons: string[];
  status: OpportunityStatus;
  notifiedAt?: string;
  appliedAt?: string;
  draft?: ProposalDraft;
  updatedAt: string;
}

export const UPWORK_DIR = join(HERMES_HOME, "upwork");
export const OPPORTUNITIES_PATH = join(UPWORK_DIR, "opportunities.jsonl");

/** Última versión por jobId, en el orden en que apareció cada una por primera vez. */
export function reduceOpportunities(lines: readonly string[]): Opportunity[] {
  const byId = new Map<string, Opportunity>();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Opportunity;
      if (o && typeof o.jobId === "string" && o.job) byId.set(o.jobId, o);
    } catch {
      // Una línea a medio escribir (corte de luz) no tumba el resto.
    }
  }
  return [...byId.values()];
}

export interface OpportunityStore {
  path: string;
  all(): Promise<Opportunity[]>;
  get(jobId: string): Promise<Opportunity | undefined>;
  put(o: Opportunity): Promise<void>;
}

export function fileOpportunityStore(path = OPPORTUNITIES_PATH): OpportunityStore {
  const readLines = async () => {
    try {
      return (await readFile(path, "utf8")).split("\n");
    } catch {
      return [];
    }
  };
  return {
    path,
    async all() {
      return reduceOpportunities(await readLines());
    },
    async get(jobId) {
      return (await this.all()).find((o) => o.jobId === jobId);
    },
    async put(o) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify(o) + "\n", "utf8");
      const lines = (await readLines()).filter((l) => l.trim());
      const unique = reduceOpportunities(lines);
      if (lines.length > 40 && lines.length > unique.length * 2) {
        const tmp = `${path}.tmp`;
        await writeFile(tmp, unique.map((u) => JSON.stringify(u)).join("\n") + "\n", "utf8");
        await rename(tmp, path);
      }
    },
  };
}
