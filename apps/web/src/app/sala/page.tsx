"use client";

// SALA DE AGENTES 3D — página suelta a pantalla completa (fuera del shell,
// hermana de /dev/terminator): agentes de pie en arco, cada uno dueño de un
// proyecto REAL del vault, y tu cuerpo por webcam (MediaPipe Pose) como
// marioneta de espaldas al frente de la sala.
//
// Dos modos de voz, según sala.json:
//  - ELENCO (`cast`, el del demo): UNA sesión con un agente multi-voz que
//    interpreta a todos los personajes. Hablas libre, los nombras y responde
//    ese; si preguntas a todos, responden en secuencia sin pisarse (un solo
//    flujo de audio). La sala se conecta sola cuando la cámara te ve.
//    Levantar la mano hacia uno es opcional: solo le avisa a quién miras.
//  - SESIONES (sin cast): una sesión por agente; levantar la mano enfoca el
//    micrófono; "Tertulia" hace que se comenten entre sí por relevo.
// Plan y decisiones: docs/sala-de-agentes-3d.md.

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  emptyPuppetFrame,
  PointingMachine,
  puppetFrame,
  PuppetSmoother,
  raisedHandTarget,
  type PointTarget,
  type SalaAgentPublic,
  type SalaCastPublic,
} from "@hermes/shared";
import { hermesFetch } from "@/lib/hermes";
import { OWNER } from "@/lib/owner";
import { useTheme } from "@/state/ThemeProvider";
import { usePose, type PoseSample } from "@/hooks/usePose";
import { AVATAR_ORIGIN } from "@/lib/sala/world";
import { SalaCalls, type SalaCallEvent, type SalaCallStatus } from "@/lib/sala/calls";
import { CastCall, type CastEvent } from "@/lib/sala/cast";
import { salaClientTools } from "@/lib/sala/client-tools";
import { SalaScene, type SalaSceneHandle } from "@/components/sala/SalaScene";
import { SalaVoice } from "@/components/sala/SalaVoice";

declare global {
  interface Window {
    /** QA: estado de la marioneta, el mundo y las llamadas (Playwright). */
    __hermesSalaDebug?: () => unknown;
    /** QA: texto del humano a la sala (elenco) o al agente enfocado (sesiones), sin micrófono. */
    __hermesSalaSay?: (text: string) => boolean;
  }
}

const NO_AGENTS: SalaAgentPublic[] = [];

type Load =
  | { kind: "loading" }
  | { kind: "offline"; error: string }
  | { kind: "off" }
  | { kind: "invalid"; error: string; path: string }
  | { kind: "empty"; path: string }
  | { kind: "ready"; agents: SalaAgentPublic[]; topic: string | null; cast: SalaCastPublic | null };

interface AgentLive {
  status: SalaCallStatus;
  speaking: boolean;
  last: string;
  error: string | null;
}
const LIVE0: AgentLive = { status: "idle", speaking: false, last: "", error: null };

interface Line {
  /** Clave del personaje, o null = el humano. */
  key: string | null;
  text: string;
}

/** Token por clave: hermes/tutor reusados, `cast` (elenco) o `agent:<clave>`; misma ruta Next que el shell. */
async function fetchTokenFor(which: string) {
  const res = await fetch(which ? `/api/elevenlabs/token?agent=${encodeURIComponent(which)}` : "/api/elevenlabs/token");
  return (await res.json()) as { conversationToken?: string; signedUrl?: string; error?: string };
}
const fetchToken = (agent: SalaAgentPublic) =>
  fetchTokenFor(agent.reuse === "hermes" ? "" : agent.reuse === "tutor" ? "tutor" : agent.key);

export default function SalaPage() {
  const theme = useTheme();
  const sceneRef = useRef<SalaSceneHandle>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [bodyInFrame, setBodyInFrame] = useState(false);
  const bodyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    hermesFetch("/sala/agents")
      .then(async (res) => {
        if (!alive) return;
        // 404 = HERMES_SALA=off en el agente · 500 = sala.json no valida · 200 = lista.
        if (res.status === 404) return setLoad({ kind: "off" });
        const r = (await res.json()) as {
          agents?: SalaAgentPublic[];
          topic?: string | null;
          cast?: SalaCastPublic | null;
          path: string;
          error?: string;
        };
        if (!res.ok || r.error) return setLoad({ kind: "invalid", error: r.error ?? `HTTP ${res.status}`, path: r.path });
        if (!r.agents?.length) return setLoad({ kind: "empty", path: r.path });
        setLoad({ kind: "ready", agents: r.agents, topic: r.topic ?? null, cast: r.cast?.ready ? r.cast : null });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ kind: "offline", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const agents = load.kind === "ready" ? load.agents : NO_AGENTS;
  const topic = load.kind === "ready" ? load.topic : null;
  const cast = load.kind === "ready" ? load.cast : null;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const nameOf = (key: string | null) => (key ? agents.find((a) => a.key === key)?.name ?? key : OWNER || "Tú");

  // Bitácora + transcript corto para el HUD y el QA.
  const logRef = useRef<{ t: number; ev: SalaCallEvent | CastEvent }[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const pushLine = useCallback((l: Line) => setLines((prev) => [...prev.slice(-7), l]), []);

  // ── Modo ELENCO ────────────────────────────────────────────────────────
  const castRef = useRef<CastCall | null>(null);
  const [castLive, setCastLive] = useState<{ status: SalaCallStatus; speaking: boolean; error: string | null }>({
    status: "idle",
    speaking: false,
    error: null,
  });

  useEffect(() => {
    if (!cast) return;
    const onEvent = (ev: CastEvent) => {
      logRef.current.push({ t: Math.round(performance.now()), ev });
      if (logRef.current.length > 200) logRef.current.shift();
      if (ev.kind === "status") setCastLive((s) => ({ ...s, status: ev.status ?? s.status, error: ev.status === "error" ? s.error : null }));
      else if (ev.kind === "mode") setCastLive((s) => ({ ...s, speaking: ev.mode === "speaking" }));
      else if (ev.kind === "line") pushLine({ key: ev.key ?? null, text: ev.text ?? "" });
      else setCastLive((s) => ({ ...s, error: ev.text ?? "error" }));
    };
    const call = new CastCall({
      fetchToken: () => fetchTokenFor("cast"),
      clientTools: salaClientTools(),
      labels: cast.labels,
      defaultKey: cast.default,
      owner: OWNER || "el usuario",
      onEvent,
    });
    castRef.current = call;
    window.__hermesSalaSay = (text) => call.say(text);
    return () => {
      delete window.__hermesSalaSay;
      void call.hangup();
      castRef.current = null;
    };
  }, [cast, pushLine]);

  const castFraming = useCallback(() => {
    const members = (cast?.members ?? []).map((k) => agentsRef.current.find((a) => a.key === k)).filter(Boolean) as SalaAgentPublic[];
    return [
      `${OWNER || "El usuario"} está en la Sala de Agentes 3D frente a ${members.map((m) => m.name).join(" y ")}. Le habla a la sala con la voz; cuando nombra a uno, responde ese.`,
      topic ? `Tema de hoy: ${topic}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [cast, topic]);

  const connectCast = useCallback(() => {
    const call = castRef.current;
    if (!call || call.isConnected() || call.getStatus() === "connecting") return;
    void call.connect(castFraming());
  }, [castFraming]);

  const hangupCast = useCallback(() => {
    void castRef.current?.hangup();
    setLines([]);
  }, []);

  // La sala se enciende sola la primera vez que la cámara te ve.
  const autoRef = useRef(false);
  useEffect(() => {
    if (!cast || !bodyInFrame || autoRef.current) return;
    autoRef.current = true;
    connectCast();
  }, [cast, bodyInFrame, connectCast]);

  // ── Modo SESIONES (sin elenco) ─────────────────────────────────────────
  const callsRef = useRef<SalaCalls | null>(null);
  const [live, setLive] = useState<Record<string, AgentLive>>({});
  const [tertulia, setTertulia] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (cast || load.kind !== "ready") return;
    const onEvent = (ev: SalaCallEvent) => {
      logRef.current.push({ t: Math.round(performance.now()), ev });
      if (logRef.current.length > 200) logRef.current.shift();
      setLive((prev) => {
        const cur = prev[ev.key] ?? LIVE0;
        const next: AgentLive =
          ev.kind === "status"
            ? { ...cur, status: ev.status ?? cur.status, error: ev.status === "error" ? cur.error : null }
            : ev.kind === "mode"
              ? { ...cur, speaking: ev.mode === "speaking" }
              : ev.kind === "message"
                ? ev.role === "agent"
                  ? { ...cur, last: ev.text ?? "" }
                  : cur
                : { ...cur, error: ev.text ?? "error" };
        return { ...prev, [ev.key]: next };
      });
      if (ev.kind === "message") pushLine({ key: ev.role === "agent" ? ev.key : null, text: ev.text ?? "" });
      if (ev.kind === "status") setFocusKey(callsRef.current?.focusedKey() ?? null);
    };
    const calls = new SalaCalls({ fetchToken, clientTools: salaClientTools(), owner: OWNER || "el usuario", onEvent });
    calls.topic = topic;
    callsRef.current = calls;
    window.__hermesSalaSay = (text) => calls.say(text);
    return () => {
      delete window.__hermesSalaSay;
      calls.dispose();
      callsRef.current = null;
    };
  }, [cast, load.kind, topic, pushLine]);

  useEffect(() => {
    if (callsRef.current) callsRef.current.tertulia = tertulia;
  }, [tertulia]);

  const focusAgent = useCallback(async (key: string) => {
    const calls = callsRef.current;
    const agent = agentsRef.current.find((a) => a.key === key);
    if (!calls || !agent) return;
    if (!agent.ready) {
      setLive((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? LIVE0), error: `${agent.name} aún no tiene voz (pnpm setup:elevenlabs --sala)` },
      }));
      return;
    }
    if (!calls.isConnected(key)) await calls.connect(agent);
    calls.focus(key);
    setFocusKey(calls.focusedKey());
  }, []);

  const startTertulia = useCallback(async () => {
    const calls = callsRef.current;
    if (!calls) return;
    setTertulia(true);
    calls.tertulia = true;
    await calls.connectAll(agentsRef.current.filter((a) => a.ready));
    setFocusKey(calls.focusedKey());
  }, []);

  const hangupAll = useCallback(() => {
    void callsRef.current?.hangupAll();
    hangupCast();
    setTertulia(false);
    setFocusKey(null);
    setLive({});
    setLines([]);
  }, [hangupCast]);

  // ── Marioneta + mano levantada ─────────────────────────────────────────
  const smootherRef = useRef(new PuppetSmoother());
  // Sin release por bajar la mano: la selección solo cambia al levantar la
  // otra mano (o con Esc / Colgar). Infinity = nunca suelta por tiempo.
  const machineRef = useRef(new PointingMachine(undefined, Number.POSITIVE_INFINITY));
  const [aimingKey, setAimingKey] = useState<string | null>(null);
  const [handKey, setHandKey] = useState<string | null>(null);
  const aimingRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  const onHandSelect = useCallback(
    (key: string) => {
      if (cast) {
        // En el elenco la mano no cambia de micrófono: solo le dice a la sala a quién miras.
        setHandKey(key);
        castRef.current?.context(`${OWNER || "El usuario"} levanta la mano hacia ${nameOf(key)}: le está hablando a ${nameOf(key)}.`);
        return;
      }
      void focusAgent(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cast, focusAgent, agents],
  );

  const applyPointing = useCallback(
    (target: string | null, handUp: boolean, tMs: number) => {
      const world = sceneRef.current?.world();
      const st = machineRef.current.update(target, handUp, tMs);
      if (world) {
        for (const f of world.figures) {
          if (f.key === st.selected) f.setProgress(1);
          else f.setProgress(f.key === st.aiming ? st.progress : 0);
        }
      }
      if (st.aiming !== aimingRef.current) {
        aimingRef.current = st.aiming;
        setAimingKey(st.aiming);
      }
      if (st.event?.kind === "select" && st.event.key !== selectedRef.current) {
        selectedRef.current = st.event.key;
        onHandSelect(st.event.key);
      }
    },
    [onHandSelect],
  );

  const onSample = useCallback(
    (s: PoseSample) => {
      const inFrame = s.world !== null;
      if (inFrame !== bodyRef.current) {
        bodyRef.current = inFrame;
        setBodyInFrame(inFrame);
      }
      const scene = sceneRef.current;
      const puppet = scene?.puppet();
      const world = scene?.world();
      if (!puppet || !world) return;
      if (!s.world) {
        smootherRef.current.reset();
        puppet.update(emptyPuppetFrame());
        applyPointing(null, false, s.tMs);
        return;
      }
      const frame = smootherRef.current.update(puppetFrame(s.world, { origin: AVATAR_ORIGIN }), s.tMs);
      puppet.update(frame);
      const targets: PointTarget[] = world.figures.map((f) => ({
        key: f.key,
        center: f.hitSphere.center,
        radius: f.hitSphere.radius,
      }));
      const hand = raisedHandTarget(frame, targets);
      applyPointing(hand.target, hand.handUp, s.tMs);
    },
    [applyPointing],
  );

  const pose = usePose(onSample);

  // Esc = colgar todo y soltar la selección.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      machineRef.current.reset();
      selectedRef.current = null;
      aimingRef.current = null;
      setAimingKey(null);
      setHandKey(null);
      sceneRef.current?.world()?.figures.forEach((f) => f.setProgress(0));
      hangupAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hangupAll]);

  // Seam de QA.
  useEffect(() => {
    window.__hermesSalaDebug = () => {
      const world = sceneRef.current?.world();
      const puppet = sceneRef.current?.puppet() ?? null;
      const calls = callsRef.current;
      const c = castRef.current;
      let headScreen: { x: number; y: number } | null = null;
      if (world && puppet) {
        const h = puppet.debug().head;
        if (h) {
          const v = new THREE.Vector3(h.x, h.y, h.z).project(world.camera);
          headScreen = { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
        }
      }
      return {
        puppet: puppet?.debug() ?? null,
        world: Boolean(world),
        aiming: aimingRef.current,
        selected: selectedRef.current,
        mode: c ? "cast" : "sessions",
        cast: c ? { status: c.getStatus(), speaking: c.isSpeaking(), speakingKey: c.speakingKey(), ...c.debug() } : null,
        focused: calls?.focusedKey() ?? null,
        calls: calls
          ? Object.fromEntries(calls.keys().map((k) => [k, { status: calls.status(k), speaking: calls.speaking(k) }]))
          : null,
        tertulia: calls?.tertulia ?? false,
        figures: world?.figures.map((f) => ({ key: f.key, center: f.hitSphere.center.toArray() })) ?? null,
        renderFrame: world?.renderer.info.render.frame ?? null,
        headScreen,
        bodyInFrame: bodyRef.current,
        log: logRef.current.slice(-60),
      };
    };
    return () => {
      delete window.__hermesSalaDebug;
    };
  }, []);

  // Cámara: arranca sola al tener la sala (el demo no debe pedir un clic).
  const startedRef = useRef(false);
  useEffect(() => {
    if (load.kind !== "ready" || startedRef.current) return;
    startedRef.current = true;
    void pose.start();
  }, [load.kind, pose]);

  // Preview chico y espejado del video (el <video> lo crea el hook).
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = previewRef.current;
    const v = pose.video;
    if (!box || !v) return;
    v.className = "h-full w-full -scale-x-100 object-cover";
    box.replaceChildren(v);
    return () => {
      if (v.parentElement === box) box.removeChild(v);
    };
  }, [pose.video]);

  // ── Derivados para el HUD ──────────────────────────────────────────────
  const ready = agents.filter((a) => a.ready).length;
  const connectedCount = cast
    ? castLive.status === "connected"
      ? agents.filter((a) => cast.members.includes(a.key)).length
      : 0
    : agents.filter((a) => live[a.key]?.status === "connected").length;
  const anyConnecting = cast ? castLive.status === "connecting" : agents.some((a) => live[a.key]?.status === "connecting");
  const inCall = connectedCount > 0 || anyConnecting;

  const cameraLabel =
    pose.phase === "tracking"
      ? bodyInFrame
        ? "Te veo"
        : "Entra al cuadro"
      : pose.phase === "starting"
        ? "Abriendo cámara…"
        : pose.phase === "error"
          ? pose.error ?? "Cámara sin acceso"
          : "Cámara apagada";

  const headline = (): React.ReactNode => {
    if (cast) {
      if (castLive.error) return <span className="text-red">{castLive.error}</span>;
      if (castLive.status === "connecting") return "Conectando la sala…";
      if (castLive.status === "connected") {
        return (
          <>
            En la sala con{" "}
            <span className="font-medium text-text">{cast.members.map((k) => nameOf(k)).join(" e ")}</span>
            <span className="text-text-faint"> · habla libre, nómbralos para dirigirte a uno · Esc cuelga</span>
          </>
        );
      }
      return bodyInFrame ? "Entrando a la sala…" : "Entra al cuadro y la sala se enciende";
    }
    if (focusKey) {
      return (
        <>
          Hablando con <span className="font-medium text-text">{nameOf(focusKey)}</span>
          <span className="text-text-faint">
            {" · "}
            {anyConnecting ? "conectando…" : tertulia ? "tertulia · levanta la otra mano para cambiar · Esc cuelga" : "levanta la otra mano para cambiar · Esc cuelga"}
          </span>
        </>
      );
    }
    if (aimingKey) {
      return (
        <>
          Levantando la mano hacia <span className="font-medium text-text">{nameOf(aimingKey)}</span>
        </>
      );
    }
    return bodyInFrame ? "Levanta la mano izquierda o la derecha para hablar con ese agente" : null;
  };

  const pulseOf = useCallback(
    (key: string) => {
      const c = castRef.current;
      if (c) return { speaking: c.speakingKey() === key, volume: c.volume() };
      const calls = callsRef.current;
      return { speaking: Boolean(calls?.speaking(key)), volume: calls?.volume(key) ?? 0 };
    },
    [],
  );

  const highlightKey = cast ? (castLive.speaking ? castRef.current?.speakingKey() ?? null : handKey) : focusKey;

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-text">
      {load.kind === "ready" && (
        <>
          <SalaScene
            key={theme.resolved}
            ref={sceneRef}
            agents={agents}
            selectedKey={highlightKey}
            aimingKey={aimingKey}
          />
          <SalaVoice pulseOf={pulseOf} figures={() => sceneRef.current?.world()?.figures ?? []} />
        </>
      )}

      {/* HUD: contexto arriba a la izquierda, sin tarjeta (lo que se lee va sin marco). */}
      <header className="pointer-events-none absolute top-5 left-6 z-20 max-w-[620px]">
        <h1 className="text-lg font-medium">Sala de agentes</h1>
        <p className="mt-0.5 text-sm text-text-dim">
          {load.kind === "ready"
            ? `${agents.length} agentes · ${ready} con voz${connectedCount ? ` · ${connectedCount} en la llamada` : ""}${cast ? " · elenco" : ""}`
            : load.kind === "loading"
              ? "Cargando…"
              : "Sin agentes"}
        </p>
        {load.kind === "ready" && <p className="mt-3 text-sm text-text-dim">{headline()}</p>}
        {load.kind === "ready" && topic && <p className="mt-1 text-xs text-text-faint">Tema: {topic}</p>}
      </header>

      {/* Controles (arriba a la derecha). */}
      {load.kind === "ready" && (
        <nav className="absolute top-5 right-6 z-20 flex items-center gap-2">
          {cast ? (
            !inCall && (
              <button
                type="button"
                onClick={connectCast}
                className="cursor-pointer rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs text-accent"
              >
                Entrar a la sala
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => (tertulia ? setTertulia(false) : void startTertulia())}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
                tertulia ? "border-accent bg-accent/10 text-accent" : "border-line bg-panel/80 text-text-dim hover:text-text"
              }`}
              title="Conecta a todos los agentes con voz y hace que se comenten entre sí"
            >
              {tertulia ? "● Tertulia" : "Tertulia"}
            </button>
          )}
          {inCall && (
            <button
              type="button"
              onClick={hangupAll}
              className="cursor-pointer rounded-full border border-line bg-panel/80 px-3 py-1 text-xs text-text-dim hover:text-text"
            >
              Colgar
            </button>
          )}
        </nav>
      )}

      {/* Transcript corto: quién dijo qué (últimas líneas). */}
      {load.kind === "ready" && lines.length > 0 && (
        <section className="pointer-events-none absolute bottom-5 left-6 z-20 flex max-w-[58vw] flex-col gap-1 text-xs">
          {lines.map((l, i) => {
            const a = l.key ? agents.find((x) => x.key === l.key) : null;
            return (
              <div key={i} className={`flex items-start gap-2 ${i === lines.length - 1 ? "" : "opacity-70"}`}>
                <span
                  aria-hidden
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: a?.color ?? "var(--color-text-faint)" }}
                />
                <div className="min-w-0">
                  <span className="font-medium text-text">{a?.name ?? (OWNER || "Tú")}</span>
                  <span className="text-text-dim"> · {l.text}</span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Cámara: estado + preview espejado (abajo a la derecha, chico). */}
      {load.kind === "ready" && (
        <aside className="absolute right-5 bottom-5 z-20 flex flex-col items-end gap-2">
          <div
            ref={previewRef}
            className={`h-[120px] w-[160px] overflow-hidden rounded-md border border-line bg-panel ${pose.video ? "" : "hidden"}`}
          />
          <div className="flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 text-xs">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                pose.phase === "tracking" && bodyInFrame ? "bg-green" : pose.phase === "error" ? "bg-red" : "bg-text-faint"
              }`}
            />
            <span className="text-text-dim">{cameraLabel}</span>
            {pose.phase === "error" && (
              <button type="button" onClick={() => void pose.start()} className="cursor-pointer text-accent hover:underline">
                reintentar
              </button>
            )}
          </div>
        </aside>
      )}

      {load.kind !== "ready" && load.kind !== "loading" && (
        <section className="absolute inset-0 z-20 grid place-items-center px-6">
          <div className="max-w-[520px] text-center">
            <p className="text-base font-medium">
              {load.kind === "offline"
                ? "El agente no responde"
                : load.kind === "off"
                  ? "La sala está apagada"
                  : load.kind === "invalid"
                    ? "sala.json no pasa la validación"
                    : "La sala está vacía"}
            </p>
            <p className="mt-2 text-sm text-text-dim">
              {load.kind === "offline"
                ? load.error
                : load.kind === "off"
                  ? "El agente corre con HERMES_SALA=off. Quita esa variable del .env y reinícialo."
                  : load.kind === "invalid"
                    ? load.error
                    : `Crea ${load.path} con tus agentes (plantilla en docs/sala.example.json) y recarga.`}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
