"use client";

import { useState } from "react";
import type { Currency, FxRate, Wallet } from "@hermes/shared";
import { StatBlock } from "@/components/ui/StatBlock";
import { money } from "./FinanceSummary";

// Campo compacto del panel: borde de token con focus que sube a line-2.
const FIELD =
  "rounded-sm border border-line bg-transparent outline-none transition-colors focus:border-line-2";

/**
 * Saldo actual: total por moneda + billeteras (bancolombia, nu, nequi, ontop…).
 * Cada saldo es editable inline (recalibre manual); los gastos con billetera
 * ya lo descuentan solos. También permite crear una billetera nueva.
 */
export function WalletsPanel({
  wallets,
  fx,
  onSave,
}: {
  wallets: Wallet[];
  /** TRM del día — habilita el total combinado en COP; null sin tasa. */
  fx?: FxRate | null;
  onSave: (name: string, balance: number, currency?: Currency) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [newCurrency, setNewCurrency] = useState<Currency>("COP");

  const totalCop = wallets.filter((w) => w.currency === "COP").reduce((a, w) => a + w.balance, 0);
  const totalUsd = wallets.filter((w) => w.currency === "USD").reduce((a, w) => a + w.balance, 0);

  const commitEdit = async (w: Wallet) => {
    const n = Number(draft.replace(/[.,\s]/g, ""));
    setEditing(null);
    if (Number.isFinite(n) && n !== w.balance) await onSave(w.name, n, w.currency);
  };

  const addWallet = async () => {
    const n = Number(newBalance.replace(/[.,\s]/g, ""));
    if (!newName.trim() || !Number.isFinite(n)) return;
    await onSave(newName.trim(), n, newCurrency);
    setNewName("");
    setNewBalance("");
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Totales por moneda + gran total combinado a la TRM del día */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <StatBlock label="Saldo total COP" value={money(totalCop, "COP")} size="lg" />
        {totalUsd > 0 && (
          <StatBlock label="Saldo total USD" value={money(totalUsd, "USD")} size="lg" tone="cyan" />
        )}
        {totalUsd > 0 && fx && (
          <div title={`Tasa del ${fx.as_of}`} className="flex flex-col">
            <StatBlock
              label="Total combinado"
              value={money(Math.round(totalCop + totalUsd * fx.usd_cop), "COP")}
              size="lg"
              tone="violet"
            />
            <span className="text-2xs text-text-faint tabular-nums">
              TRM US$1 = {money(Math.round(fx.usd_cop), "COP")}
            </span>
          </div>
        )}
      </div>

      {/* Billeteras */}
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        {wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => {
              setEditing(w.id);
              setDraft(String(w.balance));
            }}
            title="Click para recalibrar el saldo"
            className={`rounded-sm border px-2 py-1.5 text-left transition-colors ${
              editing === w.id ? "border-line-2" : "border-line hover:border-line-2"
            }`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-2xs tracking-label text-text-dim uppercase">
                {w.name}
              </span>
              <span className="text-2xs text-cyan">{w.currency}</span>
            </div>
            {editing === w.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void commitEdit(w)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitEdit(w);
                  if (e.key === "Escape") setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                inputMode="numeric"
                className={`${FIELD} mt-0.5 w-full px-1 py-0.5 text-sm text-text tabular-nums`}
              />
            ) : (
              <div className="font-display text-base text-text tabular-nums">
                {money(w.balance, w.currency)}
              </div>
            )}
          </button>
        ))}

        {/* Nueva billetera */}
        <div className="flex flex-col gap-1 rounded-sm border border-dashed border-line px-2 py-1.5">
          <div className="flex items-center gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Billetera…"
              className="min-w-0 flex-1 bg-transparent text-2xs text-text outline-none"
            />
            <select
              value={newCurrency}
              onChange={(e) => setNewCurrency(e.target.value as Currency)}
              className="bg-transparent text-2xs text-cyan outline-none"
            >
              <option value="COP" className="bg-bg">COP</option>
              <option value="USD" className="bg-bg">USD</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <input
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addWallet()}
              placeholder="Saldo"
              inputMode="numeric"
              className="min-w-0 flex-1 bg-transparent text-xs text-text tabular-nums outline-none"
            />
            <button
              type="button"
              onClick={() => void addWallet()}
              disabled={!newName.trim() || !newBalance.trim()}
              title="Crear billetera"
              className="text-xs text-violet transition-colors hover:text-violet-hot disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
