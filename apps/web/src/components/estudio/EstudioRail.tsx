"use client";

/**
 * Planeación del ESTUDIO: próxima sesión de grabación (checklist vivo),
 * colchón de piezas programadas (regla: ≥3 SIEMPRE), agenda de publicación
 * de los próximos 7 días y progreso del pipeline.
 */
import { useState } from "react";
import { STAGES, daysInStage, isStuck, stageReady } from "@hermes/shared";
import type { ContentSession } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RailRow, RailSection } from "@/components/ui/Rail";
import { pieceBeats, recordedCount } from "@/lib/script-beats";
import { PILLARS, STATUSES, STATUS_ORDER, fmtDays, fmtPublish } from "./labels";

const fieldCls =
  "h-8 rounded-sm border border-line bg-panel px-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

export function EstudioRail() {
  const { board, patchSession, createSession, buildBatch, setSelectedId, setRecording } =
    useEstudioContext();
  const [newTitle, setNewTitle] = useState("");
  const [newAt, setNewAt] = useState("");
  const [building, setBuilding] = useState(false);

  const now = Date.now();
  // Próxima sesión: la planeada/en curso más cercana; si no hay, la última.
  const upcoming =
    board.sessions
      .filter((s) => s.status === "planeada" || s.status === "en_curso")
      .sort(
        (a, b) =>
          new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
      )[0] ?? null;

  const buffer = board.pieces.filter(
    (p) => p.status === "programado" && p.publish_at && new Date(p.publish_at).getTime() >= now,
  ).length;

  const week = board.pieces
    .filter((p) => {
      if (!p.publish_at || p.status === "descartada" || p.status === "publicado") return false;
      const t = new Date(p.publish_at).getTime();
      return t >= now - 6 * 3_600_000 && t <= now + 7 * 86_400_000;
    })
    .sort((a, b) => new Date(a.publish_at!).getTime() - new Date(b.publish_at!).getTime());

  const counts = STATUS_ORDER.map((s) => ({
    status: s,
    n: board.pieces.filter((p) => p.status === s).length,
  }));

  const stuck = board.pieces
    .filter((p) => isStuck(p, now))
    .sort((a, b) => (daysInStage(b, now) ?? 0) - (daysInStage(a, now) ?? 0));

  // La etapa `grabacion` ES la lista de rodaje: lo que toca grabar en el batch.
  const porGrabar = board.pieces.filter((p) => p.status === "grabacion");

  // Cola de grabación: guiones que YA cumplen sus criterios de salida. La
  // auditoría 2026-08-10 encontró 8 así con 17 días esperando — esta sección
  // los pone en el camino y "armar el batch" los compromete de un clic.
  const listas = board.pieces.filter((p) => p.status === "guion" && stageReady(p));

  return (
    // Dos columnas que se leen por tema: a la izquierda lo que toca GRABAR, a
    // la derecha lo que va a SALIR. v5: secciones sin caja (RailSection) — la
    // única con marco es la sesión, porque es la que se opera.
    <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-8">
        {listas.length > 0 && (
          <RailSection
            label="Listas para grabar"
            right={<span className="text-2xs text-text-faint tabular-nums">{listas.length}</span>}
          >
            <div className="flex flex-col">
              {listas.map((p) => (
                <RailRow
                  key={p.id}
                  title={p.title}
                  sub={`${PILLARS[p.pillar].short} · guion listo hace ${fmtDays(daysInStage(p))}`}
                  onClick={() => setSelectedId(p.id)}
                />
              ))}
            </div>
            <div className="mt-2 px-2">
              <Button
                variant="primary"
                disabled={building}
                onClick={() => {
                  setBuilding(true);
                  void buildBatch(listas.map((p) => p.id)).finally(() => setBuilding(false));
                }}
                title="Crea la sesión del sábado con estas piezas y las pasa a grabación"
              >
                {building ? "Armando…" : `Armar batch del sábado (${listas.length})`}
              </Button>
            </div>
          </RailSection>
        )}

        <RailSection label="Próxima sesión">
          {upcoming ? (
            <SessionCard session={upcoming} onPatch={patchSession} />
          ) : (
            <form
              className="flex flex-col gap-2 rounded-md border border-line bg-panel p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTitle.trim()) return;
                void createSession({
                  title: newTitle.trim(),
                  scheduled_at: newAt ? new Date(newAt).toISOString() : undefined,
                  checklist: [
                    { label: "Guiones listos", done: false },
                    { label: "Equipo (mic · OBS · luz · disco)", done: false },
                  ],
                });
                setNewTitle("");
                setNewAt("");
              }}
            >
              <p className="text-sm text-text-dim">Sin sesión planeada.</p>
              <div className="flex flex-wrap gap-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Batch #N"
                  aria-label="Nombre de la sesión"
                  className={`${fieldCls} min-w-0 flex-1`}
                />
                <input
                  type="datetime-local"
                  value={newAt}
                  onChange={(e) => setNewAt(e.target.value)}
                  className={`${fieldCls} tabular-nums`}
                  aria-label="Fecha de la sesión"
                />
              </div>
              <div>
                <Button type="submit" disabled={!newTitle.trim()}>
                  Planear sesión
                </Button>
              </div>
            </form>
          )}
        </RailSection>

        {/* Lista de rodaje: qué se graba y cuánto de su guion ya está grabado.
            "Grabar" abre el teleprompter de esa pieza sin pasar por el workspace. */}
        {porGrabar.length > 0 && (
          <RailSection
            label="Por grabar"
            right={<span className="text-2xs text-text-faint tabular-nums">{porGrabar.length}</span>}
          >
            <div className="flex flex-col">
              {porGrabar.map((p) => {
                const beats = pieceBeats(p);
                const done = recordedCount(p, beats);
                const complete = beats.length > 0 && done === beats.length;
                return (
                  <div
                    key={p.id}
                    className="group flex items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-hover"
                  >
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className="min-w-0 flex-1 cursor-pointer truncate py-0.5 text-left text-sm text-text"
                    >
                      {p.title}
                    </button>
                    <span
                      className={`shrink-0 text-xs tabular-nums ${complete ? "text-green" : "text-text-faint"}`}
                      title="Bloques del guion con toma"
                    >
                      {done}/{beats.length}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => setRecording(p.id)}
                      title="Abrir el teleprompter de esta pieza"
                      disabled={!beats.length}
                    >
                      Grabar
                    </Button>
                  </div>
                );
              })}
            </div>
          </RailSection>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        {/* Colchón: regla de la casa, ≥3 programadas SIEMPRE. Bajo mínimo es
            estado (ámbar); sano, verde. */}
        <RailSection label="Colchón de piezas">
          <div className="flex items-center gap-3 px-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 w-8 rounded-full ${
                    i < buffer ? (buffer < 3 ? "bg-amber" : "bg-green") : "bg-selected"
                  }`}
                />
              ))}
            </div>
            <p className="text-sm text-text-dim">
              <span className="font-medium text-text tabular-nums">{buffer}/3</span> programadas
              {buffer < 3 ? " — bajo mínimo, el próximo batch debe reponer" : " — colchón sano"}
            </p>
          </div>
        </RailSection>

        <RailSection label="Próximos 7 días">
          {week.length ? (
            <div className="flex flex-col">
              {week.map((p) => (
                <RailRow
                  key={p.id}
                  title={p.title}
                  sub={fmtPublish(p.publish_at)}
                  value={PILLARS[p.pillar].short}
                  onClick={() => setSelectedId(p.id)}
                />
              ))}
            </div>
          ) : (
            <p className="px-2 text-sm text-text-faint">Nada agendado los próximos 7 días.</p>
          )}
        </RailSection>

        <RailSection label="Pipeline">
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 px-2 sm:grid-cols-6">
            {counts.map(({ status, n }) => (
              <div key={status} title={`${STAGES[status].meaning}\n${STAGES[status].work}`}>
                <div
                  className={`text-lg leading-tight font-semibold tabular-nums ${n ? "text-text" : "text-text-faint"}`}
                >
                  {n}
                </div>
                <div className="text-xs text-text-faint">{STATUSES[status].label}</div>
              </div>
            ))}
          </div>
        </RailSection>

        {/* Atascadas: llevan más días de los sanos en su etapa o ya se les pasó
            la fecha. Es el dato que evita que una pieza se muera en silencio. */}
        {stuck.length > 0 && (
          <RailSection
            label="Atascadas"
            right={<span className="text-2xs text-text-faint tabular-nums">{stuck.length}</span>}
          >
            <div className="flex flex-col">
              {stuck.slice(0, 4).map((p) => (
                <RailRow
                  key={p.id}
                  tone="amber"
                  title={p.title}
                  sub={STATUSES[p.status].label}
                  value={fmtDays(daysInStage(p))}
                  onClick={() => setSelectedId(p.id)}
                />
              ))}
            </div>
          </RailSection>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  onPatch,
}: {
  session: ContentSession;
  onPatch: (id: number, patch: Partial<Pick<ContentSession, "status" | "checklist">>) => Promise<ContentSession | null>;
}) {
  const toggle = (idx: number) =>
    void onPatch(session.id, {
      checklist: session.checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c)),
    });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text tabular-nums">
          {session.scheduled_at ? fmtPublish(session.scheduled_at) : session.title}
        </span>
        {session.status === "en_curso" && (
          <Badge tone="cyan" size="sm">
            Grabando
          </Badge>
        )}
      </div>
      {session.scheduled_at && <p className="-mt-1 text-xs text-text-faint">{session.title}</p>}
      <div className="-mx-1 flex flex-col">
        {session.checklist.map((c, i) => (
          <button
            key={`${c.label}-${i}`}
            onClick={() => toggle(i)}
            role="checkbox"
            aria-checked={c.done}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-hover"
          >
            <span
              aria-hidden
              className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-xs border ${
                c.done ? "border-accent-solid bg-accent-solid text-on-accent" : "border-line-2"
              }`}
            >
              {c.done && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </span>
            <span className={`text-sm ${c.done ? "text-text-faint line-through" : "text-text"}`}>
              {c.label}
            </span>
          </button>
        ))}
      </div>
      <div>
        {session.status === "planeada" ? (
          <Button variant="primary" onClick={() => void onPatch(session.id, { status: "en_curso" })}>
            Iniciar sesión
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void onPatch(session.id, { status: "completada" })}>
            Completar sesión
          </Button>
        )}
      </div>
    </div>
  );
}
