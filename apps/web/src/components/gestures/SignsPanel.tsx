"use client";

// SEÑAS DE MANO — takeover de configuración (⌘K "Señas de mano").
//
// Izquierda: la cámara con el esqueleto y lo que el clasificador ve AHORA
// (forma de dedos, seña candidata con su carga, último resultado) — probar
// es mirar. Derecha: la lista de señas, cada una con su acción, su tiempo
// de sostén y su interruptor; las de fábrica se reasignan o re-entrenan, las
// tuyas se enseñan delante de la cámara (3·2·1 → 24 muestras) y se borran.
//
// La config es un BORRADOR local hasta "Guardar" (PUT al agente, que valida
// y persiste); al guardar, el provider la aplica en caliente. Mientras se
// enseña una seña el disparo queda pausado — no queremos que sostener la
// mano para grabarla ejecute algo a medio camino.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BROWSER_SIGN_ACTIONS,
  SIGN_HOLD_DEFAULT_MS,
  SYSTEM_SIGN_ACTIONS,
  defaultSignsConfig,
  isReservedShape,
  shapeGlyph,
  type FingerShape,
  type SignDef,
  type SignsConfig,
} from "@hermes/shared";
import { COMMANDS } from "@/lib/commands";
import { hermesPut } from "@/lib/hermes";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Toggle } from "@/components/ui/Toggle";
import { useGestureControl, type GestureFrame } from "@/state/GestureControlProvider";

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const SAMPLES_TARGET = 24;
const SAMPLE_GAP_MS = 70;
const COUNTDOWN_MS = 2500;
const HOLD_OPTIONS = [400, SIGN_HOLD_DEFAULT_MS, 900, 1200];

const inputCls =
  "rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs text-text focus:outline-none focus:border-line-2";
const selectCls =
  "min-w-0 rounded-sm border border-line bg-panel-2 px-1.5 py-1 text-xs text-text focus:outline-none";
const btnCls =
  "cursor-pointer rounded-sm border border-line px-2 py-1 text-xs text-text-dim transition-colors hover:border-line-2 hover:text-text disabled:cursor-default disabled:opacity-50";
const btnAccentCls =
  "cursor-pointer rounded-sm border border-accent/60 bg-accent/10 px-2.5 py-1 text-xs text-accent transition-colors hover:bg-accent/20 disabled:cursor-default disabled:opacity-50";

interface Teach {
  /** null = seña nueva. */
  signId: string | null;
  name: string;
  phase: "countdown" | "capturing" | "done";
  startedAt: number;
  count: number;
  /** Aviso vigente ("esa forma está reservada"). */
  warn: string | null;
}

interface Live {
  shape: FingerShape | null;
  candidate: string | null;
  progress: number;
  fps: number;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "sena"
  );
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

/** Forma mayoritaria de un lote de capturas (la que se muestra como glifo). */
function majorityShape(shapes: FingerShape[]): FingerShape | undefined {
  const counts = new Map<string, { n: number; s: FingerShape }>();
  for (const s of shapes) {
    const k = shapeGlyph(s);
    const e = counts.get(k);
    if (e) e.n += 1;
    else counts.set(k, { n: 1, s });
  }
  let best: { n: number; s: FingerShape } | undefined;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best?.s;
}

export function SignsPanel() {
  const g = useGestureControl();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!g.signsOpen || !mounted) return null;
  return createPortal(<SignsTakeover />, document.body);
}

function SignsTakeover() {
  const g = useGestureControl();
  const [draft, setDraft] = useState<SignsConfig>(g.signs);
  const adoptedRef = useRef(g.signs);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [teach, setTeach] = useState<Teach | null>(null);
  const [newName, setNewName] = useState("");
  const [live, setLive] = useState<Live>({ shape: null, candidate: null, progress: 0, fps: 0 });

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(adoptedRef.current), [draft]);

  // Sin edición pendiente, el borrador adopta lo que llegue de afuera (el
  // agente respondió, otra pestaña guardó). Con edición pendiente, manda la tuya.
  useEffect(() => {
    if (!dirty) {
      adoptedRef.current = g.signs;
      setDraft(g.signs);
    }
  }, [g.signs, dirty]);

  // ── Cámara: preview + overlay + lectura en vivo (throttled) ─────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveAtRef = useRef(0);
  const teachRef = useRef<Teach | null>(null);
  teachRef.current = teach;
  const capturedRef = useRef<{ vectors: number[][]; shapes: FingerShape[]; lastAt: number }>({
    vectors: [],
    shapes: [],
    lastAt: 0,
  });

  useEffect(() => {
    if (g.phase !== "tracking") return;
    const video = videoRef.current;
    const stream = g.getStream();
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play();
    }
  }, [g, g.phase]);

  const finishTeach = useCallback(
    (t: Teach, vectors: number[][], shapes: FingerShape[]) => {
      const shape = majorityShape(shapes);
      setDraft((d) => {
        if (t.signId) {
          return {
            ...d,
            signs: d.signs.map((s) =>
              s.id === t.signId ? { ...s, samples: vectors, ...(s.builtin ? {} : { shape }) } : s,
            ),
          };
        }
        const taken = new Set(d.signs.map((s) => s.id));
        const sign: SignDef = {
          id: uniqueId(slugify(t.name), taken),
          name: t.name.trim() || "Mi seña",
          ...(shape ? { shape } : {}),
          samples: vectors,
          action: null,
          holdMs: SIGN_HOLD_DEFAULT_MS,
          enabled: true,
          builtin: false,
        };
        return { ...d, signs: [...d.signs, sign] };
      });
      setTeach({ ...t, phase: "done", count: vectors.length });
      setNewName("");
    },
    [],
  );

  useEffect(() => {
    const unsub = g.subscribeFrame((f: GestureFrame) => {
      const now = performance.now();
      // Overlay de landmarks (espejado como el video).
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (f.landmarks) {
          const px = (x: number) => (1 - x) * canvas.width;
          const py = (y: number) => y * canvas.height;
          ctx.strokeStyle = "rgba(217, 119, 87, 0.85)";
          ctx.lineWidth = 2;
          for (const [a, b] of BONES) {
            ctx.beginPath();
            ctx.moveTo(px(f.landmarks[a].x), py(f.landmarks[a].y));
            ctx.lineTo(px(f.landmarks[b].x), py(f.landmarks[b].y));
            ctx.stroke();
          }
          ctx.fillStyle = "rgba(217, 119, 87, 0.95)";
          for (const p of f.landmarks) {
            ctx.beginPath();
            ctx.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Enseñanza: countdown → capturar muestras espaciadas → listo.
      const t = teachRef.current;
      if (t) {
        if (t.phase === "countdown" && now - t.startedAt >= COUNTDOWN_MS) {
          capturedRef.current = { vectors: [], shapes: [], lastAt: 0 };
          setTeach({ ...t, phase: "capturing", count: 0, warn: null });
        } else if (t.phase === "capturing") {
          const cap = capturedRef.current;
          if (f.vector && f.shape) {
            if (isReservedShape(f.shape)) {
              if (!t.warn) setTeach({ ...t, warn: "Esa forma es del cursor, la pinza, el scroll o el puño — elige otra." });
            } else if (now - cap.lastAt >= SAMPLE_GAP_MS) {
              cap.vectors.push(f.vector);
              cap.shapes.push(f.shape);
              cap.lastAt = now;
              if (cap.vectors.length >= SAMPLES_TARGET) finishTeach(t, cap.vectors, cap.shapes);
              else setTeach({ ...t, count: cap.vectors.length, warn: null });
            }
          }
        }
      }

      // Lectura en vivo a ~12 Hz (o al instante si cambia la candidata).
      const changed = (f.sign?.candidate ?? null) !== live.candidate;
      if (changed || now - liveAtRef.current > 80) {
        liveAtRef.current = now;
        setLive({
          shape: f.shape,
          candidate: f.sign?.candidate ?? null,
          progress: f.sign?.progress ?? 0,
          fps: f.fps,
        });
      }
    });
    return unsub;
    // `live.candidate` solo sirve para el atajo "cambió": no re-suscribir por él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, finishTeach]);

  // Pausar el disparo mientras se enseña.
  useEffect(() => {
    g.setSignsPaused(teach !== null && teach.phase !== "done");
    return () => g.setSignsPaused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teach]);

  // Esc: cancela la enseñanza; si no hay, cierra (cede ante campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (teachRef.current && teachRef.current.phase !== "done") setTeach(null);
      else g.closeSigns();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [g]);

  const startTeach = (signId: string | null, name: string) => {
    if (g.phase !== "tracking") return;
    setTeach({ signId, name, phase: "countdown", startedAt: performance.now(), count: 0, warn: null });
  };

  const patchSign = (id: string, patch: Partial<SignDef>) =>
    setDraft((d) => ({ ...d, signs: d.signs.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await hermesPut<SignsConfig>("/input/gestures/signs", draft);
      adoptedRef.current = saved;
      setDraft(saved);
      g.applySigns(saved);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => setDraft(adoptedRef.current);
  const restoreDefaults = () => setDraft(defaultSignsConfig());

  const cameraOn = g.phase === "tracking";
  const liveSign = live.candidate ? draft.signs.find((s) => s.id === live.candidate) : null;
  const ev = g.lastSignEvent;
  const evFresh = ev && Date.now() - ev.at < 6000;

  return (
    <div
      data-signs-takeover
      className="fixed inset-0 z-50 flex flex-col gap-3 overflow-hidden bg-bg p-4 text-text"
    >
      <ViewHeader
        title="Señas de mano"
        onBack={g.closeSigns}
        backLabel="Cerrar"
        meta={
          <span className="text-xs text-text-dim">
            {draft.signs.length} señas · {draft.signs.filter((s) => s.enabled && s.action).length} activas con acción
            {cameraOn ? ` · ${Math.round(live.fps)} fps` : ""}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {saveError && <span className="text-xs text-red">{saveError}</span>}
            {dirty && (
              <button type="button" onClick={discard} className={btnCls}>
                Descartar
              </button>
            )}
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={btnAccentCls}>
              {saving ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
            </button>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Cámara + lectura en vivo ─────────────────────────────────── */}
        <section className="flex min-h-0 flex-col gap-3">
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-md border border-line bg-black">
            {cameraOn ? (
              <>
                <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
                <canvas ref={canvasRef} width={640} height={360} className="absolute inset-0 h-full w-full" />
              </>
            ) : (
              <div className="grid h-full place-items-center">
                <button
                  type="button"
                  onClick={() => void g.start({ hud: false })}
                  disabled={g.phase === "starting"}
                  className={btnAccentCls}
                >
                  {g.phase === "starting" ? "Iniciando cámara…" : "Encender la cámara"}
                </button>
              </div>
            )}
            {teach && (
              <div className="absolute inset-0 grid place-items-center bg-black/55 text-center">
                {teach.phase === "countdown" && (
                  <div>
                    <div className="text-5xl font-semibold tabular-nums text-white">
                      {Math.max(1, Math.ceil((COUNTDOWN_MS - (performance.now() - teach.startedAt)) / 1000))}
                    </div>
                    <div className="mt-2 text-sm text-white/85">
                      Prepara la seña «{teach.name}» y sostenla frente a la cámara
                    </div>
                  </div>
                )}
                {teach.phase === "capturing" && (
                  <div className="w-64">
                    <div className="text-sm text-white/90">Sostén la seña… mueve un poco la mano</div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                      <div
                        className="h-full bg-accent transition-[width]"
                        style={{ width: `${(teach.count / SAMPLES_TARGET) * 100}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-white/70">
                      {teach.count} / {SAMPLES_TARGET} muestras
                    </div>
                    {teach.warn && <div className="mt-2 text-xs text-amber">{teach.warn}</div>}
                  </div>
                )}
                {teach.phase === "done" && (
                  <div>
                    <div className="text-2xl text-green">✓ {teach.count} muestras</div>
                    <div className="mt-1 text-sm text-white/85">Ahora pruébala: haz la seña y mira si se reconoce.</div>
                    <button type="button" onClick={() => setTeach(null)} className={`${btnCls} mt-3 border-white/40 text-white`}>
                      Listo
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {g.error && <p className="text-xs text-red">{g.error}</p>}
          {cameraOn && g.accessibility === false && (
            <p className="text-xs text-amber">
              El agente no tiene permiso de Accessibility: las señas de dashboard funcionan, las de sistema
              (ventanas, teclas) no hasta darle el permiso al node del servicio.
            </p>
          )}

          {/* Lo que el clasificador ve ahora. */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-line p-3 text-xs">
            <span className="text-text-faint">Dedos</span>
            <span className="font-mono">
              {live.shape ? shapeGlyph(live.shape) : "—"}
              <span className="ml-2 text-text-faint">pulgar · índice · medio · anular · meñique</span>
              {live.shape && isReservedShape(live.shape) && (
                <span className="ml-2 text-text-dim">forma del cursor (reservada)</span>
              )}
            </span>
            <span className="text-text-faint">Seña</span>
            <span className="flex items-center gap-2">
              {liveSign ? (
                <>
                  <span>
                    {liveSign.emoji ?? "✋"} {liveSign.name}
                  </span>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                    <span
                      className={`block h-full ${live.progress >= 1 ? "bg-green" : "bg-accent"}`}
                      style={{ width: `${live.progress * 100}%` }}
                    />
                  </span>
                  <span className="text-text-dim">
                    {live.progress >= 1 ? "disparada" : "sosteniendo…"}
                  </span>
                </>
              ) : (
                <span className="text-text-faint">{cameraOn ? "ninguna" : "cámara apagada"}</span>
              )}
            </span>
            <span className="text-text-faint">Último</span>
            <span className={evFresh ? (ev.ok ? "text-green" : "text-amber") : "text-text-faint"}>
              {ev ? `${ev.ok ? "✓" : "✕"} ${ev.text}` : "—"}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-text-faint">
            Una seña se dispara sosteniéndola QUIETA el tiempo configurado (moverla la cancela); mientras carga,
            el cursor se congela. Las formas del cursor (mano abierta, pulgar+índice), el scroll (índice+medio) y
            el puño están reservadas y no se pueden enseñar. Puño + mover = agarrar la ventana bajo el cursor;
            al abrir la mano con impulso se lanza: ← → mitad de pantalla (o al otro monitor), ↑ maximizar, ↓ centrar.
          </p>
        </section>

        {/* ── Lista de señas ───────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2">
              {draft.signs.map((s) => (
                <SignRow
                  key={s.id}
                  sign={s}
                  live={live.candidate === s.id}
                  cameraOn={cameraOn}
                  teaching={teach !== null && teach.phase !== "done"}
                  onPatch={(patch) => patchSign(s.id, patch)}
                  onTeach={() => startTeach(s.id, s.name)}
                  onRemove={() => setDraft((d) => ({ ...d, signs: d.signs.filter((x) => x.id !== s.id) }))}
                />
              ))}
            </div>
          </div>

          <form
            className="flex shrink-0 items-center gap-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) startTeach(null, newName.trim());
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre de la seña nueva (p.ej. Cuernos)"
              className={`${inputCls} flex-1`}
              maxLength={60}
            />
            <button
              type="submit"
              disabled={!cameraOn || !newName.trim() || (teach !== null && teach.phase !== "done")}
              className={btnAccentCls}
              title={cameraOn ? "3·2·1 y sostén la seña" : "Enciende la cámara primero"}
            >
              ◉ Enseñar
            </button>
            <button type="button" onClick={restoreDefaults} className={btnCls} title="Vuelve a las tres de fábrica">
              Fábrica
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function SignRow({
  sign,
  live,
  cameraOn,
  teaching,
  onPatch,
  onTeach,
  onRemove,
}: {
  sign: SignDef;
  live: boolean;
  cameraOn: boolean;
  teaching: boolean;
  onPatch: (patch: Partial<SignDef>) => void;
  onTeach: () => void;
  onRemove: () => void;
}) {
  const trained = sign.samples.length > 0;
  return (
    <div
      className={`flex flex-col gap-2 rounded-md border p-3 transition-colors ${
        live ? "border-accent/60 bg-accent/5" : "border-line"
      } ${sign.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-2">
        <span className="w-7 text-center text-xl leading-none">{sign.emoji ?? "✋"}</span>
        {sign.builtin ? (
          <span className="text-sm font-medium">{sign.name}</span>
        ) : (
          <input
            value={sign.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            className={`${inputCls} w-44 font-medium`}
            maxLength={60}
          />
        )}
        <span
          className="font-mono text-xs text-text-dim"
          title="pulgar · índice · medio · anular · meñique (● arriba, ○ plegado)"
        >
          {sign.shape ? shapeGlyph(sign.shape) : "—"}
        </span>
        <span className="text-xs text-text-faint">
          {trained ? `${sign.samples.length} muestras` : sign.builtin ? "por forma" : ""}
        </span>
        <span className="ml-auto">
          <Toggle checked={sign.enabled} onChange={(v) => onPatch({ enabled: v })} size="sm" />
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <select
          value={sign.action ?? ""}
          onChange={(e) => onPatch({ action: e.target.value || null })}
          className={selectCls}
        >
          <option value="">— sin acción —</option>
          <optgroup label="Sistema (agente)">
            {SYSTEM_SIGN_ACTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Dashboard">
            {BROWSER_SIGN_ACTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Comandos ⌘K">
            {COMMANDS.map((c) => (
              <option key={c.id} value={`command:${c.id}`}>
                {c.label}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          value={sign.holdMs}
          onChange={(e) => onPatch({ holdMs: Number(e.target.value) })}
          className={selectCls}
          title="Cuánto sostener la seña"
        >
          {HOLD_OPTIONS.map((ms) => (
            <option key={ms} value={ms}>
              {ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`}
            </option>
          ))}
          {!HOLD_OPTIONS.includes(sign.holdMs) && <option value={sign.holdMs}>{sign.holdMs} ms</option>}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onTeach}
          disabled={!cameraOn || teaching}
          className={btnCls}
          title={cameraOn ? "Graba 24 muestras con tu mano" : "Enciende la cámara primero"}
        >
          {trained ? "↻ Re-entrenar" : "◉ Entrenar con mi mano"}
        </button>
        {sign.builtin && trained && (
          <button type="button" onClick={() => onPatch({ samples: [] })} className={btnCls}>
            Volver a la forma de fábrica
          </button>
        )}
        {!sign.builtin && (
          <button type="button" onClick={onRemove} className={`${btnCls} text-red hover:text-red`}>
            Borrar
          </button>
        )}
        {live && <span className="ml-auto text-xs text-accent">← reconocida ahora</span>}
      </div>
    </div>
  );
}
