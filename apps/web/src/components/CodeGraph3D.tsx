"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { CodeGraph3D as CodeGraphData } from "@hermes/shared";
import { getCodeGraph3D } from "@/lib/hermes";
import { readToken } from "@/components/ui/tones";
import { PanelState } from "@/components/ui/PanelState";
import { useGraphHands } from "@/hooks/useGraphHands";
import { useGestureControl } from "@/state/GestureControlProvider";
import { claimHands, releaseHands } from "@/lib/gestures/hand-owner";
import type { GraphGestureDecision } from "@/lib/gestures/graph-engine";

/**
 * Grafo de código de graphify en WebGL real (three.js, mismas skills y
 * branding que KnowledgeGraph: violeta/cian, bloom contenido, fondo espacial):
 *  - ~3k nodos como UNA InstancedMesh (un draw call) y ~6k aristas como UN
 *    LineSegments additive — el bloom los enciende sin costo extra.
 *  - Layout determinista por comunidades Louvain: cada comunidad es un
 *    cúmulo esférico (Fibonacci volumétrico, dios-nodo al centro) y las
 *    comunidades orbitan el núcleo en capas (las grandes más adentro).
 *  - OrbitControls: arrastrar orbita, scroll hace zoom, auto-rotación en
 *    reposo. Hover = tooltip con archivo/comunidad; clic = enfoca la
 *    comunidad (el resto se apaga); clic al vacío limpia.
 *  - El loop se auto-pausa cuando el tab está oculto (display:none → w=0):
 *    navegar no desmonta las vistas, pero no debe quemar GPU en background.
 */

interface HoverInfo {
  label: string;
  communityName: string;
  file: string | null;
  degree: number;
}

interface SelComm {
  id: number;
  name: string;
  count: number;
}

// Hash determinista → [0,1): posiciones y colores estables entre sesiones.
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

/** Color de comunidad: paleta cian→violeta del branding, nunca amber/red. */
function communityColor(key: number): THREE.Color {
  const h = (192 + hash01(`h${key}`, 3) * 92) / 360;
  const s = 0.62 + hash01(`s${key}`, 5) * 0.22;
  const l = 0.58 + hash01(`l${key}`, 7) * 0.12;
  return new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);
}

/**
 * Layout determinista: comunidades ordenadas por tamaño sobre capas
 * esféricas (grandes → cerca del núcleo), miembros en relleno volumétrico
 * de Fibonacci con el nodo de mayor grado al centro del cúmulo.
 */
function computeLayout(data: CodeGraphData): Float32Array {
  const buckets = new Map<number, number[]>();
  data.nodes.forEach((n, i) => {
    const arr = buckets.get(n.community);
    if (arr) arr.push(i);
    else buckets.set(n.community, [i]);
  });
  const comms = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
  // Dirección sobre la esfera por permutación de hash, NO por rango de tamaño:
  // la espiral de Fibonacci recorre de polo a polo y ordenarla por tamaño
  // apilaba las comunidades grandes en el polo sur (grafo cabezón).
  const dirIdx = comms
    .map((_, i) => i)
    .sort((a, b) => hash01(`o${comms[a][0]}`, 13) - hash01(`o${comms[b][0]}`, 13));
  const dirOf = new Map<number, number>();
  dirIdx.forEach((rank, dir) => dirOf.set(rank, dir));
  const pos = new Float32Array(data.nodes.length * 3);
  comms.forEach(([key, members], ci) => {
    const t = comms.length <= 1 ? 0 : ci / (comms.length - 1);
    const shell = 0.85 + t * 0.75 + (hash01(`c${key}`, 11) - 0.5) * 0.18;
    const [cx, cy, cz] = spherePoint(dirOf.get(ci)!, comms.length, shell);
    const sorted = [...members].sort((a, b) => data.nodes[b].degree - data.nodes[a].degree);
    const r = 0.05 + 0.024 * Math.sqrt(sorted.length);
    sorted.forEach((idx, j) => {
      if (j === 0 && sorted.length > 2) {
        pos.set([cx, cy, cz], idx * 3);
        return;
      }
      const id = data.nodes[idx].id;
      const [dx, dy, dz] = spherePoint(j, sorted.length, 1);
      const rr = r * Math.cbrt((j + 0.5) / sorted.length);
      pos.set(
        [
          cx + dx * rr + (hash01(id, 1) - 0.5) * r * 0.3,
          cy + dy * rr + (hash01(id, 2) - 0.5) * r * 0.3,
          cz + dz * rr + (hash01(id, 3) - 0.5) * r * 0.3,
        ],
        idx * 3,
      );
    });
  });
  return pos;
}

/** Sprite de etiqueta HUD (canvas → textura, siempre encara la cámara). */
function makeLabel(
  text: string,
  opts: { size: number; color: string; font: string },
): THREE.Sprite {
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
  ctx.shadowColor = "#05060f";
  ctx.shadowBlur = 6;
  ctx.fillStyle = opts.color;
  ctx.fillText(text, w / 2, h / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const unit = 0.0016;
  sprite.scale.set(w * unit, h * unit, 1);
  return sprite;
}

export function CodeGraph3D({ project }: { project?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<CodeGraphData | null>(null);
  const [failed, setFailed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selComm, setSelComm] = useState<SelComm | null>(null);
  const sceneApi = useRef<{
    zoomBy: (f: number) => void;
    clearSelection: () => void;
    orbitBy: (dx: number, dy: number) => void;
    /** Puntero virtual de las manos en coords [0,1] del wrap → hover real. */
    setVirtualPointer: (nx: number, ny: number) => void;
    clearVirtualPointer: () => void;
    /** Clic virtual (tap de pinza): mismo efecto que el clic del mouse. */
    clickAt: (nx: number, ny: number) => void;
  } | null>(null);

  // ── Datos (una vez por repo) ──────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    getCodeGraph3D(project)
      .then((g) => alive && setData(g))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [project]);

  // ── Escena three.js (se construye cuando llega el grafo) ──────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !data?.available || data.nodes.length === 0) return;

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
      label: readToken("--color-text", "#e2e7ff"),
      line: "#7a84ff",
    };
    const displayFont =
      getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() ||
      "sans-serif";

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "absolute inset-0 h-full w-full";
    renderer.domElement.style.touchAction = "none";
    // prepend: el canvas queda DEBAJO de los overlays de React (z-10).
    wrap.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR.bg);
    scene.fog = new THREE.FogExp2(new THREE.Color(COLOR.bg).getHex(), 0.05);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);
    camera.position.set(1.9, 1.15, 3.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 1.1;
    controls.maxDistance = 10;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.5;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const onInteract = () => {
      controls.autoRotate = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controls.autoRotate = !reduceMotion;
      }, 4000);
    };
    controls.addEventListener("start", onInteract);

    // Bloom CONTENIDO (branding): acento violeta/cian, nunca white-out.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.35, 0.55);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ── Decorado espacial ────────────────────────────────────────────────
    const starCount = 640;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const [x, y, z] = spherePoint(i, starCount, 4.6 + hash01(String(i), 7) * 5);
      starPos.set([x, y, z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: new THREE.Color(COLOR.line),
      size: 0.016,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Anillo orbital exterior + núcleo wireframe que respira.
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLOR.line),
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.0022, 8, 180), ringMat);
    ring.rotation.x = Math.PI / 2.2;
    ring.rotation.y = 0.4;
    scene.add(ring);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 20, 14),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR.core),
        wireframe: true,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
    );
    scene.add(halo);

    // ── Grafo: nodos instanciados + aristas en un LineSegments ──────────
    const graph = new THREE.Group();
    scene.add(graph);

    const positions = computeLayout(data);
    const N = data.nodes.length;

    // Colores base por comunidad (cacheados: 200+ comunidades, 3k nodos).
    const commColor = new Map<number, THREE.Color>();
    const colorOf = (community: number): THREE.Color => {
      let c = commColor.get(community);
      if (!c) {
        c = communityColor(community);
        commColor.set(community, c);
      }
      return c;
    };
    const baseColors = new Float32Array(N * 3);
    const maxDegree = data.nodes.reduce((m, n) => Math.max(m, n.degree), 1);
    data.nodes.forEach((n, i) => {
      const c = colorOf(n.community).clone();
      // Los dios-nodos brillan un poco más (el bloom los recoge primero).
      if (n.degree > maxDegree * 0.35) c.lerp(new THREE.Color("#ffffff"), 0.18);
      baseColors.set([c.r, c.g, c.b], i * 3);
    });

    const nodeGeo = new THREE.IcosahedronGeometry(1, 1);
    const nodeMat = new THREE.MeshBasicMaterial();
    const inst = new THREE.InstancedMesh(nodeGeo, nodeMat, N);
    const m4 = new THREE.Matrix4();
    const tmpColor = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = 0.01 + 0.005 * Math.sqrt(data.nodes[i].degree);
      m4.makeScale(r, r, r);
      m4.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, tmpColor.fromArray(baseColors, i * 3));
    }
    inst.instanceMatrix.needsUpdate = true;
    graph.add(inst);

    const L = data.links.length;
    const linePos = new Float32Array(L * 6);
    const lineBase = new Float32Array(L * 6);
    data.links.forEach((l, i) => {
      linePos.set(
        [
          positions[l.s * 3],
          positions[l.s * 3 + 1],
          positions[l.s * 3 + 2],
          positions[l.t * 3],
          positions[l.t * 3 + 1],
          positions[l.t * 3 + 2],
        ],
        i * 6,
      );
      const ca = colorOf(data.nodes[l.s].community);
      const cb = colorOf(data.nodes[l.t].community);
      lineBase.set([ca.r, ca.g, ca.b, cb.r, cb.g, cb.b], i * 6);
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute("color", new THREE.BufferAttribute(lineBase.slice(), 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    graph.add(lines);

    // Etiquetas de los dios-nodos (top por grado; el resto vive en el tooltip).
    const topIdx = data.nodes
      .map((n, i) => i)
      .sort((a, b) => data.nodes[b].degree - data.nodes[a].degree)
      .slice(0, 12);
    const labels: THREE.Sprite[] = [];
    for (const i of topIdx) {
      const sprite = makeLabel(data.nodes[i].label.toUpperCase(), {
        size: 10,
        color: COLOR.label,
        font: displayFont,
      });
      const r = 0.01 + 0.005 * Math.sqrt(data.nodes[i].degree);
      sprite.position.set(positions[i * 3], positions[i * 3 + 1] - r - 0.05, positions[i * 3 + 2]);
      labels.push(sprite);
      graph.add(sprite);
    }
    // Núcleo: nombre del repo al centro (dato real, no decoración).
    const coreLabel = makeLabel(data.project.toUpperCase(), {
      size: 15,
      color: COLOR.core,
      font: displayFont,
    });
    graph.add(coreLabel);

    // ── Foco por comunidad + hover (repintado por instancia) ────────────
    let selected: number | null = null;
    let hovered: number | null = null;
    // Contadores de QA: cuántos clics (mouse o tap de pinza) y qué golpearon.
    let qaClicks = 0;
    let qaLastHit: number | null = null;

    const paintNodes = () => {
      for (let i = 0; i < N; i++) {
        tmpColor.fromArray(baseColors, i * 3);
        const related = selected === null || data.nodes[i].community === selected;
        if (!related) tmpColor.multiplyScalar(0.12);
        if (i === hovered) tmpColor.lerp(new THREE.Color("#ffffff"), 0.45);
        inst.setColorAt(i, tmpColor);
      }
      inst.instanceColor!.needsUpdate = true;
    };
    const paintLinks = () => {
      const attr = lineGeo.getAttribute("color") as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      for (let i = 0; i < L; i++) {
        const l = data.links[i];
        const on =
          selected === null ||
          data.nodes[l.s].community === selected ||
          data.nodes[l.t].community === selected;
        const f = on ? 1 : 0.05;
        for (let k = 0; k < 6; k++) out[i * 6 + k] = lineBase[i * 6 + k] * f;
      }
      attr.needsUpdate = true;
    };

    const commCount = new Map<number, number>();
    for (const n of data.nodes) commCount.set(n.community, (commCount.get(n.community) ?? 0) + 1);
    const commName = (id: number) => data.communities[String(id)] ?? `Comunidad ${id}`;

    const applySelection = (community: number | null) => {
      selected = community;
      paintNodes();
      paintLinks();
      setSelComm(
        community === null
          ? null
          : {
              id: community,
              name: commName(community),
              count: commCount.get(community) ?? 0,
            },
      );
    };
    // ── Tamaño ───────────────────────────────────────────────────────────
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

    // ── Interacción: hover (tooltip) + clic (foco de comunidad) ─────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerInside = false;
    let pointerDirty = false;
    let downAt: { x: number; y: number } | null = null;

    const toNdc = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      // El tooltip sigue al puntero sin pasar por React (60hz sin re-render).
      const tip = tooltipRef.current;
      if (tip) {
        const x = Math.min(e.clientX - rect.left + 14, rect.width - 180);
        const y = Math.min(e.clientY - rect.top + 14, rect.height - 70);
        tip.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    const nodeHit = (): number | null => {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(inst, false)[0];
      return hit?.instanceId ?? null;
    };
    const onPointerMove = (e: PointerEvent) => {
      pointerInside = true;
      pointerDirty = true;
      toNdc(e);
    };
    const onPointerLeave = () => {
      pointerInside = false;
      if (hovered !== null) {
        hovered = null;
        paintNodes();
        setHover(null);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      // Solo cuenta como clic si apenas se movió (si no, fue un orbit-drag).
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
      toNdc(e);
      const hit = nodeHit();
      qaClicks++;
      qaLastHit = hit;
      if (hit !== null) {
        const community = data.nodes[hit].community;
        applySelection(community === selected ? null : community);
      } else if (selected !== null) {
        applySelection(null);
      }
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // ── API para overlays y manos (botones ± y gestos de pinza) ─────────
    // Sensibilidad de órbita: radianes por encuadre completo de mano — calca
    // la sensación del drag de OrbitControls (2π por alto de viewport).
    const ORBIT_GAIN = 2.6;
    const sph = new THREE.Spherical();
    sceneApi.current = {
      zoomBy: (f: number) => {
        const offset = camera.position.clone().sub(controls.target);
        const d = Math.min(
          controls.maxDistance,
          Math.max(controls.minDistance, offset.length() * f),
        );
        camera.position.copy(controls.target).add(offset.setLength(d));
        onInteract();
      },
      clearSelection: () => applySelection(null),
      orbitBy: (dx: number, dy: number) => {
        // Mismo mapeo que el drag de OrbitControls: theta -= dx, phi -= dy.
        const offset = camera.position.clone().sub(controls.target);
        sph.setFromVector3(offset);
        sph.theta -= dx * ORBIT_GAIN;
        sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, sph.phi - dy * ORBIT_GAIN));
        camera.position.copy(controls.target).add(offset.setFromSpherical(sph));
        onInteract();
      },
      setVirtualPointer: (nx: number, ny: number) => {
        pointer.x = nx * 2 - 1;
        pointer.y = -(ny * 2 - 1);
        pointerInside = true;
        pointerDirty = true;
        // Apuntar con la mano pausa la auto-rotación: sin esto el grafo se
        // desliza bajo el cursor y el tap llega unos píxeles tarde.
        onInteract();
        const tip = tooltipRef.current;
        if (tip) {
          const w = wrap.clientWidth;
          const h = wrap.clientHeight;
          tip.style.transform = `translate(${Math.min(nx * w + 14, w - 180)}px, ${Math.min(ny * h + 14, h - 70)}px)`;
        }
      },
      clearVirtualPointer: () => {
        pointerInside = false;
        if (hovered !== null) {
          hovered = null;
          paintNodes();
          setHover(null);
        }
      },
      clickAt: (nx: number, ny: number) => {
        // El tap selecciona PRIMERO el nodo en hover: es lo que el tooltip le
        // está mostrando al usuario, y la posición filtrada de la mano llega
        // rezagada respecto de donde el hover realmente encendió. Sin hover
        // (tap sin apuntar antes), raycast puntual como el mouse.
        pointer.x = nx * 2 - 1;
        pointer.y = -(ny * 2 - 1);
        const hit = hovered ?? nodeHit();
        qaClicks++;
        qaLastHit = hit;
        if (hit !== null) {
          const community = data.nodes[hit].community;
          applySelection(community === selected ? null : community);
        } else if (selected !== null) {
          applySelection(null);
        }
      },
    };

    // QA (Playwright no ve WebGL): estado de cámara y clics legible de afuera.
    const qaWindow = window as Window & {
      __hermesGraphDebug?: () => {
        distance: number;
        azimuth: number;
        polar: number;
        clicks: number;
        lastHit: number | null;
        hovered: number | null;
        selected: number | null;
      };
    };
    qaWindow.__hermesGraphDebug = () => {
      const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      return {
        distance: s.radius,
        azimuth: s.theta,
        polar: s.phi,
        clicks: qaClicks,
        lastHit: qaLastHit,
        hovered,
        selected,
      };
    };

    // ── Loop ─────────────────────────────────────────────────────────────
    let raf = 0;
    let t = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      // Tab oculto (display:none): las vistas no se desmontan al navegar,
      // pero no hay que renderizar a un canvas de 0×0.
      if (wrap.clientWidth === 0) return;
      t += 0.016;

      // Arranque: el grafo "asienta" escalando con ease-out (sin teleport).
      const boot = reduceMotion ? 1 : 1 - 0.3 * Math.exp(-t * 2.4);
      graph.scale.setScalar(boot);
      lineMat.opacity = 0.13 * Math.min(1, t / 1.1);

      if (!reduceMotion) {
        stars.rotation.y += 0.00022;
        ring.rotation.z += 0.0008;
        halo.rotation.y += 0.0018;
      }
      (halo.material as THREE.MeshBasicMaterial).opacity = reduceMotion
        ? 0.14
        : 0.1 + Math.sin(t * 1.3) * 0.05;

      // Hover: raycast solo cuando el puntero se movió (no cada frame).
      if (pointerInside && pointerDirty) {
        pointerDirty = false;
        const hit = nodeHit();
        if (hit !== hovered) {
          hovered = hit;
          paintNodes();
          renderer.domElement.style.cursor = hit !== null ? "pointer" : "grab";
          setHover(
            hit === null
              ? null
              : {
                  label: data.nodes[hit].label,
                  communityName: commName(data.nodes[hit].community),
                  file: data.nodes[hit].file,
                  degree: data.nodes[hit].degree,
                },
          );
        }
      }

      controls.update();
      composer.render();
    };
    raf = requestAnimationFrame(step);

    // ── Limpieza total (dispose de GPU) ─────────────────────────────────
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
      for (const s of [...labels, coreLabel]) {
        s.material.map?.dispose();
        s.material.dispose();
      }
      nodeGeo.dispose();
      nodeMat.dispose();
      inst.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      ring.geometry.dispose();
      ringMat.dispose();
      halo.geometry.dispose();
      (halo.material as THREE.Material).dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      delete qaWindow.__hermesGraphDebug;
      sceneApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  // ── Manos: pinza = agarrar/orbitar · dos pinzas = zoom · abierta = hover ──
  const sysGestures = useGestureControl();
  const handLayerRef = useRef<HTMLDivElement>(null);
  const handModeRef = useRef<HTMLSpanElement>(null);
  const hadCursorRef = useRef(false);
  const stopHandsRef = useRef<() => void>(() => {});

  const onHandDecision = useCallback((d: GraphGestureDecision) => {
    const wrap = wrapRef.current;
    // Salir del tab con las manos activas apaga la cámara: privacidad primero
    // y nada de manipular un grafo que no se ve.
    if (wrap && wrap.clientWidth === 0) {
      stopHandsRef.current();
      return;
    }
    // Dots de feedback por DOM directo: rAF-rate sin re-render de React.
    const layer = handLayerRef.current;
    if (layer) {
      for (let i = 0; i < 2; i++) {
        const dot = layer.children[i] as HTMLElement | undefined;
        if (!dot) continue;
        const hand = d.hands[i];
        if (!hand) {
          dot.style.opacity = "0";
          continue;
        }
        dot.style.opacity = "1";
        dot.style.left = `${hand.x * 100}%`;
        dot.style.top = `${hand.y * 100}%`;
        dot.style.borderColor = hand.pinching ? "#f43f5e" : "#22d3ee";
        dot.style.transform = `translate(-50%, -50%) scale(${hand.pinching ? 0.72 : 1})`;
      }
    }
    const modeEl = handModeRef.current;
    if (modeEl) {
      modeEl.textContent =
        d.mode === "orbit"
          ? "AGARRE"
          : d.mode === "zoom"
            ? "ZOOM"
            : d.mode === "cursor"
              ? "CURSOR"
              : "SIN MANO";
    }
    const api = sceneApi.current;
    if (d.orbit) api?.orbitBy(d.orbit.dx, d.orbit.dy);
    if (d.zoom !== null) api?.zoomBy(d.zoom);
    if (d.click) api?.clickAt(d.click.x, d.click.y);
    if (d.cursor) {
      api?.setVirtualPointer(d.cursor.x, d.cursor.y);
      hadCursorRef.current = true;
    } else if (hadCursorRef.current && d.hands.length === 0) {
      // El hover SOBREVIVE a la pinza (cerrar la mano no debe soltar el nodo
      // que el tooltip está mostrando — el tap lo selecciona); solo se limpia
      // cuando la mano sale del encuadre.
      hadCursorRef.current = false;
      api?.clearVirtualPointer();
    }
  }, []);
  const hands = useGraphHands(onHandDecision);
  stopHandsRef.current = hands.stop;
  const handsOn = hands.phase === "tracking" || hands.phase === "starting";

  // Exclusión mutua con el control por gestos del SISTEMA (cursor del Mac):
  // dos motores interpretando la misma pinza = doble acción.
  useEffect(() => {
    if (sysGestures.active) stopHandsRef.current();
  }, [sysGestures.active]);

  const toggleHands = () => {
    if (handsOn) {
      releaseHands("graph");
      hands.stop();
    } else if (!sysGestures.active) {
      // Apaga las manos de la UI global si estaban: un solo dueño de la pinza.
      claimHands("graph", hands.stop);
      void hands.start();
    }
  };

  if (failed) {
    return <PanelState kind="offline" hint="El agente local no responde" />;
  }
  if (data && !data.available) {
    return (
      <PanelState
        kind="empty"
        title="Sin grafo de código"
        hint="graphify aún no indexó este repo — corre `graphify extract . --code-only` o espera al job code-graph-update"
      />
    );
  }
  if (!data) {
    return <PanelState kind="loading" title="Cargando grafo de código" />;
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-bg">
      {/* Tooltip del nodo bajo el puntero (posicionado fuera de React) */}
      <div
        ref={tooltipRef}
        className={`pointer-events-none absolute left-0 top-0 z-10 max-w-64 border border-line bg-panel/90 px-2.5 py-1.5 backdrop-blur transition-opacity ${hover ? "opacity-100" : "opacity-0"}`}
      >
        {hover && (
          <>
            <p className="text-xs font-medium text-text">{hover.label}</p>
            <p className="mt-0.5 text-2xs tracking-label text-cyan uppercase">
              {hover.communityName}
            </p>
            <p className="mt-0.5 truncate text-2xs text-text-dim">
              {hover.file ?? "—"} · {hover.degree} conexiones
            </p>
          </>
        )}
      </div>

      {/* Cursores de mano: cian = abierta · rojo = pinza cerrada */}
      <div ref={handLayerRef} className="pointer-events-none absolute inset-0 z-10">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="absolute h-4 w-4 rounded-full border-2 opacity-0 transition-opacity duration-150"
            style={{ borderColor: "#22d3ee", transform: "translate(-50%, -50%)" }}
          />
        ))}
      </div>

      {/* Comunidad enfocada */}
      {selComm && (
        <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-2 border border-line bg-panel/90 px-3 py-1.5 backdrop-blur">
          <span className="text-2xs tracking-label text-violet uppercase">{selComm.name}</span>
          <span className="text-2xs text-text-dim tabular-nums">{selComm.count} nodos</span>
          <button
            type="button"
            aria-label="Quitar foco de comunidad"
            onClick={() => sceneApi.current?.clearSelection()}
            className="text-2xs text-text-dim transition-colors hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      {/* Leyenda + hints */}
      <div className="pointer-events-none absolute bottom-2 left-0 right-0 z-10 flex flex-col items-center gap-1">
        <span className="text-2xs tracking-hero text-text-dim uppercase">
          Grafo de código · {data.project}
        </span>
        <span className="text-2xs tracking-label text-text-faint tabular-nums uppercase">
          {data.nodes.length.toLocaleString("es-CO")} nodos ·{" "}
          {data.links.length.toLocaleString("es-CO")} aristas ·{" "}
          {Object.keys(data.communities).length || "?"} comunidades · color = comunidad · tamaño =
          conexiones
        </span>
      </div>
      <div className="pointer-events-none absolute left-2 top-2 z-10 text-2xs leading-relaxed tracking-hero uppercase text-text-dim">
        <div>arrastra · orbita</div>
        <div>scroll · zoom</div>
        <div>clic · enfoca comunidad</div>
        {handsOn && (
          <>
            <div className="mt-1 text-cyan">pinza rápida · clic</div>
            <div className="text-cyan">pinza sostenida · agarra</div>
            <div className="text-cyan">2 pinzas · zoom</div>
            <div className="text-cyan">
              ✋ <span ref={handModeRef}>SIN MANO</span>
            </div>
          </>
        )}
        {hands.error && (
          <div className="mt-1 max-w-56 tracking-normal normal-case text-red">{hands.error}</div>
        )}
      </div>

      {/* Controles: manos + fullscreen + zoom ± */}
      {/* bottom-right: arriba a la derecha vive el orbe de voz flotante */}
      <div className="absolute bottom-2 right-2 z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label={handsOn ? "Apagar control por manos" : "Control por manos"}
          title={
            sysGestures.active
              ? "Apaga el control por gestos del sistema para usar las manos aquí"
              : "Manos: pinza = agarrar · dos pinzas = zoom"
          }
          onClick={toggleHands}
          disabled={sysGestures.active}
          className={`flex h-6 w-6 items-center justify-center border bg-panel text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            handsOn
              ? "border-cyan text-cyan"
              : "border-line text-text-dim hover:bg-panel-2 hover:text-cyan"
          }`}
        >
          {hands.phase === "starting" ? "···" : "✋"}
        </button>
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
