"use client";

// ENTENDER: el tutor de proyecto. Conversación a la izquierda (texto, con lo
// que leyó para responder) y pizarra a la derecha: cada diagrama llega por la
// tool draw_diagram con sus fuentes; clic en un nodo = "explícame esto".
// La conversación vive en el agente (disco local), no en el navegador.
//
// v5: el proyecto se elige con un selector compacto junto al título (eran doce
// chips que desbordaban la cabecera); la conversación va sin caja, con el
// MISMO composer que Inicio, y la caja queda para la pizarra — el objeto que
// se mira. Los glifos (●, ◫, 🎙, ■) pasan a iconos de trazo.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { usePathname } from "next/navigation";
import type {
  TutorConversation,
  TutorConversationSummary,
  TutorDiagram,
  TutorMessage,
  TutorProject,
} from "@hermes/shared";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { PanelState } from "@/components/ui/PanelState";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { Pizarra } from "@/components/entender/Pizarra";
import { useOfficeDictation } from "@/hooks/useOfficeDictation";
import { createSpeaker, speechAvailable, type Speaker } from "@/lib/entender/speaker";
import {
  deleteTutorConversation,
  getTutorConversation,
  listTutorConversations,
  listTutorProjects,
  streamTutor,
} from "@/lib/tutor";

const PROJECT_KEY = "hermes-entender-project";
const VOICE_KEY = "hermes-entender-voz";

// Iconos de trazo 1.7 (como los de la barra lateral), en lugar de glifos.
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

/** Recorrido guiado: de lo general a lo particular, y al final explicarlo tú. */
const STARTERS: { title: string; hint: string; prompt: string }[] = [
  {
    title: "El panorama",
    hint: "Qué es la plataforma y cómo encajan los repos",
    prompt:
      "Dame el panorama: ¿qué es este proyecto, qué hace cada repo y cómo se hablan entre ellos? Dibújamelo.",
  },
  {
    title: "El recorrido de un mensaje",
    hint: "Del chat del usuario al agente y de vuelta",
    prompt:
      "Explícame el recorrido completo de un mensaje de chat: desde que el usuario escribe hasta que ve la respuesta, pasando por el backend. Con un diagrama de secuencia.",
  },
  {
    title: "Un agente por dentro",
    hint: "Cómo está hecho uno de los agentes",
    prompt:
      "Toma uno de los agentes reales y explícame cómo está hecho por dentro: su definición, sus fases, sus herramientas y de dónde saca los datos.",
  },
  {
    title: "Los datos y la migración",
    hint: "Las tablas y lo que se está moviendo",
    prompt:
      "Explícame el modelo de datos y la migración que se está haciendo (lo que ha salido en las reuniones): qué cambia, por qué y qué está abierto.",
  },
  {
    title: "Quién es quién",
    hint: "Dueños, decisiones y pendientes",
    prompt:
      "¿Quién es quién en el proyecto, de qué es dueño cada uno y qué decisiones recientes tomaron? Usa las actas y el historial de git.",
  },
  {
    title: "Explícamelo tú",
    hint: "Tú explicas, el tutor corrige",
    prompt:
      "Quiero practicar: hazme UNA pregunta sobre la arquitectura del proyecto para que yo te la explique con mis palabras, y después corrígeme.",
  },
];

interface Live {
  text: string;
  tools: { name: string; detail?: string }[];
  diagrams: TutorDiagram[];
}

function readProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

export function EntenderView() {
  const pathname = usePathname();
  const visible = pathname === "/entender";
  const [projects, setProjects] = useState<TutorProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [conversations, setConversations] = useState<TutorConversationSummary[]>([]);
  const [conv, setConv] = useState<TutorConversation | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [active, setActive] = useState<TutorDiagram | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Modo voz: hablas → al callarte se envía → la respuesta se dice frase a
  // frase mientras llega → al terminar se reabre el micrófono (manos libres).
  const dictation = useOfficeDictation("es-CO");
  const [voiceMode, setVoiceMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakerRef = useRef<Speaker | null>(null);
  const voiceModeRef = useRef(false);
  voiceModeRef.current = voiceMode && visible;
  /** Dictado suelto (sin modo voz): lo dicho va al cuadro de texto, no se envía. */
  const dictateToDraft = useRef(false);

  useEffect(() => {
    listTutorProjects()
      .then((list) => {
        setProjects(list);
        const saved = readProject();
        setProject(list.find((p) => p.slug === saved)?.slug ?? list[0]?.slug ?? null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const refreshConversations = useCallback(async (slug: string) => {
    setConversations(await listTutorConversations(slug).catch(() => []));
  }, []);

  useEffect(() => {
    if (!project) return;
    try {
      localStorage.setItem(PROJECT_KEY, project);
    } catch {
      /* sin storage */
    }
    setConv(null);
    setActive(null);
    void refreshConversations(project);
  }, [project, refreshConversations]);

  const openConversation = async (id: string) => {
    if (!project) return;
    const c = await getTutorConversation(project, id).catch(() => null);
    setConv(c);
    const last = c?.history.flatMap((m) => m.diagrams ?? []).at(-1) ?? null;
    setActive(last);
  };

  const busy = live !== null;

  const send = async (message: string, opts: { voice?: boolean } = {}) => {
    const text = message.trim();
    if (!text || !project || busy) return;
    setDraft("");
    setError(null);
    setPending(text);
    setLive({ text: "", tools: [], diagrams: [] });
    const abort = new AbortController();
    abortRef.current = abort;
    let convId = conv?.id;
    const voice = opts.voice && speechAvailable();
    speakerRef.current?.stop();
    speakerRef.current = voice
      ? createSpeaker(
          () => {
            setSpeaking(false);
            // Terminó de hablar: tu turno (si sigues en modo voz y en la vista).
            if (voiceModeRef.current) dictation.start();
          },
          () => setSpeaking(true),
        )
      : null;
    const speaker = speakerRef.current;
    try {
      await streamTutor(
        project,
        { message: text, conversationId: conv?.id, voice: !!voice },
        (ev) => {
          if (ev.type === "conversation") convId = ev.id;
          else if (ev.type === "delta") {
            speaker?.push(ev.text);
            setLive((l) => (l ? { ...l, text: l.text + ev.text } : l));
          }
          else if (ev.type === "tool")
            setLive((l) =>
              l ? { ...l, tools: [...l.tools, { name: ev.name, detail: ev.detail }] } : l,
            );
          else if (ev.type === "diagram") {
            setLive((l) => (l ? { ...l, diagrams: [...l.diagrams, ev.diagram] } : l));
            setActive(ev.diagram);
          } else if (ev.type === "done" && ev.error) setError(ev.error);
        },
        abort.signal,
      );
    } catch (err) {
      if (!abort.signal.aborted) setError((err as Error).message);
    } finally {
      abortRef.current = null;
      speaker?.end();
      // La verdad queda en el agente: se relee la conversación ya guardada.
      if (convId) {
        const fresh = await getTutorConversation(project, convId).catch(() => null);
        if (fresh) setConv(fresh);
      }
      setLive(null);
      setPending(null);
      void refreshConversations(project);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    speakerRef.current?.stop();
    setSpeaking(false);
  };

  // Lo dictado: en modo voz se envía solo; en dictado suelto va al cuadro.
  useEffect(() => {
    if (dictation.state !== "ready" || !dictation.text.trim()) return;
    const said = dictation.text;
    dictation.cancel();
    if (dictateToDraft.current) {
      dictateToDraft.current = false;
      setDraft((d) => (d ? `${d} ${said}` : said));
    } else if (voiceModeRef.current) void send(said, { voice: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.state, dictation.text]);

  // Silencio sin hablar: el dictado se cierra a los 8 s. En modo voz se reabre
  // hasta 3 veces (~24 s pensando la pregunta) antes de quedar "En pausa".
  const relistens = useRef(0);
  const prevDictation = useRef(dictation.state);
  useEffect(() => {
    const was = prevDictation.current;
    prevDictation.current = dictation.state;
    if (dictation.state === "ready") relistens.current = 0;
    if (was !== "listening" || dictation.state !== "idle") return;
    if (!voiceModeRef.current || busy || speaking || relistens.current >= 3) return;
    relistens.current += 1;
    dictation.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.state]);

  const toggleVoice = () => {
    if (voiceMode) {
      setVoiceMode(false);
      speakerRef.current?.stop();
      setSpeaking(false);
      dictation.cancel();
      try {
        localStorage.setItem(VOICE_KEY, "off");
      } catch {
        /* sin storage */
      }
      return;
    }
    setVoiceMode(true);
    try {
      localStorage.setItem(VOICE_KEY, "on");
    } catch {
      /* sin storage */
    }
    // El clic es el gesto que el navegador exige para abrir el micrófono.
    if (!busy) dictation.start();
  };

  /** Interrumpir: calla la voz (y el turno si aún corre) y te devuelve la palabra. */
  const interrupt = () => {
    stop();
    dictation.start();
  };

  // Salir de la vista apaga el micrófono y la voz (el turno en curso sigue).
  useEffect(() => {
    if (visible) return;
    speakerRef.current?.stop();
    setSpeaking(false);
    dictation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const newConversation = () => {
    if (busy) return;
    setConv(null);
    setActive(null);
  };

  const remove = async () => {
    if (!project || !conv || busy) return;
    await deleteTutorConversation(project, conv.id).catch(() => undefined);
    setConv(null);
    setActive(null);
    void refreshConversations(project);
  };

  const history: TutorMessage[] = conv?.history ?? [];
  const diagrams = useMemo(
    () => [...history.flatMap((m) => m.diagrams ?? []), ...(live?.diagrams ?? [])],
    [history, live?.diagrams],
  );

  // Autoscroll solo si ya estabas abajo (leer arriba no se interrumpe).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [history.length, live?.text, live?.tools.length, pending]);

  const current = projects?.find((p) => p.slug === project);

  if (loadError)
    return (
      <PanelState
        kind="error"
        title="No pude cargar los proyectos"
        hint={`${loadError}. El tutor solo responde desde la red local.`}
      />
    );
  if (!projects) return <PanelState kind="loading" title="Cargando proyectos…" />;
  if (!projects.length)
    return (
      <PanelState
        kind="empty"
        title="No hay proyectos con repos en esta máquina"
        hint="El tutor necesita la ruta_local (o repos:) del proyecto en su nota del vault."
      />
    );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ViewHeader
        title="Entender"
        // Doce proyectos no caben como chips (se salían de la cabecera): un
        // selector compacto junto al título, y al lado lo que tiene ESE proyecto.
        tabs={
          <div className="flex min-w-0 items-center gap-3">
            <ProjectPicker
              projects={projects}
              value={project}
              onChange={setProject}
              disabled={busy}
            />
            {current && (
              <span className="hidden truncate text-xs text-text-faint sm:inline">
                {current.repos.length} repo{current.repos.length === 1 ? "" : "s"} ·{" "}
                {current.meetings} actas · solo lectura
              </span>
            )}
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
        {/* ── Conversación ─────────────────────────────────────────────
            Sin caja (como el chat de Inicio): la caja es para la pizarra, que
            es el objeto que se mira; aquí se conversa sobre el lienzo. */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 items-center gap-1 pb-3">
            <select
              value={conv?.id ?? ""}
              onChange={(e) =>
                e.target.value ? void openConversation(e.target.value) : newConversation()
              }
              disabled={busy}
              className="h-8 min-w-0 flex-1 cursor-pointer truncate rounded-sm border border-line bg-panel px-2.5 text-sm text-text outline-none transition-colors hover:border-line-2 focus:border-line-2 disabled:cursor-default disabled:opacity-50"
              aria-label="Conversación"
            >
              <option value="">Conversación nueva</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="md"
              onClick={newConversation}
              disabled={busy}
              title="Empezar una conversación nueva"
              icon={
                <svg {...ICON}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              }
            >
              Nueva
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={toggleVoice}
              aria-pressed={voiceMode}
              title="Le hablas y te responde en voz alta; al terminar vuelve a escucharte"
              className={voiceMode ? "bg-selected text-text" : ""}
              icon={
                voiceMode ? (
                  <span className="pulse-dot block h-2 w-2 rounded-full bg-cyan" />
                ) : (
                  <svg {...ICON}>
                    <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
                  </svg>
                )
              }
            >
              Modo voz
            </Button>
            {conv && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                title="Borrar esta conversación"
                aria-label="Borrar esta conversación"
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-sm text-text-faint transition-colors hover:bg-red/10 hover:text-red disabled:cursor-default disabled:opacity-40"
              >
                <svg {...ICON}>
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                </svg>
              </button>
            )}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 pb-2">
            {history.length === 0 && !pending ? (
              <div className="flex flex-col gap-4 pt-1">
                <p className="text-sm leading-relaxed text-text-dim">
                  Pregúntale lo que quieras de {current?.name}: lee el código de los repos, las
                  actas y la nota del proyecto, y te lo explica dibujando. Todo lo que afirma trae
                  su fuente. O empieza por el recorrido:
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {STARTERS.map((s, i) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => void send(s.prompt, { voice: voiceMode })}
                      className="flex cursor-pointer flex-col gap-0.5 rounded-sm border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-line-2 hover:bg-hover"
                    >
                      <span className="text-xs text-text-faint tabular-nums">{i + 1}</span>
                      <span className="text-sm font-medium text-text">{s.title}</span>
                      <span className="text-xs leading-snug text-text-faint">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              history.map((m, i) => (
                <MessageView key={`${m.at}-${i}`} m={m} onDiagram={setActive} active={active} />
              ))
            )}

            {pending && (
              <>
                <MessageView
                  m={{ role: "user", text: pending, at: "" }}
                  onDiagram={setActive}
                  active={active}
                />
                <div className="space-y-2">
                  {live && live.tools.length > 0 && (
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-dim">
                      <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
                      <span className="min-w-0 truncate">
                        {live.tools.at(-1)?.name}
                        {live.tools.at(-1)?.detail ? ` ${live.tools.at(-1)?.detail}` : ""}
                      </span>
                      <span className="shrink-0 text-text-faint tabular-nums">
                        · {live.tools.length} {live.tools.length === 1 ? "consulta" : "consultas"}
                      </span>
                    </p>
                  )}
                  {live?.text ? (
                    <div className="text-sm leading-relaxed text-text">
                      <Markdown source={live.text} />
                    </div>
                  ) : (
                    <p className="pulse-dot text-sm text-text-dim">Leyendo el proyecto…</p>
                  )}
                  {live && live.diagrams.length > 0 && (
                    <DiagramChips diagrams={live.diagrams} onDiagram={setActive} active={active} />
                  )}
                </div>
              </>
            )}
            {error && (
              <p className="flex items-start gap-2 text-sm text-text-dim">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
                {error}
              </p>
            )}
          </div>

          {voiceMode && (
            <VoiceBar
              listening={dictation.state === "listening"}
              transcribing={dictation.state === "transcribing"}
              thinking={busy && !speaking}
              speaking={speaking}
              heard={[dictation.text, dictation.interim].filter(Boolean).join(" ")}
              error={dictation.error}
              onInterrupt={interrupt}
              onListen={() => {
                relistens.current = 0;
                dictation.start();
              }}
              onStopListening={() => dictation.stop()}
            />
          )}

          {/* Composer: la MISMA caja que el de Inicio (texto arriba, barra
              abajo, enviar redondo). El anillo de foco vive en la caja. */}
          <form
            className="hud-field mt-2 flex shrink-0 flex-col gap-1.5 rounded-lg border border-line-2 bg-panel px-3.5 pt-3 pb-2 shadow-[var(--shadow-card)] transition-colors focus-within:border-text-faint/60"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft, { voice: voiceMode });
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft, { voice: voiceMode });
                }
              }}
              rows={Math.min(5, Math.max(1, draft.split("\n").length))}
              placeholder={`Pregunta sobre ${current?.name ?? "el proyecto"}…`}
              className="max-h-[140px] min-h-[24px] w-full resize-none bg-transparent px-0.5 text-sm leading-relaxed text-text outline-none placeholder:text-text-faint"
            />
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate px-0.5 text-xs text-text-faint">
                {voiceMode ? "Modo voz: también puedes escribir" : "Enter envía · Shift+Enter, línea nueva"}
              </span>
              {!voiceMode && (
                <button
                  type="button"
                  onClick={() => {
                    if (dictation.state === "listening") dictation.stop();
                    else {
                      dictateToDraft.current = true;
                      dictation.start();
                    }
                  }}
                  title="Dictar (lo dicho queda en el cuadro para revisarlo)"
                  aria-label={dictation.state === "listening" ? "Detener dictado" : "Dictar"}
                  aria-pressed={dictation.state === "listening"}
                  className={`relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full transition-colors ${
                    dictation.state === "listening"
                      ? "bg-red/10 text-red"
                      : "text-text-dim hover:bg-hover hover:text-text"
                  }`}
                >
                  {dictation.state === "listening" && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-red/30" />
                  )}
                  <svg {...ICON} width={15} height={15} className="relative">
                    <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z" />
                    <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3" />
                  </svg>
                </button>
              )}
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  title="Detener"
                  aria-label="Detener"
                  className="ml-0.5 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-text text-bg transition-opacity hover:opacity-85"
                >
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  title="Enviar (Enter)"
                  aria-label="Enviar"
                  className="ml-0.5 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent transition-colors disabled:cursor-default disabled:bg-selected disabled:text-text-faint"
                >
                  <svg {...ICON} width={15} height={15} strokeWidth={1.8}>
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </svg>
                </button>
              )}
            </div>
          </form>
        </section>

        {/* ── Pizarra ──────────────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-line bg-panel shadow-[var(--shadow-card)]">
          {diagrams.length > 1 && (
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2">
              {diagrams.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setActive(d)}
                  aria-pressed={active?.id === d.id}
                  className={`flex h-7 max-w-[240px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xs px-2 text-xs transition-colors ${
                    active?.id === d.id
                      ? "bg-selected text-text"
                      : "text-text-dim hover:bg-hover hover:text-text"
                  }`}
                >
                  <span className="text-text-faint tabular-nums">{i + 1}</span>
                  <span className="truncate">{d.title}</span>
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <Pizarra
              diagram={active}
              onAsk={(label) =>
                void send(`Explícame «${label}» en el diagrama "${active?.title ?? ""}".`, {
                  voice: voiceMode,
                })
              }
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Selector de proyecto: botón compacto + menú (patrón del selector de máquina). */
function ProjectPicker({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: TutorProject[];
  value: string | null;
  onChange: (slug: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = projects.find((p) => p.slug === value);

  useEffect(() => {
    if (!open) return;
    // Al abrir, el foco va al proyecto actual: flechas y Enter funcionan ya.
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(),
    );
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    next?.focus();
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? "Espera a que termine la respuesta para cambiar de proyecto" : undefined}
        className="flex h-8 max-w-[280px] min-w-0 cursor-pointer items-center gap-2 rounded-sm border border-line bg-panel pr-2 pl-2.5 text-sm text-text shadow-[var(--shadow-card)] transition-colors hover:border-line-2 hover:bg-hover disabled:cursor-default disabled:opacity-60"
      >
        <svg {...ICON} width={13} height={13} className="shrink-0 text-text-faint">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
        <span className="min-w-0 truncate font-medium">{current?.name ?? "Elige un proyecto"}</span>
        <svg {...ICON} width={12} height={12} strokeWidth={2} className="shrink-0 text-text-faint">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Proyecto"
          onKeyDown={onListKey}
          className="absolute top-full left-0 z-40 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-sm border border-line bg-panel p-1 shadow-[var(--shadow-pop)]"
        >
          <div className="px-2 pt-1 pb-1.5 text-2xs text-text-faint">
            {projects.length} proyectos con repos en esta máquina
          </div>
          {projects.map((p) => {
            const on = p.slug === value;
            return (
              <button
                key={p.slug}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(p.slug);
                  setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover ${
                  on ? "bg-selected" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{p.name}</span>
                  <span className="block truncate text-xs text-text-faint">
                    {p.repos.length} repo{p.repos.length === 1 ? "" : "s"} · {p.meetings} actas
                  </span>
                </span>
                {on && (
                  <svg {...ICON} width={14} height={14} strokeWidth={2} className="shrink-0 text-accent">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiagramChips({
  diagrams,
  onDiagram,
  active,
}: {
  diagrams: TutorDiagram[];
  onDiagram: (d: TutorDiagram) => void;
  active: TutorDiagram | null;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {diagrams.map((d) => {
        const on = active?.id === d.id;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onDiagram(d)}
            aria-pressed={on}
            title="Ver en la pizarra"
            className={`flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors ${
              on
                ? "border-line-2 bg-selected text-text"
                : "border-line text-text-dim hover:border-line-2 hover:bg-hover hover:text-text"
            }`}
          >
            <svg {...ICON} width={12} height={12} className="shrink-0 text-text-faint">
              <rect x="3" y="3" width="7" height="6" rx="1.5" />
              <rect x="14" y="15" width="7" height="6" rx="1.5" />
              <path d="M6.5 9v3a3 3 0 0 0 3 3h4.5" />
            </svg>
            <span className="truncate">{d.title}</span>
          </button>
        );
      })}
    </div>
  );
}

function MessageView({
  m,
  onDiagram,
  active,
}: {
  m: TutorMessage;
  onDiagram: (d: TutorDiagram) => void;
  active: TutorDiagram | null;
}) {
  const [showTools, setShowTools] = useState(false);
  if (m.role === "user")
    return (
      // La burbuja del usuario es la misma que la del chat de Inicio.
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg border border-line bg-accent/10 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-text">
          {m.text}
        </div>
      </div>
    );
  return (
    <div className="space-y-2.5">
      <div className="text-sm leading-relaxed text-text">
        <Markdown source={m.text || "—"} />
      </div>
      {m.diagrams && m.diagrams.length > 0 && (
        <DiagramChips diagrams={m.diagrams} onDiagram={onDiagram} active={active} />
      )}
      {m.tools && m.tools.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            aria-expanded={showTools}
            className="-ml-1.5 flex h-6 cursor-pointer items-center gap-1 rounded-xs px-1.5 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <svg
              {...ICON}
              width={12}
              height={12}
              strokeWidth={2}
              className={`transition-transform ${showTools ? "rotate-90" : ""}`}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            Leyó {m.tools.length} fuente{m.tools.length === 1 ? "" : "s"}
          </button>
          {showTools && (
            <ul className="mt-1 space-y-0.5 border-l border-line pl-3">
              {m.tools.map((t, i) => (
                <li key={i} className="truncate font-mono text-xs text-text-faint">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Estado del modo voz: escuchando (con lo que va entendiendo) · pensando · hablando. */
function VoiceBar({
  listening,
  transcribing,
  thinking,
  speaking,
  heard,
  error,
  onInterrupt,
  onListen,
  onStopListening,
}: {
  listening: boolean;
  transcribing: boolean;
  thinking: boolean;
  speaking: boolean;
  heard: string;
  error: string | null;
  onInterrupt: () => void;
  onListen: () => void;
  onStopListening: () => void;
}) {
  let label: string;
  if (speaking) label = "Hablando…";
  else if (thinking) label = "Pensando…";
  else if (transcribing) label = "Transcribiendo…";
  else if (listening) label = "Te escucho — habla y haz una pausa para enviar";
  else label = "En pausa";
  // Punto de estado: rojo = el micrófono está abierto; cyan = en curso.
  const dot = listening
    ? "bg-red pulse-dot"
    : speaking || thinking || transcribing
      ? "bg-cyan pulse-dot"
      : "bg-text-faint";
  return (
    <div className="mt-2 shrink-0 rounded-sm border border-line bg-panel-2 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs text-text">
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span className="truncate">{label}</span>
        </span>
        <span className="flex shrink-0 gap-1">
          {(speaking || thinking) && <Button onClick={onInterrupt}>Interrumpir</Button>}
          {listening ? (
            <Button variant="ghost" onClick={onStopListening}>
              Enviar ya
            </Button>
          ) : (
            !speaking &&
            !thinking &&
            !transcribing && (
              <Button variant="ghost" onClick={onListen}>
                Hablar
              </Button>
            )
          )}
        </span>
      </div>
      {listening && heard && <p className="mt-1.5 text-sm text-text">«{heard}»</p>}
      {error && (
        <p className="mt-1.5 flex items-center gap-2 text-xs text-text-dim">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
          {error}
        </p>
      )}
    </div>
  );
}
