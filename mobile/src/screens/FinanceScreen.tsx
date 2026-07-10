/**
 * Finanzas personales: mismo módulo que la página /vida del dashboard, versión
 * móvil. Resumen del mes (COP combinado con TRM), billeteras, registro rápido
 * de movimientos y últimos movimientos con anulación (soft-delete).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { C } from "../theme";
import { Button, Card, Dim, Empty, Loading, ScreenTitle } from "../ui";
import { useApp } from "../store";
import * as api from "../hermes";
import type { Currency, FinanceSummary, Transaction, TransactionKind, Wallet } from "../types";

function fmtMoney(n: number, currency: Currency): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const [int, dec] = (currency === "USD" ? abs.toFixed(2) : String(Math.round(abs))).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$${grouped}${dec ? `,${dec}` : ""}`;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : ym;
}

export function FinanceScreen() {
  const app = useApp();
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Registro rápido
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("COP");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, w, t] = await Promise.all([
        api.financeSummary({ currency: "COP" }),
        api.listWallets().catch(() => [] as Wallet[]),
        api.listTransactions({ limit: 25 }).catch(() => [] as Transaction[]),
      ]);
      setSummary(s);
      setWallets(w);
      setTxs(t);
    } catch {
      setError("No pude leer las finanzas del agente.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const value = Number(amount.replace(/[.,\s]/g, ""));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Monto inválido.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.addTransaction({
        kind,
        amount: value,
        currency,
        category: category.trim() || undefined,
        note: note.trim() || undefined,
      });
      setFlash(
        res.deduped
          ? "Ya tenía ese registro hoy: no lo dupliqué."
          : `${kind === "expense" ? "Gasto" : "Ingreso"} de ${fmtMoney(value, currency)} ${currency} registrado.`,
      );
      setTimeout(() => setFlash(null), 3500);
      setAmount("");
      setNote("");
      setCategory("");
      await load();
    } catch {
      setError("No pude registrar el movimiento.");
    } finally {
      setSaving(false);
    }
  };

  const voidTx = async (id: number) => {
    try {
      await api.voidTransaction(id);
      await load();
    } catch {
      setError("No pude anular ese movimiento.");
    }
  };

  if (loading && !summary) return <Loading label="Cargando finanzas…" />;

  return (
    <ScrollView
      style={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.violet} />
      }
    >
      <ScreenTitle
        title="Finanzas"
        right={summary ? <Dim>{monthLabel(summary.month)}</Dim> : undefined}
      />

      {app.online === false ? (
        <Empty text="No alcanzo al agente. Revisa Ajustes (⚙)." />
      ) : (
        <>
          {/* Resumen del mes (COP combinado con la TRM real) */}
          {summary ? (
            <Card accent={summary.net >= 0 ? C.green : C.red}>
              <View style={styles.sumRow}>
                <View style={styles.sumCell}>
                  <Dim style={styles.sumLabel}>INGRESOS</Dim>
                  <Text style={[styles.sumValue, { color: C.green }]}>
                    {fmtMoney(summary.income, "COP")}
                  </Text>
                </View>
                <View style={styles.sumCell}>
                  <Dim style={styles.sumLabel}>GASTOS</Dim>
                  <Text style={[styles.sumValue, { color: C.red }]}>
                    {fmtMoney(summary.expense, "COP")}
                  </Text>
                </View>
                <View style={styles.sumCell}>
                  <Dim style={styles.sumLabel}>NETO</Dim>
                  <Text style={[styles.sumValue, { color: summary.net >= 0 ? C.green : C.red }]}>
                    {fmtMoney(summary.net, "COP")}
                  </Text>
                </View>
              </View>
              <Dim style={{ fontSize: 10.5, marginTop: 8 }}>
                {summary.tx_count} movimientos · COP
                {summary.fx ? ` · TRM ${fmtMoney(summary.fx.usd_cop, "COP")}` : ""}
              </Dim>
              {summary.budgets_at_risk.length ? (
                <Text style={{ color: C.amber, fontSize: 12, marginTop: 6 }}>
                  ⚠ Presupuesto en riesgo:{" "}
                  {summary.budgets_at_risk.map((b) => b.category).join(", ")}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {/* Billeteras */}
          {wallets.length ? (
            <>
              <Text style={styles.section}>BILLETERAS</Text>
              <Card>
                {wallets.map((w, i) => (
                  <View
                    key={w.id}
                    style={[styles.walletRow, i > 0 && { borderTopColor: C.lineSoft, borderTopWidth: 1 }]}
                  >
                    <Text style={{ color: C.text, fontSize: 13.5, fontWeight: "600" }}>
                      {w.name}
                    </Text>
                    <Text style={{ color: C.cyan, fontSize: 13.5, fontWeight: "700" }}>
                      {fmtMoney(w.balance, w.currency)} {w.currency}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* Registro rápido */}
          <Text style={styles.section}>REGISTRAR MOVIMIENTO</Text>
          <Card>
            <View style={styles.chips}>
              <Toggle label="Gasto" on={kind === "expense"} color={C.red} onPress={() => setKind("expense")} />
              <Toggle label="Ingreso" on={kind === "income"} color={C.green} onPress={() => setKind("income")} />
              <View style={{ width: 12 }} />
              <Toggle label="COP" on={currency === "COP"} color={C.cyan} onPress={() => setCurrency("COP")} />
              <Toggle label="USD" on={currency === "USD"} color={C.cyan} onPress={() => setCurrency("USD")} />
            </View>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder={currency === "COP" ? "Monto (ej. 45000)" : "Monto (ej. 350)"}
              placeholderTextColor={C.textFaint}
              style={styles.input}
            />
            <TextInput
              value={category}
              onChangeText={setCategory}
              autoCapitalize="none"
              placeholder="Categoría (mercado, transporte…)"
              placeholderTextColor={C.textFaint}
              style={styles.input}
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Nota (opcional)"
              placeholderTextColor={C.textFaint}
              style={styles.input}
            />
            <Button
              label={saving ? "Guardando…" : "Registrar"}
              color={kind === "expense" ? C.red : C.green}
              disabled={saving || !amount.trim()}
              onPress={() => void submit()}
              style={{ marginTop: 4 }}
            />
            {flash ? <Text style={{ color: C.green, marginTop: 10, fontSize: 12.5 }}>✓ {flash}</Text> : null}
            {error ? <Text style={{ color: C.red, marginTop: 10, fontSize: 12.5 }}>⚠ {error}</Text> : null}
          </Card>

          {/* Últimos movimientos */}
          <Text style={styles.section}>ÚLTIMOS MOVIMIENTOS</Text>
          {txs.length === 0 ? (
            <Empty text="Sin movimientos este mes." />
          ) : (
            txs.map((t) => (
              <Card key={t.id} accent={t.kind === "expense" ? C.red : C.green} style={{ paddingVertical: 10 }}>
                <View style={styles.txRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontSize: 13.5, fontWeight: "600" }}>
                      {t.category}
                      {t.note ? <Dim style={{ fontSize: 12 }}> · {t.note}</Dim> : null}
                    </Text>
                    <Dim style={{ fontSize: 10.5, marginTop: 2 }}>
                      {t.occurred_on}
                      {t.account ? ` · ${t.account}` : ""} · {t.source}
                    </Dim>
                  </View>
                  <Text
                    style={{
                      color: t.kind === "expense" ? C.red : C.green,
                      fontSize: 14,
                      fontWeight: "700",
                    }}
                  >
                    {t.kind === "expense" ? "−" : "+"}
                    {fmtMoney(t.amount, t.currency)}
                    <Dim style={{ fontSize: 10 }}> {t.currency}</Dim>
                  </Text>
                  <Pressable onPress={() => void voidTx(t.id)} hitSlop={8} style={{ marginLeft: 10 }}>
                    <Text style={{ color: C.textFaint, fontSize: 15 }}>✕</Text>
                  </Pressable>
                </View>
              </Card>
            ))
          )}
        </>
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function Toggle({
  label,
  on,
  color,
  onPress,
}: {
  label: string;
  on: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: on ? color : C.line, backgroundColor: on ? `${color}22` : "transparent" },
      ]}
    >
      <Text style={{ color: on ? color : C.textDim, fontSize: 11.5, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 10 },
  section: {
    color: C.textDim,
    fontSize: 10,
    letterSpacing: 1.6,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 8,
  },
  sumRow: { flexDirection: "row", gap: 10 },
  sumCell: { flex: 1 },
  sumLabel: { fontSize: 9, letterSpacing: 1.2 },
  sumValue: { fontSize: 15, fontWeight: "800", marginTop: 3 },
  walletRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  input: {
    backgroundColor: C.bg,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
    marginBottom: 8,
  },
  txRow: { flexDirection: "row", alignItems: "center" },
});
