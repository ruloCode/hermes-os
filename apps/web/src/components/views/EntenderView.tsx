"use client";

// ENTENDER: el tutor de proyecto. Conversación a la izquierda (texto, con lo
// que leyó para responder) y pizarra a la derecha: cada diagrama llega por la
// tool draw_diagram con sus fuentes; clic en un nodo = "explícame esto".
// La conversación vive en el agente (disco local), no en el navegador.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
        meta={
          current
            ? `${current.repos.length} repo${current.repos.length === 1 ? "" : "s"} · ${current.meetings} actas · solo lectura`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {projects.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => !busy && setProject(p.slug)}
                aria-pressed={p.slug === project}
                className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
                  p.slug === project
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-line text-text-dim hover:border-line-2 hover:text-text"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
        {/* ── Conversación ─────────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col rounded-sm border border-line bg-panel">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            <select
              value={conv?.id ?? ""}
              onChange={(e) => (e.target.value ? void openConversation(e.target.value) : newConversation())}
              disabled={busy}
              className="min-w-0 flex-1 truncate rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text"
              aria-label="Conversación"
            >
              <option value="">Conversación nueva</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={newConversation}
              disabled={busy}
              className="shrink-0 rounded-sm border border-line px-2 py-1 text-xs text-text-dim hover:border-line-2 hover:text-text disabled:opacity-40"
            >
              Nueva
            </button>
            <button
              type="button"
              onClick={toggleVoice}
              aria-pressed={voiceMode}
              title="Le hablas y te responde en voz alta; al terminar vuelve a escucharte"
              className={`shrink-0 rounded-sm border px-2 py-1 text-xs transition-colors ${
                voiceMode
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-line text-text-dim hover:border-line-2 hover:text-text"
              }`}
            >
              {voiceMode ? "● Modo voz" : "Modo voz"}
            </button>
            {conv && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                title="Borrar esta conversación"
                className="shrink-0 rounded-sm border border-line px-2 py-1 text-xs text-text-dim hover:border-red/60 hover:text-red disabled:opacity-40"
              >
                Borrar
              </button>
            )}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {history.length === 0 && !pending ? (
              <div className="space-y-3">
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
                      className="rounded-sm border border-line p-2.5 text-left transition-colors hover:border-accent/60"
                    >
                      <span className="text-xs text-text-dim tabular-nums">{i + 1}</span>
                      <span className="block text-sm text-text">{s.title}</span>
                      <span className="block text-xs text-text-dim">{s.hint}</span>
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
                    <p className="text-xs text-text-dim">
                      {live.tools.at(-1)?.name}
                      {live.tools.at(-1)?.detail ? ` ${live.tools.at(-1)?.detail}` : ""}
                      <span className="pulse-dot"> …</span>
                      <span className="ml-1 text-text-faint">({live.tools.length} consultas)</span>
                    </p>
                  )}
                  {live?.text ? (
                    <div className="text-sm leading-relaxed text-text">
                      <Markdown source={live.text} />
                    </div>
                  ) : (
                    <p className="text-sm text-text-dim pulse-dot">Leyendo el proyecto…</p>
                  )}
                  {live && live.diagrams.length > 0 && (
                    <DiagramChips diagrams={live.diagrams} onDiagram={setActive} active={active} />
                  )}
                </div>
              </>
            )}
            {error && <p className="text-xs text-red">⚠ {error}</p>}
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

          <form
            className="flex shrink-0 items-end gap-2 border-t border-line p-2.5"
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
              className="min-h-[38px] flex-1 resize-none rounded-sm border border-line bg-transparent px-2.5 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
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
                aria-label="Dictar"
                className={`h-[38px] shrink-0 rounded-sm border px-2.5 text-xs ${
                  dictation.state === "listening"
                    ? "border-accent/60 text-accent pulse-dot"
                    : "border-line text-text-dim hover:border-line-2 hover:text-text"
                }`}
              >
                {dictation.state === "listening" ? "● Escuchando" : "🎙"}
              </button>
            )}
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="h-[38px] shrink-0 rounded-sm border border-red/60 px-3 text-xs text-red hover:bg-red/10"
              >
                ■ Detener
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                className="h-[38px] shrink-0 rounded-sm border border-accent/60 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/15 disabled:opacity-40"
              >
                Enviar
              </button>
            )}
          </form>
        </section>

        {/* ── Pizarra ──────────────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col rounded-sm border border-line bg-panel">
          {diagrams.length > 1 && (
            <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2">
              {diagrams.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setActive(d)}
                  className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs ${
                    active?.id === d.id
                      ? "border-accent/60 text-accent"
                      : "border-line text-text-dim hover:text-text"
                  }`}
                >
                  {i + 1}. {d.title}
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
      {diagrams.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onDiagram(d)}
          className={`rounded-sm border px-2 py-0.5 text-xs ${
            active?.id === d.id ? "border-accent/60 text-accent" : "border-line text-text-dim hover:text-text"
          }`}
        >
          ◫ {d.title}
        </button>
      ))}
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
      <div className="ml-8 rounded-sm bg-panel-2 px-3 py-2 text-sm leading-relaxed text-text">
        {m.text}
      </div>
    );
  return (
    <div className="space-y-2">
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
            className="text-xs text-text-dim hover:text-text"
          >
            {showTools ? "▾" : "▸"} Leyó {m.tools.length} fuente{m.tools.length === 1 ? "" : "s"}
          </button>
          {showTools && (
            <ul className="mt-1 space-y-0.5">
              {m.tools.map((t, i) => (
                <li key={i} className="truncate font-mono text-xs text-text-dim">
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
  return (
    <div className="shrink-0 border-t border-line bg-accent/5 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${listening || speaking ? "text-accent pulse-dot" : "text-text-dim"}`}>
          ● {label}
        </span>
        <span className="flex gap-1.5">
          {(speaking || thinking) && (
            <button
              type="button"
              onClick={onInterrupt}
              className="rounded-sm border border-accent/60 px-2 py-0.5 text-xs text-accent hover:bg-accent/10"
            >
              Interrumpir
            </button>
          )}
          {listening ? (
            <button
              type="button"
              onClick={onStopListening}
              className="rounded-sm border border-line px-2 py-0.5 text-xs text-text-dim hover:text-text"
            >
              Enviar ya
            </button>
          ) : (
            !speaking &&
            !thinking &&
            !transcribing && (
              <button
                type="button"
                onClick={onListen}
                className="rounded-sm border border-line px-2 py-0.5 text-xs text-text-dim hover:text-text"
              >
                Hablar
              </button>
            )
          )}
        </span>
      </div>
      {listening && heard && <p className="mt-1 text-sm text-text">«{heard}»</p>}
      {error && <p className="mt-1 text-xs text-amber">{error}</p>}
    </div>
  );
}
