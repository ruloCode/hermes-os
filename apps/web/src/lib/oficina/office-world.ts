// Mundo three.js de la Oficina de agentes: piso, un pod de escritorios por
// proyecto, un personaje por sesión viva con su laptop, cámara orbital y clic.
// Sin React: la página lo crea una vez por tema y le habla por métodos
// (setLayout, setWorkers, setSelected, focus). Cada frame proyecta el centro
// de cada pod a pantalla para que las etiquetas HTML de los proyectos lo sigan
// (texto nítido y con el tema), igual que la Sala.
//
// Look de agent-office (AgentSystemLabs, MIT): toon con rampa de 3 pasos,
// OutlineEffect para el contorno de caricatura y sin tone mapping (ACES lava
// los colores planos). Los colores salen del tema (palette.ts).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import type { OfficeLayout, OfficeWorker } from "@hermes/shared";
import { buildDesk, buildPodRug, type DeskView } from "./desk";
import { Confetti } from "./confetti";
import { Laptop } from "./laptop";
import { OfficeCharacter } from "./worker";
import { setToonFont, toon } from "./toon";
import type { OfficePalette } from "./palette";

/** Desde dónde mira la cámara al encuadrar: de frente y en picada suave. */
const FRAME_DIR = new THREE.Vector3(0, 0.62, 0.78).normalize();

export type OfficeHit = { kind: "worker"; id: string } | { kind: "desk"; id: string };

export interface PodAnchor {
  project: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface OfficeWorldHooks {
  onPods?: (anchors: PodAnchor[]) => void;
  onHover?: (hit: OfficeHit | null) => void;
  onClick?: (hit: OfficeHit | null) => void;
}

interface Seated {
  status?: OfficeWorker["status"];
  character: OfficeCharacter;
  laptop: Laptop;
  deskId: string | null;
  leaving: boolean;
}

/** Planos y materiales básicos no llevan contorno (se verían como marcos gruesos). */
function noOutline(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry;
    const flat = geo instanceof THREE.PlaneGeometry || geo instanceof THREE.CircleGeometry || geo instanceof THREE.ShapeGeometry;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (flat || mat instanceof THREE.MeshBasicMaterial) mat.userData.outlineParameters = { visible: false };
  });
}

function hexToRgbArray(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export class OfficeWorld {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly effect: OutlineEffect;
  private readonly controls: OrbitControls;
  private readonly container: HTMLElement;
  private readonly hooks: OfficeWorldHooks;
  private readonly palette: OfficePalette;
  private readonly desks = new Map<string, DeskView>();
  private readonly seated = new Map<string, Seated>();
  private readonly rugs: THREE.Mesh[] = [];
  private layout: OfficeLayout | null = null;
  private podColor = new Map<string, string>();
  private readonly observer: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly floorMesh: THREE.Mesh;
  private readonly confetti: Confetti;
  private readonly disposables: { dispose(): void }[] = [];
  private raf = 0;
  private running = false;
  private last = performance.now();
  private t = 0;
  private downAt: { x: number; y: number } | null = null;
  private hovered: OfficeHit | null = null;
  private selected: OfficeHit | null = null;
  private focusGoal: { target: THREE.Vector3; dist: number } | null = null;
  private framed = false;
  private frames = 0;
  private fpsAt = performance.now();
  fps = 0;

  constructor(container: HTMLElement, palette: OfficePalette, hooks: OfficeWorldHooks = {}) {
    this.container = container;
    this.palette = palette;
    this.hooks = hooks;
    setToonFont(palette.font);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "absolute inset-0 h-full w-full";
    renderer.domElement.style.touchAction = "none";
    container.prepend(renderer.domElement);
    this.renderer = renderer;
    this.effect = new OutlineEffect(renderer, { defaultThickness: 0.0032, defaultColor: hexToRgbArray(palette.outline) });

    const bg = new THREE.Color(palette.bg);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 55, 110);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camera.position.set(0, 20, 26);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 70;
    this.controls.screenSpacePanning = false;
    // Si el humano mueve la cámara, se cancela cualquier encuadre automático.
    this.controls.addEventListener("start", () => (this.focusGoal = null));

    // ── Luz: la de agent-office, algo más baja en el tema oscuro ──────────
    const dark = palette.dark;
    const hemi = new THREE.HemisphereLight("#fff5e6", new THREE.Color(palette.floor), dark ? 1.15 : 1.5);
    const ambient = new THREE.AmbientLight("#ffffff", dark ? 0.35 : 0.5);
    const sun = new THREE.DirectionalLight("#fff1d6", dark ? 1.7 : 2.2);
    sun.position.set(-10, 26, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 90 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    this.scene.add(hemi, ambient, sun, sun.target);
    this.sun = sun;

    const floorMat = toon(palette.floor);
    this.floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
    this.disposables.push(this.floorMesh.geometry);

    const grid = new THREE.GridHelper(120, 120, new THREE.Color(palette.grid), new THREE.Color(palette.grid));
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = dark ? 0.1 : 0.14;
    gridMat.depthWrite = false;
    grid.position.y = 0.003;
    this.scene.add(grid);
    this.disposables.push(grid.geometry, gridMat);
    // El confeti cae sobre los escritorios o el piso.
    this.confetti = new Confetti((x, z) => {
      for (const v of this.desks.values()) {
        const dx = x - v.desk.x;
        const dz = z - v.desk.z;
        if (Math.abs(dx) < 1.1 && Math.abs(dz) < 0.55) return 0.8;
      }
      return 0;
    }, [palette.accent, ...palette.skins, palette.bulb.working, palette.bulb.done, "#ffffff"]);
    this.scene.add(this.confetti.mesh);
    noOutline(this.scene);

    const el = renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerleave", this.onLeave);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private readonly sun: THREE.DirectionalLight;

  // ── Planta ─────────────────────────────────────────────────────────────

  /** Construye/actualiza los escritorios (solo toca los que cambian) y los tapetes de los pods. */
  setLayout(layout: OfficeLayout) {
    this.layout = layout;
    this.podColor = new Map(layout.pods.map((p, i) => [p.project, this.palette.skins[i % this.palette.skins.length]]));
    const want = new Map(layout.desks.map((d) => [d.id, d]));
    for (const [id, view] of this.desks) {
      const d = want.get(id);
      if (d && d.x === view.desk.x && d.z === view.desk.z && d.rotY === view.desk.rotY) continue;
      // Quien estaba sentado aquí se desengancha antes de liberar el escritorio.
      for (const s of this.seated.values()) {
        if (s.deskId !== id) continue;
        s.character.root.removeFromParent();
        s.laptop.root.removeFromParent();
        s.deskId = null;
      }
      this.scene.remove(view.group);
      view.dispose();
      this.desks.delete(id);
    }
    layout.desks.forEach((d, i) => {
      if (this.desks.has(d.id)) return;
      const view = buildDesk(d, i, this.palette);
      noOutline(view.group);
      this.scene.add(view.group);
      this.desks.set(d.id, view);
    });

    for (const r of this.rugs) {
      this.scene.remove(r);
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    this.rugs.length = 0;
    for (const pod of layout.pods) {
      const rug = buildPodRug(pod, this.podColor.get(pod.project) ?? this.palette.accent, this.palette);
      noOutline(rug);
      this.scene.add(rug);
      this.rugs.push(rug);
    }

    const f = layout.floor;
    const w = f.maxX - f.minX + 40;
    const d = f.maxZ - f.minZ + 40;
    this.floorMesh.scale.set(w, d, 1);
    this.floorMesh.position.set((f.minX + f.maxX) / 2, 0, (f.minZ + f.maxZ) / 2);
    this.sun.target.position.set((f.minX + f.maxX) / 2, 0, (f.minZ + f.maxZ) / 2);
    this.sun.position.set(this.sun.target.position.x - 10, 26, this.sun.target.position.z + 14);
    this.refreshVacancies();
  }

  /** Encuadra los pods donde hay alguien trabajando; si no hay nadie, toda la planta. */
  frameAll(animate = true) {
    const layout = this.layout;
    if (!layout) return;
    const busy = new Set<string>();
    for (const s of this.seated.values()) {
      const d = s.deskId && !s.leaving ? this.desks.get(s.deskId) : undefined;
      if (d) busy.add(d.desk.project);
    }
    const pods = busy.size ? layout.pods.filter((p) => busy.has(p.project)) : layout.pods;
    const xs = pods.flatMap((p) => p.desks.map((d) => d.x));
    const zs = pods.map((p) => p.z);
    const f = {
      minX: Math.min(...xs) - 2.5,
      maxX: Math.max(...xs) + 2.5,
      minZ: Math.min(...zs) - 3,
      maxZ: Math.max(...zs) + 3,
    };
    const center = new THREE.Vector3((f.minX + f.maxX) / 2, 0, (f.minZ + f.maxZ) / 2);
    const dist = this.fitDistance(center, f);
    if (!animate) {
      this.controls.target.copy(center);
      this.camera.position.copy(center).add(FRAME_DIR.clone().multiplyScalar(dist));
      this.controls.update();
      return;
    }
    this.focusGoal = { target: center, dist };
  }

  /**
   * Distancia mínima (desde la dirección de encuadre) a la que caben en
   * pantalla las esquinas del rectángulo, con altura para las tarjetas. Se
   * prueba en vez de estimar: la perspectiva agranda lo que queda adelante.
   */
  private fitDistance(center: THREE.Vector3, f: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
    const cam = this.camera.clone();
    const corners: THREE.Vector3[] = [];
    for (const x of [f.minX, f.maxX]) for (const z of [f.minZ, f.maxZ]) for (const y of [0, 2.4]) corners.push(new THREE.Vector3(x, y, z));
    const p = new THREE.Vector3();
    let dist = 8;
    for (let i = 0; i < 40 && dist < this.controls.maxDistance; i++) {
      cam.position.copy(center).add(FRAME_DIR.clone().multiplyScalar(dist));
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      const fits = corners.every((c) => {
        p.copy(c).project(cam);
        return Math.abs(p.x) <= 0.9 && p.y <= 0.72 && p.y >= -0.9 && p.z < 1;
      });
      if (fits) break;
      dist *= 1.07;
    }
    return Math.min(dist, this.controls.maxDistance);
  }

  /** Acerca la cámara a un escritorio o personaje. */
  focus(hit: OfficeHit) {
    const deskId = hit.kind === "desk" ? hit.id : this.seated.get(hit.id)?.deskId;
    const view = deskId ? this.desks.get(deskId) : undefined;
    if (!view) return;
    this.focusGoal = { target: new THREE.Vector3(view.desk.x, 0.8, view.desk.z), dist: 7.5 };
  }

  // ── Personajes ─────────────────────────────────────────────────────────

  /** Sienta, actualiza y despide personajes según el estado real. `seats`: workerId → deskId. */
  setWorkers(workers: OfficeWorker[], seats: ReadonlyMap<string, string>) {
    const live = new Set<string>();
    for (const w of workers) {
      const deskId = seats.get(w.id);
      if (!deskId) continue;
      const desk = this.desks.get(deskId);
      if (!desk) continue;
      live.add(w.id);
      let s = this.seated.get(w.id);
      if (s?.leaving) {
        // Volvió el mismo id mientras se iba: es una sesión nueva.
        s.character.root.removeFromParent();
        s.laptop.root.removeFromParent();
        s.character.dispose();
        s.laptop.dispose();
        this.seated.delete(w.id);
        s = undefined;
      }
      if (!s) {
        const character = new OfficeCharacter(w.id, this.podColor.get(w.project) ?? this.palette.accent, this.palette);
        const laptop = new Laptop(this.palette);
        noOutline(character.root);
        noOutline(laptop.root);
        s = { character, laptop, deskId: null, leaving: false };
        this.seated.set(w.id, s);
      }
      if (s.deskId !== deskId) {
        desk.seatAnchor.add(s.character.root);
        desk.laptopAnchor.add(s.laptop.root);
        s.deskId = deskId;
      }
      // Recién terminado (no al cargar la página con uno ya listo): confeti.
      if (w.status === "done" && s.status && s.status !== "done") {
        const at = s.character.root.getWorldPosition(new THREE.Vector3());
        this.confetti.burst(at.x, at.y + 1.3, at.z, 140);
      }
      s.status = w.status;
      s.character.setState(w);
      s.character.setSelected(this.selected?.kind === "worker" && this.selected.id === w.id);
      s.laptop.setLines(w.lines);
    }
    // Primer encuadre: cuando ya se sabe quién está sentado dónde.
    if (!this.framed && this.layout) {
      this.framed = true;
      this.frameAll(false);
    }
    for (const [id, s] of this.seated) {
      if (live.has(id) || s.leaving) continue;
      s.leaving = true;
      s.character.vanish();
      s.laptop.close();
    }
    this.refreshVacancies();
  }

  private refreshVacancies() {
    const occupied = new Set<string>();
    for (const s of this.seated.values()) if (s.deskId) occupied.add(s.deskId);
    for (const [id, view] of this.desks) view.vacancy.visible = !occupied.has(id);
  }

  setSelected(hit: OfficeHit | null) {
    this.selected = hit;
    for (const [id, s] of this.seated) s.character.setSelected(hit?.kind === "worker" && hit.id === id);
  }

  /** Posición en pantalla de un escritorio o personaje (para anclar popovers HTML). */
  screenOf(hit: OfficeHit): { x: number; y: number } | null {
    const deskId = hit.kind === "desk" ? hit.id : this.seated.get(hit.id)?.deskId;
    const view = deskId ? this.desks.get(deskId) : undefined;
    if (!view) return null;
    this.tmp.set(view.desk.x, 1.2, view.desk.z).project(this.camera);
    if (this.tmp.z > 1) return null;
    return { x: ((this.tmp.x + 1) / 2) * this.container.clientWidth, y: ((1 - this.tmp.y) / 2) * this.container.clientHeight };
  }

  // ── Puntero ────────────────────────────────────────────────────────────

  private hitAt(clientX: number, clientY: number): OfficeHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const workerBoxes: THREE.Object3D[] = [];
    for (const s of this.seated.values()) if (!s.leaving && s.deskId) workerBoxes.push(s.character.hitbox);
    const w = this.raycaster.intersectObjects(workerBoxes, false)[0];
    if (w) return { kind: "worker", id: w.object.userData.workerId as string };
    const deskBoxes = [...this.desks.values()].map((d) => d.hitbox);
    const d = this.raycaster.intersectObjects(deskBoxes, false)[0];
    if (d) {
      const deskId = d.object.userData.deskId as string;
      // Un escritorio ocupado se lee como su personaje.
      for (const [id, s] of this.seated) if (s.deskId === deskId && !s.leaving) return { kind: "worker", id };
      return { kind: "desk", id: deskId };
    }
    return null;
  }

  private onDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    const down = this.downAt;
    this.downAt = null;
    // Un arrastre (orbitar) no es un clic.
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    this.hooks.onClick?.(this.hitAt(e.clientX, e.clientY));
  };

  private onMove = (e: PointerEvent) => {
    if (this.downAt) return;
    const hit = this.hitAt(e.clientX, e.clientY);
    const same = hit?.kind === this.hovered?.kind && hit?.id === this.hovered?.id;
    if (same) return;
    this.hovered = hit;
    this.renderer.domElement.style.cursor = hit ? "pointer" : "";
    this.hooks.onHover?.(hit);
  };

  private onLeave = () => {
    if (!this.hovered) return;
    this.hovered = null;
    this.renderer.domElement.style.cursor = "";
    this.hooks.onHover?.(null);
  };

  // ── Loop ───────────────────────────────────────────────────────────────

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const step = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(step);
      if (document.hidden || this.container.clientWidth === 0) {
        this.last = performance.now();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Un frame (también lo usa el QA para renderizar sin rAF). */
  renderFrame(dt = 1 / 60) {
    this.frame(dt, performance.now());
  }

  private frame(dt: number, now: number) {
    const t = this.t;
    if (this.focusGoal) {
      const g = this.focusGoal;
      const k = 1 - Math.exp(-dt * 4);
      const offset = this.camera.position.clone().sub(this.controls.target);
      const dist = offset.length();
      const nextDist = dist + (g.dist - dist) * k;
      this.controls.target.lerp(g.target, k);
      offset.setLength(nextDist);
      this.camera.position.copy(this.controls.target).add(offset);
      if (this.controls.target.distanceTo(g.target) < 0.02 && Math.abs(nextDist - g.dist) < 0.05) this.focusGoal = null;
    }
    this.controls.update();

    for (const [id, s] of this.seated) {
      s.character.update(dt, t);
      const pos = s.character.root.getWorldPosition(this.tmp);
      s.laptop.update(dt, pos.distanceTo(this.camera.position));
      if (s.leaving && s.character.gone) {
        s.character.root.removeFromParent();
        s.laptop.root.removeFromParent();
        s.character.dispose();
        s.laptop.dispose();
        this.seated.delete(id);
        this.refreshVacancies();
      }
    }
    for (const view of this.desks.values()) {
      if (!view.vacancy.visible) continue;
      const hot = (this.hovered?.kind === "desk" && this.hovered.id === view.desk.id) || (this.selected?.kind === "desk" && this.selected.id === view.desk.id);
      view.vacancy.rotation.y = t * (hot ? 3 : 0.8);
      view.vacancy.position.y = 1.33 + Math.sin(t * 2 + view.desk.x) * 0.05;
      view.vacancy.scale.setScalar(hot ? 1.5 : 1);
    }

    this.confetti.update(dt);
    this.effect.render(this.scene, this.camera);
    this.emitPods();

    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
  }

  private emitPods() {
    if (!this.hooks.onPods || !this.layout) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const anchors: PodAnchor[] = this.layout.pods.map((pod) => {
      const xs = pod.desks.map((d) => d.x);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      this.tmp.set(cx, 0.02, pod.z + 2.5).project(this.camera);
      const visible = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      return { project: pod.project, x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h, visible };
    });
    this.hooks.onPods(anchors);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.observer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerleave", this.onLeave);
    this.controls.dispose();
    for (const s of this.seated.values()) {
      s.character.dispose();
      s.laptop.dispose();
    }
    this.seated.clear();
    for (const view of this.desks.values()) view.dispose();
    this.desks.clear();
    for (const r of this.rugs) {
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.confetti.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
