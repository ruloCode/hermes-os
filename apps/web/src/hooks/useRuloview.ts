"use client";

// RuloView en el navegador: UNA conexión SSE al agente (/ruloview/events), que
// a su vez tiene UNA conexión al servidor RuView. Cada mensaje alimenta la
// métrica por enlace (LinkMetric) y el estado de la sala (EscenarioState),
// ambos de @hermes/shared. La escena 3D lee esos objetos por REF en su propio
// rAF; React solo se entera 4 veces por segundo (el HUD), así ~70 mensajes/s
// no re-renderizan nada.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EscenarioState,
  LinkMetric,
  RU_NODE_IDS,
  type RuNodeId,
  type RuReference,
  type RuRoom,
  type RuStreamMsg,
  type RuStreamState,
} from "@hermes/shared";
import { sseUrl } from "@/lib/hermes";

export interface RuNodeSnap {
  d: number;
  on: boolean;
  fps: number;
  rssi: number | null;
  stale: boolean;
}

export interface RuSnapshot {
  /** Llegó un mensaje en los últimos 3 s. */
  live: boolean;
  link: RuStreamState;
  linkError: string | null;
  /** Estado de la sala que reporta el servidor (con histéresis de 0,8 s). */
  room: string;
  conf: number;
  sourceWarn: string | null;
  nodes: Record<RuNodeId, RuNodeSnap>;
  zone: { available: boolean; score: number; on: boolean };
  ref: RuReference | null;
  sens: number;
  /** ms que faltan de la calibración en curso, o null. */
  calibrating: number | null;
}

const blankNode = (): RuNodeSnap => ({ d: 0, on: false, fps: 0, rssi: null, stale: true });

export function useRuloview(room: RuRoom | null) {
  const metricRef = useRef<LinkMetric | null>(null);
  const escRef = useRef<EscenarioState>(new EscenarioState());
  const linkRef = useRef<{ state: RuStreamState; error: string | null }>({ state: "down", error: null });
  const [snap, setSnap] = useState<RuSnapshot>(() => ({
    live: false,
    link: "down",
    linkError: null,
    room: "absent",
    conf: 0,
    sourceWarn: null,
    nodes: { 1: blankNode(), 2: blankNode(), 3: blankNode() },
    zone: { available: false, score: 0, on: false },
    ref: null,
    sens: 1,
    calibrating: null,
  }));

  if (!metricRef.current && typeof window !== "undefined") metricRef.current = new LinkMetric({ store: localStorage });

  // El cuarto manda las posiciones y la zona.
  useEffect(() => {
    if (room) metricRef.current?.setPos(room.nodes, room.zone);
  }, [room]);

  useEffect(() => {
    const es = new EventSource(sseUrl("/ruloview/events"));
    es.onmessage = (e) => {
      let msg: RuStreamMsg;
      try {
        msg = JSON.parse(e.data) as RuStreamMsg;
      } catch {
        return;
      }
      const now = performance.now();
      if (msg.type === "sensing") {
        metricRef.current?.onSensing(msg.d, now);
        escRef.current.ingest(msg.d, now);
      } else if (msg.type === "vitals") metricRef.current?.onEdgeVitals(msg.v);
      else if (msg.type === "link") linkRef.current = { state: msg.state, error: msg.error ?? null };
    };
    es.onerror = () => {
      linkRef.current = { state: "down", error: "sin conexión con el agente" };
    };

    const timer = setInterval(() => {
      const m = metricRef.current;
      if (!m) return;
      const now = performance.now();
      m.tick(now);
      const e = escRef.current;
      const nodes = {} as Record<RuNodeId, RuNodeSnap>;
      for (const id of RU_NODE_IDS) {
        const n = m.nodes[id];
        nodes[id] = { d: n.d, on: n.on, fps: n.fps, rssi: n.rssiNow, stale: n.stale };
      }
      setSnap({
        live: m.live(now),
        link: linkRef.current.state,
        linkError: linkRef.current.error,
        room: e.shown,
        conf: e.conf,
        sourceWarn: e.sourceWarn,
        nodes,
        zone: { available: m.stage.available, score: m.stage.score, on: m.stage.on },
        ref: m.ref,
        sens: m.sens,
        calibrating: m.calib ? Math.max(0, m.calib.until - now) : null,
      });
    }, 250);
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, []);

  const calibrate = useCallback(() => metricRef.current?.startCalibration(performance.now(), 20000), []);
  const clearReference = useCallback(() => metricRef.current?.clearReference(), []);
  const setSensitivity = useCallback((v: number) => metricRef.current?.setSensitivity(v), []);

  return { snap, metricRef, escRef, calibrate, clearReference, setSensitivity };
}
