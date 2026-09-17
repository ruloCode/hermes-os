"use client";

// SALA DE AGENTES 3D — página suelta a pantalla completa (fuera del shell,
// hermana de /dev/terminator): cinco agentes de pie, cada uno dueño de un
// proyecto REAL del vault, con su color, su nombre y su estado; y tu cuerpo,
// capturado por la webcam con MediaPipe Pose, como marioneta de espaldas al
// frente de la sala. Los personajes salen de ~/.hermes-os/sala.json vía
// GET /sala/agents; nada aquí está escrito a mano. Plan y decisiones:
// docs/sala-de-agentes-3d.md.

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  emptyPuppetFrame,
  pickTarget,
  pointingRay,
  PointingMachine,
  puppetFrame,
  PuppetSmoother,
  type PointTarget,
  type SalaAgentPublic,
} from "@hermes/shared";
import { hermesFetch } from "@/lib/hermes";
import { useTheme } from "@/state/ThemeProvider";
import { usePose, type PoseSample } from "@/hooks/usePose";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useVoice, type VoiceMode } from "@/components/VoiceBusyContext";
import { AVATAR_ORIGIN } from "@/lib/sala/world";
import { SalaScene, type SalaSceneHandle } from "@/components/sala/SalaScene";
import { SalaVoice } from "@/components/sala/SalaVoice";

/** Modo de voz de un personaje: reusa Hermes/tutor o su agente propio. */
function voiceModeFor(agent: SalaAgentPublic): VoiceMode {
  if (agent.reuse === "hermes") return "hermes";
  if (agent.reuse === "tutor") return "tutor";
  return `agent:${agent.key}`;
}

declare global {
  interface Window {
    /** QA: estado de la marioneta y del mundo (Playwright). */
    __hermesSalaDebug?: () => unknown;
  }
}

const NO_AGENTS: SalaAgentPublic[] = [];

type Load =
  | { kind: "loading" }
  | { kind: "offline"; error: string }
  | { kind: "off" }
  | { kind: "invalid"; error: string; path: string }
  | { kind: "empty"; path: string }
  | { kind: "ready"; agents: SalaAgentPublic[] };

export default function SalaPage() {
  const theme = useTheme();
  const sceneRef = useRef<SalaSceneHandle>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // ¿Hay alguien en cuadro? Estado solo cuando CAMBIA (el callback corre a 30 fps).
  const [bodyInFrame, setBodyInFrame] = useState(false);
  const bodyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    hermesFetch("/sala/agents")
      .then(async (res) => {
        if (!alive) return;
        // 404 = HERMES_SALA=off en el agente · 500 = sala.json no valida (el
        // cuerpo trae el motivo exacto) · 200 = lista (vacía si no hay archivo).
        if (res.status === 404) return setLoad({ kind: "off" });
        const r = (await res.json()) as { agents?: SalaAgentPublic[]; path: string; error?: string };
        if (!res.ok || r.error) return setLoad({ kind: "invalid", error: r.error ?? `HTTP ${res.status}`, path: r.path });
        if (!r.agents?.length) return setLoad({ kind: "empty", path: r.path });
        setLoad({ kind: "ready", agents: r.agents });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ kind: "offline", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  // ── Marioneta + señalar ──────────────────────────────────────────────
  // La malla es de la escena (vive con el canvas); aquí solo se le mandan
  // frames: cuerpo crudo → escena (puro) → One Euro → malla → rayo → dwell.
  const smootherRef = useRef(new PuppetSmoother());
  const machineRef = useRef(new PointingMachine());
  // Selección/apuntado como estado de React SOLO cuando cambian (para las
  // tarjetas y, en la fase 4, la voz); el progreso del anillo va directo a la figura.
  const [aimingKey, setAimingKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const aimingRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  const applyPointing = useCallback((target: string | null, armUp: boolean, tMs: number) => {
    const world = sceneRef.current?.world();
    const st = machineRef.current.update(target, armUp, tMs);
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
    if (st.selected !== selectedRef.current) {
      selectedRef.current = st.selected;
      setSelectedKey(st.selected);
    }
  }, []);

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
        puppet.setRay(null);
        applyPointing(null, false, s.tMs);
        return;
      }
      const frame = smootherRef.current.update(puppetFrame(s.world, { origin: AVATAR_ORIGIN }), s.tMs);
      puppet.update(frame);
      const ray = pointingRay(frame);
      puppet.setRay(ray);
      const targets: PointTarget[] = world.figures.map((f) => ({
        key: f.key,
        center: f.hitSphere.center,
        radius: f.hitSphere.radius,
      }));
      applyPointing(pickTarget(ray, targets), ray !== null, s.tMs);
    },
    [applyPointing],
  );

  // Esc suelta la selección (y en la fase 4, corta la llamada).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const st = machineRef.current.release(performance.now());
      sceneRef.current?.world()?.figures.forEach((f) => f.setProgress(0));
      if (aimingRef.current !== null) {
        aimingRef.current = null;
        setAimingKey(null);
      }
      if (st.selected !== selectedRef.current) {
        selectedRef.current = st.selected;
        setSelectedKey(st.selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pose = usePose(onSample);

  // Seam de QA: estado de la marioneta sin abrir el inspector.
  useEffect(() => {
    window.__hermesSalaDebug = () => {
      const world = sceneRef.current?.world();
      const puppet = sceneRef.current?.puppet() ?? null;
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
        figures: world?.figures.map((f) => ({ key: f.key, center: f.hitSphere.center.toArray() })) ?? null,
        stageInScene: world ? world.scene.children.includes(world.stage) : null,
        stageChildren: world?.stage.children.length ?? null,
        puppetParentIsStage: world && puppet ? puppet.group.parent === world.stage : null,
        renderFrame: world?.renderer.info.render.frame ?? null,
        headScreen,
        bodyInFrame: bodyRef.current,
      };
    };
    return () => {
      delete window.__hermesSalaDebug;
    };
  }, []);

  // Identidad estable cuando no hay sala: un [] nuevo por render re-dispararía los efectos.
  const agents = load.kind === "ready" ? load.agents : NO_AGENTS;

  // ── Voz: seleccionar = hablar con ESE agente; soltar = colgar ─────────
  const voice = useVoiceConnect();
  const { setMode } = useVoice();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  useEffect(() => {
    const v = voiceRef.current;
    if (!selectedKey) {
      // Soltar: colgar si había llamada y volver al modo por defecto.
      if (v.connected || v.connecting) void v.disconnect();
      setMode("hermes");
      setVoiceNote(null);
      return;
    }
    const agent = agents.find((a) => a.key === selectedKey);
    if (!agent) return;
    if (!agent.ready) {
      // Sin agente de voz: se cuelga la llamada anterior (seguir oyendo al
      // otro mientras señalas a este confunde) y se dice qué falta.
      if (v.connected || v.connecting) void v.disconnect();
      setMode("hermes");
      setVoiceNote(`${agent.name} aún no tiene voz (pnpm setup:elevenlabs --sala)`);
      return;
    }
    setVoiceNote(null);
    const scopePrompt = `El usuario está en la Sala de Agentes 3D y te está señalando a ti, ${agent.name} (proyecto "${agent.project}"). Habla en primera persona como ${agent.name}.`;
    void v.switchTo(voiceModeFor(agent), { scopePrompt });
    // Solo al cambiar la selección: `voice` cambia de identidad en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, agents, setMode]);

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

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-text">
      {load.kind === "ready" && (
        // key=tema: el mundo lee los tokens al montar (bg, piso, grilla).
        <>
          <SalaScene
            key={theme.resolved}
            ref={sceneRef}
            agents={agents}
            selectedKey={selectedKey}
            aimingKey={aimingKey}
          />
          <SalaVoice
            figure={() =>
              selectedRef.current ? sceneRef.current?.world()?.figure(selectedRef.current) : undefined
            }
          />
        </>
      )}

      {/* HUD: contexto arriba a la izquierda, sin tarjeta (lo que se lee va sin marco). */}
      <header className="pointer-events-none absolute top-5 left-6 z-20">
        <h1 className="text-lg font-medium">Sala de agentes</h1>
        <p className="mt-0.5 text-sm text-text-dim">
          {load.kind === "ready"
            ? `${agents.length} agentes · ${ready} con voz`
            : load.kind === "loading"
              ? "Cargando…"
              : "Sin agentes"}
        </p>
        {load.kind === "ready" && (
          <p className="mt-3 text-sm text-text-dim">
            {selectedKey ? (
              <>
                Hablando con{" "}
                <span className="font-medium text-text">
                  {agents.find((a) => a.key === selectedKey)?.name ?? selectedKey}
                </span>
                <span className="text-text-faint">
                  {" · "}
                  {voiceNote
                    ? voiceNote
                    : voice.error
                      ? voice.error
                      : voice.connecting
                        ? "conectando…"
                        : voice.connected
                          ? "en llamada · baja el brazo o Esc para colgar"
                          : "baja el brazo o Esc para soltar"}
                </span>
              </>
            ) : aimingKey ? (
              <>
                Apuntando a{" "}
                <span className="font-medium text-text">{agents.find((a) => a.key === aimingKey)?.name ?? aimingKey}</span>
              </>
            ) : bodyInFrame ? (
              "Extiende el brazo hacia un agente para hablarle"
            ) : null}
          </p>
        )}
      </header>

      {/* Cámara: estado + preview espejado (abajo a la derecha, chico). */}
      {load.kind === "ready" && (
        <aside className="absolute right-5 bottom-5 z-20 flex flex-col items-end gap-2">
          <div
            ref={previewRef}
            className={`h-[120px] w-[160px] overflow-hidden rounded-md border border-line bg-panel ${
              pose.video ? "" : "hidden"
            }`}
          />
          <div className="flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 text-xs">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                pose.phase === "tracking" && bodyInFrame
                  ? "bg-green"
                  : pose.phase === "error"
                    ? "bg-red"
                    : "bg-text-faint"
              }`}
            />
            <span className="text-text-dim">{cameraLabel}</span>
            {pose.phase === "error" && (
              <button
                type="button"
                onClick={() => void pose.start()}
                className="cursor-pointer text-accent hover:underline"
              >
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
