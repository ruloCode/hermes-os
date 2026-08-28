"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { Memory, ProjectStatus } from "@hermes/shared";
import { readToken } from "@/components/ui/tones";

/**
 * Red de conocimiento en WebGL real (three.js, guiado por las skills
 * threejs-fundamentals/materials/postprocessing/interaction):
 *  - CORE al centro con halo y anillos; proyectos (cian) en capa esférica
 *    interior; memorias (violeta) en cono alrededor de su proyecto.
 *  - Materiales emissive + UnrealBloomPass → el glow es del render, no un truco.
 *  - OrbitControls: arrastra para orbitar, SCROLL para zoom, con damping.
 *  - Raycasting: clic en un proyecto lo enfoca (toggle); clic al vacío limpia.
 *  - Fullscreen nativo (⛶) con la misma escena, re-dimensionada en vivo.
 * La física de resortes hacia el objetivo se conserva del grafo anterior:
 * los nodos "asientan" al reconstruirse en vez de teletransportarse.
 */

interface GraphNode {
  id: string;
  kind: "core" | "project" | "memory";
  slug: string | null;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  label: THREE.Sprite | null;
  // Física (posición actual = mesh.position; objetivo + velocidad aquí).
  tx: number;
  ty: number;
  tz: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  phase: number;
  linkTo: string | null;
}

// Hash determinista id→[0,1): fija jitter/fase por nodo para que la estructura
// no salte cuando se reconstruye el grafo al cambiar los datos.
function hash01(s: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

// Punto i de N repartido parejo sobre una esfera (espiral de Fibonacci).
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
function spherePoint(i: number, n: number, r: number): [number, number, number] {
  const y = ((i + 0.5) / n) * 2 - 1;
  const ry = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * GOLDEN;
  return [Math.cos(theta) * ry * r, y * r, Math.sin(theta) * ry * r];
}

const R_PROJ = 0.62;
const R_MEM = 1.02;

/** Sprite de etiqueta: texto HUD dibujado a canvas → textura (siempre encara
 *  la cámara; depthWrite off para no tapar nodos). */
function makeLabel(text: string, opts: { size: number; color: string; font: string }): THREE.Sprite {
  const pad = 12;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `600 ${opts.size * 2}px ${opts.font}, sans-serif`; // ×2 = nitidez retina
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = opts.size * 2 + pad * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "3px";
  // Glow sutil: suficiente para despegar del fondo, sin emborronar el texto.
  ctx.shadowColor = "#05060f";
  ctx.shadowBlur = 6;
  ctx.fillStyle = opts.color;
  ctx.fillText(text, w / 2, h / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  // Escala en unidades de mundo proporcional al texto (constante ~legible).
  const unit = 0.0016;
  sprite.scale.set(w * unit, h * unit, 1);
  return sprite;
}

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Refs para que el loop (deps []) lea props frescas sin re-montar la escena.
  const workingRef = useRef(working);
  workingRef.current = working;
  const selectedRef = useRef<string | null>(selectedProject ?? null);
  selectedRef.current = selectedProject ?? null;
  const onSelectRef = useRef(onSelectProject);
  onSelectRef.current = onSelectProject;
  // API de la escena viva, para que el effect de datos reconstruya los nodos.
  const sceneApi = useRef<{
    rebuild: (projects: ProjectStatus[], memories: Memory[]) => void;
    zoomBy: (f: number) => void;
  } | null>(null);
  const dataRef = useRef({ projects, memories });
  dataRef.current = { projects, memories };

  // ── Escena three.js (una vez) ─────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reduceMotion = mq?.matches ?? false;
    const onMotionChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
      controls.autoRotate = !e.matches;
    };
    mq?.addEventListener?.("change", onMotionChange);

    // Tokens del design system (three no resuelve var(--…)).
    const COLOR = {
      bg: readToken("--color-bg", "#05060f"),
      core: readToken("--color-violet-hot", "#c4b5fd"),
      // Azul tranquilo del branding (no el cian eléctrico): con el bloom
      // encima, el cian saturado gritaba y las etiquetas no se leían.
      project: readToken("--color-blue", "#60a5fa"),
      memory: readToken("--color-violet", "#a78bfa"),
      label: readToken("--color-text", "#e2e7ff"),
      line: "#7a84ff",
    };
    const rootStyles = getComputedStyle(document.documentElement);
    const displayFont = rootStyles.getPropertyValue("--font-display").trim() || "sans-serif";

    // Renderer + escena + cámara (skill: fundamentals).
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "absolute inset-0 h-full w-full";
    renderer.domElement.style.touchAction = "none";
    // prepend: el canvas queda DEBAJO de los overlays de React (leyenda,
    // hints y botones), que además llevan z-10.
    wrap.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR.bg);
    scene.fog = new THREE.FogExp2(COLOR.bg, 0.075);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
    camera.position.set(0.9, 0.9, 3.4);

    // Luces: ambiente tenue + punto violeta en el core → los lados no emisivos
    // de las esferas ganan volumen (skill: lighting).
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const coreLight = new THREE.PointLight(new THREE.Color(COLOR.core), 2.5, 8, 1.6);
    scene.add(coreLight);

    // Controles: orbitar con arrastre + ZOOM CON SCROLL, con damping y
    // auto-rotación suave en reposo (skill: interaction).
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 1.5;
    controls.maxDistance = 9;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.55;
    // Pausa la auto-rotación al interactuar; vuelve tras unos segundos quieta.
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const onInteract = () => {
      controls.autoRotate = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controls.autoRotate = !reduceMotion;
      }, 4000);
    };
    controls.addEventListener("start", onInteract);

    // Post-proceso: bloom real sobre los materiales emissive (skill:
    // postprocessing — composer.render() en vez de renderer.render()).
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Bloom CONTENIDO: acento de marca, no white-out — los nodos deben leerse
    // violeta/cian (branding HUD), nunca reventar a blanco.
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.35, 0.55);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ── Decorado fijo ────────────────────────────────────────────────────
    // Campo de partículas de fondo: profundidad y "aire" alrededor de la red.
    const starCount = 420;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const [x, y, z] = spherePoint(i, starCount, 4.2 + hash01(String(i), 7) * 5);
      starPos.set([x, y, z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: new THREE.Color(COLOR.line),
      size: 0.016,
      transparent: true,
      opacity: 0.38,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Anillos orbitales del core (uno ecuatorial, uno inclinado).
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLOR.line),
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
    });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.0022, 8, 160), ringMat);
    ring1.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.0016, 8, 160), ringMat.clone());
    ring2.rotation.x = Math.PI / 2.6;
    ring2.rotation.y = 0.6;
    scene.add(ring1, ring2);

    // Halo del core: esfera wireframe tenue que respira.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 20, 14),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR.core),
        wireframe: true,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    scene.add(halo);

    // Anillo de selección (billboard): marca el proyecto en foco.
    const selRing = new THREE.Mesh(
      new THREE.RingGeometry(1.35, 1.5, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR.project),
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    selRing.visible = false;
    scene.add(selRing);

    // ── Nodos + enlaces (reconstruibles al cambiar los datos) ────────────
    const graph = new THREE.Group();
    scene.add(graph);
    const sphereGeo = new THREE.SphereGeometry(1, 28, 20); // unitaria, se escala
    let nodes: GraphNode[] = [];
    let links: { line: THREE.LineSegments; pairs: [GraphNode, GraphNode][] } | null = null;

    const disposeNode = (n: GraphNode) => {
      n.mesh.material.dispose();
      if (n.label) {
        n.label.material.map?.dispose();
        n.label.material.dispose();
      }
    };

    const rebuild = (projs: ProjectStatus[], mems: Memory[]) => {
      // Preserva posición/velocidad de los nodos que sobreviven al rebuild.
      const prev = new Map(nodes.map((n) => [n.id, n]));
      for (const n of nodes) disposeNode(n);
      graph.clear();
      if (links) {
        links.line.geometry.dispose();
        (links.line.material as THREE.Material).dispose();
        links = null;
      }
      nodes = [];

      const addNode = (
        id: string,
        kind: GraphNode["kind"],
        target: [number, number, number],
        r: number,
        colorHex: string,
        emissiveIntensity: number,
        linkTo: string | null,
        labelText?: string,
      ) => {
        const color = new THREE.Color(colorHex);
        const material = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity,
          roughness: 0.5,
          metalness: 0.1,
          transparent: true,
          opacity: 1,
        });
        const mesh = new THREE.Mesh(sphereGeo, material);
        mesh.scale.setScalar(r);
        const old = prev.get(id);
        if (old) {
          mesh.position.copy(old.mesh.position);
        } else {
          mesh.position.set(target[0] * 0.6, target[1] * 0.6, target[2] * 0.6);
        }
        mesh.userData.nodeId = id;
        let label: THREE.Sprite | null = null;
        if (labelText) {
          // Etiquetas en color de TEXTO (no en el color del nodo): legibles
          // sobre el fondo oscuro sin competir con el glow del nodo.
          label = makeLabel(labelText, {
            size: kind === "core" ? 15 : 11,
            color: COLOR.label,
            font: displayFont,
          });
          graph.add(label);
        }
        const node: GraphNode = {
          id,
          kind,
          slug: kind === "project" ? id.slice(2) : null,
          mesh,
          label,
          tx: target[0],
          ty: target[1],
          tz: target[2],
          vx: old?.vx ?? 0,
          vy: old?.vy ?? 0,
          vz: old?.vz ?? 0,
          r,
          phase: hash01(id) * Math.PI * 2,
          linkTo,
        };
        graph.add(mesh);
        nodes.push(node);
        return node;
      };

      addNode("core", "core", [0, 0, 0], 0.15, COLOR.core, 0.85, null, "HERMES");

      const active = projs.filter((p) => p.estado === "activo");
      const projDir = new Map<string, [number, number, number]>();
      active.forEach((p, i) => {
        const [x, y, z] = spherePoint(i, active.length, R_PROJ);
        const len = Math.hypot(x, y, z) || 1;
        projDir.set(`p:${p.slug}`, [x / len, y / len, z / len]);
        addNode(`p:${p.slug}`, "project", [x, y, z], 0.055, COLOR.project, 0.7, "core", p.name.toUpperCase());
      });

      mems.slice(0, 40).forEach((m, i) => {
        const projectNode = m.project_slug ? `p:${m.project_slug}` : null;
        const anchor = projectNode && projDir.has(projectNode) ? projectNode : "core";
        let t: [number, number, number];
        const dir = anchor !== "core" ? projDir.get(anchor)! : null;
        if (dir) {
          // Cono alrededor de la dirección del proyecto: dir + jitter renormalizado.
          const j = 0.55;
          const dx = dir[0] + (hash01(m.id, 1) - 0.5) * j;
          const dy = dir[1] + (hash01(m.id, 2) - 0.5) * j;
          const dz = dir[2] + (hash01(m.id, 3) - 0.5) * j;
          const len = Math.hypot(dx, dy, dz) || 1;
          t = [(dx / len) * R_MEM, (dy / len) * R_MEM, (dz / len) * R_MEM];
        } else {
          t = spherePoint(i, 40, R_MEM);
        }
        addNode(`m:${m.id}`, "memory", t, 0.016 + (m.importance ?? 3) * 0.004, COLOR.memory, 0.55, anchor);
      });

      // Enlaces como un solo LineSegments (additive: el bloom los enciende).
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const pairs: [GraphNode, GraphNode][] = [];
      for (const n of nodes) {
        const to = n.linkTo ? byId.get(n.linkTo) : null;
        if (to) pairs.push([n, to]);
      }
      const positions = new Float32Array(pairs.length * 6);
      const colors = new Float32Array(pairs.length * 6);
      pairs.forEach(([a, b], i) => {
        const ca = (a.mesh.material as THREE.MeshStandardMaterial).color;
        const cb = (b.mesh.material as THREE.MeshStandardMaterial).color;
        colors.set([ca.r, ca.g, ca.b, cb.r, cb.g, cb.b], i * 6);
      });
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      lineGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const line = new THREE.LineSegments(
        lineGeo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      graph.add(line);
      links = { line, pairs };
    };
    sceneApi.current = {
      rebuild,
      zoomBy: (f: number) => {
        // Zoom programático (botones ±): escala la distancia al target con los
        // mismos límites del control.
        const offset = camera.position.clone().sub(controls.target);
        const d = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * f));
        camera.position.copy(controls.target).add(offset.setLength(d));
      },
    };
    rebuild(dataRef.current.projects, dataRef.current.memories);

    // ── Tamaño (contenedor y fullscreen) ─────────────────────────────────
    const resize = () => {
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ── Interacción: hover + clic (raycasting, skill: interaction) ──────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerInside = false;
    let downAt: { x: number; y: number } | null = null;

    const toNdc = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const projectHit = (): GraphNode | null => {
      raycaster.setFromCamera(pointer, camera);
      const meshes = nodes.filter((n) => n.kind === "project").map((n) => n.mesh);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit) return null;
      return nodes.find((n) => n.mesh === hit.object) ?? null;
    };
    const onPointerMove = (e: PointerEvent) => {
      pointerInside = true;
      toNdc(e);
    };
    const onPointerLeave = () => {
      pointerInside = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      // Solo cuenta como clic si apenas se movió (si no, fue un orbit-drag).
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
      toNdc(e);
      const hit = projectHit();
      const cur = selectedRef.current;
      if (hit?.slug) onSelectRef.current?.(hit.slug === cur ? null : hit.slug);
      else if (cur) onSelectRef.current?.(null);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // ── Loop ─────────────────────────────────────────────────────────────
    let raf = 0;
    let t = 0;
    const step = () => {
      t += 0.016;
      const selected = selectedRef.current;
      const wob = reduceMotion ? 0 : 0.02;

      let selNode: GraphNode | null = null;
      for (const n of nodes) {
        // Física: resorte hacia el objetivo + wobble orbital + amortiguación.
        if (n.kind !== "core") {
          const wx = Math.sin(t * 0.5 + n.phase) * wob;
          const wy = Math.cos(t * 0.42 + n.phase * 1.3) * wob;
          const wz = Math.sin(t * 0.36 + n.phase * 0.7) * wob;
          const p = n.mesh.position;
          n.vx += (n.tx + wx - p.x) * 0.02;
          n.vy += (n.ty + wy - p.y) * 0.02;
          n.vz += (n.tz + wz - p.z) * 0.02;
          n.vx *= 0.86;
          n.vy *= 0.86;
          n.vz *= 0.86;
          p.set(p.x + n.vx, p.y + n.vy, p.z + n.vz);
        }

        // Foco: el subgrafo del proyecto elegido brilla, el resto se apaga.
        const isSelProj = n.kind === "project" && selected != null && n.slug === selected;
        const isRelated =
          selected == null ||
          isSelProj ||
          n.kind === "core" ||
          (n.kind === "memory" && n.linkTo === `p:${selected}`);
        if (isSelProj) selNode = n;

        const mat = n.mesh.material;
        mat.opacity = isRelated ? 1 : 0.16;
        const base = n.kind === "core" ? 0.85 : n.kind === "project" ? 0.7 : 0.55;
        mat.emissiveIntensity = (isRelated ? base : base * 0.25) * (isSelProj ? 1.4 : 1);

        // Pulso: el core late (rápido si Hermes trabaja); el resto respira.
        const pulse = reduceMotion
          ? 1
          : n.kind === "core"
            ? 1 + Math.sin(t * (workingRef.current ? 6 : 1.6)) * 0.07
            : 1 + Math.sin(t * 1.2 + n.phase) * 0.06;
        n.mesh.scale.setScalar(n.r * pulse * (isSelProj ? 1.45 : 1));

        // Etiqueta bajo el nodo, siempre encarando cámara (sprite).
        if (n.label) {
          n.label.position.set(
            n.mesh.position.x,
            n.mesh.position.y - n.r * 2.2 - 0.06,
            n.mesh.position.z,
          );
          n.label.material.opacity = isRelated ? 1 : 0.25;
        }
      }

      // Enlaces siguen a los nodos.
      if (links) {
        const pos = links.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        links.pairs.forEach(([a, b], i) => {
          pos.setXYZ(i * 2, a.mesh.position.x, a.mesh.position.y, a.mesh.position.z);
          pos.setXYZ(i * 2 + 1, b.mesh.position.x, b.mesh.position.y, b.mesh.position.z);
        });
        pos.needsUpdate = true;
      }

      // Decorado vivo.
      if (!reduceMotion) {
        ring1.rotation.z += 0.0009;
        ring2.rotation.z -= 0.0012;
        stars.rotation.y += 0.00025;
        halo.rotation.y += 0.002;
      }
      const haloMat = halo.material as THREE.MeshBasicMaterial;
      haloMat.opacity = reduceMotion ? 0.16 : 0.12 + Math.sin(t * 1.4) * 0.06;
      coreLight.intensity = workingRef.current ? 3.6 + Math.sin(t * 6) * 0.8 : 2.5;

      // Anillo de selección como billboard sobre el proyecto en foco.
      if (selNode) {
        selRing.visible = true;
        const s = selNode.r * 1.5;
        selRing.scale.setScalar(s);
        selRing.position.copy(selNode.mesh.position);
        selRing.quaternion.copy(camera.quaternion);
        (selRing.material as THREE.MeshBasicMaterial).opacity = reduceMotion
          ? 0.7
          : 0.55 + Math.sin(t * 3) * 0.25;
      } else {
        selRing.visible = false;
      }

      // Cursor de mano sobre proyectos (raycast barato: ≤ ~10 esferas).
      if (pointerInside) {
        renderer.domElement.style.cursor = projectHit() ? "pointer" : "grab";
      }

      controls.update();
      composer.render();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    // ── Limpieza total (skill: fundamentals — dispose de GPU) ───────────
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      observer.disconnect();
      mq?.removeEventListener?.("change", onMotionChange);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.removeEventListener("start", onInteract);
      controls.dispose();
      for (const n of nodes) disposeNode(n);
      if (links) {
        links.line.geometry.dispose();
        (links.line.material as THREE.Material).dispose();
      }
      sphereGeo.dispose();
      starGeo.dispose();
      starMat.dispose();
      ring1.geometry.dispose();
      ringMat.dispose();
      ring2.geometry.dispose();
      (ring2.material as THREE.Material).dispose();
      halo.geometry.dispose();
      (halo.material as THREE.Material).dispose();
      selRing.geometry.dispose();
      (selRing.material as THREE.Material).dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconstruir nodos cuando cambian los datos (la escena sigue viva).
  useEffect(() => {
    sceneApi.current?.rebuild(projects, memories);
  }, [projects, memories]);

  // ── Fullscreen nativo del wrapper ─────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.requestFullscreen?.();
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full bg-bg">
      <div className="pointer-events-none absolute bottom-2 left-0 right-0 z-10 flex flex-col items-center gap-1">
        <span className="text-2xs tracking-hero text-text-dim">
          RED DE CONOCIMIENTO 3D · {working ? "PROCESANDO…" : "EN REPOSO"}
        </span>
        <div className="flex items-center gap-3 text-2xs tracking-label text-text-dim">
          <span>
            <span className="text-violet-hot">●</span> CORE
          </span>
          <span>
            <span className="text-blue">●</span> PROYECTO
          </span>
          <span>
            <span className="text-violet">●</span> MEMORIA
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute left-2 top-2 z-10 text-2xs leading-relaxed tracking-hero uppercase text-text-dim">
        <div>arrastra · orbita</div>
        <div>scroll · zoom</div>
        <div>clic · enfoca proyecto</div>
      </div>
      {/* Controles: fullscreen + zoom ± (el scroll también hace zoom) */}
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          title={isFullscreen ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}
          onClick={toggleFullscreen}
          className="flex h-6 w-6 items-center justify-center border border-line bg-panel text-xs text-text-dim transition-colors hover:bg-panel-2 hover:text-cyan"
        >
          {isFullscreen ? "✕" : "⛶"}
        </button>
        <button
          type="button"
          aria-label="Acercar"
          title="Acercar (o usa el scroll)"
          onClick={() => sceneApi.current?.zoomBy(0.75)}
          className="flex h-6 w-6 items-center justify-center border border-line bg-panel text-xs text-text-dim transition-colors hover:bg-panel-2 hover:text-text"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Alejar"
          title="Alejar (o usa el scroll)"
          onClick={() => sceneApi.current?.zoomBy(1.33)}
          className="flex h-6 w-6 items-center justify-center border border-line bg-panel text-xs text-text-dim transition-colors hover:bg-panel-2 hover:text-text"
        >
          −
        </button>
      </div>
    </div>
  );
}
