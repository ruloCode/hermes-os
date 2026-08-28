"use client";

// Poll ÚNICO del orquestador: runs de Claude Code (/claude/runs) + tareas
// async del SDK (/tasks), cada 4s. Lo comparten el panel Orquestador, la
// lista de agentes activos y los chips "agentes en acción" — antes cada uno
// habría abierto su propio poll.
//
// Además acumula la HISTORIA de toolCalls por run (deltas entre polls) para
// las sparklines: es dato real acumulado en el cliente, no una curva
// inventada — un run recién visto aún no tiene curva y así se muestra.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ClaudeRunSummary, HermesTask } from "@hermes/shared";
import { hermesGet, hermesPost } from "@/lib/hermes";

const SPARK_LEN = 20;

interface Orchestrator {
  runs: ClaudeRunSummary[];
  /** Solo las tareas async del SDK en curso. */
  tasks: HermesTask[];
  /** Deltas de toolCalls por poll (dato real; vacío si el run es nuevo). */
  sparkFor: (runId: string) => number[];
  /** Cancela un run (optimista; el próximo poll corrige). */
  kill: (id: string) => Promise<void>;
}

const OrchestratorContext = createContext<Orchestrator | null>(null);

export function OrchestratorProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<ClaudeRunSummary[]>([]);
  const [tasks, setTasks] = useState<HermesTask[]>([]);
  const historyRef = useRef(new Map<string, { last: number; deltas: number[] }>());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [r, t] = await Promise.all([
          hermesGet<ClaudeRunSummary[]>("/claude/runs"),
          hermesGet<HermesTask[]>("/tasks"),
        ]);
        if (!alive) return;
        // Historia de actividad: delta de toolCalls desde el poll anterior.
        const hist = historyRef.current;
        for (const run of r) {
          const h = hist.get(run.id) ?? { last: run.toolCalls, deltas: [] };
          if (hist.has(run.id)) {
            h.deltas.push(Math.max(0, run.toolCalls - h.last));
            if (h.deltas.length > SPARK_LEN) h.deltas.shift();
            h.last = run.toolCalls;
          }
          hist.set(run.id, h);
        }
        // Evita crecer sin límite: solo conservamos runs aún visibles.
        for (const id of hist.keys()) {
          if (!r.some((run) => run.id === id)) hist.delete(id);
        }
        setRuns(r);
        setTasks(t.filter((x) => x.status === "running"));
      } catch {
        if (alive) {
          setRuns([]);
          setTasks([]);
        }
      }
    };
    void load();
    const poll = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, []);

  const sparkFor = useCallback(
    (runId: string) => historyRef.current.get(runId)?.deltas ?? [],
    [],
  );

  const kill = useCallback(async (id: string) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, status: "error" as const } : r)));
    try {
      await hermesPost(`/claude/run/${id}/kill`);
    } catch {
      /* el próximo poll corrige el estado real */
    }
  }, []);

  return (
    <OrchestratorContext.Provider value={{ runs, tasks, sparkFor, kill }}>
      {children}
    </OrchestratorContext.Provider>
  );
}

export function useOrchestrator(): Orchestrator {
  const ctx = useContext(OrchestratorContext);
  if (!ctx) throw new Error("useOrchestrator requiere <OrchestratorProvider> en el árbol");
  return ctx;
}
