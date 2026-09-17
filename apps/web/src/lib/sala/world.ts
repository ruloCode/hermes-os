// Mundo three.js de la Sala de Agentes: escena, cámara fija, piso con grilla,
// luz cálida y las figuras en arco. Sin React: la página lo crea una vez y le
// habla por métodos (setAgents, setProgress…); cada frame devuelve dónde caen
// las figuras en pantalla para que las tarjetas HTML de los nombres las sigan
// (texto nítido y con el tema, sin sprites).
//
// Colores: los del tema por readToken (bg, piso, grilla) + el color propio de
// cada agente (sala.json). El componente re-monta el mundo con key=tema.

import * as THREE from "three";
import { salaArcPositions, type SalaAgentPublic } from "@hermes/shared";
import { buildFigure, type SalaFigure } from "./figures";

export interface SalaWorldColors {
  bg: string;
  floor: string;
  grid: string;
  accent: string;
  text: string;
}

export interface LabelAnchor {
  key: string;
  /** Píxeles dentro del contenedor. */
  x: number;
  y: number;
  /** Detrás de la cámara o fuera del cuadro. */
  visible: boolean;
}

export interface SalaWorldHooks {
  /** Cada frame: posiciones en pantalla de las tarjetas de nombre. */
  onLabels?: (anchors: LabelAnchor[]) => void;
}

/** Punto fijo donde vive el avatar del humano (frente al arco). */
export const AVATAR_ORIGIN = new THREE.Vector3(0, 0, 1.9);

export class SalaWorld {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly figures: SalaFigure[] = [];
  private readonly container: HTMLElement;
  private readonly hooks: SalaWorldHooks;
  private readonly disposables: { dispose(): void }[] = [];
  private raf = 0;
  private running = false;
  private t0 = performance.now();
  private readonly observer: ResizeObserver;
  private readonly tmp = new THREE.Vector3();
  /** Nodos extra por fase (marioneta, rayo…) que se agregan/quitan desde afuera. */
  readonly stage = new THREE.Group();

  constructor(container: HTMLElement, colors: SalaWorldColors, hooks: SalaWorldHooks = {}) {
    this.container = container;
    this.hooks = hooks;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft está deprecado en r185 (avisa por consola)
    renderer.domElement.className = "absolute inset-0 h-full w-full";
    container.prepend(renderer.domElement);
    this.renderer = renderer;

    const bg = new THREE.Color(colors.bg);
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg.getHex(), 0.055);

    // Cámara fija detrás del avatar, mirando al arco. Sin controles: la sala
    // se opera con el cuerpo, no con el mouse.
    // Más alta y más lejos que la marioneta: el humano queda ABAJO en el
    // cuadro y los agentes arriba — no se pisan aunque el brazo suba.
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(0, 2.9, 7.4);
    this.camera.lookAt(0, 0.9, -2.6);

    // ── Luz: cálida, baja, un solo foco que proyecta sombra ──────────────
    const hemi = new THREE.HemisphereLight(new THREE.Color(colors.text), bg, 0.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(new THREE.Color(colors.accent).lerp(new THREE.Color(0xffffff), 0.7), 1.6);
    key.position.set(3.5, 6.5, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.0008;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-5, 3, 2);
    this.scene.add(fill);

    // ── Piso + grilla ────────────────────────────────────────────────────
    const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.floor), roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.disposables.push(floor.geometry, floorMat);

    const grid = new THREE.GridHelper(60, 60, new THREE.Color(colors.grid), new THREE.Color(colors.grid));
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.32;
    gridMat.depthWrite = false;
    grid.position.y = 0.002;
    this.scene.add(grid);
    this.disposables.push(grid.geometry, gridMat);

    // Marca del avatar: un aro tenue en el punto donde "estás".
    const spot = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.45, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.text), transparent: true, opacity: 0.18, depthWrite: false }),
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.copy(AVATAR_ORIGIN).setY(0.004);
    this.scene.add(spot);
    this.disposables.push(spot.geometry, spot.material);

    this.scene.add(this.stage);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  /** Coloca las figuras en arco (reemplaza las anteriores). */
  setAgents(agents: SalaAgentPublic[]): void {
    for (const f of this.figures) {
      this.scene.remove(f.group);
      f.dispose();
    }
    this.figures.length = 0;
    const slots = salaArcPositions(agents.length, { radius: 4.4, spreadDeg: 96 });
    agents.forEach((a, i) => {
      const fig = buildFigure(a);
      const slot = slots[i];
      fig.group.position.set(slot.x, 0, slot.z);
      // Mirar al avatar (no al origen): ligera diferencia, pero es a quien hablan.
      fig.group.rotation.y = Math.atan2(AVATAR_ORIGIN.x - slot.x, AVATAR_ORIGIN.z - slot.z);
      fig.hitSphere.center.add(fig.group.position);
      this.scene.add(fig.group);
      this.figures.push(fig);
    });
  }

  figure(key: string): SalaFigure | undefined {
    return this.figures.find((f) => f.key === key);
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now();
    const step = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(step);
      // Tab oculto o contenedor colapsado: no renderizar a un canvas que nadie ve.
      if (document.hidden || this.container.clientWidth === 0) return;
      const t = (performance.now() - this.t0) / 1000;
      for (const f of this.figures) f.idle(t);
      this.renderer.render(this.scene, this.camera);
      this.emitLabels();
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private emitLabels(): void {
    if (!this.hooks.onLabels) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const anchors: LabelAnchor[] = this.figures.map((f) => {
      this.tmp.set(f.group.position.x, f.height + 0.32, f.group.position.z).project(this.camera);
      const visible = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.2 && Math.abs(this.tmp.y) < 1.2;
      return { key: f.key, x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h, visible };
    });
    this.hooks.onLabels(anchors);
  }

  dispose(): void {
    this.stop();
    this.observer.disconnect();
    for (const f of this.figures) f.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
