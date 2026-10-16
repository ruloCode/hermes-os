/**
 * Controlador de voz de Hermes. Vive en la RAÍZ (siempre montado, no atado a un
 * tab) para que la llamada y las client tools sobrevivan al navegar. Expone su
 * estado por contexto (useVoice) y la UI (HermesScreen) solo lo consume.
 *
 * Las client tools corren EN EL TELÉFONO (igual que en el browser del dashboard)
 * y llaman al agente en :8650. Se registran con los MISMOS nombres que espera el
 * agente "Hermes" de ElevenLabs, así que el mismo agente funciona desde el móvil.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { useConversation, type ConversationStatus } from "@elevenlabs/react-native";
// El wrapper RN no reexporta este hook, pero @elevenlabs/react (que el propio
// wrapper embebe) sí — y comparte el MISMO ConversationProvider/contexto.
import { useConversationClientTool } from "@elevenlabs/react";
// AudioSession nativa de LiveKit (enruta el audio en el dispositivo). Import
// defensivo: si el nombre no existe en esta versión, queda undefined y se ignora.
import { AudioSession } from "@livekit/react-native";
import * as api from "./hermes";
import { useApp, type Tab } from "./store";
import { useChat } from "./chat";

export interface Line {
  who: "TÚ" | "HERMES" | "TUTORA";
  text: string;
}

/** A quién le hablas: Hermes (asistente) o la tutora de inglés (otro agente ElevenLabs). */
export type VoiceMode = "hermes" | "tutor";

/** Cómo terminó la última práctica con la tutora (para avisarlo en Inglés). */
export type TutorSaveState = "saved" | "autosaved" | "error" | null;

interface ConnectOptions {
  /**
   * Contexto para {{practice_context}} de la tutora. Sin él se pide al agente
   * (última sesión, errores recurrentes, vocabulario por repasar). "Repasar
   * esta clase" lo arma con las correcciones de ESA clase.
   */
  practiceContext?: string;
  /**
   * Primer turno "del usuario" enviado al conectar. El saludo de la tutora es
   * fijo en ElevenLabs ("Ready to practice…?"): en modo repaso esto la lleva
   * directo a la clase en vez de ofrecer charla o mock interview.
   */
  openingMessage?: string;
}

interface VoiceState {
  status: ConversationStatus;
  connected: boolean;
  connecting: boolean;
  isSpeaking: boolean;
  mode: VoiceMode;
  /** epoch ms del inicio de la llamada en curso (cronómetro). */
  callStartedAt: number | null;
  /** Líneas de la llamada con la tutora en curso (o la última). */
  tutorLines: Line[];
  tutorSave: TutorSaveState;
  transcript: Line[];
  error: string | null;
  action: string | null;
  connect: (mode?: VoiceMode, opts?: ConnectOptions) => Promise<void>;
  disconnect: () => void;
}

/** Bajo esto, una práctica cortada de golpe no amerita auto-guardado (ruido). */
const MIN_ABRUPT_LINES = 8;

const todayLabel = () =>
  new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

const Ctx = createContext<VoiceState | null>(null);
export function useVoice(): VoiceState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVoice fuera de VoiceProvider");
  return v;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

async function ensureMic(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Micrófono",
        message: "Hermes necesita el micrófono para hablar contigo en tiempo real.",
        buttonPositive: "Permitir",
      },
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const chat = useChat();
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [mode, setModeState] = useState<VoiceMode>("hermes");
  const modeRef = useRef<VoiceMode>("hermes");
  const setMode = (m: VoiceMode) => {
    modeRef.current = m;
    setModeState(m);
  };
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [tutorSave, setTutorSave] = useState<TutorSaveState>(null);
  // Práctica con la tutora: dónde empezó en el transcript, cuándo y si ya se
  // guardó (por end_practice_session o por el auto-guardado al cortar).
  const tutorStartLineRef = useRef(0);
  const tutorStartedAtRef = useRef<string | null>(null);
  const tutorSavedRef = useRef(false);
  const openingRef = useRef<string | null>(null);
  const connectedBefore = useRef(false);
  // Espejo del transcript + marca de lo ya plegado al chat: al colgar, las
  // líneas nuevas de la llamada se pliegan al hilo de texto (patrón ChatGPT).
  const transcriptRef = useRef<Line[]>([]);
  const foldedRef = useRef(0);

  // Ref a la conversación para poder usarla dentro de sus propios callbacks
  // (onConnect) sin caer en la zona muerta temporal del const.
  const convRef = useRef<ReturnType<typeof useConversation> | null>(null);

  const pushLine = useCallback((l: Line) => {
    setTranscript((prev) => {
      const next = [...prev.slice(-60), l];
      // El slice corre la ventana: el índice de plegado se corre igual.
      foldedRef.current = Math.max(0, foldedRef.current - (prev.length + 1 - next.length));
      transcriptRef.current = next;
      return next;
    });
  }, []);

  const flashAction = useCallback((label: string, ms = 1600) => {
    setAction(label);
    setTimeout(() => setAction((a) => (a === label ? null : a)), ms);
  }, []);

  // Hook combinado: nos da startSession/endSession/status/isSpeaking y registra
  // los callbacks (onMessage, etc.) con el provider.
  const conv = useConversation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onMessage: (m: any) => {
      const text = str(m?.message) ?? str(m?.text);
      if (!text) return;
      const src = m?.source ?? m?.role;
      pushLine({
        who: src === "user" ? "TÚ" : modeRef.current === "tutor" ? "TUTORA" : "HERMES",
        text,
      });
    },
    onConnect: () => {
      setError(null);
      setCallStartedAt(Date.now());
      if (modeRef.current === "tutor") {
        tutorStartLineRef.current = transcriptRef.current.length;
        tutorStartedAtRef.current = new Date().toISOString();
        tutorSavedRef.current = false;
        setTutorSave(null);
        const opening = openingRef.current;
        openingRef.current = null;
        if (opening) {
          setTimeout(() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (convRef.current as any)?.sendUserMessage?.(opening);
            } catch {
              /* sin canal: la tutora igual tiene el contexto del repaso */
            }
          }, 1200);
        }
        return;
      }
      // Reconexión sin recargar: reinyecta contexto para no perder el hilo.
      if (connectedBefore.current && transcript.length) {
        const recap = transcript
          .slice(-20)
          .map((l) => `${l.who}: ${l.text}`)
          .join("\n");
        try {
          convRef.current?.sendContextualUpdate(
            `[Continuidad de sesión] El usuario reactivó la voz: es la MISMA conversación. Retoma el hilo con naturalidad, sin volver a saludar. Lo último que hablamos:\n${recap}`.slice(
              0,
              1600,
            ),
          );
        } catch {
          /* aún sin canal listo */
        }
      }
      connectedBefore.current = true;
    },
    onDisconnect: () => {
      setCallStartedAt(null);
      const fresh = transcriptRef.current.slice(foldedRef.current);
      foldedRef.current = transcriptRef.current.length;
      if (modeRef.current === "tutor") {
        // La práctica NO va al hilo de Hermes: vive en Inglés. Si la llamada se
        // cortó sin end_practice_session, se guarda igual lo hablado.
        const lines = transcriptRef.current.slice(tutorStartLineRef.current);
        if (!tutorSavedRef.current && tutorStartedAtRef.current && lines.length >= MIN_ABRUPT_LINES) {
          tutorSavedRef.current = true;
          void api
            .saveEnglishSession({
              started_at: tutorStartedAtRef.current,
              duration_sec: tutorDurationSec(),
              transcript: tutorTranscript(),
              source: "mobile",
            })
            .then(() => setTutorSave("autosaved"))
            .catch(() => setTutorSave("error"));
        }
        return;
      }
      // Pliega lo hablado en ESTA llamada al hilo de chat (queda unificado).
      const hermesLines = fresh.filter(
        (l): l is { who: "TÚ" | "HERMES"; text: string } => l.who !== "TUTORA",
      );
      if (hermesLines.length) chat.addVoiceLines(hermesLines);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (msg: any) => setError(typeof msg === "string" ? msg : "Error de la llamada."),
  });
  convRef.current = conv;

  const tutorLinesNow = () => transcriptRef.current.slice(tutorStartLineRef.current);
  // Mismo formato que la web ("TUTOR:"/"TÚ:"): el reporte del agente lo lee igual.
  const tutorTranscript = () =>
    tutorLinesNow()
      .map((l) => `${l.who === "TÚ" ? "TÚ" : "TUTOR"}: ${l.text}`)
      .join("\n");
  const tutorDurationSec = () =>
    tutorStartedAtRef.current
      ? Math.max(0, Math.round((Date.now() - Date.parse(tutorStartedAtRef.current)) / 1000))
      : 0;

  // ── Tools de la tutora de inglés (mismo contrato que EnglishTutorTools web) ──
  useConversationClientTool("save_vocab", async (p: any) => {
    const term = str(p?.term);
    const meaning = str(p?.meaning_es);
    if (!term || !meaning) return "Missing term or meaning.";
    try {
      await api.saveVocab({ term, meaning_es: meaning, example: str(p?.example) });
      flashAction(`Guardado: ${term}`);
      return `Saved "${term}".`;
    } catch {
      return "Could not save it (agent offline) — keep going.";
    }
  });

  useConversationClientTool("recall_vocab", async () => {
    try {
      const due = await api.englishVocab(true, 6);
      if (!due.length) return "No vocabulary due for review — nothing pending.";
      return `Vocabulary due for review: ${due
        .map((v) =>
          v.meaning_es
            ? `${v.term} (${v.meaning_es})`
            : `${v.term} (no meaning saved yet — explain it and re-save it with save_vocab)`,
        )
        .join(" · ")}. Quiz him conversationally on a few of these.`;
    } catch {
      return "Could not fetch the vocabulary list (agent offline).";
    }
  });

  useConversationClientTool("end_practice_session", async (p: any) => {
    const errors = Array.isArray(p?.errors)
      ? (p.errors as Record<string, unknown>[])
          .map((e) => ({
            quote: str(e.quote) ?? "",
            correction: str(e.correction) ?? "",
            note_es: str(e.note_es),
          }))
          .filter((e) => e.quote && e.correction)
      : [];
    try {
      await api.saveEnglishSession({
        started_at: tutorStartedAtRef.current ?? new Date().toISOString(),
        duration_sec: tutorDurationSec(),
        topics: Array.isArray(p?.topics) ? (p.topics as unknown[]).map(String) : [],
        fluency: typeof p?.fluency === "number" ? p.fluency : undefined,
        errors,
        wins: Array.isArray(p?.wins) ? (p.wins as unknown[]).map(String) : [],
        transcript: tutorTranscript(),
        source: "mobile",
      });
      tutorSavedRef.current = true;
      setTutorSave("saved");
      return "Session saved — the full report will show up in his app in a minute.";
    } catch {
      return "Could not save the session (agent offline). Tell him the summary out loud instead.";
    }
  });

  // Hermes → "quiero practicar inglés": cuelga y conecta con la tutora.
  useConversationClientTool("start_english_practice", async () => {
    app.setTab("ingles");
    setTimeout(() => void connectRef.current?.("tutor"), 1200);
    return "Listo, te paso con tu tutora de inglés.";
  });

  // ── Registro de client tools (mismos nombres que el agente de voz) ─────
  useConversationClientTool("focus_project", async (p: any) => {
    const raw = str(p?.project);
    if (!raw) {
      app.setFocused(null);
      app.setTab("proyectos");
      return "Listo, quité el foco.";
    }
    const slug = app.resolveSlug(raw);
    if (!slug) return `No tengo un proyecto que coincida con "${raw}".`;
    app.setFocused(slug);
    app.setTab("proyectos");
    flashAction(`Enfocando ${slug}`);
    return `Enfocando ${slug}.`;
  });

  useConversationClientTool("show_panel", async (p: any) => {
    const raw = (str(p?.panel) ?? "").toLowerCase();
    const tab: Tab | null = raw.includes("reuni") || raw.includes("junta") || raw.includes("meet")
      ? "reuniones"
      : raw.includes("ingl") || raw.includes("english") || raw.includes("clase") || raw.includes("tutor")
        ? "ingles"
      : raw.includes("tarea") || raw.includes("task") || raw.includes("mision") || raw.includes("misión")
        ? "tareas"
        : raw.includes("finan") || raw.includes("dinero") || raw.includes("plata") || raw.includes("gasto")
          ? "finanzas"
          : raw.includes("proyect") || raw.includes("project")
            ? "proyectos"
            : raw.includes("voz") || raw.includes("voice") || raw.includes("chat") || raw.includes("hermes")
              ? "voz"
              : null;
    if (!tab) return `No conozco el panel "${raw}".`;
    app.setTab(tab);
    return `Mostrando ${tab}.`;
  });

  useConversationClientTool("work_on_project", async (p: any) => {
    const slug = app.resolveSlug(str(p?.project));
    if (!slug) return `¿En qué proyecto? No reconocí "${str(p?.project) ?? ""}".`;
    const prompt = str(p?.prompt);
    if (!prompt) return "¿Qué quieres que haga Claude en el repo?";
    flashAction(`Claude · ${slug}`, 3000);
    try {
      const res = await api.startClaudeRun(slug, prompt);
      return `Va, Claude ya está trabajando en ${slug}. El run es ${res.run_id}.`;
    } catch {
      return "No pude lanzar a Claude: el agente no responde.";
    }
  });

  useConversationClientTool("run_task", async (p: any) => {
    const prompt = str(p?.prompt);
    if (!prompt) return "¿Qué tarea quieres que haga?";
    try {
      const res = await api.startTask(prompt);
      flashAction("Tarea en curso", 3000);
      return `Va, lo estoy preparando en segundo plano. El id es ${res.task_id}.`;
    } catch {
      return "No alcanzo al agente local ahora mismo.";
    }
  });

  useConversationClientTool("check_task", async (p: any) => {
    const id = str(p?.task_id);
    if (!id) return "¿De qué tarea? Necesito el identificador.";
    try {
      const t = await api.getAsyncTask(id);
      if (t.status === "running") return `Sigue en curso, ${t.toolCalls} acciones hasta ahora.`;
      if (t.status === "error") return `Falló: ${t.result?.slice(0, 200) ?? "sin detalle"}.`;
      return `Terminó. ${t.result?.slice(0, 300) ?? "Sin detalle."}`;
    } catch {
      /* probamos como run de Claude Code */
    }
    try {
      const runs = await api.claudeRuns();
      const run = runs.find((r) => r.id === id);
      if (!run) return `No encontré nada con el id ${id}.`;
      if (run.status === "running") return `Claude sigue trabajando en ${run.projectSlug}.`;
      if (run.status === "error") return `El run en ${run.projectSlug} falló.`;
      return `Terminó en ${run.projectSlug}. ${run.lastText ?? ""}`.trim();
    } catch {
      return `No pude consultar el id ${id}.`;
    }
  });

  useConversationClientTool("get_project_status", async (p: any) => {
    try {
      const data = await api.toolGetProjectStatus(str(p?.project));
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude leer el estado de los proyectos.";
    }
  });

  useConversationClientTool("search_memory", async (p: any) => {
    try {
      const data = await api.toolSearchMemory(str(p?.query) ?? "");
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude buscar en la memoria.";
    }
  });

  useConversationClientTool("save_memory", async (p: any) => {
    const content = str(p?.content);
    if (!content) return "¿Qué quieres que recuerde?";
    try {
      await api.toolSaveMemory(content, str(p?.type));
      return "Memoria guardada.";
    } catch {
      return "No pude guardar la memoria.";
    }
  });

  useConversationClientTool("get_daily_brief", async () => {
    try {
      const data = await api.toolDailyBrief();
      return data.brief;
    } catch {
      return "No pude armar el resumen del día.";
    }
  });

  useConversationClientTool("show_project_status", async (p: any) => {
    const slug = app.resolveSlug(str(p?.project));
    if (slug) {
      app.setFocused(slug);
      app.setTab("proyectos");
      flashAction(`Estado de ${slug}`);
    }
    try {
      const data = await api.toolGetProjectStatus(slug ?? undefined);
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude leer el estado de los proyectos.";
    }
  });

  // ── Finanzas personales (asesor financiero por voz, paridad con la web) ─
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

  useConversationClientTool("log_transaction", async (p: any) => {
    const amount = typeof p?.amount === "number" ? p.amount : Number(p?.amount);
    if (!amount || amount <= 0) return "¿De cuánto fue el movimiento?";
    try {
      const res = await api.post<{ ok: boolean; deduped?: boolean; confirmation?: string; error?: string }>(
        "/tools/log_transaction",
        {
          kind: str(p?.kind) ?? "expense",
          amount,
          currency: str(p?.currency),
          category: str(p?.category),
          account: str(p?.account),
          note: str(p?.note),
          occurred_on: str(p?.date),
          allow_duplicate: p?.allow_duplicate === true,
        },
      );
      if (!res.ok) return res.error ?? "No pude registrar el movimiento.";
      if (res.deduped)
        return `Ojo: ya tenía ese registro hoy, no lo dupliqué. Si es un movimiento distinto, dime "regístralo de todos modos".`;
      flashAction("Movimiento registrado");
      return res.confirmation ?? "Registrado.";
    } catch {
      return "No alcanzo al agente para registrar el movimiento.";
    }
  });

  useConversationClientTool("correct_last_transaction", async (p: any) => {
    try {
      const res = await api.post<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/correct_last_transaction",
        {
          amount: num(p?.amount),
          currency: str(p?.currency),
          category: str(p?.category),
          void: p?.void === true,
        },
      );
      return res.ok ? (res.confirmation ?? "Corregida.") : (res.error ?? "No pude corregirla.");
    } catch {
      return "No alcanzo al agente para corregir.";
    }
  });

  useConversationClientTool("get_finance_summary", async (p: any) => {
    try {
      const res = await api.post<{ text: string }>("/tools/get_finance_summary", {
        month: str(p?.month),
        currency: str(p?.currency),
      });
      return res.text;
    } catch {
      return "No pude consultar las finanzas.";
    }
  });

  useConversationClientTool("get_balance", async () => {
    try {
      const res = await api.post<{ text: string }>("/tools/get_balance", {});
      return res.text;
    } catch {
      return "No pude consultar el saldo.";
    }
  });

  useConversationClientTool("set_wallet_balance", async (p: any) => {
    const wallet = str(p?.wallet);
    const balance = typeof p?.balance === "number" ? p.balance : Number(p?.balance);
    if (!wallet || !Number.isFinite(balance)) return "¿Qué billetera y qué saldo fijo?";
    try {
      const res = await api.post<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/set_wallet_balance",
        { wallet, balance, currency: str(p?.currency) },
      );
      return res.ok ? (res.confirmation ?? "Saldo fijado.") : (res.error ?? "No pude fijarlo.");
    } catch {
      return "No alcanzo al agente para fijar el saldo.";
    }
  });

  // ── Hábitos y metas (coach por voz) ────────────────────────────────────
  useConversationClientTool("log_habit", async (p: any) => {
    const habit = str(p?.habit);
    if (!habit) return "¿Qué hábito marco?";
    try {
      const res = await api.post<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/log_habit",
        { habit, note: str(p?.note) },
      );
      return res.ok ? (res.confirmation ?? "Marcado.") : (res.error ?? "No pude marcarlo.");
    } catch {
      return "No alcanzo al agente para marcar el hábito.";
    }
  });

  useConversationClientTool("get_habits_today", async () => {
    try {
      const data = await api.post<unknown>("/tools/get_habits_today", {});
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude consultar los hábitos.";
    }
  });

  useConversationClientTool("update_goal", async (p: any) => {
    const goal = str(p?.goal);
    if (!goal) return "¿Qué meta actualizo?";
    try {
      const res = await api.post<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/update_goal",
        { goal, progress: num(p?.progress), delta: num(p?.delta), milestone: str(p?.milestone) },
      );
      return res.ok ? (res.confirmation ?? "Actualizada.") : (res.error ?? "No pude actualizarla.");
    } catch {
      return "No alcanzo al agente para actualizar la meta.";
    }
  });

  // ── Google Calendar por voz ────────────────────────────────────────────
  useConversationClientTool("create_event", async (p: any) => {
    const title = str(p?.title);
    const start = str(p?.start);
    if (!title || !start) return "¿Qué evento creo y para cuándo?";
    try {
      const res = await api.post<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/create_event",
        {
          title,
          start,
          end: str(p?.end),
          duration_min: num(p?.duration_min),
          all_day: p?.all_day === true,
          description: str(p?.description),
          location: str(p?.location),
        },
      );
      return res.ok ? (res.confirmation ?? "Evento creado.") : (res.error ?? "No pude crearlo.");
    } catch {
      return "No alcanzo al agente para crear el evento.";
    }
  });

  useConversationClientTool("find_events", async (p: any) => {
    try {
      const res = await api.post<{ ok: boolean; events?: unknown[]; error?: string }>(
        "/tools/find_events",
        { query: str(p?.query), days_ahead: num(p?.days_ahead) },
      );
      if (!res.ok) return res.error ?? "No pude buscar en el calendario.";
      if (!res.events?.length) return "No encontré eventos que coincidan.";
      return JSON.stringify(res.events).slice(0, 1500);
    } catch {
      return "No alcanzo al agente para buscar en el calendario.";
    }
  });

  useConversationClientTool("update_event", async (p: any) => {
    const eventId = str(p?.event_id);
    if (!eventId) return "Primero busco el evento con find_events para tener su id.";
    try {
      const res = await api.post<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/update_event",
        {
          event_id: eventId,
          title: str(p?.title),
          start: str(p?.start),
          end: str(p?.end),
          duration_min: num(p?.duration_min),
          all_day: p?.all_day === true ? true : undefined,
          description: str(p?.description),
          location: str(p?.location),
        },
      );
      return res.ok ? (res.confirmation ?? "Evento actualizado.") : (res.error ?? "No pude modificarlo.");
    } catch {
      return "No alcanzo al agente para modificar el evento.";
    }
  });

  useConversationClientTool("cancel_event", async (p: any) => {
    const eventId = str(p?.event_id);
    if (!eventId) return "Primero busco el evento con find_events para tener su id.";
    try {
      const res = await api.post<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/cancel_event",
        { event_id: eventId, title: str(p?.title) },
      );
      return res.ok ? (res.confirmation ?? "Evento cancelado.") : (res.error ?? "No pude cancelarlo.");
    } catch {
      return "No alcanzo al agente para cancelar el evento.";
    }
  });

  // ── Conexión ───────────────────────────────────────────────────────────
  const connectRef = useRef<((m?: VoiceMode, o?: ConnectOptions) => Promise<void>) | null>(null);
  const connect = useCallback(async (target: VoiceMode = "hermes", opts?: ConnectOptions) => {
    setError(null);
    // Una sola conversación a la vez (un ConversationProvider): cambiar de
    // agente cuelga la actual primero.
    if (conv.status === "connected" || conv.status === "connecting") {
      try {
        conv.endSession();
      } catch {
        /* noop */
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    const ok = await ensureMic();
    if (!ok) {
      setError("Sin permiso de micrófono no puedo escucharte.");
      return;
    }
    try {
      try {
        await AudioSession?.startAudioSession?.();
      } catch {
        /* algunos entornos la manejan solos */
      }
      const creds = await api.voiceToken(target === "tutor" ? "tutor" : undefined);
      if (creds.error || creds.notConfigured) {
        setError(creds.error ?? "Voz no configurada en el agente.");
        return;
      }
      const today = todayLabel();
      const dynamicVariables: Record<string, string> =
        target === "tutor"
          ? {
              practice_context:
                opts?.practiceContext ??
                (await api.englishContext().catch(() => "First session — no history yet.")),
              today,
            }
          : { session_scope: "El usuario te habla desde la app del celular.", today };
      // El modo se fija ANTES de conectar: onConnect/onMessage ya etiquetan bien.
      setMode(target);
      openingRef.current = target === "tutor" ? (opts?.openingMessage ?? null) : null;
      if (creds.conversationToken) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conv.startSession({
          conversationToken: creds.conversationToken,
          connectionType: "webrtc",
          dynamicVariables,
        } as any);
      } else if (creds.signedUrl) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conv.startSession({ signedUrl: creds.signedUrl, connectionType: "websocket", dynamicVariables } as any);
      } else {
        setError("El agente no devolvió credenciales de voz.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude conectar la voz.");
    }
  }, [conv]);
  connectRef.current = connect;

  const disconnect = useCallback(() => {
    try {
      conv.endSession();
    } catch {
      /* noop */
    }
    try {
      void AudioSession?.stopAudioSession?.();
    } catch {
      /* noop */
    }
  }, [conv]);

  const value: VoiceState = {
    status: conv.status,
    connected: conv.status === "connected",
    connecting: conv.status === "connecting",
    isSpeaking: conv.isSpeaking,
    mode,
    callStartedAt,
    tutorLines: mode === "tutor" ? transcript.slice(Math.max(0, tutorStartLineRef.current)) : [],
    tutorSave,
    transcript,
    error,
    action,
    connect,
    disconnect,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
