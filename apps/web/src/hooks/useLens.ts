"use client";

// LENTE — conexión de una superficie de mirar a la junta EN VIVO. Busca la
// junta activa (no hay que elegirla: hay a lo sumo una), entra al WS como
// `viewer` — nunca desplaza al micrófono de nadie — y alimenta una LensDeck
// con las tarjetas `cue`. El agente ya manda la tarjeta MIENTRAS se escribe
// (`pending`, LensStreamer): la capa rápida tarda ~1,4 s al primer texto y
// varios segundos al final. Misma id: la final la reemplaza en sitio.
//
// `sim` reproduce el guion de lib/lente/sim.ts por el mismo toCue y el mismo
// LensStreamer del agente, sin junta.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cueAllowed,
  LensDeck,
  LensStreamer,
  toCue,
  type LensCue,
  type LensLevel,
  type LensView,
  type LiveMeetingSnapshot,
  type LiveServerEvent,
} from "@hermes/shared";
import { hermesGet, liveMeetingWsUrl, suggestNowLive } from "@/lib/hermes";
import { LENS_SIM, LENS_SIM_LOOP_MS } from "@/lib/lente/sim";

export type LensLink =
  | { state: "offline" }
  | { state: "waiting" }
  | { state: "connecting"; title?: string }
  | { state: "live"; id: string; title?: string; coachMode?: string }
  | { state: "ended"; title?: string }
  | { state: "sim" };

const FIND_EVERY_MS = 3_000;
const TICK_MS = 200;
/** Tras cerrarse la junta, cuánto se queda el aviso antes de volver a esperar. */
const ENDED_HOLD_MS = 15_000;

export interface LensState {
  link: LensLink;
  view: LensView;
  /** Lo último que se dijo (subtítulo opcional). */
  caption: { speaker?: string; text: string } | null;
  /** Historial de la sesión de la lente (lo más nuevo primero). */
  history: LensCue[];
  next: () => void;
  askHelp: () => Promise<"ok" | "busy" | "error" | "unavailable">;
}

export function useLens(opts: { level: LensLevel; sim: boolean }): LensState {
  const { level, sim } = opts;
  const deckRef = useRef(new LensDeck());
  /** Lo que pasaste con "siguiente": su streaming no vuelve a ponerla. */
  const dismissedRef = useRef(new Set<string>());
  const levelRef = useRef(level);
  levelRef.current = level;
  const [link, setLink] = useState<LensLink>(sim ? { state: "sim" } : { state: "waiting" });
  const linkRef = useRef(link);
  linkRef.current = link;
  const [view, setView] = useState<LensView>({ cue: null, remaining: 0, queued: 0 });
  const [caption, setCaption] = useState<LensState["caption"]>(null);
  const [history, setHistory] = useState<LensCue[]>([]);
  const speakerNamesRef = useRef<Record<string, string>>({});

  const repaint = useCallback(() => setView(deckRef.current.view(Date.now())), []);

  const offer = useCallback(
    (cue: LensCue) => {
      if (!cueAllowed(cue, levelRef.current) || dismissedRef.current.has(cue.id)) return;
      deckRef.current.push(cue, Date.now());
      if (!cue.pending)
        setHistory((h) => [cue, ...h.filter((c) => c.id !== cue.id)].slice(0, 40));
      repaint();
    },
    [repaint],
  );

  // Reloj de la baraja: vencer tarjetas y bajar la barra de tiempo.
  useEffect(() => {
    const t = setInterval(() => {
      deckRef.current.tick(Date.now());
      repaint();
    }, TICK_MS);
    return () => clearInterval(t);
  }, [repaint]);

  // Cambiar a "calma" no deja en pantalla lo que ya no pasaría el filtro.
  useEffect(() => {
    const cur = deckRef.current.view(Date.now()).cue;
    if (cur && !cueAllowed(cur, level)) {
      deckRef.current.next(Date.now());
      repaint();
    }
  }, [level, repaint]);

  // ── Simulación ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sim) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const streamer = new LensStreamer();
    const run = (round: number) => {
      for (const step of LENS_SIM) {
        const id = `${step.suggestion.id}-${round}`;
        const sug = { ...step.suggestion, id, atMs: step.at };
        if (!step.stream) {
          timers.push(setTimeout(() => {
            const cue = toCue(sug);
            if (cue) offer(cue);
          }, step.at));
          continue;
        }
        // Streaming: el texto crece por palabras como en la capa rápida.
        const words = sug.text.split(" ");
        timers.push(setTimeout(() => streamer.start(id, sug.kind, sug.why, sug.atMs), step.at));
        words.forEach((w, i) => {
          timers.push(setTimeout(() => {
            const cue = streamer.delta(id, i ? ` ${w}` : w, Date.now());
            if (cue) offer(cue);
          }, step.at + i * 110));
        });
        timers.push(setTimeout(() => {
          streamer.end(id);
          const cue = toCue(sug);
          if (cue) offer(cue);
        }, step.at + words.length * 110 + 400));
      }
      timers.push(setTimeout(() => run(round + 1), LENS_SIM_LOOP_MS));
    };
    run(0);
    return () => timers.forEach(clearTimeout);
  }, [sim, offer]);

  // ── Junta real: buscar → WS viewer → reconectar ──────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (sim) return;
    let alive = true;
    let findTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;

    const find = async () => {
      if (!alive) return;
      let list: LiveMeetingSnapshot[];
      try {
        list = await hermesGet<LiveMeetingSnapshot[]>("/meetings/live");
      } catch {
        if (!alive) return;
        setLink({ state: "offline" });
        findTimer = setTimeout(find, FIND_EVERY_MS);
        return;
      }
      if (!alive) return;
      const active = list.find((s) => s.status === "live" || s.status === "connecting");
      if (!active) {
        setLink({ state: "waiting" });
        findTimer = setTimeout(find, FIND_EVERY_MS);
        return;
      }
      connect(active);
    };

    const connect = (snap: LiveMeetingSnapshot) => {
      setLink({ state: "connecting", title: snap.title });
      const ws = new WebSocket(liveMeetingWsUrl(snap.id, "viewer"));
      wsRef.current = ws;
      ws.onmessage = (msg) => {
        let ev: LiveServerEvent;
        try {
          ev = JSON.parse(String(msg.data)) as LiveServerEvent;
        } catch {
          return;
        }
        handle(snap.id, ev);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!alive) return;
        if (linkRef.current.state === "ended") {
          // El aviso de "terminó" se queda un rato antes de volver a esperar.
          retry = 0;
          findTimer = setTimeout(() => {
            deckRef.current.clear();
            void find();
          }, ENDED_HOLD_MS);
          return;
        }
        retry = Math.min(retry + 1, 5);
        findTimer = setTimeout(find, 500 * 2 ** retry);
      };
    };

    const handle = (id: string, ev: LiveServerEvent) => {
      switch (ev.type) {
        case "hello":
          retry = 0;
          speakerNamesRef.current = ev.session.speakerNames;
          setLink({ state: "live", id, title: ev.session.title, coachMode: ev.session.coachMode });
          break;
        case "speakers_renamed":
          speakerNamesRef.current = ev.speakerNames;
          break;
        case "transcript_partial":
        case "transcript_final": {
          const sp = ev.segment.speaker;
          setCaption({ speaker: sp ? speakerNamesRef.current[sp] ?? undefined : undefined, text: ev.segment.text });
          break;
        }
        case "suggestion_aborted":
          if (deckRef.current.remove(ev.id, Date.now())) repaint();
          break;
        case "cue":
          offer(ev.cue);
          break;
        case "status":
          if (ev.status === "stopping" || ev.status === "ingesting" || ev.status === "done")
            setLink((l) => ({ state: "ended", title: l.state === "live" ? l.title : undefined }));
          break;
        case "done":
          setLink({ state: "ended", title: ev.title });
          // La sesión puede quedarse en el agente ya cerrada: soltar el WS para
          // poder engancharse a la próxima junta.
          wsRef.current?.close();
          break;
        default:
          break;
      }
    };

    void find();
    return () => {
      alive = false;
      if (findTimer) clearTimeout(findTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sim, offer, repaint]);

  const next = useCallback(() => {
    const cur = deckRef.current.view(Date.now()).cue;
    if (cur) dismissedRef.current.add(cur.id);
    deckRef.current.next(Date.now());
    repaint();
  }, [repaint]);

  const askHelp = useCallback(async (): Promise<"ok" | "busy" | "error" | "unavailable"> => {
    const l = linkRef.current;
    if (l.state !== "live") return "unavailable";
    try {
      return (await suggestNowLive(l.id)) ? "ok" : "busy";
    } catch {
      return "error";
    }
  }, []);

  return { link, view, caption, history, next, askHelp };
}
