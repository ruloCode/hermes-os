"use client";

// RULOVIEW — presencia con la señal WiFi entre un router y 3 nodos ESP32-S3
// (fork ruloCode/RuView), dibujada sobre TU cuarto en 3D. Página suelta (fuera
// del shell, como /sala y /oficina). Guía: docs/ruloview.md.
//
// Qué es dato y qué no (regla de oro: todo dato visible es real):
//  - el cuarto: el ESCANEO del celular (room.glb) con sus medidas; sin
//    escaneo, cajas del room.json y la página lo dice;
//  - enlaces, lecturas/s, dBm y perturbación por enlace: medidos;
//  - estado de la sala: lo clasifica el servidor RuView;
//  - esqueleto: SOLO con la cámara maestra (MediaPipe Pose), ubicado en el
//    cuarto con el modelo pinhole de esa cámara (posición estimada);
//  - sin cámara, la figura es APROXIMADA y lo dice. (El servidor manda
//    `persons` con 17 puntos, pero con confianza 0 — es un stub: no se pinta.)

import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import {
  cameraToRoom,
  POSE,
  puppetFrame,
  PuppetSmoother,
  roomPuppetFrame,
  RU_NODE_IDS,
  RU_ROOM_TEXT,
  type RuloviewStatus,
  type RuPosKey,
  type RuRoom,
  type RuRoomState,
  type RuScan,
} from "@hermes/shared";
import { hermesFetch } from "@/lib/hermes";
import { useTheme } from "@/state/ThemeProvider";
import { usePose, type PoseSample } from "@/hooks/usePose";
import { useRuloview } from "@/hooks/useRuloview";
import { RoomScene, RU_NODE_COLORS, type EditTarget, type PoseFeed } from "@/components/ruloview/RoomScene";
import { alignScan, applyScan, disposeScan, parseScan, type ScanAlignment } from "@/lib/ruloview/scan";

declare global {
  interface Window {
    /** QA: estado del HUD, el cuarto, el escaneo y la cámara (Playwright). */
    __hermesRuloviewDebug?: () => unknown;
  }
}

type RoomLoad = { room: RuRoom; fromFile: boolean; scanBytes: number | null; path: string; error?: string };
type ScanState = { kind: "none" } | { kind: "loading"; what: string } | { kind: "ready" } | { kind: "error"; error: string };

const LINK_TEXT = { ws: "en vivo", poll: "en vivo (polling)", down: "sin conexión" } as const;
const CAMERA_KEY = "ruloview-camera";
const VIRTUAL_CAM = /virtual|vcam|obs|snap|mmhmm|ndi/i;
const m2 = (v: number) => v.toFixed(2).replace(".", ",");

export default function RuloviewPage() {
  const theme = useTheme();
  const [status, setStatus] = useState<RuloviewStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [roomLoad, setRoomLoad] = useState<RoomLoad | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanGroup, setScanGroup] = useState<THREE.Group | null>(null);
  const [scanState, setScanState] = useState<ScanState>({ kind: "none" });
  /** Alineación de un escaneo recién subido, antes de guardarla. */
  const [draft, setDraft] = useState<{ turns: number; align: ScanAlignment; bytes: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"persp" | "top">("persp");

  const savedRoom = roomLoad?.room ?? null;
  // Mientras se alinea, la escena muestra el borrador (tamaño y giro nuevos).
  const room: RuRoom | null = savedRoom && draft
    ? { ...savedRoom, size: draft.align.size, scan: { file: "room.glb", yaw: draft.align.yaw, offset: draft.align.offset, scale: draft.align.scale, bytes: draft.bytes, at: "" } }
    : savedRoom;
  const { snap, metricRef, escRef, calibrate, clearReference, setSensitivity } = useRuloview(room);

  // ── estado del servidor (poll de 3 s; durante un arranque, cada 1 s) ──
  const loadStatus = useCallback(async () => {
    try {
      const r = await hermesFetch("/ruloview/status");
      const j = (await r.json()) as RuloviewStatus & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStatus(j);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void loadStatus();
    const id = setInterval(loadStatus, status?.busy ? 1000 : 3000);
    return () => clearInterval(id);
  }, [loadStatus, status?.busy]);

  const loadRoom = useCallback(async () => {
    try {
      const r = await hermesFetch("/ruloview/room");
      setRoomLoad((await r.json()) as RoomLoad);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  // ── escaneo guardado: se baja con Bearer y se aplica el giro guardado ──
  const savedScanKey = savedRoom?.scan ? `${savedRoom.scan.at}-${savedRoom.scan.bytes}` : null;
  useEffect(() => {
    if (draft) return;
    const scan = savedRoom?.scan;
    if (!scan) {
      setScanState({ kind: "none" });
      setScanGroup((g) => (disposeScan(g), null));
      return;
    }
    let alive = true;
    setScanState({ kind: "loading", what: "Cargando el escaneo…" });
    (async () => {
      try {
        const r = await hermesFetch("/ruloview/room/scan");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const group = await parseScan(await r.arrayBuffer());
        if (!alive) return disposeScan(group);
        applyScan(group, scan);
        setScanGroup((g) => (disposeScan(g), group));
        setScanState({ kind: "ready" });
      } catch (err) {
        if (alive) setScanState({ kind: "error", error: `no se pudo leer el escaneo: ${err instanceof Error ? err.message : err}` });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia el escaneo guardado
  }, [savedScanKey, draft]);

  // ── subir un escaneo nuevo → alinear → guardar ──
  const uploadScan = useCallback(async (file: File) => {
    if (!/\.glb$/i.test(file.name)) {
      setNotice("Exporta el escaneo como .glb (no OBJ ni USDZ)");
      return;
    }
    setScanState({ kind: "loading", what: `Subiendo ${(file.size / 1e6).toFixed(1)} MB…` });
    try {
      const buf = await file.arrayBuffer();
      const r = await hermesFetch("/ruloview/room/scan", {
        method: "PUT",
        headers: { "Content-Type": "model/gltf-binary" },
        body: buf,
      });
      const j = (await r.json()) as { ok: boolean; bytes?: number; error?: string };
      if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setScanState({ kind: "loading", what: "Alineando paredes…" });
      const group = await parseScan(buf);
      const align = alignScan(group, 0, 1);
      setScanGroup((g) => (disposeScan(g), group));
      setDraft({ turns: 0, align, bytes: j.bytes ?? file.size });
      setScanState({ kind: "ready" });
    } catch (err) {
      setScanState({ kind: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const turnDraft = useCallback(() => {
    if (!draft || !scanGroup) return;
    const turns = (draft.turns + 1) % 4;
    setDraft({ ...draft, turns, align: alignScan(scanGroup, turns, draft.align.scale) });
  }, [draft, scanGroup]);

  const scaleDraft = useCallback(
    (scale: number) => {
      if (!draft || !scanGroup || !(scale > 0.2 && scale < 5)) return;
      setDraft({ ...draft, align: alignScan(scanGroup, draft.turns, scale) });
    },
    [draft, scanGroup],
  );

  const saveRoom = useCallback(
    async (next: RuRoom, okMsg: string) => {
      const r = await hermesFetch("/ruloview/room", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = (await r.json()) as { ok: boolean; room?: RuRoom; error?: string };
      if (j.ok && j.room) {
        setRoomLoad((prev) => (prev ? { ...prev, room: j.room!, fromFile: true } : prev));
        setNotice(okMsg);
        return true;
      }
      setNotice(j.error ?? "no se pudo guardar");
      return false;
    },
    [],
  );

  const saveDraft = useCallback(async () => {
    if (!draft || !savedRoom) return;
    const scan: RuScan = { file: "room.glb", yaw: draft.align.yaw, offset: draft.align.offset, scale: draft.align.scale, bytes: draft.bytes, at: new Date().toISOString() };
    const ok = await saveRoom(
      { ...savedRoom, size: draft.align.size, scan },
      `Escaneo guardado · ${m2(draft.align.size.w)} × ${m2(draft.align.size.d)} m. Ahora ubica los nodos y la cámara (E).`,
    );
    if (ok) {
      setDraft(null);
      setEditMode(true);
    }
  }, [draft, savedRoom, saveRoom]);

  const removeScan = useCallback(async () => {
    await hermesFetch("/ruloview/room/scan", { method: "DELETE" });
    setDraft(null);
    setScanGroup((g) => (disposeScan(g), null));
    await loadRoom();
    setNotice("Escaneo borrado: vuelven las cajas del room.json");
  }, [loadRoom]);

  const serverAction = useCallback(
    async (path: "/ruloview/start" | "/ruloview/stop", body?: unknown) => {
      const r = await hermesFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) setNotice(j.error ?? "no se pudo");
      void loadStatus();
    },
    [loadStatus],
  );

  // ── cámara maestra: elegir el dispositivo (la virtual nunca por defecto) ──
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const refreshCameras = useCallback(async () => {
    const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    const vids = all.filter((d) => d.kind === "videoinput");
    setCameras(vids);
    setCameraId((cur) => {
      if (cur && vids.some((d) => d.deviceId === cur)) return cur;
      const saved = localStorage.getItem(CAMERA_KEY);
      if (saved && vids.some((d) => d.deviceId === saved)) return saved;
      return vids.find((d) => d.label && !VIRTUAL_CAM.test(d.label))?.deviceId ?? vids[0]?.deviceId ?? null;
    });
  }, []);
  useEffect(() => {
    void refreshCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshCameras);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshCameras);
  }, [refreshCameras]);

  // ── esqueleto MEDIDO: con la cámara ubicada, en tu sitio real; si no, en el ancla ──
  const poseRef = useRef<PoseFeed>({ frame: null, at: 0 });
  const smootherRef = useRef(new PuppetSmoother());
  const roomRef = useRef(room);
  roomRef.current = room;
  const placedRef = useRef<{ distance: number } | null>(null);
  const onPose = useCallback((s: PoseSample) => {
    const r = roomRef.current;
    if (!r || !s.world) {
      poseRef.current = { frame: null, at: 0 };
      placedRef.current = null;
      return;
    }
    let raw = null;
    if (r.camera && s.image) {
      const body = cameraToRoom(s.world, s.image, { width: s.videoWidth, height: s.videoHeight }, r.camera);
      if (body) {
        raw = roomPuppetFrame(body.points, s.world);
        placedRef.current = { distance: body.distance };
      }
    }
    if (!raw) {
      // Sin cámara ubicada: tobillos a la vista → pies al piso; si no, cadera a altura de silla.
      const ankles = [POSE.LEFT_ANKLE, POSE.RIGHT_ANKLE].filter((i) => (s.world![i]?.visibility ?? 0) >= 0.5);
      const hipHeight = ankles.length ? 0.08 + Math.max(...ankles.map((i) => s.world![i].y)) : 0.55;
      raw = puppetFrame(s.world, { origin: { x: r.anchor.x, y: 0, z: r.anchor.z }, hipHeight });
      placedRef.current = null;
    }
    poseRef.current = { frame: smootherRef.current.update(raw, s.tMs), at: performance.now() };
  }, []);
  const pose = usePose(onPose, { deviceId: cameraId, width: 1280, height: 720 });
  const cameraOn = pose.phase === "starting" || pose.phase === "tracking";
  const toggleCamera = useCallback(() => {
    if (cameraOn) {
      pose.stop();
      poseRef.current = { frame: null, at: 0 };
    } else void pose.start().then(refreshCameras);
  }, [cameraOn, pose, refreshCameras]);
  const pickCamera = useCallback(
    (id: string) => {
      localStorage.setItem(CAMERA_KEY, id);
      setCameraId(id);
      if (cameraOn) {
        pose.stop();
        setTimeout(() => void pose.start(), 50);
      }
    },
    [cameraOn, pose],
  );

  // ── ubicar con un clic: nodos sobre la superficie real, la cámara y hacia dónde mira ──
  const place = useCallback(
    async (target: EditTarget, p: { x: number; y: number; z: number }) => {
      if (!savedRoom || draft) return;
      const onSurface = p.y > 0.05; // clic en el piso: se conserva la altura que tenía
      if (target === "cam") {
        const prev = savedRoom.camera;
        const camera = { yaw: 180, pitch: 0, hfov: 70, ...prev, x: p.x, y: onSurface ? p.y + 0.05 : (prev?.y ?? 1.2), z: p.z };
        if (await saveRoom({ ...savedRoom, camera }, "Cámara ubicada. Ahora clic hacia donde mira.")) setEditing("camlook");
        return;
      }
      if (target === "camlook") {
        const c = savedRoom.camera;
        if (!c) return;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dz = p.z - c.z;
        const yaw = Math.round((Math.atan2(dx, dz) * 180) / Math.PI);
        const pitch = Math.round((Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI);
        if (await saveRoom({ ...savedRoom, camera: { ...c, yaw, pitch } }, `Cámara mirando a ${yaw}° · inclinación ${pitch}°`)) setEditing(null);
        return;
      }
      const prev = savedRoom.nodes[target];
      const y = onSurface ? Math.round((p.y + 0.03) * 100) / 100 : prev.y;
      await saveRoom(
        { ...savedRoom, nodes: { ...savedRoom.nodes, [target]: { x: p.x, y, z: p.z } } },
        `${target === "T" ? "Router" : `Nodo ${target}`} en x ${m2(p.x)} · z ${m2(p.z)} · altura ${m2(y)} m`,
      );
    },
    [savedRoom, draft, saveRoom],
  );

  // ── teclado ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const k = e.key.toUpperCase();
      if (editMode && ["1", "2", "3", "T"].includes(k)) setEditing(k as RuPosKey);
      else if (editMode && k === "C") setEditing("cam");
      else if (k === "C") calibrate();
      else if (k === "X") clearReference();
      else if (k === "V") toggleCamera();
      else if (k === "P") setView((v) => (v === "top" ? "persp" : "top"));
      else if (k === "E") {
        setEditMode((v) => !v);
        setEditing(null);
      } else if (k === "+" || k === "=") setSensitivity(snap.sens + 0.25);
      else if (k === "-" || k === "_") setSensitivity(snap.sens - 0.25);
      else if (k === "F") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
      else if (e.key === "Escape") {
        setEditMode(false);
        setEditing(null);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [calibrate, clearReference, editMode, setSensitivity, snap.sens, toggleCamera]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    window.__hermesRuloviewDebug = () => ({
      snap,
      status,
      room: roomLoad,
      scan: { state: scanState, draft, loaded: Boolean(scanGroup) },
      camera: pose.phase,
      cameras: cameras.map((c) => c.label),
      cameraId,
      placed: placedRef.current,
      editing,
      editMode,
      view,
    });
    return () => {
      delete window.__hermesRuloviewDebug;
    };
  }, [snap, status, roomLoad, scanState, draft, scanGroup, pose.phase, cameras, cameraId, editing, editMode, view]);

  // Soltar un .glb en cualquier parte de la página.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) void uploadScan(f);
    },
    [uploadScan],
  );

  const serverUp = Boolean(status?.serverUp);
  const roomText = RU_ROOM_TEXT[snap.room as RuRoomState] ?? snap.room;
  const activeNodes = RU_NODE_IDS.filter((id) => !snap.nodes[id].stale && snap.live).length;
  const totalFps = RU_NODE_IDS.reduce((s, id) => s + (snap.nodes[id].stale ? 0 : snap.nodes[id].fps), 0);
  const scanReady = scanGroup && (draft || savedRoom?.scan);
  const sceneScan = scanReady ? scanGroup : null;
  const editHint: Record<string, string> = {
    T: "el router",
    "1": "el nodo 1",
    "2": "el nodo 2",
    "3": "el nodo 3",
    cam: "la cámara maestra",
  };

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-text" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {room && (
        <RoomScene
          key={`${theme.resolved}-${view}-${JSON.stringify(room)}-${sceneScan ? sceneScan.uuid : "cajas"}`}
          room={room}
          metricRef={metricRef}
          escRef={escRef}
          poseRef={poseRef}
          scan={sceneScan}
          view={view}
          editing={editing}
          onPlace={place}
        />
      )}

      {/* Cabecera: qué pasa en el cuarto + estado del servidor */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-6">
        <div className="pointer-events-auto max-w-xl">
          <p className="text-sm text-text-dim">
            RuloView · {room?.name ?? "cuarto"} ·{" "}
            <span data-testid="room-source">
              {draft
                ? `escaneo (alineando) · ${m2(draft.align.size.w)} × ${m2(draft.align.size.d)} m`
                : savedRoom?.scan
                  ? `escaneo · ${m2(savedRoom.size.w)} × ${m2(savedRoom.size.d)} m`
                  : "cajas (sin escaneo)"}
            </span>
          </p>
          <h1 className="mt-1 text-3xl font-semibold" aria-live="polite" data-testid="room-state">
            {!serverUp ? "Servidor apagado" : !snap.live ? "Esperando datos de los nodos" : roomText}
          </h1>
          <p className="mt-2 text-sm text-text-dim">
            {snap.live
              ? `${activeNodes} de 3 nodos transmitiendo · ${Math.round(totalFps)} lecturas WiFi por segundo`
              : "Sin lecturas en los últimos 3 s"}
            {snap.sourceWarn && <span className="ml-2 rounded-sm bg-amber/15 px-1.5 py-0.5 text-amber">fuente: {snap.sourceWarn}</span>}
          </p>
          {roomLoad && !roomLoad.fromFile && (
            <p className="mt-2 text-sm text-amber">
              Cuarto de ejemplo (4×4 m). Describe el tuyo en {roomLoad.path} o carga un escaneo.
              {roomLoad.error ? ` — ${roomLoad.error}` : ""}
            </p>
          )}
          {scanState.kind === "loading" && <p className="mt-2 text-sm text-text-dim">{scanState.what}</p>}
          {scanState.kind === "error" && <p className="mt-2 text-sm text-red">{scanState.error}</p>}
          {draft && (
            <div className="mt-3 rounded-md border border-accent bg-panel p-3 text-sm" data-testid="scan-align">
              <p className="font-medium">Alinea el escaneo</p>
              <p className="mt-1 text-text-dim">
                Las paredes ya quedaron derechas (giro {m2(draft.align.yaw)}°). Gira hasta que el escritorio quede en la pared del FONDO y guarda.
              </p>
              <label className="mt-2 flex items-center gap-2 text-text-dim">
                Escala ×
                <input
                  type="number"
                  step="0.01"
                  min="0.2"
                  max="5"
                  defaultValue={draft.align.scale}
                  className="w-20 rounded-sm border border-line bg-bg px-1.5 py-0.5 text-text"
                  data-testid="scan-scale"
                  onChange={(e) => scaleDraft(Number(e.target.value))}
                />
                <span className="text-xs">sin LiDAR: medida real ÷ la misma medida en el escaneo</span>
              </label>
              <div className="mt-2 flex gap-2">
                <button className="rounded-sm border border-line px-2 py-1 hover:border-accent" onClick={turnDraft}>
                  Girar 90°
                </button>
                <button className="rounded-sm bg-accent px-2 py-1 text-white" onClick={() => void saveDraft()}>
                  Guardar
                </button>
                <button className="rounded-sm border border-line px-2 py-1 hover:border-accent" onClick={() => void removeScan()}>
                  Descartar
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex max-w-md flex-col items-end gap-2 text-right">
          <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm" data-testid="server-status">
            <span
              className={`inline-block h-2 w-2 rounded-full ${serverUp && snap.live ? "bg-green" : serverUp ? "bg-amber" : "bg-red"}`}
              aria-hidden
            />
            <span>
              {status?.busy === "starting"
                ? "Arrancando servidor…"
                : status?.busy === "stopping"
                  ? "Deteniendo…"
                  : serverUp
                    ? `Servidor arriba · ${LINK_TEXT[snap.link]}`
                    : "Servidor apagado"}
            </span>
            {status?.liveSource && <span className="text-text-dim">· {status.liveSource}</span>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {serverUp ? (
              <button className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent" onClick={() => void serverAction("/ruloview/stop")} disabled={Boolean(status?.busy)}>
                Detener servidor
              </button>
            ) : (
              <>
                <button className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => void serverAction("/ruloview/start", { source: "esp32" })} disabled={Boolean(status?.busy) || !status?.pathOk}>
                  Arrancar con los ESP32
                </button>
                <button className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void serverAction("/ruloview/start", { source: "simulated" })} disabled={Boolean(status?.busy) || !status?.pathOk}>
                  Simulado
                </button>
              </>
            )}
            <button className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent" onClick={() => fileRef.current?.click()}>
              {savedRoom?.scan ? "Cambiar escaneo" : "Cargar escaneo (.glb)"}
            </button>
            {status?.pages && (
              <a className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent" href={status.pages.observatory} target="_blank" rel="noreferrer">
                Observatorio ↗
              </a>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".glb,model/gltf-binary"
            className="hidden"
            data-testid="scan-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadScan(f);
              e.target.value = "";
            }}
          />
          {status && !status.pathOk && <p className="text-sm text-amber">RUVIEW_PATH no apunta a un clon de RuView</p>}
          {(statusError || status?.error) && <p className="text-sm text-red">{statusError ?? status?.error}</p>}
          {status?.busy && status.log.length > 0 && (
            <pre className="max-h-40 w-96 overflow-auto rounded-md border border-line bg-panel p-2 text-left font-mono text-xs text-text-dim">{status.log.slice(-8).join("\n")}</pre>
          )}
        </div>
      </header>

      {notice && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-md bg-accent px-3 py-1.5 text-sm text-white" role="status">
          {notice}
        </div>
      )}
      {editMode && !draft && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-md border border-accent bg-panel px-3 py-1.5 text-sm" role="status" data-testid="edit-hint">
          {editing === "camlook"
            ? "Clic hacia donde MIRA la cámara (p. ej. la silla). Esc para salir."
            : editing
              ? `Ubicando ${editHint[editing]}: clic sobre ${savedRoom?.scan ? "el escaneo, donde está pegado" : "el mueble o el piso"}. E para salir.`
              : "Edición: 1 / 2 / 3 / T = nodos · C = cámara maestra. E para salir."}
        </div>
      )}

      {/* Pie: enlaces, zona y controles */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)] gap-4 p-6 max-lg:grid-cols-3">
        {RU_NODE_IDS.map((id) => {
          const n = snap.nodes[id];
          const key = String(id) as RuPosKey;
          const off = n.stale || !snap.live;
          return (
            <div key={id} className={`pointer-events-auto rounded-md border border-line bg-panel/90 p-3 ${off ? "opacity-50" : ""}`} style={{ borderTopColor: RU_NODE_COLORS[key], borderTopWidth: 3 }} data-testid={`node-${id}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Enlace {id}</h2>
                <span className="truncate text-xs text-text-dim">{room?.labels?.[key] ?? ""}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(n.d * 100)} aria-label={`Perturbación del enlace ${id}`}>
                <i className="block h-full rounded-full transition-[width] duration-200" style={{ width: `${off ? 0 : Math.round(n.d * 100)}%`, background: RU_NODE_COLORS[key] }} />
              </div>
              <p className="mt-1.5 text-xs text-text-dim">
                {off ? "sin señal: revisa su cargador o pulsa RESET" : `${Math.round(n.fps)} lecturas/s · ${n.rssi ?? "–"} dBm${n.on ? " · algo lo cruza" : ""}`}
              </p>
            </div>
          );
        })}
        <div className="pointer-events-auto rounded-md border border-line bg-panel/90 p-3 text-xs text-text-dim max-lg:col-span-3">
          <p className="text-sm text-text">
            {snap.calibrating != null
              ? `Calibrando: deja el cuarto vacío ${Math.ceil(snap.calibrating / 1000)} s…`
              : !snap.zone.available
                ? "Ningún enlace cruza la zona de captura"
                : snap.zone.on
                  ? `Actividad en la zona · ${Math.round(snap.zone.score * 100)}%`
                  : "Zona en calma"}
          </p>
          <p className="mt-1">
            {snap.ref ? `Referencia: cuarto vacío (${snap.ref.at})` : "Referencia: últimos 2 min (calibra con el cuarto vacío)"} · sensibilidad {snap.sens.toFixed(2)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button className="rounded-sm border border-line px-2 py-1 hover:border-accent" onClick={calibrate}>Calibrar (C)</button>
            <button className={`rounded-sm border px-2 py-1 ${cameraOn ? "border-accent text-accent" : "border-line hover:border-accent"}`} onClick={toggleCamera}>
              {cameraOn ? "Apagar cámara (V)" : "Cámara maestra (V)"}
            </button>
            {cameras.length > 1 && (
              <select
                className="max-w-44 rounded-sm border border-line bg-panel px-1.5 py-1 text-text"
                value={cameraId ?? ""}
                onChange={(e) => pickCamera(e.target.value)}
                aria-label="Cámara maestra"
                data-testid="camera-select"
              >
                {cameras.map((c, i) => (
                  <option key={c.deviceId || i} value={c.deviceId}>
                    {c.label || `Cámara ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            <button className={`rounded-sm border px-2 py-1 ${editMode ? "border-accent text-accent" : "border-line hover:border-accent"}`} onClick={() => setEditMode((v) => !v)}>
              Ubicar (E)
            </button>
            <button className={`rounded-sm border px-2 py-1 ${view === "top" ? "border-accent text-accent" : "border-line hover:border-accent"}`} onClick={() => setView((v) => (v === "top" ? "persp" : "top"))}>
              Planta (P)
            </button>
            <button className="rounded-sm border border-line px-2 py-1 hover:border-accent" onClick={() => setSensitivity(snap.sens - 0.25)} aria-label="Menos sensibilidad">−</button>
            <button className="rounded-sm border border-line px-2 py-1 hover:border-accent" onClick={() => setSensitivity(snap.sens + 0.25)} aria-label="Más sensibilidad">+</button>
          </div>
          <p className="mt-2 leading-relaxed">
            {cameraOn
              ? pose.phase === "tracking"
                ? room?.camera
                  ? "Esqueleto medido por la cámara, en tu posición estimada del cuarto (la imagen no se graba ni se muestra)."
                  : "Esqueleto medido por la cámara. Ubica la cámara (E, luego C) para ponerlo en tu sitio real."
                : "Abriendo la cámara…"
              : "Sin cámara, la figura es aproximada: el WiFi dice que hay alguien y qué enlace cruza, no tu pose."}
            {pose.error && <span className="text-red"> {pose.error}</span>}
          </p>
        </div>
      </footer>
    </main>
  );
}
