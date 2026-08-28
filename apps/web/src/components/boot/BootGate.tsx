"use client";

// Conecta el <BootLoader/> a la carga REAL de la app. Vive dentro del árbol de
// providers, así que lee las mismas señales que ya alimentan el dashboard —
// sin abrir polls nuevos:
//   · HermesData `online`  → datos críticos listos (proyectos + memoria + stats)
//   · Dashboard `snapshot` → agregador /dashboard (jobs, sistema, agenda…)
//   · AgentEvents `connected` → socket SSE del bus de actividad
// El progreso se reparte entre esas fases; cuando lo crítico está listo (con un
// piso de exhibición anti-parpadeo) se completa, hace fade y se desmonta. Si el
// agente está offline nada de esto resuelve: un tope duro dispara igual para no
// dejar la cortina colgada.

import { useEffect, useRef, useState } from "react";
import { useHermesDataContext } from "@/state/HermesDataProvider";
import { useDashboard } from "@/state/DashboardProvider";
import { useAgentEventsContext } from "@/state/AgentEventsProvider";
import { BootLoader } from "./BootLoader";

const MIN_MS = 1200;   // exhibición mínima antes de completar (anti-parpadeo)
const SOFT_MS = 2400;  // ya hay datos críticos pero falta el snapshot → no esperes más
const HARD_MS = 6500;  // tope: dispara aunque el agente esté offline

export function BootGate({ children }: { children: React.ReactNode }) {
  const { online, projects } = useHermesDataContext();
  const { snapshot } = useDashboard();
  const { connected } = useAgentEventsContext();

  const [showLoader, setShowLoader] = useState(true);
  const [progress, setProgress] = useState(6);
  const [finish, setFinish] = useState(false);
  const startRef = useRef<number | null>(null);

  // Marca de tiempo de arranque (cliente).
  useEffect(() => {
    startRef.current = performance.now();
  }, []);

  // Progreso ponderado por fuentes reales. Discreto (salta al resolver cada
  // fase); el BootLoader lo suaviza. Monótono vía Math.max.
  useEffect(() => {
    if (!showLoader) return;
    let p = 6;
    if (online) p += 50;      // datos críticos (proyectos + memoria + stats)
    if (snapshot) p += 26;    // agregador /dashboard (jobs, sistema, agenda…)
    if (connected) p += 18;   // socket SSE de actividad
    setProgress((prev) => Math.max(prev, p));
  }, [showLoader, online, snapshot, connected]);

  // Trickle inicial: mientras el primer fetch está en vuelo, sube suave para
  // que la barra respire (nunca sobrepasa a las señales reales, que empiezan
  // en 56 al quedar `online`).
  useEffect(() => {
    if (!showLoader) return;
    const raise = (v: number) => setProgress((prev) => Math.max(prev, v));
    const timers = [
      setTimeout(() => raise(18), 250),
      setTimeout(() => raise(30), 650),
      setTimeout(() => raise(40), 1100),
    ];
    return () => timers.forEach(clearTimeout);
  }, [showLoader]);

  // Decide cuándo completar. Se re-evalúa cuando cambian las señales críticas;
  // un intervalo ligero cubre los umbrales de tiempo (no re-renderiza salvo que
  // dispare).
  useEffect(() => {
    if (!showLoader || finish) return;
    const start = startRef.current ?? performance.now();
    const check = () => {
      const e = performance.now() - start;
      const ready =
        (online && snapshot && e >= MIN_MS) || // caso ideal: todo listo
        (online && e >= SOFT_MS) ||            // críticos listos, snapshot lento
        (e >= HARD_MS);                        // tope duro (agente offline)
      if (ready) setFinish(true);
    };
    const id = setInterval(check, 150);
    check();
    return () => clearInterval(id);
  }, [showLoader, finish, online, snapshot]);

  // Labels de los nodos: nombres de proyecto si ya están en el cliente; si no,
  // el BootLoader cae a los hardcodeados del asset.
  const labels = projects.length
    ? projects.map((p) => p.name.toUpperCase()).slice(0, 11)
    : undefined;

  return (
    <>
      {children}
      {showLoader && (
        <BootLoader
          progress={progress}
          finish={finish}
          labels={labels}
          onDone={() => setShowLoader(false)}
        />
      )}
    </>
  );
}
