"use client";

// "Qué tiene este agente": una ficha por tool con su origen, su permiso real,
// la descripción que ve el modelo y cuándo la usó en este run (clic en un paso
// = salta a la traza). Son cientos (los conectores de claude.ai entran solos),
// así que van agrupadas: arriba lo que usó y lo que está usando; cada servidor
// con su conteo y plegado.

import { memo, useMemo, useState } from "react";
import { ORIGIN_LABEL, PERMISSION_LABEL, type ToolCard, type ToolPermission } from "@hermes/shared";
import type { Redact } from "@/lib/oficina/public-view";

const PERM_CLASS: Record<ToolPermission, string> = {
  free: "bg-green/15 text-green",
  guardrail: "bg-amber/15 text-amber",
  checked: "bg-cyan/15 text-cyan",
  asks: "bg-accent/15 text-accent",
  "denied-by-mode": "bg-red/15 text-red",
};

function groupKey(c: ToolCard): string {
  if (c.origin === "skill") return "Skills del plugin";
  if (c.origin === "cli") return ORIGIN_LABEL.cli;
  if (c.origin === "hermes") return ORIGIN_LABEL.hermes;
  if (c.origin === "linear") return ORIGIN_LABEL.linear;
  if (c.origin === "chrome") return ORIGIN_LABEL.chrome;
  return `MCP: ${(c.server ?? "").replace(/^claude_ai_/, "claude.ai ").replace(/_/g, " ")}`;
}

const Card = memo(function Card({ c, redact, big, onJump }: { c: ToolCard; redact: Redact; big: boolean; onJump: (step: number) => void }) {
  return (
    <li
      data-tool-card={c.name}
      data-origin={c.origin}
      data-permission={c.permission}
      data-active={c.active ? "true" : undefined}
      className={`rounded-lg border px-3 py-2 ${c.active ? "border-accent bg-accent/10" : "border-line bg-panel"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-mono font-medium text-text ${big ? "text-[20px]" : "text-sm"}`} title={c.name}>
          {c.origin === "skill" ? `/${c.name}` : c.name}
        </span>
        {c.active ? <span className={`rounded-full bg-accent px-2 text-white ${big ? "text-[15px]" : "text-[11px]"}`}>en uso</span> : null}
        <span className={`rounded-full px-2 ${PERM_CLASS[c.permission]} ${big ? "text-[15px]" : "text-[11px]"}`} title={c.permissionNote}>
          {PERMISSION_LABEL[c.permission]}
        </span>
        {c.origin === "skill" ? (
          <span className={`rounded-full px-2 ${c.loaded ? "bg-green/15 text-green" : "bg-panel-2 text-text-dim"} ${big ? "text-[15px]" : "text-[11px]"}`}>{c.loaded ? "cargada en este run" : "no se cargó"}</span>
        ) : null}
      </div>
      <p className={`mt-1 text-text-dim ${big ? "text-[17px]" : "text-xs"}`}>{c.permissionNote}</p>
      <p className={`mt-1 ${c.description ? "text-text" : "text-text-faint italic"} ${big ? "text-[17px]" : "text-xs"}`}>
        {c.description ? redact(c.description) : c.origin === "cli" ? "Tool integrada de Claude Code: el CLI no expone su descripción." : "Descripción no expuesta por el SDK en este run."}
      </p>
      {c.steps.length ? (
        <p className={`mt-1 flex flex-wrap items-center gap-1 text-text-dim ${big ? "text-[16px]" : "text-[11px]"}`}>
          Usada {c.steps.length}× · pasos
          {c.steps.map((s) => (
            <button key={s} type="button" data-jump-step={s} onClick={() => onJump(s)} className="rounded bg-panel-2 px-1.5 tabular-nums text-accent hover:bg-accent/15">
              #{s}
            </button>
          ))}
        </p>
      ) : null}
    </li>
  );
});

export function InventoryList({ cards, redact, big = false, onJump, note }: { cards: ToolCard[]; redact: Redact; big?: boolean; onJump: (step: number) => void; note?: string }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set([ORIGIN_LABEL.hermes, "Skills del plugin"]));
  const used = useMemo(() => cards.filter((c) => c.active || c.steps.length), [cards]);
  const groups = useMemo(() => {
    const m = new Map<string, ToolCard[]>();
    for (const c of cards) {
      const k = groupKey(c);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    const order = [ORIGIN_LABEL.hermes, ORIGIN_LABEL.cli, "Skills del plugin", ORIGIN_LABEL.linear, ORIGIN_LABEL.chrome];
    return [...m.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99) || b[1].length - a[1].length);
  }, [cards]);

  if (!cards.length) return <p className={`text-text-faint ${big ? "text-[20px]" : "text-xs"}`}>Todavía no llegó el inventario del agente (llega con el primer evento del run).</p>;

  return (
    <div className="space-y-3" data-inventory data-tool-count={cards.length}>
      <p className={`text-text-dim ${big ? "text-[18px]" : "text-xs"}`}>
        {cards.filter((c) => c.origin !== "skill").length} tools y {cards.filter((c) => c.origin === "skill").length} skills disponibles · usó {used.length}
        {note ? ` · ${note}` : ""}
      </p>
      {used.length ? (
        <section>
          <h3 className={`mb-1.5 font-medium text-text ${big ? "text-[20px]" : "text-sm"}`}>Las que usó en este run</h3>
          <ul className={`grid gap-2 ${big ? "grid-cols-2" : "grid-cols-1"}`}>
            {used.map((c) => (
              <Card key={`u-${c.name}`} c={c} redact={redact} big={big} onJump={onJump} />
            ))}
          </ul>
        </section>
      ) : null}
      {groups.map(([g, list]) => {
        const isOpen = openGroups.has(g);
        return (
          <section key={g} data-tool-group={g}>
            <button
              type="button"
              onClick={() =>
                setOpenGroups((prev) => {
                  const n = new Set(prev);
                  if (n.has(g)) n.delete(g);
                  else n.add(g);
                  return n;
                })
              }
              className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-text hover:bg-panel-2 ${big ? "text-[19px]" : "text-sm"}`}
            >
              <span className="text-text-faint">{isOpen ? "▾" : "▸"}</span>
              <span className="font-medium">{redact(g)}</span>
              <span className="text-text-dim">{list.length}</span>
              <span className="ml-auto text-text-faint">{list.filter((c) => c.steps.length).length ? `usó ${list.filter((c) => c.steps.length).length}` : ""}</span>
            </button>
            {isOpen ? (
              <ul className={`mt-1 grid gap-2 ${big ? "grid-cols-2" : "grid-cols-1"}`}>
                {list.slice(0, 80).map((c) => (
                  <Card key={c.name} c={c} redact={redact} big={big} onJump={onJump} />
                ))}
                {list.length > 80 ? <li className="text-xs text-text-faint">…y {list.length - 80} más</li> : null}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
