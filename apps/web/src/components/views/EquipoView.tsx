"use client";

// TU EQUIPO (/equipo): en el PC lo mismo que la pestaña Equipo de Hermes Phone —
// los agentes del dueño como personajes y su estado en vivo. Lista a la
// izquierda (lo que te necesita primero), el detalle del elegido a la derecha.
//
// Todo dato visible es real: cada miembro sale de una ruta del agente y, si esa
// ruta no contesta, sus miembros no aparecen (y una línea ámbar dice por qué).
// La lógica es la del teléfono, portada a `lib/team.ts` con sus contratos.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { BotAvatar } from "@/components/equipo/BotAvatar";
import { ApprovalCard } from "@/components/equipo/ApprovalCard";
import { MemberDetail } from "@/components/equipo/MemberDetail";
import { useTeam } from "@/hooks/useTeam";
import { headline, statusWord, type Member } from "@/lib/team";

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

export function EquipoView({ active }: { active: boolean }) {
  const { state: st, decide, runNow, setEnabled } = useTeam(active);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => st.members.find((m) => m.id === selectedId) ?? null, [st.members, selectedId]);
  const byApproval = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of st.members) if (m.approvalId) map.set(m.approvalId, m);
    return map;
  }, [st.members]);

  const close = useCallback(() => setSelectedId(null), []);

  // Esc cierra el detalle (si no estás escribiendo).
  useEffect(() => {
    if (!active || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selectedId, close]);

  const loaded = st.fetchedAt !== 0;
  const meta = !loaded
    ? st.offline
      ? "No alcanzo a tu Mac"
      : "Buscando a tu equipo…"
    : headline(st.members);

  const notices: string[] = [];
  if (st.offline)
    notices.push(
      loaded
        ? `Sin conexión con tu Mac: esto es lo último que vi, a las ${hhmm(st.fetchedAt)}.`
        : "Tu Mac no contesta: sin ella no veo a tu equipo. Vuelvo a intentar en unos segundos.",
    );
  else if (st.cloudIssue) notices.push(st.cloudIssue);

  const showDetail = selectedId != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader title="Tu equipo" meta={<span className="tabular-nums">{meta}</span>} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        {/* La lista: bajo lg, el detalle la reemplaza. */}
        <ScrollArea fade="y" className={`min-h-0 ${showDetail ? "max-lg:hidden" : ""}`}>
          <div className="flex flex-col gap-4 pb-6">
            {notices.map((n) => (
              <p key={n} className="flex items-start gap-2 text-sm text-amber">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                {n}
              </p>
            ))}

            {st.approvals.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Te necesitan">
                {st.approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    member={byApproval.get(a.id) ?? null}
                    onDecide={(allow, note) => decide(a.id, allow, note)}
                  />
                ))}
              </section>
            )}

            {st.members.length > 0 && (
              <ul className="flex flex-col">
                {st.members.map((m) => (
                  <li key={m.id}>
                    <MemberRow member={m} selected={m.id === selectedId} onOpen={() => setSelectedId(m.id)} />
                  </li>
                ))}
              </ul>
            )}

            {!loaded && !st.offline && (
              <div className="flex flex-col gap-3" role="status" aria-label="Buscando a tu equipo">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-1">
                    <div className="skeleton h-10 w-10 rounded-full" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className="skeleton h-3 w-1/3" />
                      <div className="skeleton h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loaded && !st.offline && st.members.length === 0 && (
              <p className="py-8 text-center text-sm text-text-dim">
                Todavía no tienes agentes. Crea el primero desde Hermes Phone o pídeselo a Hermes.
              </p>
            )}
          </div>
        </ScrollArea>

        <section
          aria-label="Detalle del agente"
          className={`min-h-0 lg:border-l lg:border-line lg:pl-6 ${showDetail ? "" : "max-lg:hidden"}`}
        >
          {selected ? (
            <MemberDetail
              key={selected.id}
              member={selected}
              worker={selected.workerId ? (st.workers.get(selected.workerId) ?? null) : null}
              task={selected.taskId ? (st.tasks.get(selected.taskId) ?? null) : null}
              cloud={selected.cloudId ? (st.cloud.get(selected.cloudId) ?? null) : null}
              approval={selected.approvalId ? (st.approvals.find((a) => a.id === selected.approvalId) ?? null) : null}
              active={active}
              onDecide={decide}
              onRunNow={runNow}
              onSetEnabled={setEnabled}
              onClose={close}
            />
          ) : selectedId ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-text-dim">Este agente ya terminó y salió de la oficina.</p>
              <button
                type="button"
                onClick={close}
                className="cursor-pointer text-sm text-accent hover:underline"
              >
                Volver al equipo
              </button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="max-w-[36ch] text-center text-sm text-text-faint">
                Elige a alguien de tu equipo para ver qué hace, sus corridas o su conversación.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MemberRow({ member: m, selected, onOpen }: { member: Member; selected: boolean; onOpen: () => void }) {
  const needs = m.status === "NEEDS_YOU";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      aria-label={`${m.name}, ${statusWord(m.status)}${m.where ? `, ${m.where}` : ""}: ${m.line}`}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-2.5 text-left transition-colors ${
        selected ? "bg-selected" : "hover:bg-hover"
      }`}
    >
      <BotAvatar look={m.look} status={m.status} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-text">{m.name}</span>
          {m.where && <span className="shrink-0 text-xs text-text-faint">{m.where}</span>}
          {m.time && (
            <span className={`ml-auto shrink-0 text-xs tabular-nums ${needs ? "text-amber" : "text-text-faint"}`}>
              {m.time}
            </span>
          )}
        </span>
        <span className={`mt-0.5 block truncate text-sm ${needs ? "text-text" : "text-text-dim"}`}>{m.line}</span>
      </span>
    </button>
  );
}
