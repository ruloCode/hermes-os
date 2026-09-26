"use client";

// Riel de contexto del home: "qué sigue", no telemetría.
//
// Qué vive aquí y por qué (decidido con datos reales de uso, no a ojo):
// la voz es el 88% de las conversaciones (622 de 704) y el trabajo real son las
// tareas del VAULT — no la tabla `tasks`, que está vacía. Claude Usage tenía un
// gauge gigante para 8 ejecuciones históricas: se fue a un número en la topbar.
//
// Regla de oro del dashboard: todo dato visible es real. Cada bloque se omite
// solo si su fuente no responde (no hay placeholders).

import { useState } from "react";
import { useDashboard } from "@/state/DashboardProvider";
import { useHermesData } from "@/hooks/useHermesData";
import { useWorkspace } from "@/state/WorkspaceContext";
import { Rail, RailSection, RailRow } from "@/components/ui/Rail";
import { setHermesUrl } from "@/lib/hermes";

export function ContextRail() {
  const { snapshot } = useDashboard();
  const { projects } = useHermesData();
  const ws = useWorkspace();

  // Proyectos activos con tareas pendientes REALES del vault, los que más
  // cargan primero. El vault es la verdad de proyectos.
  const withPend = (p: (typeof projects)[number]) => ({
    ...p,
    pend: p.tareas_pendientes?.length ?? 0,
  });
  const active = projects
    .filter((p) => p.estado === "activo")
    .map(withPend)
    .sort((a, b) => b.pend - a.pend);
  // Los que NO están activos (archivado · por definir) viven detrás de "ver
  // más": el riel es para lo que sigue, pero el vault se desactualiza y un
  // proyecto dormido puede despertar — que estén a un clic, no invisibles.
  const resto = projects
    .filter((p) => p.estado !== "activo")
    .map(withPend)
    .sort((a, b) => (a.name ?? a.slug).localeCompare(b.name ?? b.slug, "es"));
  const [verTodos, setVerTodos] = useState(false);

  const events = snapshot?.calendar?.configured ? (snapshot.calendar.events ?? []) : [];
  const agenda = events.slice(0, 3);
  const jobs = (snapshot?.jobs ?? []).slice(0, 3);
  const k = snapshot?.knowledge;

  // Máquinas de la red interna: el snapshot ya trae la presencia de todas
  // (agent_presence), así que esto no abre ningún poll nuevo.
  const machines = snapshot?.presence ?? [];
  const onlineCount = machines.filter((m) => m.online).length;

  const fmtHora = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Rail>
      {agenda.length > 0 && (
        <RailSection label="Ahora">
          <div>
            {agenda.map((e) => {
              // startsInMin negativo = en curso (contrato de UpcomingCalendar)
              const enCurso = e.startsInMin < 0;
              return (
                <RailRow
                  key={e.id}
                  title={e.title}
                  sub={
                    enCurso
                      ? e.end
                        ? `En curso · termina ${fmtHora(e.end)}`
                        : "En curso"
                      : fmtHora(e.start)
                  }
                  tone={enCurso ? "green" : "line"}
                  value={enCurso ? <span className="text-green">●</span> : undefined}
                />
              );
            })}
          </div>
        </RailSection>
      )}

      {active.length + resto.length > 0 && (
        <RailSection label="Proyectos · vault">
          <div>
            {active.map((p) => (
              <RailRow
                key={p.slug}
                title={p.name ?? p.slug}
                sub={p.pend ? `${p.pend} tareas pendientes` : "Sin pendientes"}
                tone={ws.selectedProject === p.slug ? "accent" : p.pend > 0 ? "cyan" : "line"}
                value={p.pend || "✓"}
                onClick={() => ws.focusProject(p.slug)}
              />
            ))}
            {verTodos &&
              resto.map((p) => (
                <RailRow
                  key={p.slug}
                  title={p.name ?? p.slug}
                  // El estado real del vault, no un adorno: por eso está abajo.
                  sub={p.estado ?? "sin estado"}
                  tone={ws.selectedProject === p.slug ? "accent" : "line"}
                  value={p.pend || undefined}
                  onClick={() => ws.focusProject(p.slug)}
                />
              ))}
          </div>
          {resto.length > 0 && (
            <button
              type="button"
              onClick={() => setVerTodos((v) => !v)}
              className="cursor-pointer self-start text-2xs text-text-faint transition-colors hover:text-accent"
            >
              {verTodos ? "− Ver menos" : `+ Ver ${resto.length} más`}
            </button>
          )}
        </RailSection>
      )}

      {/* MÁQUINAS de la red interna. Solo aparece cuando hay más de una: con
            un solo PC no hay nada que elegir y el riel es para lo que sigue. */}
      {machines.length > 1 && (
        <RailSection
          label="Máquinas"
          right={<span className="text-2xs text-text-faint">{onlineCount} en línea</span>}
        >
          <div>
            {machines.map((m) => {
              const caps = m.capabilities;
              // Subtítulo honesto: qué es y qué le falta, no adornos.
              const falta = caps
                ? [!caps.vault && "sin vault", !caps.runs && "sin claude"]
                    .filter(Boolean)
                    .join(" · ")
                : "";
              const sub = [m.os ?? "—", falta].filter(Boolean).join(" · ");
              const trabajando = m.status === "working" || m.status === "thinking";
              return (
                <RailRow
                  key={m.machine}
                  title={m.machine}
                  sub={m.currentTask ?? sub}
                  tone={m.self ? "accent" : !m.online ? "line" : trabajando ? "cyan" : "green"}
                  value={
                    m.self ? "aquí" : !m.online ? "offline" : trabajando ? "trabajando" : "libre"
                  }
                  // Cambiar de máquina = apuntar este browser a su agente.
                  // Sin baseUrl publicada no hay a dónde apuntar.
                  onClick={
                    m.self || !m.online || !m.baseUrl
                      ? undefined
                      : () => {
                          setHermesUrl(m.baseUrl);
                          location.reload();
                        }
                  }
                />
              );
            })}
          </div>
        </RailSection>
      )}

      {jobs.length > 0 && (
        <RailSection label="Pulso">
          <div className="flex flex-col gap-1.5">
            {jobs.map((j) => (
              <div key={j.name} className="flex items-center gap-2.5 text-2xs text-text-faint">
                <span
                  className={`h-1 w-1 shrink-0 rounded-full ${
                    j.lastResult === "error"
                      ? "bg-red"
                      : j.lastResult === "ok"
                        ? "bg-green"
                        : "bg-accent"
                  }`}
                />
                <span className="truncate text-text-dim">{j.name}</span>
                <span className="ml-auto shrink-0 opacity-70">
                  {j.lastRunAt ? fmtHora(j.lastRunAt) : "—"}
                </span>
              </div>
            ))}
          </div>
        </RailSection>
      )}

      {k?.available && (
        <RailSection label="Conocimiento">
          <div className="text-xl text-text">
            {k.total.toLocaleString("es-CO")}
            <span className="ml-1.5 text-2xs text-text-faint">fuentes</span>
          </div>
          <p className="text-2xs leading-relaxed text-text-faint">
            {k.conversationVoice} voz · {k.memories} memorias · {k.conversationText} texto ·{" "}
            {k.vaultDocs} vault · {k.meetings} juntas
          </p>
        </RailSection>
      )}
    </Rail>
  );
}
