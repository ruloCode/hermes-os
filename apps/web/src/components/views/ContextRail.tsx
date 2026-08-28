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

import { useDashboard } from "@/state/DashboardProvider";
import { useHermesData } from "@/hooks/useHermesData";
import { useWorkspace } from "@/state/WorkspaceContext";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { setHermesUrl } from "@/lib/hermes";

function Eyebrow({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-2xs tracking-label text-text-faint uppercase">{children}</span>
      {right}
    </div>
  );
}

/** Fila sin panel: hairline + aire. La jerarquía la da la barra de color. */
function Row({
  title,
  sub,
  value,
  tone = "line",
  onClick,
}: {
  title: string;
  sub?: string;
  value?: React.ReactNode;
  tone?: "line" | "violet" | "cyan" | "green";
  onClick?: () => void;
}) {
  const bar =
    tone === "violet"
      ? "bg-violet shadow-[0_0_8px_rgb(167_139_250_/_0.6)]"
      : tone === "cyan"
        ? "bg-cyan shadow-[0_0_8px_rgb(103_232_249_/_0.5)]"
        : tone === "green"
          ? "bg-green shadow-[0_0_8px_rgb(110_231_160_/_0.5)]"
          : "bg-line-2";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="group flex w-full items-center gap-2.5 border-t border-line/50 py-2 text-left first:border-t-0 enabled:cursor-pointer"
    >
      <span className={`h-5.5 w-0.5 shrink-0 rounded-xs ${bar}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text transition-colors group-enabled:group-hover:text-violet">
          {title}
        </span>
        {sub && <span className="mt-0.5 block text-2xs text-text-faint">{sub}</span>}
      </span>
      {value != null && <span className="shrink-0 text-2xs text-text-dim">{value}</span>}
    </button>
  );
}

export function ContextRail() {
  const { snapshot } = useDashboard();
  const { projects } = useHermesData();
  const ws = useWorkspace();

  // Proyectos activos con tareas pendientes REALES del vault, los que más
  // cargan primero. El vault es la verdad de proyectos.
  const active = projects
    .filter((p) => p.estado === "activo")
    .map((p) => ({ ...p, pend: p.tareas_pendientes?.length ?? 0 }))
    .sort((a, b) => b.pend - a.pend);

  const events = snapshot?.calendar?.configured ? (snapshot.calendar.events ?? []) : [];
  const agenda = events.slice(0, 3);
  const jobs = (snapshot?.jobs ?? []).slice(0, 3);
  const k = snapshot?.knowledge;

  // Máquinas de la red interna: el snapshot ya trae la presencia de todas
  // (agent_presence), así que esto no abre ningún poll nuevo.
  const machines = snapshot?.presence ?? [];
  const onlineCount = machines.filter((m) => m.online).length;

  const fmtHora = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

  return (
    <ScrollArea rail fade="y" className="h-full px-5 py-5">
      <div className="flex flex-col gap-6">
        {agenda.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <Eyebrow>Ahora</Eyebrow>
            <div>
              {agenda.map((e) => {
                // startsInMin negativo = en curso (contrato de UpcomingCalendar)
                const enCurso = e.startsInMin < 0;
                return (
                  <Row
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
          </section>
        )}

        {active.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <Eyebrow>Proyectos · vault</Eyebrow>
            <div>
              {active.map((p) => (
                <Row
                  key={p.slug}
                  title={p.name ?? p.slug}
                  sub={p.pend ? `${p.pend} tareas pendientes` : "Sin pendientes"}
                  tone={ws.selectedProject === p.slug ? "violet" : p.pend > 0 ? "cyan" : "line"}
                  value={p.pend || "✓"}
                  onClick={() => ws.focusProject(p.slug)}
                />
              ))}
            </div>
          </section>
        )}

        {/* MÁQUINAS de la red interna. Solo aparece cuando hay más de una: con
            un solo PC no hay nada que elegir y el riel es para lo que sigue. */}
        {machines.length > 1 && (
          <section className="flex flex-col gap-2.5">
            <Eyebrow right={<span className="text-2xs text-text-faint">{onlineCount} en línea</span>}>
              Máquinas
            </Eyebrow>
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
                  <Row
                    key={m.machine}
                    title={m.machine}
                    sub={m.currentTask ?? sub}
                    tone={m.self ? "violet" : !m.online ? "line" : trabajando ? "cyan" : "green"}
                    value={
                      m.self
                        ? "aquí"
                        : !m.online
                          ? "offline"
                          : trabajando
                            ? "trabajando"
                            : "libre"
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
          </section>
        )}

        {jobs.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <Eyebrow>Pulso</Eyebrow>
            <div className="flex flex-col gap-1.5">
              {jobs.map((j) => (
                <div key={j.name} className="flex items-center gap-2.5 text-2xs text-text-faint">
                  <span
                    className={`h-1 w-1 shrink-0 rounded-full ${
                      j.lastResult === "error" ? "bg-red" : j.lastResult === "ok" ? "bg-green" : "bg-violet"
                    }`}
                  />
                  <span className="truncate text-text-dim">{j.name}</span>
                  <span className="ml-auto shrink-0 opacity-70">
                    {j.lastRunAt ? fmtHora(j.lastRunAt) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {k?.available && (
          <section className="flex flex-col gap-2">
            <Eyebrow>Conocimiento</Eyebrow>
            <div className="text-xl text-text">
              {k.total.toLocaleString("es-CO")}
              <span className="ml-1.5 text-2xs text-text-faint">fuentes</span>
            </div>
            <p className="text-2xs leading-relaxed text-text-faint">
              {k.conversationVoice} voz · {k.memories} memorias · {k.conversationText} texto ·{" "}
              {k.vaultDocs} vault · {k.meetings} juntas
            </p>
          </section>
        )}
      </div>
    </ScrollArea>
  );
}
