"use client";

// EL DETALLE DE UN MIEMBRO (/equipo, panel derecho). Puerto de `TeamChat.kt` y
// `TeamDetail.kt` de Hermes Phone:
//  - Nube: su conversación (la sesión de Managed Agents), lo que hace en este
//    turno, el compositor y "Nueva conversación".
//  - Tarea programada: qué hace, cuándo, su última salida, sus corridas,
//    "Correr ahora" y pausar/reanudar.
//  - Sesión viva: sus últimas líneas y la tool del momento.

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { fetchRuns, useCloudChat } from "@/hooks/useTeam";
import {
  sleepLine,
  statusWord,
  timeLabel,
  toolLine,
  type Approval,
  type CloudAgent,
  type Member,
  type Run,
  type Scheduled,
  type Worker,
} from "@/lib/team";
import { ApprovalCard } from "./ApprovalCard";
import { BotAvatar } from "./BotAvatar";

const ICON = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium text-text-faint">{children}</h3>;
}

export function MemberDetail({
  member: m,
  worker,
  task,
  cloud,
  approval,
  active,
  onDecide,
  onRunNow,
  onSetEnabled,
  onClose,
}: {
  member: Member;
  worker: Worker | null;
  task: Scheduled | null;
  cloud: CloudAgent | null;
  approval: Approval | null;
  /** La vista se ve: solo así se vigila la conversación de la nube. */
  active: boolean;
  onDecide: (approvalId: string, allow: boolean, note?: string) => Promise<string | null>;
  onRunNow: (taskId: string) => Promise<string | null>;
  onSetEnabled: (taskId: string, enabled: boolean) => Promise<string | null>;
  onClose: () => void;
}) {
  const chat = useCloudChat(m.kind === "CLOUD" ? (m.cloudId ?? null) : null, active);
  const cost = m.kind === "CLOUD" ? (chat.costUsd ?? cloud?.costUsd ?? 0) : 0;
  const sub = [m.where, statusWord(m.status), cost > 0 ? `US$${cost.toFixed(2)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line pb-3">
        <BotAvatar look={m.look} status={m.status} size={44} label={`${m.name}, ${statusWord(m.status)}`} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-md font-semibold text-text">{m.name}</h2>
          <p className="truncate text-xs text-text-faint tabular-nums">{sub}</p>
        </div>
        {m.kind === "CLOUD" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void chat.newChat()}
            disabled={chat.working}
            title="Empezar de cero con este agente"
            icon={
              <svg {...ICON}>
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
          >
            Nueva conversación
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Cerrar detalle"
          title="Cerrar (Esc)"
          className="px-1.5"
        >
          <svg {...ICON}>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </Button>
      </header>

      {m.kind === "CLOUD" ? (
        <CloudChat member={m} cloud={cloud} chat={chat} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-4 pb-6">
          <div className="flex max-w-2xl flex-col gap-6">
            {approval && (
              <ApprovalCard approval={approval} member={m} onDecide={(allow, note) => onDecide(approval.id, allow, note)} />
            )}
            {worker && <WorkerCard member={m} worker={worker} />}
            {task && <TaskInfo task={task} member={m} onRunNow={onRunNow} onSetEnabled={onSetEnabled} />}
            {!worker && !task && <p className="text-sm text-text-dim">Sin más detalles por ahora.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sesión viva ──────────────────────────────────────────────────────────

function WorkerCard({ member: m, worker: w }: { member: Member; worker: Worker }) {
  const working = m.status === "WORKING" || m.status === "NEEDS_YOU";
  const place = m.where || "Mac";
  const secs = w.startedAt != null ? Math.max(0, Math.round(((w.finishedAt ?? Date.now()) - w.startedAt) / 1000)) : null;
  const tool = working ? toolLine(w.toolName, w.toolTarget) : null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold text-text">
          {working ? `Trabajando en tu ${place}` : `Trabajó en tu ${place}`}
        </span>
        {secs != null && (
          <span className="font-mono text-xs text-text-faint tabular-nums">
            {secs < 90 ? `${secs} s` : `${Math.floor(secs / 60)} min`}
          </span>
        )}
      </div>
      {tool && <p className="text-sm text-text">{tool}</p>}
      {w.lines.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-sm bg-bg p-2.5 font-mono text-xs leading-relaxed text-text-dim">
          {w.lines.slice(-8).map((l, i) => (
            <p key={i} className="line-clamp-2 break-words">
              {l}
            </p>
          ))}
        </div>
      )}
      {w.toolCalls > 0 && <p className="text-xs text-text-faint tabular-nums">{w.toolCalls} pasos</p>}
    </section>
  );
}

// ── Tarea programada ─────────────────────────────────────────────────────

function TaskInfo({
  task: t,
  member: m,
  onRunNow,
  onSetEnabled,
}: {
  task: Scheduled;
  member: Member;
  onRunNow: (taskId: string) => Promise<string | null>;
  onSetEnabled: (taskId: string, enabled: boolean) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [runsKey, setRunsKey] = useState(0);
  const now = Date.now();
  const when = t.whenText ? t.whenText.charAt(0).toUpperCase() + t.whenText.slice(1) : t.cron;
  const sleep = t.enabled ? sleepLine(t.nextRunAt, now) : null;
  const failed = t.lastStatus != null && t.lastStatus !== "ok" && t.lastStatus !== "running";

  useEffect(() => {
    setMsg(null);
    setConfirmRun(false);
  }, [t.id]);

  const run = async () => {
    setConfirmRun(false);
    setBusy(true);
    const err = await onRunNow(t.id);
    setMsg(err ? { text: err, tone: "error" } : { text: "Lanzada: aparece aquí trabajando y en sus corridas al terminar.", tone: "ok" });
    setBusy(false);
    setRunsKey((k) => k + 1);
  };

  const toggle = async () => {
    setBusy(true);
    const err = await onSetEnabled(t.id, !t.enabled);
    setMsg(err ? { text: err, tone: "error" } : null);
    setBusy(false);
  };

  return (
    <>
      <section className="flex flex-col gap-1">
        <Label>Cuándo</Label>
        <p className="text-sm text-text">{when}</p>
        {sleep && <p className="text-sm text-text-dim">{sleep}</p>}
        {!t.enabled && <p className="text-sm text-amber">En pausa: no correrá hasta que la reanudes.</p>}
      </section>

      {t.prompt && (
        <section className="flex flex-col gap-1">
          <Label>Lo que hace</Label>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-text">{t.prompt}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        {confirmRun ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-2 bg-panel p-3">
            <p className="min-w-0 flex-1 text-sm text-text">
              ¿Correr «{t.title}» ahora? Se ejecuta en tu {m.where || "Mac"} con lo que tiene programado.
            </p>
            <Button size="md" onClick={() => setConfirmRun(false)}>
              Cancelar
            </Button>
            <Button size="md" variant="primary" onClick={() => void run()}>
              Correr
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="md" variant="primary" disabled={busy} onClick={() => setConfirmRun(true)}>
              Correr ahora
            </Button>
            <Button size="md" disabled={busy} onClick={() => void toggle()}>
              {t.enabled ? "Pausar" : "Reanudar"}
            </Button>
          </div>
        )}
        {msg && <p className={`text-xs ${msg.tone === "error" ? "text-red" : "text-text-dim"}`}>{msg.text}</p>}
      </section>

      {t.lastOutput && (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label>Última salida</Label>
            {t.lastRunAt != null && (
              <span className="text-xs text-text-faint tabular-nums">
                · {timeLabel(t.lastRunAt, now)}
                {failed ? " · falló" : ""}
              </span>
            )}
          </div>
          <div className="text-sm">
            <Markdown source={t.lastOutput} />
          </div>
        </section>
      )}

      <Runs taskId={t.id} reload={runsKey} />
    </>
  );
}

function Runs({ taskId, reload }: { taskId: string; reload: number }) {
  const [runs, setRuns] = useState<Run[] | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setRuns(undefined);
    void fetchRuns(taskId).then((r) => alive && setRuns(r));
    return () => {
      alive = false;
    };
  }, [taskId, reload]);

  return (
    <section className="flex flex-col gap-1.5">
      <Label>Corridas</Label>
      {runs === undefined ? (
        <p className="text-sm text-text-faint">Cargando…</p>
      ) : runs === null ? (
        <p className="text-sm text-text-faint">No pude leer sus corridas.</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-text-faint">Todavía no ha corrido.</p>
      ) : (
        <ul className="flex flex-col">
          {runs.slice(0, 10).map((r) => {
            const ok = r.status === "ok";
            const dot = ok ? "bg-green" : r.status === "running" ? "bg-cyan" : "bg-red";
            const isOpen = open === r.id;
            return (
              <li key={r.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  aria-expanded={isOpen}
                  disabled={!r.output}
                  className="flex w-full items-center gap-2.5 rounded-sm px-1.5 py-2 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-hover"
                >
                  <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                  <span className="min-w-0 flex-1 text-sm text-text tabular-nums">{timeLabel(r.startedAt, Date.now())}</span>
                  <span className="text-xs text-text-faint">
                    {ok ? "bien" : r.status === "running" ? "corriendo" : r.status || "—"}
                  </span>
                </button>
                {isOpen && r.output && (
                  <div className="px-1.5 pb-3 text-sm">
                    <Markdown source={r.output} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Agente en la nube ────────────────────────────────────────────────────

const CLOUD_SUGGESTIONS = ["¿Qué sabes hacer?", "Hazlo ahora y cuéntame"];

function CloudChat({
  member: m,
  cloud,
  chat,
}: {
  member: Member;
  cloud: CloudAgent | null;
  chat: ReturnType<typeof useCloudChat>;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const count = chat.messages.length + (chat.working ? 1 : 0) + chat.steps.length;

  useEffect(() => {
    setDraft("");
  }, [m.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, m.id]);

  const send = (text: string) => {
    if (!text.trim() || chat.working) return;
    void chat.send(text);
    setDraft("");
  };

  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pt-4 pb-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {cloud?.description && (
            <details className="group rounded-sm text-xs text-text-faint">
              <summary className="cursor-pointer list-none hover:text-text-dim">Lo que hace ▸</summary>
              <p className="mt-1.5 leading-relaxed whitespace-pre-wrap text-text-dim">{cloud.description}</p>
            </details>
          )}
          {chat.loading && chat.messages.length === 0 && <p className="text-sm text-text-faint">Leyendo su conversación…</p>}
          {!chat.loading && chat.messages.length === 0 && !chat.working && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <BotAvatar look={m.look} status={m.status} size={96} />
              <div className="flex flex-col gap-1">
                <p className="text-md font-semibold text-text">Escríbele a {m.name}</p>
                <p className="text-sm text-text-dim">Trabaja en la nube: te responde aunque tus Macs estén apagadas.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {CLOUD_SUGGESTIONS.map((s) => (
                  <Button key={s} size="sm" onClick={() => send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {chat.messages.map((l) =>
            l.fromAgent ? (
              <div key={l.id} className="flex items-start gap-2.5">
                <BotAvatar look={m.look} status="DONE" size={24} />
                <div className="min-w-0 flex-1 text-sm leading-relaxed text-text">
                  <Markdown source={l.text} />
                </div>
              </div>
            ) : (
              <div key={l.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg border border-line bg-accent/10 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-text">
                  {l.text}
                </div>
              </div>
            ),
          )}
          {chat.working && (
            <div className="flex items-start gap-2.5">
              <BotAvatar look={m.look} status="WORKING" size={24} />
              <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-line bg-panel p-3">
                <p className="text-sm font-medium text-text">Trabajando en su computador en la nube…</p>
                {chat.steps.length === 0 ? (
                  <p className="text-xs text-text-faint">Pensando…</p>
                ) : (
                  chat.steps.slice(-6).map((s, i) => (
                    <p key={i} className="line-clamp-2 font-mono text-xs break-words text-text-dim">
                      {s}
                    </p>
                  ))
                )}
              </div>
            </div>
          )}
          {chat.error && <p className="text-sm text-red">{chat.error}</p>}
        </div>
      </div>

      <form
        className="mx-auto mt-1 flex w-full max-w-2xl shrink-0 items-end gap-2 rounded-lg border border-line-2 bg-panel py-2 pr-2 pl-3.5 shadow-[var(--shadow-card)] transition-colors focus-within:border-text-faint/60"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={Math.min(5, Math.max(1, draft.split("\n").length))}
          placeholder={`Escríbele a ${m.name}…`}
          aria-label={`Mensaje para ${m.name}`}
          className="max-h-[140px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 text-sm leading-relaxed text-text outline-none placeholder:text-text-faint"
        />
        <button
          type="submit"
          disabled={!draft.trim() || chat.working}
          title="Enviar (Enter)"
          aria-label="Enviar"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent transition-colors disabled:cursor-default disabled:bg-selected disabled:text-text-faint"
        >
          <svg {...ICON} width={15} height={15} strokeWidth={1.8}>
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </form>
    </>
  );
}
