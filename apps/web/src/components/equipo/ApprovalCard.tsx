"use client";

// TE NECESITA: el permiso que un agente espera AHORA, con el dato exacto y la
// decisión. Puerto del `ApprovalCard` de Hermes Phone: Permitir es la acción
// principal (una por fila); Negar deja decir por qué, y el agente lo lee.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { timeLabel, type Approval, type Member } from "@/lib/team";
import { BotAvatar } from "./BotAvatar";

export function ApprovalCard({
  approval: a,
  member,
  onDecide,
}: {
  approval: Approval;
  /** Quién pide (si su sesión sigue en la oficina). */
  member: Member | null;
  onDecide: (allow: boolean, note?: string) => Promise<string | null>;
}) {
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const decide = async (allow: boolean) => {
    setBusy(true);
    setMsg(await onDecide(allow, allow ? undefined : note));
    setBusy(false);
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-amber/40 bg-panel p-4 shadow-[var(--shadow-card)]">
      <header className="flex items-center gap-2.5">
        {member && <BotAvatar look={member.look} status="NEEDS_YOU" size={28} ring="fill-panel" />}
        <p className="min-w-0 flex-1 truncate text-sm text-text">
          <span className="font-semibold">{member?.name ?? "Un agente"}</span>
          <span className="text-text-dim"> pide permiso</span>
        </p>
        {a.since != null && (
          <span className="shrink-0 text-xs text-amber tabular-nums">
            desde las {timeLabel(a.since, Date.now())}
          </span>
        )}
      </header>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-text-faint">¿Lo dejo hacer esto?</p>
        <p className="text-sm font-medium break-words text-text">{a.summary}</p>
        {a.detail && a.detail !== a.summary && (
          <pre className="max-h-48 overflow-auto rounded-sm border border-line bg-bg p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-text">
            {a.detail}
          </pre>
        )}
        {a.tool && <p className="text-xs text-text-faint">Herramienta: {a.tool}</p>}
      </div>
      {denying && (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void decide(false);
            if (e.key === "Escape") setDenying(false);
          }}
          placeholder="¿Por qué? (opcional, el agente lo lee)"
          className="h-8 rounded-sm border border-line-2 bg-bg px-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
      )}
      <div className="flex items-center justify-end gap-2">
        <Button size="md" disabled={busy} onClick={() => (denying ? void decide(false) : setDenying(true))}>
          {denying ? "Negar" : "Negar…"}
        </Button>
        <Button size="md" variant="primary" disabled={busy} onClick={() => void decide(true)}>
          Permitir
        </Button>
      </div>
      {msg && <p className="text-xs text-amber">{msg}</p>}
    </article>
  );
}
