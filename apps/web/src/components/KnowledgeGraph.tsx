"use client";

import { useEffect, useRef } from "react";
import type { Memory, ProjectStatus } from "@hermes/shared";

/**
 * Nodo en espacio 3D. (x,y,z) es la posición actual en coordenadas de mundo
 * centradas en el origen (~[-1,1]); (tx,ty,tz) es el objetivo hacia el que
 * el resorte lo empuja; (vx,vy,vz) la velocidad. El core vive en el origen.
 */
interface Node3D {
  id: string;
  label: string;
  kind: "core" | "project" | "memory";
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  color: string;
  linkTo: string | null;
  phase: number;
}

// Hash determinista id→[0,1): fija el jitter/fase de cada nodo para que la
// estructura no salte cuando se reconstruye el grafo al cambiar los datos.
function hash01(s: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// Punto sobre una esfera de radio R, i-ésimo de N, repartido de forma pareja
// (espiral tipo Fibonacci, evitando acumulación en los polos).
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
function spherePoint(i: number, n: number, r: number): [number, number, number] {
  const y = ((i + 0.5) / n) * 2 - 1; // -1..1
  const ry = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * GOLDEN;
  return [Math.cos(theta) * ry * r, y * r, Math.sin(theta) * ry * r];
}

const R_PROJ = 0.58; // radio de la capa de proyectos
const R_MEM = 0.98; // radio de la capa de memorias
const CAM = 3.0; // distancia de cámara (perspectiva)
const FOCAL = 3.0; // distancia focal → scale≈1 en el plano del origen
const RANGE = 1.0; // |z| máximo aprox para normalizar profundidad

/**
 * Grafo de conocimiento en 3D con canvas puro (sin Three.js): CORE al centro,
 * proyectos (cian) en una capa esférica interior, memorias (violeta) agrupadas
 * en un cono alrededor de su proyecto. Rotación automática + arrastre para
 * orbitar con inercia; proyección en perspectiva con orden por profundidad,
 * y desvanecido/escala/glow según cercanía a la cámara.
 */
export function KnowledgeGraph({
  projects,
  memories,
  working,
  selectedProject,
  onSelectProject,
}: {
  projects: ProjectStatus[];
  memories: Memory[];
  working: boolean;
  selectedProject?: string | null;
  onSelectProject?: (slug: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node3D[]>([]);
  const workingRef = useRef(working);
  workingRef.current = working;
  // Refs para que el loop de animación (deps []) lea props frescas sin re-montar.
  const selectedRef = useRef<string | null>(selectedProject ?? null);
  selectedRef.current = selectedProject ?? null;
  const onSelectRef = useRef(onSelectProject);
  onSelectRef.current = onSelectProject;

  // (Re)construye los nodos y sus objetivos 3D cuando cambian los datos,
  // preservando la posición/velocidad de los que ya existían.
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: Node3D[] = [];

    const add = (n: Node3D) => {
      const old = prev.get(n.id);
      if (old) {
        n.x = old.x;
        n.y = old.y;
        n.z = old.z;
        n.vx = old.vx;
        n.vy = old.vy;
        n.vz = old.vz;
      } else {
        // Aparece cerca de su objetivo para un asentado suave, sin volar desde 0.
        n.x = n.tx * 0.6;
        n.y = n.ty * 0.6;
        n.z = n.tz * 0.6;
      }
      nodes.push(n);
    };

    add({
      id: "core",
      label: "HERMES",
      kind: "core",
      x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, vx: 0, vy: 0, vz: 0,
      r: 19,
      color: "#c4b5fd",
      linkTo: null,
      phase: 0,
    });

    const active = projects.filter((p) => p.estado === "activo");
    // Dirección unitaria de cada proyecto → las memorias se agrupan a su alrededor.
    const projDir = new Map<string, [number, number, number]>();
    active.forEach((p, i) => {
      const [x, y, z] = spherePoint(i, active.length, R_PROJ);
      const len = Math.hypot(x, y, z) || 1;
      projDir.set(`p:${p.slug}`, [x / len, y / len, z / len]);
      add({
        id: `p:${p.slug}`,
        label: p.name.toUpperCase(),
        kind: "project",
        x: 0, y: 0, z: 0,
        tx: x, ty: y, tz: z,
        vx: 0, vy: 0, vz: 0,
        r: 8.5,
        color: "#67e8f9",
        linkTo: "core",
        phase: hash01(p.slug) * Math.PI * 2,
      });
    });

    const mems = memories.slice(0, 24);
    mems.forEach((m, i) => {
      const projectNode = m.project_slug ? `p:${m.project_slug}` : null;
      const anchor = projectNode && projDir.has(projectNode) ? projectNode : "core";
      let tx: number, ty: number, tz: number;
      const dir = anchor !== "core" ? projDir.get(anchor)! : null;
      if (dir) {
        // Cono alrededor de la dirección del proyecto: dir + jitter, renormalizado.
        const j = 0.55;
        const dx = dir[0] + (hash01(m.id, 1) - 0.5) * j;
        const dy = dir[1] + (hash01(m.id, 2) - 0.5) * j;
        const dz = dir[2] + (hash01(m.id, 3) - 0.5) * j;
        const len = Math.hypot(dx, dy, dz) || 1;
        tx = (dx / len) * R_MEM;
        ty = (dy / len) * R_MEM;
        tz = (dz / len) * R_MEM;
      } else {
        // Sin proyecto → repartida en la capa esférica exterior.
        [tx, ty, tz] = spherePoint(i, Math.max(mems.length, 1), R_MEM);
      }
      add({
        id: `m:${m.id}`,
        label: "",
        kind: "memory",
        x: 0, y: 0, z: 0,
        tx, ty, tz,
        vx: 0, vy: 0, vz: 0,
        r: 2.6 + (m.importance ?? 3) * 0.7,
        color: "#a78bfa",
        linkTo: anchor,
        phase: hash01(m.id) * Math.PI * 2,
      });
    });

    nodesRef.current = nodes;
  }, [projects, memories]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // prefers-reduced-motion: honrado en carga Y en vivo (si el usuario lo
    // cambia con la página abierta, el listener actualiza la bandera).
    const mq =
      typeof window !== "undefined"
        ? window.matchMedia?.("(prefers-reduced-motion: reduce)")
        : undefined;
    let reduceMotion = mq?.matches ?? false;
    const onMotionChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
    };
    mq?.addEventListener?.("change", onMotionChange);

    // El setter de fuente del canvas NO resuelve var(--…) de CSS: hay que
    // leer los valores concretos del :root y componer el string a mano.
    const rootStyles = getComputedStyle(document.documentElement);
    const displayFont = rootStyles.getPropertyValue("--font-display").trim() || "sans-serif";
    const monoFont = rootStyles.getPropertyValue("--font-mono").trim() || "monospace";

    let raf = 0;
    let t = 0;

    // Cámara: yaw (giro horizontal) + pitch (inclinación). Inercia al soltar.
    let yaw = 0.5;
    let pitch = -0.35;
    let velYaw = 0;
    let velPitch = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    // Detección de clic (vs arrastre) para seleccionar proyecto.
    let downX = 0;
    let downY = 0;
    let moved = 0;
    // Posiciones en pantalla del último frame → hit-testing del clic.
    let hits: Array<{ kind: string; slug: string | null; sx: number; sy: number; r: number }> = [];

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    // ── Interacción: arrastrar para orbitar ────────────────────────────
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      moved = 0;
      velYaw = 0;
      velPitch = 0;
      canvas.setPointerCapture?.(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.hypot(dx, dy);
      velYaw = dx * 0.005;
      velPitch = dy * 0.005;
      yaw += velYaw;
      pitch += velPitch;
      pitch = Math.max(-1.25, Math.min(1.25, pitch));
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
      canvas.style.cursor = "grab";
      // Movimiento total pequeño → fue un clic, no un arrastre: selecciona.
      if (moved < 6 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        let best: { slug: string | null; d: number } | null = null;
        for (const hit of hits) {
          if (hit.kind !== "project") continue;
          const d = Math.hypot(cx - hit.sx, cy - hit.sy);
          if (d <= hit.r + 10 && (!best || d < best.d)) best = { slug: hit.slug, d };
        }
        const cur = selectedRef.current;
        if (best) onSelectRef.current?.(best.slug === cur ? null : best.slug);
        else if (cur) onSelectRef.current?.(null); // clic en vacío → limpia foco
      }
    };
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onUp);

    // Proyección perspectiva de un punto de mundo → pantalla.
    type Proj = { sx: number; sy: number; scale: number; z: number; df: number };
    const project = (
      x: number, y: number, z: number,
      cy: number, sy: number, cp: number, sp: number,
      w: number, h: number, unit: number,
    ): Proj => {
      // Rotar en Y (yaw)
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      // Rotar en X (pitch)
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const depth = CAM - z2; // > 0 siempre (CAM > radio máximo)
      const scale = FOCAL / depth;
      const df = Math.max(0, Math.min(1, (z2 / RANGE + 1) / 2)); // 0 lejos, 1 cerca
      return {
        sx: w / 2 + x1 * scale * unit,
        sy: h / 2 - y2 * scale * unit,
        scale,
        z: z2,
        df,
      };
    };

    // Anillo ecuatorial (referencia de "globo"): puntos precomputados en XZ.
    const RING = 60;
    const ringAngles = Array.from({ length: RING }, (_, i) => (i / RING) * Math.PI * 2);
    const R_RING = 0.74;

    const step = () => {
      t += 0.016;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const unit = Math.min(w, h) * 0.46;
      const nodes = nodesRef.current;

      // Rotación de cámara: inercia + auto-giro cuando no se arrastra.
      if (!dragging) {
        yaw += velYaw;
        pitch += velPitch;
        pitch = Math.max(-1.25, Math.min(1.25, pitch));
        velYaw *= 0.94;
        velPitch *= 0.94;
        if (!reduceMotion && Math.abs(velYaw) < 0.0015) yaw += 0.0016;
      }
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);

      // Física: resorte hacia el objetivo + leve wobble orbital + amortiguación.
      const wob = reduceMotion ? 0 : 0.02;
      for (const n of nodes) {
        if (n.kind === "core") {
          n.x = 0; n.y = 0; n.z = 0;
          continue;
        }
        const wx = Math.sin(t * 0.5 + n.phase) * wob;
        const wy = Math.cos(t * 0.42 + n.phase * 1.3) * wob;
        const wz = Math.sin(t * 0.36 + n.phase * 0.7) * wob;
        n.vx += (n.tx + wx - n.x) * 0.02;
        n.vy += (n.ty + wy - n.y) * 0.02;
        n.vz += (n.tz + wz - n.z) * 0.02;
        n.vx *= 0.86; n.vy *= 0.86; n.vz *= 0.86;
        n.x += n.vx; n.y += n.vy; n.z += n.vz;
      }

      ctx.clearRect(0, 0, w, h);

      // ── Anillo ecuatorial (detrás de todo, muy tenue, con profundidad) ──
      ctx.lineWidth = 1;
      for (let i = 0; i < RING; i++) {
        const a0 = ringAngles[i];
        const a1 = ringAngles[(i + 1) % RING];
        const p0 = project(Math.cos(a0) * R_RING, 0, Math.sin(a0) * R_RING, cy, sy, cp, sp, w, h, unit);
        const p1 = project(Math.cos(a1) * R_RING, 0, Math.sin(a1) * R_RING, cy, sy, cp, sp, w, h, unit);
        const df = (p0.df + p1.df) / 2;
        ctx.strokeStyle = `rgba(122,132,255,${0.02 + df * 0.09})`;
        ctx.beginPath();
        ctx.moveTo(p0.sx, p0.sy);
        ctx.lineTo(p1.sx, p1.sy);
        ctx.stroke();
      }

      // Proyectar todos los nodos una vez.
      const proj = new Map<string, Proj>();
      for (const n of nodes) {
        proj.set(n.id, project(n.x, n.y, n.z, cy, sy, cp, sp, w, h, unit));
      }

      // ── Enlaces (detrás de los nodos) ──
      for (const n of nodes) {
        if (!n.linkTo) continue;
        const a = proj.get(n.id);
        const b = proj.get(n.linkTo);
        if (!a || !b) continue;
        const df = (a.df + b.df) / 2;
        const grad = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
        const alphaA = Math.round((0.06 + df * 0.16) * 255).toString(16).padStart(2, "0");
        const alphaB = Math.round((0.12 + df * 0.28) * 255).toString(16).padStart(2, "0");
        grad.addColorStop(0, `${n.color}${alphaA}`);
        grad.addColorStop(1, `${nodeColor(nodes, n.linkTo)}${alphaB}`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = (n.kind === "project" ? 1.1 : 0.6) * a.scale;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      // ── Nodos: ordenados de lejos a cerca (painter's algorithm) ──
      const selected = selectedRef.current;
      const order = [...nodes].sort((n1, n2) => proj.get(n1.id)!.z - proj.get(n2.id)!.z);
      hits = []; // se repuebla cada frame para el hit-testing del clic
      for (const n of order) {
        const p = proj.get(n.id)!;
        // Foco: el proyecto seleccionado y sus memorias quedan brillantes; el
        // resto se atenúa para destacar el subgrafo elegido.
        const isSelProj = n.kind === "project" && selected != null && n.id === `p:${selected}`;
        const isRelated =
          selected == null ||
          isSelProj ||
          n.kind === "core" ||
          (n.kind === "memory" && n.linkTo === `p:${selected}`);
        const dim = isRelated ? 1 : 0.22;

        const pulse = reduceMotion
          ? 1
          : n.kind === "core"
            ? 1 + Math.sin(t * (workingRef.current ? 6 : 1.6)) * 0.09
            : 1 + Math.sin(t * 1.2 + n.phase) * 0.09;
        const radius = Math.max(0.6, n.r * p.scale * pulse * (isSelProj ? 1.4 : 1));

        if (n.kind === "project") {
          hits.push({ kind: "project", slug: n.id.slice(2), sx: p.sx, sy: p.sy, r: radius });
        }

        ctx.save();
        ctx.globalAlpha = (n.kind === "memory" ? 0.35 + p.df * 0.55 : 0.5 + p.df * 0.5) * dim;
        ctx.shadowColor = n.color;
        ctx.shadowBlur =
          (n.kind === "core" ? 32 : n.kind === "project" ? 17 : 8) *
          (0.45 + p.df * 0.55) *
          (isSelProj ? 1.5 : 1);
        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Anillo de selección del proyecto en foco.
        if (isSelProj) {
          ctx.save();
          ctx.strokeStyle = `rgba(103,232,249,${0.5 + (reduceMotion ? 0.15 : Math.sin(t * 3) * 0.25)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, radius + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Halo del core (billboard, encara la cámara).
        if (n.kind === "core") {
          ctx.strokeStyle = `rgba(196,181,253,${reduceMotion ? 0.22 : 0.22 + Math.sin(t * 2) * 0.1})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, radius * 1.9 + (reduceMotion ? 0 : Math.sin(t * 1.4) * 3), 0, Math.PI * 2);
          ctx.stroke();
        }

        // Etiquetas: core siempre; proyecto en foco siempre; resto si está al frente.
        if (n.label && (n.kind === "core" || isSelProj || p.df > 0.32)) {
          ctx.save();
          ctx.globalAlpha =
            (n.kind === "core" || isSelProj ? 1 : Math.min(1, (p.df - 0.2) * 1.6)) *
            (isRelated ? 1 : 0.4);
          ctx.font =
            n.kind === "core"
              ? `700 12px ${displayFont}, sans-serif`
              : `600 9px ${monoFont}, monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = isSelProj ? "#a9f0fb" : n.kind === "core" ? "#e4defe" : "#9aa4e0";
          ctx.shadowColor = n.color;
          ctx.shadowBlur = 8;
          ctx.letterSpacing = "2px";
          ctx.fillText(n.label, p.sx, p.sy + radius + 14);
          ctx.restore();
        }
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onUp);
      mq?.removeEventListener?.("change", onMotionChange);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div
        className="pointer-events-none absolute bottom-2 left-0 right-0 flex items-center justify-center gap-3 text-[9px] tracking-[0.35em]"
        style={{ color: "var(--text-dim)" }}
      >
        <span>RED DE CONOCIMIENTO 3D · {working ? "PROCESANDO…" : "EN REPOSO"}</span>
      </div>
      <div
        className="pointer-events-none absolute right-2 top-2 text-right text-[9px] leading-relaxed tracking-[0.3em] uppercase"
        style={{ color: "var(--text-dim)" }}
      >
        <div>arrastra para orbitar</div>
        <div>clic en un proyecto para enfocar</div>
      </div>
    </div>
  );
}

// Color del nodo destino de un enlace (para el degradado del link).
function nodeColor(nodes: Node3D[], id: string): string {
  return nodes.find((n) => n.id === id)?.color ?? "#67e8f9";
}
