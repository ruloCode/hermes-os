"use client";

// Pantalla de arranque de Hermes OS (overlay fullscreen). El asset original es
// hermes-loader.html (autocontenido): aquí el CSS, el markup y la lógica del
// canvas se copian TAL CUAL — solo se reorganizan para React:
//   · el CSS se scopea bajo `.hermes-boot` (mismos nombres de clase) para no
//     tocar estilos globales ni el `body`.
//   · toda la lógica JS vive en un useEffect con cleanup del requestAnimationFrame
//     y del listener de resize.
//   · en vez de `window.HermesLoader` la API imperativa (setProgress/done) se
//     expone por ref y la conduce <BootGate/> con el progreso real de carga.
// El modo demo y el loop de reinicio se eliminaron: el progreso es real.

import { useEffect, useRef } from "react";

// Labels por defecto del asset (se usan si aún no hay proyectos en el cliente).
const DEFAULT_LABELS = [
  "ZYLEN", "TEKER", "SMOKECK2", "RULOCODE", "MG-COMPANY", "DIVISUAL",
  "IKIGAI", "OPENMONTAGE", "CAREWAYS", "SMOKERUN", "TERNIUM",
];

interface GNode {
  idx: number; r: number; speed: number; phase: number;
  tilt: number; size: number; color: string; spawnAt: number; born: number;
}
interface GLink { a: number; b: number; spawnAt: number; born: number }
interface Pulse { i: number; t: number }

interface BootLoaderProps {
  /** Progreso real de carga 0..100 (monótono; el componente lo suaviza). */
  progress: number;
  /** Al pasar a true: completa a 100, mantiene "SISTEMA ONLINE", hace fade y llama onDone. */
  finish: boolean;
  /** Labels de los nodos del grafo (nombres de proyecto). Pueden llegar tarde. */
  labels?: string[];
  /** Se llama tras el fade-out para desmontar el overlay. */
  onDone: () => void;
}

const CSS = `
.hermes-boot {
  --bg: #06050e;
  --bg-panel: #0a0817;
  --violet: #8b7cf8;
  --violet-hot: #b7a8ff;
  --violet-dim: #453a7d;
  --node-blue: #5fb4f9;
  --alert: #ff3b5c;
  --ok: #3ef08a;
  --ink: #cfc9ea;
  --ink-dim: #6b6490;
  --mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;

  position: fixed; inset: 0; z-index: 120;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--mono);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ===== Atmosphere layers ===== */
.hermes-boot .grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(139,124,248,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(139,124,248,.05) 1px, transparent 1px);
  background-size: 56px 56px;
  -webkit-mask-image: radial-gradient(ellipse 90% 80% at 50% 45%, #000 30%, transparent 100%);
  mask-image: radial-gradient(ellipse 90% 80% at 50% 45%, #000 30%, transparent 100%);
  pointer-events: none;
}
.hermes-boot .vignette {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 70% 55% at 50% 42%, rgba(139,124,248,.07), transparent 65%),
    radial-gradient(ellipse 130% 110% at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%);
  pointer-events: none;
}
.hermes-boot .scanlines {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px);
  mix-blend-mode: overlay;
  pointer-events: none;
}

/* ===== HUD frame ===== */
.hermes-boot .frame { position: absolute; inset: 14px; pointer-events: none; }
.hermes-boot .frame i {
  position: absolute; width: 22px; height: 22px;
  border: 1px solid var(--violet-dim);
}
.hermes-boot .frame i:nth-child(1) { top: 0;    left: 0;   border-right: 0; border-bottom: 0; }
.hermes-boot .frame i:nth-child(2) { top: 0;    right: 0;  border-left: 0;  border-bottom: 0; }
.hermes-boot .frame i:nth-child(3) { bottom: 0; left: 0;   border-right: 0; border-top: 0; }
.hermes-boot .frame i:nth-child(4) { bottom: 0; right: 0;  border-left: 0;  border-top: 0; }

/* ===== Stage ===== */
.hermes-boot .stage {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: clamp(10px, 2.5vh, 26px);
  padding: 34px 24px;
  box-sizing: border-box;
  transition: opacity .5s ease;
}
.hermes-boot .stage.out { opacity: 0; }

.hermes-boot .hud-top {
  position: absolute; top: 26px; left: 34px; right: 34px;
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 10px; letter-spacing: .32em; color: var(--ink-dim);
  text-transform: uppercase;
}
.hermes-boot .hud-top b {
  font-weight: 700; font-size: 15px; letter-spacing: .42em; color: #fff;
  text-shadow: 0 0 18px rgba(139,124,248,.9), 0 0 42px rgba(139,124,248,.45);
}
.hermes-boot .hud-top b span { color: var(--violet-hot); }

.hermes-boot canvas.net {
  width:  min(66vmin, 540px);
  height: min(66vmin, 540px);
  display: block;
}

/* ===== Boot log ===== */
.hermes-boot .log {
  width: min(440px, 86vw);
  height: 108px;
  display: flex; flex-direction: column; justify-content: flex-end;
  gap: 3px;
  font-size: 11px; letter-spacing: .14em;
  color: var(--ink-dim);
}
.hermes-boot .log .line {
  display: flex; align-items: baseline; gap: 8px;
  opacity: 0; transform: translateY(5px);
  animation: hb-rise .28s ease-out forwards;
  white-space: nowrap;
}
.hermes-boot .log .line .txt { color: var(--ink); }
.hermes-boot .log .line .dots {
  flex: 1; min-width: 12px;
  border-bottom: 1px dotted var(--violet-dim);
  transform: translateY(-3px);
}
.hermes-boot .log .line .st { color: var(--violet-hot); }
.hermes-boot .log .line.ok .st { color: var(--ok); text-shadow: 0 0 10px rgba(62,240,138,.6); }
@keyframes hb-rise { to { opacity: 1; transform: none; } }

/* ===== Progress ===== */
.hermes-boot .progress {
  width: min(440px, 86vw);
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: 18px; row-gap: 8px;
}
.hermes-boot .cells { display: flex; gap: 3px; }
.hermes-boot .cells i {
  flex: 1; height: 12px;
  background: rgba(139,124,248,.10);
  border: 1px solid rgba(139,124,248,.12);
}
.hermes-boot .cells i.on {
  background: var(--violet);
  border-color: var(--violet-hot);
  box-shadow: 0 0 8px rgba(139,124,248,.75);
}
.hermes-boot .cells i.head { animation: hb-blink .5s steps(2) infinite; }
@keyframes hb-blink { 50% { opacity: .35; } }

.hermes-boot .pct {
  font-size: 30px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff; letter-spacing: .04em;
  text-shadow: 0 0 16px rgba(139,124,248,.8);
  min-width: 3.2ch; text-align: right;
}
.hermes-boot .pct small { font-size: 14px; color: var(--violet-hot); }

.hermes-boot .status {
  grid-column: 1 / -1;
  display: flex; justify-content: space-between;
  font-size: 9px; letter-spacing: .3em; text-transform: uppercase;
  color: var(--ink-dim);
}
.hermes-boot .status .state { color: var(--violet-hot); }
.hermes-boot .stage.online .pct { color: var(--ok); text-shadow: 0 0 18px rgba(62,240,138,.8); }
.hermes-boot .stage.online .status .state {
  color: var(--ok); text-shadow: 0 0 10px rgba(62,240,138,.6);
}

@media (prefers-reduced-motion: reduce) {
  .hermes-boot .log .line { animation: none; opacity: 1; transform: none; }
  .hermes-boot .cells i.head { animation: none; }
  .hermes-boot .stage { transition: none; }
}
`;

export function BootLoader({ progress, finish, labels, onDone }: BootLoaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<{ setProgress: (p: number) => void; done: (cb: () => void) => void } | null>(null);
  const labelsRef = useRef<string[]>(labels && labels.length ? labels : DEFAULT_LABELS);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Los labels (proyectos) pueden llegar tarde: se actualiza el ref que lee el
  // draw loop, sin reconstruir el canvas (no reinicia la animación).
  useEffect(() => {
    if (labels && labels.length) labelsRef.current = labels;
  }, [labels]);

  // ── Canvas + loop + API imperativa (se monta una vez) ──────────────────
  useEffect(() => {
    const root = rootRef.current;
    const cv = canvasRef.current;
    if (!root || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- palette ---------- */
    const VIOLET = "139,124,248", BLUE = "95,180,249", HOT = "183,168,255", OK = "62,240,138";

    /* ---------- graph data ---------- */
    const N = 15;
    const nodes: GNode[] = [];
    for (let i = 0; i < N; i++) {
      nodes.push({
        idx: i,
        r: .34 + .58 * (i / (N - 1)) + Math.random() * .06,   // orbit radius (unit)
        speed: (.10 + Math.random() * .16) * (reduced ? 0 : 1),
        phase: Math.random() * Math.PI * 2,
        tilt: .30 + Math.random() * .18,                       // ellipse squash
        size: 2.4 + Math.random() * 2.2,
        color: Math.random() < .6 ? BLUE : VIOLET,
        spawnAt: 6 + (i / (N - 1)) * 80,                       // progress threshold
        born: -1,
      });
    }
    // a few node-to-node cross links, appear late
    const links: GLink[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.random() * N) | 0;
      let b = (Math.random() * N) | 0;
      if (b === a) b = (b + 3) % N;
      links.push({ a, b, spawnAt: 42 + i * 8, born: -1 });
    }
    const pulses: Pulse[] = [];

    /* ---------- boot log ---------- */
    const BOOT = [
      { at: 4,   txt: "INICIANDO NÚCLEO HERMES",            st: "OK", ok: false },
      { at: 22,  txt: "MONTANDO RED DE AGENTES",            st: "OK", ok: false },
      { at: 45,  txt: "SINCRONIZANDO MEMORIA · 609 NODOS",  st: "OK", ok: false },
      { at: 62,  txt: "ENLAZANDO PROYECTOS · 12 ACTIVOS",   st: "OK", ok: false },
      { at: 80,  txt: "CALIBRANDO CANAL DE VOZ",            st: "OK", ok: false },
      { at: 100, txt: "SISTEMA ONLINE",                     st: "●",  ok: true },
    ];

    /* ---------- dom ---------- */
    const q = <T extends Element>(sel: string) => root.querySelector(sel) as T | null;
    const stage = q<HTMLElement>('[data-boot="stage"]')!;
    const logEl = q<HTMLElement>('[data-boot="log"]')!;
    const pctEl = q<HTMLElement>('[data-boot="pct"]')!;
    const stateEl = q<HTMLElement>('[data-boot="state"]')!;
    const pbar = q<HTMLElement>('[data-boot="pbar"]')!;
    const cellsEl = q<HTMLElement>('[data-boot="cells"]')!;
    const CELLS = 28;
    const cells = [...cellsEl.children] as HTMLElement[]; // los 28 <i> vienen del markup
    const fontFamily = getComputedStyle(root).fontFamily;

    /* ---------- canvas ---------- */
    let W = 0, H = 0;
    function fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = cv!.getBoundingClientRect();
      W = rect.width; H = rect.height;
      cv!.width = W * dpr; cv!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", fit);
    fit();

    /* ---------- state ---------- */
    let target = 0, shown = 0;
    let t0 = performance.now(), tPrev = t0, clock = 0;
    let logIdx = 0, doneAt = 0, phase: "boot" | "hold" = "boot";
    let finishing = false;
    let rafId = 0;
    let doneT1 = 0, doneT2 = 0;

    function project(n: GNode, time: number) {
      const a = n.phase + time * n.speed;
      const R = Math.min(W, H) * .46 * n.r;
      return {
        x: W / 2 + Math.cos(a) * R,
        y: H / 2 + Math.sin(a) * R * n.tilt + Math.sin(n.phase * 3 + time * .2) * 4,
        z: Math.sin(a),   // -1 back … +1 front
      };
    }
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const grow = (born: number, time: number, dur: number) =>
      born < 0 ? 0 : ease(Math.min(1, (time - born) / dur));

    function draw(time: number) {
      ctx!.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;

      // spawn according to progress
      for (const n of nodes) if (n.born < 0 && shown >= n.spawnAt) n.born = time;
      for (const l of links) if (l.born < 0 && shown >= l.spawnAt) l.born = time;

      const pos = nodes.map((n) => project(n, time));

      // edges core->node
      nodes.forEach((n, i) => {
        const g = grow(n.born, time, .5);
        if (!g) return;
        const p = pos[i];
        const ex = cx + (p.x - cx) * g, ey = cy + (p.y - cy) * g;
        ctx!.strokeStyle = `rgba(${VIOLET},${(.10 + .16 * (p.z + 1) / 2).toFixed(3)})`;
        ctx!.lineWidth = 1;
        ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.lineTo(ex, ey); ctx!.stroke();
      });
      // cross links
      for (const l of links) {
        const g = grow(l.born, time, .6);
        if (!g) continue;
        const a = pos[l.a], b = pos[l.b];
        ctx!.strokeStyle = `rgba(${BLUE},${(.10 * g).toFixed(3)})`;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(a.x + (b.x - a.x) * g, a.y + (b.y - a.y) * g);
        ctx!.stroke();
      }

      // pulses travelling core -> node
      if (!reduced) {
        for (const n of nodes) {
          if (n.born >= 0 && Math.random() < .006) {
            pulses.push({ i: n.idx, t: 0 });
          }
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.t += .028;
          if (p.t >= 1) { pulses.splice(i, 1); continue; }
          const q2 = pos[p.i];
          const x = cx + (q2.x - cx) * p.t, y = cy + (q2.y - cy) * p.t;
          ctx!.fillStyle = `rgba(${HOT},${(.9 * (1 - p.t)).toFixed(3)})`;
          ctx!.shadowColor = `rgba(${VIOLET},.9)`; ctx!.shadowBlur = 8;
          ctx!.beginPath(); ctx!.arc(x, y, 1.6, 0, 7); ctx!.fill();
          ctx!.shadowBlur = 0;
        }
      }

      // nodes, painter's order (back first)
      const order = nodes.map((n, i) => i).sort((a, b) => pos[a].z - pos[b].z);
      for (const i of order) {
        const n = nodes[i], p = pos[i];
        const g = grow(n.born, time, .45);
        if (!g) continue;
        const depth = (p.z + 1) / 2;                      // 0 back … 1 front
        const rad = n.size * (0.65 + 0.65 * depth) * g;
        const alpha = .35 + .65 * depth;
        ctx!.shadowColor = `rgba(${n.color},.9)`;
        ctx!.shadowBlur = 10 + 8 * depth;
        ctx!.fillStyle = `rgba(${n.color},${alpha.toFixed(3)})`;
        ctx!.beginPath(); ctx!.arc(p.x, p.y, rad, 0, 7); ctx!.fill();
        ctx!.shadowBlur = 0;
        const label = labelsRef.current[n.idx];
        if (label && depth > .62 && g > .9 && shown > 30) {
          ctx!.font = "600 8px " + fontFamily;
          ctx!.fillStyle = `rgba(207,201,234,${(.5 * depth).toFixed(3)})`;
          ctx!.fillText(label, p.x + rad + 4, p.y + 2.5);
        }
      }

      // core
      const coreG = ease(Math.min(1, shown / 8));
      if (coreG > 0) {
        if (!reduced) {                                   // sonar rings
          const ring = (time % 1.4) / 1.4;
          ctx!.strokeStyle = `rgba(${VIOLET},${(.5 * (1 - ring)).toFixed(3)})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath(); ctx!.arc(cx, cy, 12 + ring * 52, 0, 7); ctx!.stroke();
        }
        const breathe = 1 + (reduced ? 0 : Math.sin(time * 2.4) * .08);
        ctx!.shadowColor = `rgba(${VIOLET},1)`; ctx!.shadowBlur = 26;
        ctx!.fillStyle = phase === "boot" ? `rgba(${HOT},.95)` : `rgba(${OK},.95)`;
        ctx!.beginPath(); ctx!.arc(cx, cy, 7.5 * coreG * breathe, 0, 7); ctx!.fill();
        ctx!.shadowBlur = 0;
        ctx!.strokeStyle = `rgba(${VIOLET},.5)`;
        ctx!.beginPath(); ctx!.arc(cx, cy, 13 * coreG, 0, 7); ctx!.stroke();
      }
    }

    /* ---------- ui sync ---------- */
    function syncUI() {
      const p = Math.round(shown);
      pctEl.innerHTML = p + "<small>%</small>";
      pbar.setAttribute("aria-valuenow", String(p));
      const on = Math.round(p / 100 * CELLS);
      cells.forEach((c, i) => {
        c.className = i < on ? (i === on - 1 && p < 100 ? "on head" : "on") : "";
      });
      while (logIdx < BOOT.length && shown >= BOOT[logIdx].at) {
        const b = BOOT[logIdx++];
        const line = document.createElement("div");
        line.className = "line" + (b.ok ? " ok" : "");
        line.innerHTML = `<span>&gt;</span><span class="txt">${b.txt}</span><span class="dots"></span><span class="st">${b.st}</span>`;
        logEl.appendChild(line);
      }
      if (shown >= 100 && phase === "boot") {
        phase = "hold"; doneAt = clock;
        stage.classList.add("online");
        stateEl.textContent = "SISTEMA ONLINE";
      } else if (phase === "boot") {
        stateEl.textContent = shown < 40 ? "INICIANDO…" : shown < 80 ? "SINCRONIZANDO…" : "CASI LISTO…";
      }
    }

    /* ---------- main loop ---------- */
    function frame(now: number) {
      const dt = Math.min(.05, (now - tPrev) / 1000);
      tPrev = now; clock = (now - t0) / 1000;

      if (reduced) {
        shown = target;                       // sin lerp: refleja el progreso real
      } else {
        shown += (target - shown) * (1 - Math.exp(-dt * 9));
        if (target >= 100 && shown > 99.4) shown = 100;
      }

      draw(reduced ? 12 : clock);   // frozen time = static composition
      syncUI();
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    /* ---------- API imperativa (la conduce BootGate) ---------- */
    apiRef.current = {
      setProgress(p: number) {
        if (finishing) return;
        target = Math.max(target, Math.max(0, Math.min(100, p))); // monótono
      },
      done(cb: () => void) {
        finishing = true; target = 100;
        doneT1 = window.setTimeout(() => {
          stage.classList.add("out");
          doneT2 = window.setTimeout(() => cb && cb(), 550);
        }, 900);
      },
    };

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", fit);
      clearTimeout(doneT1);
      clearTimeout(doneT2);
      apiRef.current = null;
    };
  }, []);

  // Progreso real → target (monótono; ignorado una vez que done() arrancó).
  useEffect(() => {
    apiRef.current?.setProgress(progress);
  }, [progress]);

  // Completar una sola vez cuando la carga real terminó.
  const finishedRef = useRef(false);
  useEffect(() => {
    if (finish && !finishedRef.current && apiRef.current) {
      finishedRef.current = true;
      apiRef.current.done(() => onDoneRef.current());
    }
  }, [finish]);

  return (
    <div className="hermes-boot" ref={rootRef} aria-label="Arranque de Hermes OS">
      <style>{CSS}</style>
      <div className="grid-bg" />
      <div className="vignette" />

      <div className="stage" data-boot="stage">
        <div className="hud-top">
          <b>HERMES <span>OS</span></b>
          <span>BOOT SEQ · v5.0</span>
        </div>

        <canvas className="net" ref={canvasRef} aria-hidden="true" />

        <div className="log" data-boot="log" role="status" aria-live="polite" />

        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          aria-label="Progreso de arranque"
          data-boot="pbar"
        >
          <div className="cells" data-boot="cells">
            {Array.from({ length: 28 }).map((_, i) => (
              <i key={i} />
            ))}
          </div>
          <div className="pct" data-boot="pct">0<small>%</small></div>
          <div className="status">
            <span>RED DE AGENTES</span>
            <span className="state" data-boot="state">INICIANDO…</span>
          </div>
        </div>
      </div>

      <div className="scanlines" />
      <div className="frame"><i /><i /><i /><i /></div>
    </div>
  );
}
