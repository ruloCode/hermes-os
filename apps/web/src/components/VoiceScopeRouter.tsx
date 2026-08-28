"use client";

// Un solo dueño del SCOPE de la voz (fusiona los viejos VoiceScopeSync y
// VidaScopeBridge, que competían por setScope). Prioridad:
//   1. /finanzas·/habitos → contexto financiero+hábitos real (asesor desde el turno 1)
//   2. /ingles            → progreso real de la práctica (y cómo arrancarla)
//   3. proyecto en foco   → scope de proyecto (la voz trabaja centrada en él)
//   4. default            → vista general, sin scope
// El scope viaja como dynamic var `session_scope` al conectar (useVoiceConnect)
// y como contextual update si cambia con la llamada activa. No renderiza nada.

import { useCallback, useEffect, useRef } from "react";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";
import { usePathname } from "next/navigation";
import type { EnglishSession, FinanceSummary, HabitToday, VocabEntry, Wallet } from "@hermes/shared";
import { getFinanceSummary, hermesGet, listHabitsToday, listWallets } from "@/lib/hermes";
import { useVoice } from "./VoiceBusyContext";
import { useWorkspace } from "@/state/WorkspaceContext";
import { money } from "./vida/FinanceSummary";
import { OWNER, OWNER_LABEL } from "@/lib/owner";

function buildVidaContext(
  cop: FinanceSummary | null,
  usd: FinanceSummary | null,
  habits: HabitToday[],
  wallets: Wallet[],
): string {
  const parts: string[] = [
    `${OWNER_LABEL} está en su página VIDA: finanzas personales y hábitos. Actúa como su asesor financiero y coach personal, con cercanía y sin regañar. Estos son sus datos REALES (NO inventes cifras; para el detalle usa get_finance_summary, get_balance y list_transactions):`,
  ];
  // Saldo actual por billetera — la respuesta a "¿cuánto tengo?".
  if (wallets.length) {
    const cur = (c: "COP" | "USD") => wallets.filter((w) => w.currency === c);
    const bits: string[] = [];
    const copW = cur("COP");
    if (copW.length)
      bits.push(
        `${money(copW.reduce((a, w) => a + w.balance, 0), "COP")} COP (${copW.map((w) => `${w.name} ${money(w.balance, "COP")}`).join(", ")})`,
      );
    const usdW = cur("USD");
    if (usdW.length)
      bits.push(
        `${money(usdW.reduce((a, w) => a + w.balance, 0), "USD")} (${usdW.map((w) => `${w.name} ${money(w.balance, "USD")}`).join(", ")})`,
      );
    parts.push(`Saldo actual: ${bits.join(" + ")}.`);
  }
  if (cop && cop.tx_count) {
    let l = `En pesos (COP): ingresos ${money(cop.income, "COP")}, gastos ${money(cop.expense, "COP")}, neto ${money(cop.net, "COP")}.`;
    if (cop.by_category.length)
      l += ` Mayores gastos: ${cop.by_category.slice(0, 3).map((c) => `${c.category} ${money(c.spent, "COP")}`).join(", ")}.`;
    if (cop.budgets_at_risk.length)
      l += ` Presupuestos en riesgo: ${cop.budgets_at_risk.map((c) => `${c.category} ${Math.round((c.pct ?? 0) * 100)}%`).join(", ")}.`;
    parts.push(l);
  }
  if (usd && usd.tx_count) {
    parts.push(
      `En dólares (USD): ingresos ${money(usd.income, "USD")}, gastos ${money(usd.expense, "USD")}, neto ${money(usd.net, "USD")}.`,
    );
  }
  if (!cop?.tx_count && !usd?.tx_count) {
    parts.push("Todavía no hay movimientos registrados este mes.");
  }
  if (habits.length) {
    const pend = habits.filter((h) => !h.done_today).map((h) => h.name);
    parts.push(
      `Hábitos de hoy: ${habits.length} activos${pend.length ? `, pendientes: ${pend.join(", ")}` : ", todos hechos"}.`,
    );
  }
  parts.push(
    `Cuando ${OWNER || "el usuario"} mencione un gasto o ingreso, regístralo con log_transaction sin pedir permiso (con account si nombra la billetera — el saldo se descuenta solo) y confírmalo en una frase. Si dice cuánto tiene en una billetera, usa set_wallet_balance.`,
  );
  return parts.join(" ");
}

/** Progreso real de la práctica de inglés para el scope de /ingles. */
function buildInglesContext(sessions: EnglishSession[], vocab: VocabEntry[]): string {
  const parts: string[] = [
    `${OWNER_LABEL} está en su página INGLÉS: progreso de su práctica hablada con el tutor. Datos REALES (no inventes):`,
  ];
  const last = sessions[0];
  if (last) {
    parts.push(
      `Última sesión: ${last.started_at.slice(0, 10)}, fluidez ${last.fluency ?? "?"}/5${last.topics.length ? `, temas: ${last.topics.slice(0, 3).join(", ")}` : ""}. Sesiones registradas: ${sessions.length}.`,
    );
  } else {
    parts.push("Todavía no hay sesiones registradas.");
  }
  const learned = vocab.filter((v) => v.learned).length;
  if (vocab.length) parts.push(`Vocabulario: ${learned}/${vocab.length} términos aprendidos.`);
  parts.push(
    `Si ${OWNER || "el usuario"} quiere practicar o ensayar inglés, arranca la sesión con la tool start_english_practice (la clase la da el tutor, otro agente).`,
  );
  return parts.join(" ");
}

export function VoiceScopeRouter() {
  const pathname = usePathname();
  const { setScope, mode } = useVoice();
  const { selectedProject, selectedProjectName } = useWorkspace();
  const { status } = useConversationStatus();
  const { sendContextualUpdate } = useConversationControls();
  // En modo tutor NO se inyecta scope: el contexto financiero/proyecto
  // contaminaría la clase de inglés (el tutor tiene sus propias dynamic vars).
  const connected = status === "connected" && mode !== "tutor";

  // /vida se separó: finanzas y hábitos comparten el scope "vida" (asesor
  // financiero + coach); /ingles tiene el suyo (progreso de la práctica).
  const inVida = pathname === "/finanzas" || pathname === "/habitos";
  const inIngles = pathname === "/ingles";
  const slug = selectedProject;
  const name = selectedProjectName;

  const refreshVida = useCallback(async (): Promise<string> => {
    const [cop, usd, habits, wallets] = await Promise.all([
      getFinanceSummary(undefined, "COP"),
      getFinanceSummary(undefined, "USD"),
      listHabitsToday(),
      listWallets(),
    ]);
    const ctx = buildVidaContext(cop, usd, habits, wallets);
    setScope({ slug: "vida", name: "Vida", prompt: ctx });
    return ctx;
  }, [setScope]);

  const refreshIngles = useCallback(async (): Promise<string> => {
    const [sessions, vocab] = await Promise.all([
      hermesGet<EnglishSession[]>("/english/sessions?limit=12").catch(() => []),
      hermesGet<VocabEntry[]>("/english/vocab?limit=100").catch(() => []),
    ]);
    const ctx = buildInglesContext(sessions, vocab);
    setScope({ slug: "ingles", name: "Inglés", prompt: ctx });
    return ctx;
  }, [setScope]);

  // Mantiene el scope al día según la vista/foco actual (no aplica al tutor).
  useEffect(() => {
    if (mode === "tutor") return;
    if (inVida) {
      void refreshVida();
    } else if (inIngles) {
      void refreshIngles();
    } else if (slug) {
      setScope({ slug, name: name || slug });
    } else {
      setScope(null);
    }
  }, [inVida, inIngles, slug, name, refreshVida, refreshIngles, setScope, mode]);

  // Reencuadres en vivo: la llamada sigue al usuario entre vistas/proyectos.
  const prevKeyRef = useRef<string>("");
  const wasConnected = useRef(false);
  useEffect(() => {
    const key = inVida ? "vida" : inIngles ? "ingles" : (slug ?? "");
    const prev = prevKeyRef.current;
    prevKeyRef.current = key;
    if (!connected) {
      wasConnected.current = false;
      return;
    }
    const justConnected = !wasConnected.current;
    wasConnected.current = true;
    if (!justConnected && prev === key) return;
    if (inVida) {
      // Estado financiero fresco (por si cambió entre montar y hablar).
      void refreshVida().then((ctx) => sendContextualUpdate(`[Contexto de Vida] ${ctx}`));
    } else if (inIngles) {
      void refreshIngles().then((ctx) => sendContextualUpdate(`[Contexto de Inglés] ${ctx}`));
    } else if (justConnected) {
      // Al conectar en el dashboard, la dynamic var ya llevó el scope.
      return;
    } else if (slug) {
      sendContextualUpdate(
        `[Scope] A partir de ahora el usuario está DENTRO del proyecto "${name || slug}" (slug: ${slug}). Centra todo en este proyecto salvo que nombre otro.`,
      );
    } else {
      sendContextualUpdate(
        "[Scope] El usuario salió del proyecto: ahora está en la vista general, sin proyecto enfocado.",
      );
    }
  }, [connected, inVida, inIngles, slug, name, refreshVida, refreshIngles, sendContextualUpdate]);

  return null;
}
