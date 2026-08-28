"use client";

import { useCallback, useEffect, useState } from "react";
import type { Budget, Currency, FinanceSummary, FxRate, Goal, HabitToday, Transaction, Wallet } from "@hermes/shared";
import {
  checkinHabit,
  createHabit,
  createTransaction,
  getFinanceSummary,
  getFxRate,
  listBudgets,
  listGoals,
  listHabitsToday,
  listTransactions,
  listWallets,
  setBudget,
  setWallet,
  updateGoal,
  updateTransaction,
  voidTransaction,
} from "@/lib/hermes";

/**
 * Datos de la página Vida (finanzas + hábitos + metas): polling ligero cada
 * 10s (patrón useHermesData) + mutaciones que refrescan al terminar. La
 * moneda del resumen es conmutable (COP default, USD para movimientos en
 * dólares).
 */
/** Mes anterior al de hoy (Bogotá) como YYYY-MM, para el delta de ritmo. */
function prevMonth(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function useVida() {
  const [currency, setCurrency] = useState<Currency>("COP");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [fx, setFx] = useState<FxRate | null>(null);
  const [habits, setHabits] = useState<HabitToday[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [online, setOnline] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, prev, txs, b, w, rate, h, g] = await Promise.all([
        // combined: el hero muestra el gran total del mes (COP+USD a TRM).
        getFinanceSummary(undefined, currency, true),
        // mes anterior (mismo combined): delta de ritmo en MonthPulse.
        getFinanceSummary(prevMonth(), currency, true),
        // 400 ≈ mes completo: las barras por día necesitan todo el mes.
        listTransactions({ limit: 400 }),
        listBudgets(),
        listWallets(),
        // TRM del día para el total combinado de billeteras.
        getFxRate(),
        listHabitsToday(),
        listGoals("active"),
      ]);
      setSummary(s);
      setPrevSummary(prev);
      setTransactions(txs);
      setBudgets(b);
      setWallets(w);
      setFx(rate);
      setHabits(h);
      setGoals(g);
      setOnline(s !== null);
    } catch {
      setOnline(false);
    }
  }, [currency]);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  // ── Mutaciones (refrescan al terminar) ───────────────────────────────

  const addTransaction = useCallback(
    async (input: Parameters<typeof createTransaction>[0]) => {
      const res = await createTransaction(input);
      await load();
      return res;
    },
    [load],
  );

  const removeTransaction = useCallback(
    async (id: number) => {
      const ok = await voidTransaction(id);
      await load();
      return ok;
    },
    [load],
  );

  const editTransaction = useCallback(
    async (id: number, patch: Parameters<typeof updateTransaction>[1]) => {
      const res = await updateTransaction(id, patch);
      await load();
      return res;
    },
    [load],
  );

  const saveBudget = useCallback(
    async (category: string, limit: number) => {
      const res = await setBudget(category, limit, currency);
      await load();
      return res;
    },
    [load, currency],
  );

  const saveWallet = useCallback(
    async (name: string, balance: number, cur?: Currency) => {
      const res = await setWallet(name, balance, cur);
      await load();
      return res;
    },
    [load],
  );

  const toggleHabit = useCallback(
    async (habit: HabitToday) => {
      const res = await checkinHabit(habit.id, { done: !habit.done_today });
      await load();
      return res;
    },
    [load],
  );

  const addHabit = useCallback(
    async (name: string, cadence?: "daily" | "weekly", timesPerWeek?: number) => {
      const res = await createHabit({ name, cadence, times_per_week: timesPerWeek });
      await load();
      return res;
    },
    [load],
  );

  const bumpGoal = useCallback(
    async (id: number, delta: number) => {
      const res = await updateGoal(id, { delta });
      await load();
      return res;
    },
    [load],
  );

  const markMilestone = useCallback(
    async (id: number, milestone: string) => {
      const res = await updateGoal(id, { milestone_done: milestone });
      await load();
      return res;
    },
    [load],
  );

  return {
    currency,
    setCurrency,
    summary,
    prevSummary,
    transactions,
    budgets,
    wallets,
    fx,
    habits,
    goals,
    online,
    refresh: load,
    addTransaction,
    removeTransaction,
    editTransaction,
    saveBudget,
    saveWallet,
    toggleHabit,
    addHabit,
    bumpGoal,
    markMilestone,
  };
}
