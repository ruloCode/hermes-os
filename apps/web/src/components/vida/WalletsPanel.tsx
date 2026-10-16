"use client";

// Saldo actual: total por moneda + billeteras (bancolombia, nu, nequi, ontop…).
// Cada saldo es editable inline (recalibre manual); los gastos con billetera
// ya lo descuentan solos. También permite crear una billetera nueva.
//
// v5: eran tres cifras grandes de tres colores (COP en tinta, USD en cyan, el
// combinado en el acento) sobre una rejilla de cajitas con la moneda en cyan.
// Ninguno de esos colores decía un estado. Ahora hay UNA cifra principal —el
// total que de verdad responde "¿cuánto tengo?"— con el desglose por moneda en
// una línea, y las billeteras son una lista: nombre a la izquierda, saldo a la
// derecha, alineado como un extracto.

import { useState } from "react";
import type { Currency, FxRate, Wallet } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { money } from "./FinanceSummary";
import { FIELD, IconPlus } from "./kit";

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
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [newCurrency, setNewCurrency] = useState<Currency>("COP");

  const totalCop = wallets.filter((w) => w.currency === "COP").reduce((a, w) => a + w.balance, 0);
  const totalUsd = wallets.filter((w) => w.currency === "USD").reduce((a, w) => a + w.balance, 0);
  // Gran total a la TRM del día: solo si hay dólares Y tasa real.
  const combined = totalUsd > 0 && fx ? Math.round(totalCop + totalUsd * fx.usd_cop) : null;

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
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* La cifra que responde "¿cuánto tengo?" + su desglose en una línea */}
      <div className="flex flex-col gap-1 px-2">
        <span className="text-2xl leading-tight font-medium text-text tabular-nums">
          {money(combined ?? totalCop, "COP")}
        </span>
        <span className="text-xs text-text-faint tabular-nums">
          {combined != null && fx ? (
            <span title={`Tasa del ${fx.as_of}`}>
              {money(totalCop, "COP")} + {money(totalUsd, "USD")} a TRM{" "}
              {money(Math.round(fx.usd_cop), "COP")}
            </span>
          ) : totalUsd > 0 ? (
            // Hay dólares pero no tasa: no se suman, se dicen aparte.
            <>
              en pesos · además {money(totalUsd, "USD")} (sin TRM para sumarlos)
            </>
          ) : (
            `en ${wallets.length} billetera${wallets.length === 1 ? "" : "s"}`
          )}
        </span>
      </div>

      {/* Billeteras: lista, no rejilla de cajas */}
      {wallets.length > 0 && (
        <ul className="flex flex-col">
          {wallets.map((w) => (
            <li key={w.id}>
              {editing === w.id ? (
                <div className="flex items-center gap-2 rounded-sm bg-hover px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{w.name}</span>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitEdit(w)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit(w);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    inputMode="numeric"
                    aria-label={`Saldo de ${w.name}`}
                    className={`${FIELD} h-7 w-32 text-right tabular-nums`}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(w.id);
                    setDraft(String(w.balance));
                  }}
                  title="Clic para recalibrar el saldo"
                  className="group flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{w.name}</span>
                  <span className="shrink-0 text-xs text-text-faint">{w.currency}</span>
                  <span className="w-28 shrink-0 text-right text-sm text-text tabular-nums">
                    {money(w.balance, w.currency)}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Nueva billetera: plegada hasta que se pide */}
      {adding ? (
        <div
          className="flex flex-col gap-2 rounded-sm border border-line p-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") setAdding(false);
          }}
        >
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre (nequi, efectivo…)"
              aria-label="Nombre de la billetera"
              className={`${FIELD} min-w-0 flex-1`}
            />
            <Segmented
              size="sm"
              ariaLabel="Moneda de la billetera"
              value={newCurrency}
              onChange={setNewCurrency}
              options={[
                { value: "COP", label: "COP" },
                { value: "USD", label: "USD" },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addWallet()}
              placeholder="Saldo actual"
              aria-label="Saldo actual"
              inputMode="numeric"
              className={`${FIELD} min-w-0 flex-1 tabular-nums`}
            />
            <Button variant="ghost" size="md" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => void addWallet()}
              disabled={!newName.trim() || !newBalance.trim()}
            >
              Crear
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          icon={<IconPlus size={13} />}
          onClick={() => setAdding(true)}
          className="self-start"
        >
          Agregar billetera
        </Button>
      )}
    </div>
  );
}
