"use client";

// BANDEJA DEL PULSO. Regla del pulso: bandeja antes que aviso — lo que el pulso
// encuentra espera aquí hasta que el dueño la abra. Por eso la bandeja es una
// hoja lateral que se abre a pedido (contador en la barra lateral, ⌘K
// «Bandeja») y no un panel más compitiendo en Inicio.
//
// Cada tarjeta: título, texto, el porqué, la fuente con enlace a donde se
// resuelve, y dos acciones: «Listo» (no vuelve por la misma causa) y «Nunca de
// esto» (silencia la clase). Vacía: una línea honesta con la última pasada.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PULSE_KIND_LABEL, type PulseCard } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { useWorkspace } from "@/state/WorkspaceContext";
import {
  dismissPulseCard,
  neverPulseKind,
  PULSE_OPEN_EVENT,
  undoNeverPulseKind,
  usePulseInbox,
  type PulseInboxData,
} from "@/lib/pulse-api";

function clock(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("es-CO", { day: "numeric", month: "short" })} ${time}`;
}

function lastRunLine(d: PulseInboxData): string {
  if (!d.lastRun) return "El pulso aún no ha hecho su primera pasada.";
  const model = d.lastRun.model ? "revisó con el modelo" : d.lastRun.reason === "silencio" ? "horas de silencio" : d.lastRun.reason === "tope" ? "tope de llamadas del día" : "sin cambios que pedir juicio";
  return `Última pasada ${clock(d.lastRun.at)} · ${model}`;
}

/** A dónde se resuelve cada fuente. Sin destino en la web, la fuente solo se nombra. */
function useSourceAction(card: PulseCard): { label: string; run?: () => void; href?: string } {
  const router = useRouter();
  const ws = useWorkspace();
  const s = card.source;
  switch (s.kind) {
    case "upwork":
      return s.url ? { label: s.label, href: s.url } : { label: s.label };
    case "calendar":
    case "day-task":
      return { label: s.label, run: () => router.push("/agenda") };
    case "goal":
    case "habit":
      return { label: s.label, run: () => router.push("/habitos") };
    case "finance":
      return { label: s.label, run: () => router.push("/finanzas") };
    case "meeting": {
      const project = s.ref.split("/")[0] ?? null;
      return {
        label: s.label,
        run: () => {
          ws.selectProject(project);
          ws.showPanel("reuniones");
        },
      };
    }
    default:
      return { label: s.label };
  }
}

function CardRow({ card, onNavigate }: { card: PulseCard; onNavigate: () => void }) {
  const src = useSourceAction(card);
  const [busy, setBusy] = useState(false);
  const srcCls = "text-accent hover:underline cursor-pointer";
  return (
    <li className="border-t border-line px-4 py-3.5 first:border-t-0">
      <div className="flex items-center gap-2 text-2xs text-text-faint">
        {card.urgent && (
          <span className="flex items-center gap-1 font-medium text-amber">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
            Urgente
          </span>
        )}
        <span>{PULSE_KIND_LABEL[card.kind]}</span>
        <span aria-hidden>·</span>
        <span>{clock(card.createdAt)}</span>
      </div>
      <h4 className="mt-1 text-sm font-medium break-words text-text">{card.title}</h4>
      <p className="mt-1 text-sm break-words text-text-dim">{card.text}</p>
      <p className="mt-1.5 text-xs break-words text-text-faint">Por qué: {card.why}</p>
      {card.notice && !card.notice.sent && card.urgent && (
        <p className="mt-1 text-2xs text-text-faint">No se avisó: {card.notice.reason}.</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="text-text-faint">Fuente: </span>
          {src.href ? (
            <a href={src.href} target="_blank" rel="noreferrer" className={srcCls}>
              {src.label} ↗
            </a>
          ) : src.run ? (
            <button
              type="button"
              className={srcCls}
              onClick={() => {
                src.run!();
                onNavigate();
              }}
            >
              {src.label}
            </button>
          ) : (
            <span className="text-text-dim">{src.label}</span>
          )}
        </span>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          title={`No volver a mostrar tarjetas de «${PULSE_KIND_LABEL[card.kind]}»`}
          onClick={async () => {
            setBusy(true);
            await neverPulseKind(card);
          }}
        >
          Nunca de esto
        </Button>
        <Button
          size="xs"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await dismissPulseCard(card.id);
          }}
        >
          Listo
        </Button>
      </div>
    </li>
  );
}

export function PulseInboxBody({ onNavigate }: { onNavigate: () => void }) {
  const snap = usePulseInbox();
  if (snap.status === "loading") return <p className="px-4 py-6 text-sm text-text-faint">Cargando la bandeja…</p>;
  if (snap.status === "offline") return <p className="px-4 py-6 text-sm text-text-faint">El agente no responde: la bandeja vuelve cuando se conecte.</p>;
  if (snap.status === "error") return <p className="px-4 py-6 text-sm text-text-faint">{snap.error}</p>;
  const d = snap.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {d.mode === "off" && (
        <p className="border-b border-line px-4 py-2.5 text-xs text-text-dim">El pulso está apagado (HERMES_PULSE=off): no se agregan tarjetas nuevas.</p>
      )}
      {d.cards.length ? (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {d.cards.map((c) => (
            <CardRow key={c.id} card={c} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : (
        <p className="flex-1 px-4 py-6 text-sm text-text-dim">Nada por ahora. {lastRunLine(d)}.</p>
      )}
      <div className="shrink-0 border-t border-line px-4 py-2.5 text-2xs text-text-faint">
        {d.cards.length > 0 && <p>{lastRunLine(d)}.</p>}
        <p>
          {d.mode === "notify" ? "Lo urgente puede sonar en el teléfono." : "Nada suena: todo espera aquí."} Modelo hoy: {d.calls.today} de {d.calls.max} llamadas.
        </p>
        {d.never.length > 0 && (
          <p className="mt-1">
            Silenciadas:{" "}
            {d.never.map((k, i) => (
              <span key={k}>
                {i > 0 && ", "}
                <button type="button" className="cursor-pointer text-text-dim hover:text-text hover:underline" title="Volver a mostrar esta clase" onClick={() => void undoNeverPulseKind(k)}>
                  {PULSE_KIND_LABEL[k]}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/** Hoja lateral, abierta por el evento global (contador de la barra o ⌘K). */
export function PulseSheet() {
  const [open, setOpen] = useState(false);
  const snap = usePulseInbox();
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(PULSE_OPEN_EVENT, on);
    return () => window.removeEventListener(PULSE_OPEN_EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  const live = snap.status === "ok" ? snap.data.counts.live : 0;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <aside
        role="dialog"
        aria-label="Bandeja"
        className="m-2 flex w-full max-w-[420px] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-[var(--shadow-pop)]"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="min-w-0 flex-1 text-md font-semibold text-text">
            Bandeja{live > 0 && <span className="ml-2 text-sm font-normal text-text-faint">{live}</span>}
          </h3>
          <Kbd>Esc</Kbd>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar la bandeja"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-xs text-text-faint hover:bg-hover hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <PulseInboxBody onNavigate={() => setOpen(false)} />
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Entrada en la barra lateral, junto a los indicadores «en curso». Solo se ve
 * con tarjetas vivas; con urgentes se tiñe de ámbar (estado, no decoración).
 */
export function PulseChip({ collapsed = false }: { collapsed?: boolean }) {
  const snap = usePulseInbox();
  if (snap.status !== "ok" || snap.data.counts.live === 0) return null;
  const { live, urgent } = snap.data.counts;
  const label = urgent ? `${urgent} ${urgent === 1 ? "urgente" : "urgentes"}` : `${live}`;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(PULSE_OPEN_EVENT))}
      title={`Bandeja: ${live} ${live === 1 ? "tarjeta" : "tarjetas"}${urgent ? `, ${urgent} urgente${urgent === 1 ? "" : "s"}` : ""}`}
      className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm border px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
        urgent ? "border-amber/30 bg-amber/10 text-amber" : "border-line text-text-dim hover:bg-hover hover:text-text"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 13h5l1.5 3h5L16 13h5" />
        <path d="M5.5 5h13L21 13v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-5z" />
      </svg>
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">Bandeja</span>}
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
