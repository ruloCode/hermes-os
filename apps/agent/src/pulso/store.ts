import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyInbox, parseInbox, type PendingSituation, type PulseInbox, type PulseState } from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

/**
 * Disco del pulso, en `~/.hermes-os/pulso/` (o `$HERMES_HOME/pulso`):
 * - `state.json`: la foto anterior, lo que espera al modelo y el contador de llamadas del día.
 * - `inbox.json`: la bandeja (tarjetas vivas, descartes recordados, clases silenciadas).
 * - `log.jsonl`: una línea por pasada — qué cambió, si llamó al modelo y qué salió.
 *   Es lo que permite auditar que no gasta de más. Solo claves, nunca títulos.
 */

export interface PulseRun {
  at: string;
  /** Llamó al modelo en esta pasada. */
  model: boolean;
  /** Por qué no lo llamó habiendo algo que juzgar (silencio, tope) o por qué falló. */
  reason?: string;
  added: number;
  cards: number;
}

export interface PulseMemory {
  snapshot: PulseState | null;
  pending: PendingSituation[];
  calls: { day: string; count: number } | null;
  lastRun: PulseRun | null;
}

export const emptyMemory = (): PulseMemory => ({ snapshot: null, pending: [], calls: null, lastRun: null });

export interface PulseLogLine {
  at: string;
  mode: string;
  dryRun: boolean;
  sources: { ok: string[]; failed: string[] };
  added: string[];
  resolved: string[];
  rule: string[];
  model:
    | { called: true; keys: string[]; ms: number; cards: string[]; rejected: string[]; error?: string }
    | { called: false; reason: string | null; waiting: string[] };
  notices: { key: string; sent: boolean; reason: string }[];
}

export interface PulseStore {
  loadMemory(): Promise<PulseMemory>;
  saveMemory(m: PulseMemory): Promise<void>;
  loadInbox(): Promise<PulseInbox>;
  saveInbox(i: PulseInbox): Promise<void>;
  appendLog(line: PulseLogLine): Promise<void>;
  readLog(limit: number): Promise<PulseLogLine[]>;
}

export const PULSE_DIR = join(HERMES_HOME, "pulso");

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Escritura atómica: un corte a mitad no deja un JSON roto. */
async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value), "utf8");
  await rename(tmp, path);
}

export function filePulseStore(dir = PULSE_DIR): PulseStore {
  const statePath = join(dir, "state.json");
  const inboxPath = join(dir, "inbox.json");
  const logPath = join(dir, "log.jsonl");
  return {
    async loadMemory() {
      const raw = (await readJson(statePath)) as Partial<PulseMemory> | null;
      return { ...emptyMemory(), ...(raw && typeof raw === "object" ? raw : {}) };
    },
    async saveMemory(m) {
      await mkdir(dir, { recursive: true });
      await writeJson(statePath, m);
    },
    async loadInbox() {
      const raw = await readJson(inboxPath);
      return raw ? parseInbox(raw) : emptyInbox();
    },
    async saveInbox(i) {
      await mkdir(dir, { recursive: true });
      await writeJson(inboxPath, i);
    },
    async appendLog(line) {
      await mkdir(dir, { recursive: true });
      await appendFile(logPath, JSON.stringify(line) + "\n", "utf8");
    },
    async readLog(limit) {
      try {
        const lines = (await readFile(logPath, "utf8")).split("\n").filter((l) => l.trim());
        return lines
          .slice(-limit)
          .reverse()
          .flatMap((l) => {
            try {
              return [JSON.parse(l) as PulseLogLine];
            } catch {
              return [];
            }
          });
      } catch {
        return [];
      }
    },
  };
}

/** Store en memoria para los tests. */
export function memPulseStore(init: { memory?: PulseMemory; inbox?: PulseInbox } = {}) {
  const data = { memory: init.memory ?? emptyMemory(), inbox: init.inbox ?? emptyInbox(), log: [] as PulseLogLine[], writes: 0 };
  const store: PulseStore = {
    loadMemory: async () => structuredClone(data.memory),
    saveMemory: async (m) => {
      data.writes++;
      data.memory = structuredClone(m);
    },
    loadInbox: async () => structuredClone(data.inbox),
    saveInbox: async (i) => {
      data.writes++;
      data.inbox = structuredClone(i);
    },
    appendLog: async (l) => {
      data.writes++;
      data.log.push(l);
    },
    readLog: async (limit) => data.log.slice(-limit).reverse(),
  };
  return { store, data };
}
