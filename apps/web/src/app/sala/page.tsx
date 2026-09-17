"use client";

// SALA DE AGENTES 3D — página suelta a pantalla completa (fuera del shell,
// hermana de /dev/terminator): agentes de pie en arco, cada uno dueño de un
// proyecto REAL del vault, y tu cuerpo por webcam (MediaPipe Pose) como
// marioneta de espaldas al frente de la sala. Levantar la mano izquierda o la
// derecha ENFOCA a ese agente: se conecta si hace falta y el micrófono le
// habla a él; los demás siguen en la llamada con el mic en silencio (bajar la
// mano no cuelga a nadie). Con TERTULIA activa, los agentes se escuchan entre
// sí y por cada turno tuyo el compañero comenta. Los personajes salen de
// ~/.hermes-os/sala.json vía GET /sala/agents. Plan: docs/sala-de-agentes-3d.md.

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
} from "@hermes/shared";
import { hermesFetch } from "@/lib/hermes";
import { OWNER } from "@/lib/owner";
import { useTheme } from "@/state/ThemeProvider";
import { usePose, type PoseSample } from "@/hooks/usePose";
import { AVATAR_ORIGIN } from "@/lib/sala/world";
import { SalaCalls, type SalaCallEvent, type SalaCallStatus } from "@/lib/sala/calls";
import { salaClientTools } from "@/lib/sala/client-tools";
import { SalaScene, type SalaSceneHandle } from "@/components/sala/SalaScene";
import { SalaVoice } from "@/components/sala/SalaVoice";

declare global {
  interface Window {
    /** QA: estado de la marioneta, el mundo y las llamadas (Playwright). */
    __hermesSalaDebug?: () => unknown;
    /** QA: texto del humano al agente enfocado, sin micrófono. */
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
  | { kind: "ready"; agents: SalaAgentPublic[]; topic: string | null };

interface AgentLive {
  status: SalaCallStatus;
  speaking: boolean;
  last: string;
  error: string | null;
}

const LIVE0: AgentLive = { status: "idle", speaking: false, last: "", error: null };

/** Token por clave: hermes/tutor reusados o `agent:<clave>`; misma ruta Next que el shell. */
async function fetchToken(agent: SalaAgentPublic) {
  const which = agent.reuse === "hermes" ? "" : agent.reuse === "tutor" ? "tutor" : agent.key;
  const res = await fetch(which ? `/api/elevenlabs/token?agent=${encodeURIComponent(which)}` : "/api/elevenlabs/token");
  return (await res.json()) as { conversationToken?: string; signedUrl?: string; error?: string };
}

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
        const r = (await res.json()) as { agents?: SalaAgentPublic[]; topic?: string | null; path: string; error?: string };
        if (!res.ok || r.error) return setLoad({ kind: "invalid", error: r.error ?? `HTTP ${res.status}`, path: r.path });
        if (!r.agents?.length) return setLoad({ kind: "empty", path: r.path });
        setLoad({ kind: "ready", agents: r.agents, topic: r.topic ?? null });
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
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // ── Llamadas (una sesión por agente, todas vivas) ──────────────────────
  const callsRef = useRef<SalaCalls | null>(null);
  const [live, setLive] = useState<Record<string, AgentLive>>({});
  const [tertulia, setTertulia] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // Bitácora de eventos de las llamadas (QA: window.__hermesSalaDebug().log).
  const logRef = useRef<{ t: number; ev: SalaCallEvent }[]>([]);

  useEffect(() => {
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
      if (ev.kind === "status") setFocusKey(callsRef.current?.focusedKey() ?? null);
    };
    const calls = new SalaCalls({ fetchToken, clientTools: salaClientTools(), owner: OWNER || "el usuario", onEvent });
    callsRef.current = calls;
    window.__hermesSalaSay = (text) => calls.say(text);
    return () => {
      delete window.__hermesSalaSay;
      calls.dispose();
      callsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (callsRef.current) callsRef.current.topic = topic;
  }, [topic]);
  useEffect(() => {
    if (callsRef.current) callsRef.current.tertulia = tertulia;
  }, [tertulia]);

  /** Enfoca a un agente: lo conecta si hace falta y le da el micrófono. */
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

  /** Tertulia: conecta a TODOS los que tienen voz y enciende el relevo de turnos. */
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
    setTertulia(false);
    setFocusKey(null);
    setLive({});
  }, []);

  // ── Marioneta + mano levantada ─────────────────────────────────────────
  const smootherRef = useRef(new PuppetSmoother());
  // Sin release por bajar la mano: la selección solo cambia al levantar la
  // otra mano (o con Esc / Colgar). Infinity = nunca suelta por tiempo.
  const machineRef = useRef(new PointingMachine(undefined, Number.POSITIVE_INFINITY));
  const [aimingKey, setAimingKey] = useState<string | null>(null);
  const aimingRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);

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
        void focusAgent(st.event.key);
      }
    },
    [focusAgent],
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
        focused: calls?.focusedKey() ?? null,
        calls: calls
          ? Object.fromEntries(calls.keys().map((k) => [k, { status: calls.status(k), speaking: calls.speaking(k) }]))
          : null,
        tertulia: calls?.tertulia ?? false,
        figures: world?.figures.map((f) => ({ key: f.key, center: f.hitSphere.center.toArray() })) ?? null,
        renderFrame: world?.renderer.info.render.frame ?? null,
        headScreen,
        bodyInFrame: bodyRef.current,
        log: logRef.current.slice(-40),
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

  const ready = agents.filter((a) => a.ready).length;
  const connectedCount = agents.filter((a) => live[a.key]?.status === "connected").length;
  const anyConnecting = agents.some((a) => live[a.key]?.status === "connecting");

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

  const statusLabel = (a: SalaAgentPublic): string => {
    const l = live[a.key] ?? LIVE0;
    if (l.error) return l.error;
    if (l.status === "connecting") return "conectando…";
    if (l.status === "connected") return l.speaking ? "hablando" : focusKey === a.key ? "te escucha" : "en la llamada";
    return a.ready ? "" : "sin voz";
  };

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-text">
      {load.kind === "ready" && (
        <>
          <SalaScene
            key={theme.resolved}
            ref={sceneRef}
            agents={agents}
            selectedKey={focusKey}
            aimingKey={aimingKey}
          />
          <SalaVoice calls={() => callsRef.current} figures={() => sceneRef.current?.world()?.figures ?? []} />
        </>
      )}

      {/* HUD: contexto arriba a la izquierda, sin tarjeta (lo que se lee va sin marco). */}
      <header className="pointer-events-none absolute top-5 left-6 z-20 max-w-[560px]">
        <h1 className="text-lg font-medium">Sala de agentes</h1>
        <p className="mt-0.5 text-sm text-text-dim">
          {load.kind === "ready"
            ? `${agents.length} agentes · ${ready} con voz${connectedCount ? ` · ${connectedCount} en la llamada` : ""}`
            : load.kind === "loading"
              ? "Cargando…"
              : "Sin agentes"}
        </p>
        {load.kind === "ready" && (
          <p className="mt-3 text-sm text-text-dim">
            {focusKey ? (
              <>
                Hablando con{" "}
                <span className="font-medium text-text">{agents.find((a) => a.key === focusKey)?.name ?? focusKey}</span>
                <span className="text-text-faint">
                  {" · "}
                  {anyConnecting
                    ? "conectando…"
                    : tertulia
                      ? "tertulia a tres · levanta la otra mano para cambiar · Esc cuelga"
                      : "levanta la otra mano para cambiar · Esc cuelga"}
                </span>
              </>
            ) : aimingKey ? (
              <>
                Levantando la mano hacia{" "}
                <span className="font-medium text-text">{agents.find((a) => a.key === aimingKey)?.name ?? aimingKey}</span>
              </>
            ) : bodyInFrame ? (
              "Levanta la mano izquierda o la derecha para hablar con ese agente"
            ) : null}
          </p>
        )}
        {load.kind === "ready" && topic && <p className="mt-1 text-xs text-text-faint">Tema: {topic}</p>}
      </header>

      {/* Controles: tertulia y colgar (arriba a la derecha). */}
      {load.kind === "ready" && (
        <nav className="absolute top-5 right-6 z-20 flex items-center gap-2">
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
          {(connectedCount > 0 || anyConnecting) && (
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

      {/* Estado por agente: quién está en la llamada, quién habla, su última frase. */}
      {load.kind === "ready" && (
        <section className="pointer-events-none absolute bottom-5 left-6 z-20 flex max-w-[60vw] flex-col gap-1.5">
          {agents.map((a) => {
            const l = live[a.key] ?? LIVE0;
            const label = statusLabel(a);
            if (!label && !l.last) return null;
            return (
              <div key={a.key} className="flex items-start gap-2 text-xs">
                <span
                  aria-hidden
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${l.speaking ? "animate-pulse" : ""}`}
                  style={{ backgroundColor: l.status === "connected" ? a.color : "var(--color-text-faint)" }}
                />
                <div className="min-w-0">
                  <span className="font-medium text-text">{a.name}</span>
                  {label && <span className={l.error ? "text-red" : "text-text-dim"}> · {label}</span>}
                  {l.last && <div className="truncate text-text-faint">«{l.last}»</div>}
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
