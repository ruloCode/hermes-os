"use client";

/**
 * Riel del ESTUDIO: próxima sesión de grabación (checklist vivo), colchón de
 * piezas programadas (regla: ≥3 SIEMPRE), agenda de publicación de los
 * próximos 7 días y progreso del pipeline.
 */
import { useState } from "react";
import { STAGES, daysInStage, isStuck, stageReady } from "@hermes/shared";
import type { ContentSession } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { pieceBeats, recordedCount } from "@/lib/script-beats";
import { PILLARS, STATUSES, STATUS_ORDER, fmtDays, fmtPublish } from "./labels";

const btnCls =
  "rounded-sm border border-line-2 bg-panel-2 px-2.5 py-1 text-2xs tracking-label text-text uppercase hover:border-violet";

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
    <>
      {listas.length > 0 && (
        <Panel title="Listas para grabar" delay={100} tone="violet" className="shrink-0">
          <div className="flex flex-col">
            {listas.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className="flex items-baseline gap-2 rounded-xs px-0.5 py-0.5 text-left hover:bg-panel-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-text-dim hover:text-text">
                  {p.title}
                </span>
                <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                  {fmtDays(daysInStage(p))}
                </span>
                <Badge tone={PILLARS[p.pillar].tone} variant="solid" size="sm">
                  {PILLARS[p.pillar].short}
                </Badge>
              </button>
            ))}
          </div>
          <button
            className={`${btnCls} mt-1.5 w-full`}
            disabled={building}
            onClick={() => {
              setBuilding(true);
              void buildBatch(listas.map((p) => p.id)).finally(() => setBuilding(false));
            }}
            title="Crea la sesión del sábado con estas piezas y las pasa a grabación"
          >
            {building ? "Armando…" : `⛭ Armar batch del sábado (${listas.length})`}
          </button>
        </Panel>
      )}
      <Panel title="Próxima sesión" delay={140} tone="cyan" className="shrink-0">
        {upcoming ? (
          <SessionCard session={upcoming} onPatch={patchSession} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-text-faint">Sin sesión planeada.</p>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Batch #N"
              className="rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-violet focus:outline-none"
            />
            <input
              type="datetime-local"
              value={newAt}
              onChange={(e) => setNewAt(e.target.value)}
              className="rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text tabular-nums focus:border-violet focus:outline-none"
              aria-label="Fecha de la sesión"
            />
            <button
              className={btnCls}
              onClick={() => {
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
              ＋ Planear sesión
            </button>
          </div>
        )}

        {/* Lista de rodaje: qué se graba y cuánto de su guion ya está grabado.
            ▶ abre el teleprompter de esa pieza sin pasar por el workspace. */}
        {porGrabar.length > 0 && (
          <div className="mt-2 border-t border-line pt-1.5">
            <p className="text-2xs tracking-label text-text-faint uppercase">
              Por grabar · {porGrabar.length}
            </p>
            <div className="mt-1 flex flex-col">
              {porGrabar.map((p) => {
                const beats = pieceBeats(p);
                const done = recordedCount(p, beats);
                return (
                  <div key={p.id} className="flex items-center gap-2 rounded-xs px-0.5 py-0.5">
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className="min-w-0 flex-1 truncate text-left text-xs text-text-dim hover:text-text"
                    >
                      {p.title}
                    </button>
                    <span
                      className={`shrink-0 text-2xs tabular-nums ${
                        beats.length && done === beats.length ? "text-green" : "text-text-faint"
                      }`}
                    >
                      {done}/{beats.length}
                    </span>
                    <button
                      onClick={() => setRecording(p.id)}
                      title="Abrir el teleprompter de esta pieza"
                      disabled={!beats.length}
                      className="shrink-0 rounded-xs border border-line-2 px-1.5 text-2xs text-text-dim hover:border-red hover:text-red disabled:opacity-35"
                    >
                      ▶
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Colchón de piezas"
        delay={180}
        variant={buffer < 3 ? "alert" : "default"}
        tone={buffer < 3 ? "amber" : "green"}
        className="shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2.5 w-7 rounded-xs"
                style={{
                  background:
                    i < buffer
                      ? buffer < 3
                        ? "var(--color-amber)"
                        : "var(--color-green)"
                      : "var(--color-line-2)",
                }}
              />
            ))}
          </div>
          <p className="text-xs text-text-dim">
            <span className="font-display tabular-nums">{buffer}/3</span> programadas
            {buffer < 3 ? " — bajo mínimo, el próximo batch debe reponer" : " — colchón sano"}
          </p>
        </div>
      </Panel>

      <Panel title="Próximos 7 días" delay={220} className="shrink-0">
        {week.length ? (
          <div className="flex flex-col gap-1">
            {week.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className="flex items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-panel-2"
              >
                <span className="w-24 shrink-0 text-2xs text-cyan uppercase tabular-nums">
                  {fmtPublish(p.publish_at)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-text">{p.title}</span>
                <Badge tone={PILLARS[p.pillar].tone} variant="solid" size="sm">
                  {PILLARS[p.pillar].short}
                </Badge>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-faint">Nada agendado los próximos 7 días.</p>
        )}
      </Panel>

      <Panel title="Pipeline" delay={260} className="shrink-0">
        <div className="grid grid-cols-3 gap-1.5">
          {counts.map(({ status, n }) => (
            <div
              key={status}
              className="rounded-sm bg-panel-2 px-2 py-1.5"
              title={`${STAGES[status].meaning}\n${STAGES[status].work}`}
            >
              <div className="font-display text-sm text-text tabular-nums">{n}</div>
              <div className="text-2xs tracking-label text-text-faint uppercase">
                {STATUSES[status].label}
              </div>
            </div>
          ))}
        </div>
        {/* Atascadas: llevan más días de los sanos en su etapa o ya se les pasó
            la fecha. Es el dato que evita que una pieza se muera en silencio. */}
        {stuck.length > 0 && (
          <div className="mt-2 border-t border-line pt-1.5">
            <p className="text-2xs tracking-label text-amber uppercase">
              Atascadas · {stuck.length}
            </p>
            <div className="mt-1 flex flex-col">
              {stuck.slice(0, 4).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="flex items-baseline gap-2 rounded-xs px-0.5 py-0.5 text-left hover:bg-panel-2"
                >
                  <span className="w-16 shrink-0 text-2xs text-amber uppercase tabular-nums">
                    {fmtDays(daysInStage(p))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-dim">{p.title}</span>
                  <span className="shrink-0 text-2xs text-text-faint uppercase">
                    {STATUSES[p.status].label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </>
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm text-text tabular-nums">
          {session.scheduled_at ? fmtPublish(session.scheduled_at) : session.title}
        </span>
        {session.status === "en_curso" && (
          <span className="text-2xs tracking-label text-red uppercase">● grabando</span>
        )}
      </div>
      {session.scheduled_at && <p className="text-2xs text-text-dim">{session.title}</p>}
      <div className="flex flex-col">
        {session.checklist.map((c, i) => (
          <button
            key={`${c.label}-${i}`}
            onClick={() => toggle(i)}
            className="flex items-baseline gap-2 px-0.5 py-0.5 text-left"
          >
            <span className={`text-2xs ${c.done ? "text-green" : "text-text-faint"}`}>
              {c.done ? "[✓]" : "[ ]"}
            </span>
            <span className={`text-xs ${c.done ? "text-text-faint" : "text-text-dim"}`}>
              {c.label}
            </span>
          </button>
        ))}
      </div>
      {session.status === "planeada" ? (
        <button className={btnCls} onClick={() => void onPatch(session.id, { status: "en_curso" })}>
          ▶ Iniciar sesión
        </button>
      ) : (
        <button className={btnCls} onClick={() => void onPatch(session.id, { status: "completada" })}>
          ✓ Completar sesión
        </button>
      )}
    </div>
  );
}
