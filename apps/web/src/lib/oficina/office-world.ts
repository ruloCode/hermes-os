// Mundo three.js de la Oficina de agentes: la sala (piso, paredes, cocina,
// lounge), un pod de escritorios por proyecto, un personaje por sesión viva
// con su laptop, y el personaje del dueño que camina entre ellos.
//
// Dos vistas: EXPLORAR (tercera persona estilo RPG: WASD, Shift, Espacio,
// arrastrar orbita, rueda acerca, E interactúa con lo cercano) y AÉREA (la
// cámara orbital para ver todo; clic en un personaje o un "+"). V cambia.
//
// Sin React: la página lo crea una vez por tema y le habla por métodos. Cada
// frame proyecta a pantalla los pods, el dueño y lo cercano, para que las
// etiquetas HTML los sigan (texto nítido y con el tema).
//
// Look de agent-office (AgentSystemLabs, MIT): toon con rampa de 3 pasos,
// OutlineEffect y sin tone mapping (ACES lava los colores planos).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { DESK_SIZE, SEAT_ANCHOR, deskToWorld, type OfficeLayout, type OfficeWorker } from "@hermes/shared";
import { buildDesk, buildPodRug, type DeskView } from "./desk";
import { Confetti } from "./confetti";
import { Laptop } from "./laptop";
import { OfficeCharacter } from "./worker";
import { Person } from "./person";
import { PlayerController, isTyping, type Collider } from "./player";
import { buildRoom, type BoardStat, type FeedLine, type Room, FLOOR_Y, floorAt } from "./room";
import { setToonFont, toon } from "./toon";
import type { OwnerLook } from "./look";
import type { OfficePalette } from "./palette";

/** Desde dónde mira la cámara al encuadrar: de frente y en picada suave. */
const FRAME_DIR = new THREE.Vector3(0, 0.62, 0.78).normalize();
/** Distancia a la que "E" alcanza un escritorio (desde su silla). */
const REACH = 1.7;

export type OfficeHit = { kind: "worker"; id: string } | { kind: "desk"; id: string };
export type OfficeMode = "explore" | "aerial";

export interface ScreenAnchor {
  x: number;
  y: number;
  visible: boolean;
}

export interface PodAnchor extends ScreenAnchor {
  project: string;
}

export interface OfficeWorldHooks {
  onPods?: (anchors: PodAnchor[]) => void;
  /** Cada frame: dónde está la cabeza del dueño y lo que tiene al alcance de "E". */
  onPlayer?: (head: ScreenAnchor | null, near: ScreenAnchor | null) => void;
  onNear?: (hit: OfficeHit | null) => void;
  onHover?: (hit: OfficeHit | null) => void;
  onClick?: (hit: OfficeHit | null) => void;
  onMode?: (mode: OfficeMode) => void;
  /** El piso que se ve cambió (explorar: donde está el dueño; aérea: el elegido). */
  onFloor?: (floor: number) => void;
}

export interface OfficeWorldOptions {
  ownerName: string;
  look: OwnerLook;
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
    for (const mat of mats) if (flat || mat instanceof THREE.MeshBasicMaterial || mat.transparent) mat.userData.outlineParameters = { visible: false };
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
  private readonly player: PlayerController;
  private readonly owner: Person;
  private readonly container: HTMLElement;
  private readonly hooks: OfficeWorldHooks;
  private readonly palette: OfficePalette;
  private readonly ownerName: string;
  private readonly desks = new Map<string, DeskView>();
  private readonly seated = new Map<string, Seated>();
  private readonly rugs: THREE.Mesh[] = [];
  private room: Room | null = null;
  private roomKey = "";
  private feed: FeedLine[] = [];
  private board: BoardStat[] = [];
  private deskColliders: Collider[] = [];
  private layout: OfficeLayout | null = null;
  private podColor = new Map<string, string>();
  private readonly observer: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly outside: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly confetti: Confetti;
  private readonly disposables: { dispose(): void }[] = [];
  private raf = 0;
  private running = false;
  private last = performance.now();
  private t = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private hovered: OfficeHit | null = null;
  private selected: OfficeHit | null = null;
  private near: OfficeHit | null = null;
  private nearAt = new THREE.Vector3();
  private focusGoal: { target: THREE.Vector3; pos: THREE.Vector3 } | null = null;
  private framed = false;
  private spawned = false;
  private frames = 0;
  private fpsAt = performance.now();
  private clockAt = 0;
  /** Piso que se ve en vista aérea (en explorar manda la altura del dueño). */
  private aerialFloor = 0;
  private shownFloor = -1;
  /** Intensidad de las lámparas según la hora; se reparte solo a las del piso que se ve. */
  private lampBase = 1;
  private padInput = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, run: false, zoom: 0 };
  mode: OfficeMode = "explore";
  fps = 0;

  constructor(container: HTMLElement, palette: OfficePalette, hooks: OfficeWorldHooks, opts: OfficeWorldOptions) {
    this.container = container;
    this.palette = palette;
    this.hooks = hooks;
    this.ownerName = opts.ownerName;
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
    this.effect = new OutlineEffect(renderer, { defaultThickness: 0.0028, defaultColor: hexToRgbArray(palette.outline) });

    const bg = new THREE.Color(palette.bg);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 60, 130);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 250);
    this.camera.position.set(0, 20, 26);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 70;
    this.controls.screenSpacePanning = false;
    this.controls.enabled = false;
    this.controls.addEventListener("start", () => (this.focusGoal = null));

    // ── Luz: sol con sombras finas, cielo y lámparas (la sala pone las suyas) ──
    const dark = palette.dark;
    this.hemi = new THREE.HemisphereLight("#fff5e6", new THREE.Color(palette.floor), dark ? 1.1 : 1.45);
    const ambient = new THREE.AmbientLight("#ffffff", dark ? 0.3 : 0.45);
    const sun = new THREE.DirectionalLight("#fff1d6", dark ? 1.6 : 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.025;
    this.scene.add(this.hemi, ambient, sun, sun.target);
    this.sun = sun;

    // Afuera de la sala: un piso neutro que se funde con el fondo.
    this.outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(palette.floor));
    this.outside.rotation.x = -Math.PI / 2;
    this.outside.position.y = -0.01;
    this.outside.receiveShadow = true;
    this.scene.add(this.outside);
    this.disposables.push(this.outside.geometry);

    this.confetti = new Confetti(
      (x, z) => {
        for (const v of this.desks.values()) {
          if (Math.abs(x - v.desk.x) < DESK_SIZE.width / 2 && Math.abs(z - v.desk.z) < DESK_SIZE.depth / 2) return DESK_SIZE.height;
        }
        return 0;
      },
      [palette.accent, ...palette.skins, palette.bulb.working, palette.bulb.done, "#ffffff"],
    );
    this.scene.add(this.confetti.mesh);

    // ── El dueño ─────────────────────────────────────────────────────────
    this.owner = new Person(opts.look);
    this.owner.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.scene.add(this.owner.root);
    this.player = new PlayerController(this.camera);
    noOutline(this.scene);

    const el = renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKey);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  // ── Vistas ─────────────────────────────────────────────────────────────

  setMode(mode: OfficeMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.focusGoal = null;
    if (mode === "aerial") {
      this.player.setEnabled(false);
      this.controls.target.set(this.player.pos.x, this.player.pos.y + 0.5, this.player.pos.z);
      this.controls.enabled = true;
      // La vista aérea abre en el piso donde estás.
      this.aerialFloor = floorAt(this.player.pos.y);
      this.frameFloor();
    } else {
      this.controls.enabled = false;
      this.player.setEnabled(true);
      // La cámara vuelve detrás del dueño desde donde esté (se desliza).
      this.player.camYaw = Math.atan2(this.camera.position.x - this.player.pos.x, this.camera.position.z - this.player.pos.z);
    }
    this.hooks.onMode?.(mode);
  }

  /** Mientras hay un diálogo abierto el dueño no camina (las teclas son del diálogo). */
  setInputEnabled(on: boolean) {
    this.player.setEnabled(on && this.mode === "explore");
  }

  setLook(look: OwnerLook) {
    this.owner.setLook(look);
  }

  setFeed(lines: FeedLine[]) {
    this.feed = lines;
    this.room?.setFeed(lines);
  }

  setBoard(stats: BoardStat[]) {
    this.board = stats;
    this.room?.setBoard(stats);
  }

  // ── Control de juego (lo alimenta la página cada frame) ────────────────

  /** Sticks y gatillos: mover, cámara, correr y zoom continuo (cruceta ↑↓). */
  setPad(p: { move: { x: number; y: number }; look: { x: number; y: number }; run: boolean; zoom: number }) {
    this.padInput = p;
  }

  /** Lo mismo que E: habla con el agente o contrata en el escritorio al alcance. */
  interact(): boolean {
    if (this.mode !== "explore" || !this.near || !this.player.enabled) return false;
    this.owner.wave();
    this.hooks.onClick?.(this.near);
    return true;
  }

  jump() {
    if (this.mode === "explore") this.player.jump();
  }

  recenter() {
    if (this.mode === "explore") this.player.recenter();
    else this.frameAll();
  }

  /** Estado para QA (__hermesOficinaDebug). */
  debug() {
    const p = this.player.pos;
    return {
      mode: this.mode,
      player: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), grounded: this.player.grounded },
      camYaw: +this.player.camYaw.toFixed(3),
      camera: { x: +this.camera.position.x.toFixed(2), z: +this.camera.position.z.toFixed(2) },
      near: this.near,
      floor: { mine: floorAt(p.y), shown: this.shownFloor },
      stairs: this.room?.stairs ?? [],
      fps: this.fps,
    };
  }

  /** Lleva al dueño junto a un escritorio o personaje (lista del equipo en vista explorar). */
  walkTo(hit: OfficeHit) {
    const deskId = hit.kind === "desk" ? hit.id : this.seated.get(hit.id)?.deskId;
    const view = deskId ? this.desks.get(deskId) : undefined;
    if (!view) return;
    // A un costado del escritorio, mirando a la silla: la cámara ve al agente por
    // encima del hombro. Se elige el costado cuya silla más cercana es ESTA (del
    // otro lado puede estar la del vecino de la pareja); si ninguno, detrás.
    const seat = deskToWorld(view.desk, { x: 0, z: SEAT_ANCHOR.z });
    const seats = [...this.desks.values()].map((v) => ({ id: v.desk.id, ...deskToWorld(v.desk, { x: 0, z: SEAT_ANCHOR.z }) }));
    const nearestSeat = (x: number, z: number) => seats.reduce((a, b) => (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a));
    const sides = [1, -1].map((sx) => deskToWorld(view.desk, { x: sx * (DESK_SIZE.width / 2 + 0.55), z: SEAT_ANCHOR.z + 0.25 }));
    const p =
      sides.find((c) => nearestSeat(c.x, c.z).id === view.desk.id && Math.hypot(c.x - seat.x, c.z - seat.z) < REACH) ??
      deskToWorld(view.desk, { x: 0, z: SEAT_ANCHOR.z + 0.9 });
    this.player.spawn(p.x, p.z, Math.atan2(seat.x - p.x, seat.z - p.z));
    // Cámara sobre el hombro, no detrás de la cabeza: el agente queda a la vista.
    this.player.camYaw += 0.6;
  }

  // ── Planta ─────────────────────────────────────────────────────────────

  /** Construye/actualiza los escritorios (solo toca los que cambian), los tapetes y la sala. */
  setLayout(layout: OfficeLayout) {
    this.layout = layout;
    this.podColor = new Map(layout.pods.map((p, i) => [p.project, this.palette.skins[i % this.palette.skins.length]]));
    const want = new Map(layout.desks.map((d) => [d.id, d]));
    for (const [id, view] of this.desks) {
      const d = want.get(id);
      if (d && d.x === view.desk.x && d.z === view.desk.z && d.rotY === view.desk.rotY) continue;
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

    // La sala se reconstruye solo si cambia la planta (tamaño o pods: sus lámparas cuelgan sobre cada uno).
    const f = layout.floor;
    const roomKey = `${f.minX},${f.maxX},${f.minZ},${f.maxZ}|${layout.pods.map((p) => `${p.project}:${p.desks.length}`).join(",")}`;
    if (!this.room || roomKey !== this.roomKey) {
      this.roomKey = roomKey;
      if (this.room) {
        this.scene.remove(this.room.group);
        this.room.dispose();
      }
      this.room = buildRoom(layout, this.palette, this.ownerName);
      this.shownFloor = -1;
      this.room.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.receiveShadow = true;
        // Muros y muebles grandes proyectan; lo plano y lo transparente no.
        if (!(m.geometry instanceof THREE.PlaneGeometry)) m.castShadow = true;
      });
      noOutline(this.room.group);
      this.scene.add(this.room.group);
      this.room.setFeed(this.feed);
      this.room.setBoard(this.board);
      const b = this.room.bounds;
      const c = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
      const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2;
      Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 120 });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.target.position.copy(c);
      this.sun.position.set(c.x - 14, 30, c.z + 18);
      this.player.bounds = b;
      this.clockAt = 0;
      if (!this.spawned) {
        this.spawned = true;
        this.player.spawn(this.room.spawn.x, this.room.spawn.z, this.room.spawn.facing);
      }
    }

    // Escritorios: cajas sólidas (con un salto se puede subir a uno).
    this.deskColliders = layout.desks.map((d) => ({
      minX: d.x - DESK_SIZE.width / 2,
      maxX: d.x + DESK_SIZE.width / 2,
      minZ: d.z - DESK_SIZE.depth / 2,
      maxZ: d.z + DESK_SIZE.depth / 2,
      top: DESK_SIZE.height,
    }));
    this.player.colliders = [...(this.room?.colliders ?? []), ...this.deskColliders];
    this.refreshVacancies();
  }

  /** Encuadra (vista aérea) los pods donde hay alguien trabajando; si no hay nadie, toda la planta. */
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
    const f = { minX: Math.min(...xs) - 2.5, maxX: Math.max(...xs) + 2.5, minZ: Math.min(...zs) - 3, maxZ: Math.max(...zs) + 3 };
    const center = new THREE.Vector3((f.minX + f.maxX) / 2, 0, (f.minZ + f.maxZ) / 2);
    const dist = this.fitDistance(center, f);
    if (!animate) {
      this.controls.target.copy(center);
      this.camera.position.copy(center).add(FRAME_DIR.clone().multiplyScalar(dist));
      this.controls.update();
      return;
    }
    this.focusGoal = { target: center, pos: center.clone().add(FRAME_DIR.clone().multiplyScalar(dist)) };
  }

  private fitDistance(center: THREE.Vector3, f: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
    const cam = this.camera.clone();
    const corners: THREE.Vector3[] = [];
    for (const x of [f.minX, f.maxX]) for (const z of [f.minZ, f.maxZ]) for (const y of [center.y, center.y + 2.4]) corners.push(new THREE.Vector3(x, y, z));
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

  /** Acerca la cámara a un escritorio o personaje (vista aérea). */
  focus(hit: OfficeHit) {
    if (this.mode !== "aerial") return;
    const deskId = hit.kind === "desk" ? hit.id : this.seated.get(hit.id)?.deskId;
    const view = deskId ? this.desks.get(deskId) : undefined;
    if (!view) return;
    const target = new THREE.Vector3(view.desk.x, 0.8, view.desk.z);
    this.focusGoal = { target, pos: target.clone().add(FRAME_DIR.clone().multiplyScalar(7.5)) };
  }

  // ── Personajes ─────────────────────────────────────────────────────────

  /** Quién suena ahora en la llamada del equipo (id + volumen 0..1); lo lee cada frame. */
  speakingProbe: (() => { id: string; level: number } | null) | null = null;

  setWorkers(workers: OfficeWorker[], seats: ReadonlyMap<string, string>, voices?: ReadonlyMap<string, string>) {
    const live = new Set<string>();
    for (const w of workers) {
      const deskId = seats.get(w.id);
      if (!deskId) continue;
      const desk = this.desks.get(deskId);
      if (!desk) continue;
      live.add(w.id);
      let s = this.seated.get(w.id);
      if (s?.leaving) {
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
      if (w.status === "done" && s.status && s.status !== "done") {
        const at = s.character.root.getWorldPosition(new THREE.Vector3());
        this.confetti.burst(at.x, at.y + 1.3, at.z, 140);
      }
      s.status = w.status;
      s.character.setState(w, voices?.get(w.id));
      s.character.setSelected(this.selected?.kind === "worker" && this.selected.id === w.id);
      s.laptop.setLines(w.lines);
    }
    for (const [id, s] of this.seated) {
      if (live.has(id) || s.leaving) continue;
      s.leaving = true;
      s.character.vanish();
      s.laptop.close();
    }
    if (!this.framed && this.layout) {
      this.framed = true;
      if (this.mode === "aerial") this.frameAll(false);
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

  screenOf(hit: OfficeHit): { x: number; y: number } | null {
    const deskId = hit.kind === "desk" ? hit.id : this.seated.get(hit.id)?.deskId;
    const view = deskId ? this.desks.get(deskId) : undefined;
    if (!view) return null;
    return this.project(this.tmp.set(view.desk.x, 1.2, view.desk.z));
  }

  private project(v: THREE.Vector3): ScreenAnchor & { x: number; y: number } {
    v.project(this.camera);
    const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    return { x: ((v.x + 1) / 2) * this.container.clientWidth, y: ((1 - v.y) / 2) * this.container.clientHeight, visible };
  }

  // ── Qué tiene el dueño al alcance de "E" ───────────────────────────────

  private updateNear() {
    let best: { hit: OfficeHit; d: number; at: THREE.Vector3 } | null = null;
    // Los escritorios están en el piso 1: desde arriba no se alcanzan.
    if (this.mode === "explore" && floorAt(this.player.pos.y) === 0) {
      const p = this.player.pos;
      for (const view of this.desks.values()) {
        const seat = deskToWorld(view.desk, { x: 0, z: SEAT_ANCHOR.z });
        const d = Math.hypot(seat.x - p.x, seat.z - p.z);
        if (d > REACH || (best && d >= best.d)) continue;
        let hit: OfficeHit = { kind: "desk", id: view.desk.id };
        for (const [id, s] of this.seated) if (s.deskId === view.desk.id && !s.leaving) hit = { kind: "worker", id };
        best = { hit, d, at: new THREE.Vector3(view.desk.x, 1.5, view.desk.z) };
      }
    }
    const next = best?.hit ?? null;
    const same = next?.kind === this.near?.kind && next?.id === this.near?.id;
    if (best) this.nearAt.copy(best.at);
    if (!same) {
      this.near = next;
      this.hooks.onNear?.(next);
    }
  }

  // ── Entrada ────────────────────────────────────────────────────────────

  private onKey = (e: KeyboardEvent) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.code === "KeyV") {
      this.setMode(this.mode === "explore" ? "aerial" : "explore");
      return;
    }
    if (e.code === "KeyE" && this.mode === "explore" && this.near && this.player.enabled) {
      this.owner.wave();
      this.hooks.onClick?.(this.near);
    }
  };

  private hitAt(clientX: number, clientY: number): OfficeHit | null {
    // Viendo el piso 2 o 3, la losa tapa a los agentes: nada del piso 1 se clickea a través de ella.
    if (this.shownFloor > 0) return null;
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
      for (const [id, s] of this.seated) if (s.deskId === deskId && !s.leaving) return { kind: "worker", id };
      return { kind: "desk", id: deskId };
    }
    return null;
  }

  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved > 6 || e.target !== this.renderer.domElement) return;
    this.hooks.onClick?.(this.hitAt(e.clientX, e.clientY));
  };

  private onMove = (e: PointerEvent) => {
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      // En explorar, arrastrar orbita la cámara del dueño (en aérea lo hace OrbitControls).
      if (this.mode === "explore") this.player.orbit(dx, dy);
      return;
    }
    if (e.target !== this.renderer.domElement) return;
    const hit = this.hitAt(e.clientX, e.clientY);
    const same = hit?.kind === this.hovered?.kind && hit?.id === this.hovered?.id;
    if (same) return;
    this.hovered = hit;
    this.renderer.domElement.style.cursor = hit ? "pointer" : this.mode === "explore" ? "grab" : "";
    this.hooks.onHover?.(hit);
  };

  private onLeave = () => {
    if (!this.hovered) return;
    this.hovered = null;
    this.renderer.domElement.style.cursor = "";
    this.hooks.onHover?.(null);
  };

  private onWheel = (e: WheelEvent) => {
    if (this.mode !== "explore") return;
    e.preventDefault();
    this.player.zoom(e.deltaY);
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

  renderFrame(dt = 1 / 60) {
    this.frame(dt, performance.now());
  }

  /** Solo el piso que se ve tiene sus lámparas prendidas (las demás quedan en 0, sin quitarlas de la escena). */
  private applyFloorLamps() {
    if (!this.room) return;
    this.room.lamps.forEach((l, i) => (l.intensity = this.room!.lampFloor[i] === this.shownFloor ? this.lampBase : 0));
  }

  /** Corte de casa de muñecas: se ven el piso actual y los de abajo. */
  private updateFloors() {
    if (!this.room) return;
    const mine = floorAt(this.player.pos.y);
    const shown = this.mode === "explore" ? mine : this.aerialFloor;
    // En aérea, si el dueño está en un piso oculto, tampoco se ve.
    this.owner.root.visible = mine <= shown;
    if (shown === this.shownFloor) return;
    this.shownFloor = shown;
    this.room.showFloors(shown);
    this.applyFloorLamps();
    this.hooks.onFloor?.(shown);
  }

  /** Vista aérea de un piso: el 1 encuadra los pods; el 2 y el 3, la planta entera a su altura. */
  setFloorView(floor: number) {
    if (this.mode !== "aerial") this.setMode("aerial");
    this.aerialFloor = Math.max(0, Math.min(FLOOR_Y.length - 1, Math.round(floor)));
    this.frameFloor();
  }

  private frameFloor() {
    const f = this.aerialFloor;
    if (f === 0 || !this.room) {
      this.frameAll();
      return;
    }
    const b = this.room.bounds;
    const y = FLOOR_Y[f];
    const center = new THREE.Vector3((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
    const dist = this.fitDistance(center, b);
    this.focusGoal = { target: center, pos: center.clone().add(FRAME_DIR.clone().multiplyScalar(dist)) };
  }

  /** QA y "ir a la escalera": el dueño al pie de la escalera `i`, mirando hacia arriba. */
  goToStair(i: number): boolean {
    const st = this.room?.stairs[i];
    if (!st) return false;
    if (this.mode !== "explore") this.setMode("explore");
    this.player.spawn(st.x, st.z, st.facing, st.y);
    return true;
  }

  /** Luz según la hora real: de día manda el sol, de noche las lámparas. */
  private applyDaylight() {
    if (!this.room) return;
    const d = this.room.tick(new Date());
    const dark = this.palette.dark;
    this.sun.intensity = (dark ? 0.55 : 0.7) + d.day * (dark ? 1.05 : 1.4);
    this.sun.color.set(d.day >= 1 ? "#fff1d6" : d.day <= 0 ? "#b8c6ff" : "#ffc58a");
    this.hemi.intensity = (dark ? 0.8 : 1.05) + d.day * 0.4;
    this.lampBase = 0.6 + (1 - d.day) * 2.6;
    this.applyFloorLamps();
  }

  private frame(dt: number, now: number) {
    const t = this.t;
    if (now - this.clockAt > 1000) {
      this.clockAt = now;
      this.applyDaylight();
    }
    if (this.mode === "explore") {
      const pad = this.padInput;
      this.player.setPad(pad.move.x, pad.move.y, pad.run);
      if (pad.look.x || pad.look.y) this.player.padLook(pad.look.x, pad.look.y, dt);
      if (pad.zoom) this.player.zoom(pad.zoom * 900 * dt);
      if (this.player.enabled) this.player.update(dt);
      else this.player.update(0);
    } else {
      // En vista aérea el stick derecho orbita y la cruceta acerca.
      const pad = this.padInput;
      if (pad.look.x || pad.look.y || pad.zoom) {
        this.focusGoal = null;
        const offset = this.camera.position.clone().sub(this.controls.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta -= pad.look.x * 2 * dt;
        sph.phi = THREE.MathUtils.clamp(sph.phi + pad.look.y * 1.4 * dt, 0.15, this.controls.maxPolarAngle);
        sph.radius = THREE.MathUtils.clamp(sph.radius * (1 + pad.zoom * 1.2 * dt), this.controls.minDistance, this.controls.maxDistance);
        this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      }
      if (this.focusGoal) {
        // Target y posición se deslizan juntos: el encuadre siempre llega desde el frente abierto.
        const g = this.focusGoal;
        const k = 1 - Math.exp(-dt * 4);
        this.controls.target.lerp(g.target, k);
        this.camera.position.lerp(g.pos, k);
        if (this.controls.target.distanceTo(g.target) < 0.02 && this.camera.position.distanceTo(g.pos) < 0.05) this.focusGoal = null;
      }
      this.controls.update();
    }
    // El dueño sigue a su controlador (también visible desde la vista aérea).
    this.owner.root.position.copy(this.player.pos);
    this.updateFloors();
    this.owner.root.rotation.y = this.player.facing;
    this.owner.update(dt, t, this.mode === "explore" ? this.player.speed : 0, !this.player.grounded);

    const explore = this.mode === "explore";
    const speaking = this.speakingProbe?.() ?? null;
    for (const [id, s] of this.seated) {
      s.character.setTalking(speaking?.id === id ? 0.35 + Math.min(1, speaking.level * 2.5) * 0.65 : 0);
      s.character.update(dt, t);
      const pos = s.character.root.getWorldPosition(this.tmp);
      const dist = pos.distanceTo(this.camera.position);
      s.laptop.update(dt, dist);
      // En explorar: tarjetas más chicas y solo las de los agentes cercanos (o el seleccionado).
      const mine = this.selected?.kind === "worker" && this.selected.id === id;
      s.character.setCard(explore ? 0.72 : 1, !explore || dist < 13 || mine);
      if (s.leaving && s.character.gone) {
        s.character.root.removeFromParent();
        s.laptop.root.removeFromParent();
        s.character.dispose();
        s.laptop.dispose();
        this.seated.delete(id);
        this.refreshVacancies();
      }
    }
    this.updateNear();
    for (const view of this.desks.values()) {
      if (!view.vacancy.visible) continue;
      const hot =
        (this.hovered?.kind === "desk" && this.hovered.id === view.desk.id) ||
        (this.selected?.kind === "desk" && this.selected.id === view.desk.id) ||
        (this.near?.kind === "desk" && this.near.id === view.desk.id);
      view.vacancy.rotation.y = t * (hot ? 3 : 0.8);
      view.vacancy.position.y = 1.33 + Math.sin(t * 2 + view.desk.x) * 0.05;
      view.vacancy.scale.setScalar(hot ? 1.5 : 1);
    }

    this.room?.animate(t);
    this.confetti.update(dt);
    this.effect.render(this.scene, this.camera);
    this.emitAnchors();

    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
  }

  private emitAnchors() {
    if (this.hooks.onPods && this.layout) {
      const anchors: PodAnchor[] = this.layout.pods.map((pod) => {
        const xs = pod.desks.map((d) => d.x);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const at = this.tmp.set(cx, 0.02, pod.z + 2.5);
        const far = this.mode === "explore" && at.distanceTo(this.camera.position) > 14;
        const a = this.project(at);
        // Los pods están en el piso 1: viendo el 2 o el 3, la losa los tapa y su etiqueta también se va.
        return { project: pod.project, ...a, visible: a.visible && !far && this.shownFloor <= 0 };
      });
      this.hooks.onPods(anchors);
    }
    if (this.hooks.onPlayer) {
      const head = this.project(this.tmp.set(this.player.pos.x, this.player.pos.y + 2.05, this.player.pos.z));
      const near = this.near ? this.project(this.tmp.copy(this.nearAt).setY(DESK_SIZE.height + 0.15)) : null;
      this.hooks.onPlayer(head, near);
    }
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
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    this.controls.dispose();
    this.player.dispose();
    this.owner.dispose();
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
    this.room?.dispose();
    for (const d of this.disposables) d.dispose();
    this.confetti.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
