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
import {
  type QueueState,
  type GameId,
  type GameInput,
  GAME_INFO,
  NO_INPUT,
  bestKey,
  DESK_SIZE,
  SEAT_ANCHOR,
  deskToWorld,
  isOfficeBoardId,
  isOfficeNpcRole,
  type NavBox,
  type OfficeBoardId,
  type OfficeBoards,
  type OfficeLayout,
  type OfficeNpcRole,
  type OfficeSpend,
  type OfficeWorker,
  type PlanUsage,
  type UpcomingCalendar,
  hourOf,
  skyAt,
  type SkyState,
} from "@hermes/shared";
import { Outdoor } from "./outdoor";
import { hdMegabytes, hdReady, hdState, preloadHd } from "./hd";
import type { PeopleVoices } from "./people-voice";
import { buildDesk, buildPodRug, type DeskView } from "./desk";
import { Confetti } from "./confetti";
import { Laptop } from "./laptop";
import { OfficeCharacter } from "./worker";
import { Person, PERSON_SEAT_OFFSET } from "./person";
import { OfficeCrowd } from "./npc";
import { WallBoards } from "./boards";
import { WallWhiteboard } from "./whiteboard";
import { QueueBoard } from "./queueboard";
import { SpendBoard } from "./spendboard";
import { ControlWall } from "./controlwall";
import { DeskMonitor } from "./monitor";
import { CeoAgenda, CeoInbox, MeetingScreen } from "./ceo-screens";
import type { AudioSource, OfficeAudio } from "./audio";
import { createGame, paintArcadeIdle, type GameEvent, type GameHud, type MiniGame } from "./games";
import { PlayerController, isTyping, type Collider } from "./player";
import { ALL_LAYERS, buildRoom, type BoardStat, type FeedLine, type Room, type RoomLayers, type RoomProp, FLOOR_Y, floorAt } from "./room";
import { mesh, noOutline, setToonFont, toon } from "./toon";
import type { OwnerLook } from "./look";
import type { OfficePalette } from "./palette";

/** Desde dónde mira la cámara al encuadrar: de frente y en picada suave. */
const FRAME_DIR = new THREE.Vector3(0, 0.62, 0.78).normalize();
/** Distancia a la que "E" alcanza un escritorio (desde su silla). */
const REACH = 1.7;
/** Distancia a la que "E" alcanza un tablero de pared (desde su punto de uso). */
const BOARD_REACH = 1.8;
/** Distancia a la que "E" alcanza un minijuego (desde donde se para el jugador). */
const GAME_REACH = 1.4;

/** Récord de un minijuego en este navegador (null = nunca se jugó o el storage no responde). */
export function readBest(id: GameId): number | null {
  try {
    const v = localStorage.getItem(bestKey(id));
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeBest(id: GameId, score: number): boolean {
  const best = readBest(id);
  if (score <= 0 || (best !== null && score <= best)) return false;
  try {
    localStorage.setItem(bestKey(id), String(score));
    return true;
  } catch {
    return false;
  }
}

/** Lo que se clickea o alcanza con "E": un agente, un escritorio libre, un NPC con rol o un tablero de pared. */
export type OfficeHit =
  | { kind: "worker"; id: string }
  | { kind: "desk"; id: string }
  | { kind: "npc"; id: OfficeNpcRole }
  | { kind: "board"; id: OfficeBoardId }
  | { kind: "tv"; id: "lounge" }
  | { kind: "whiteboard"; id: "free" }
  | { kind: "queue"; id: "main" }
  | { kind: "spend"; id: "wall" }
  | { kind: "control"; id: "wall" }
  | { kind: "game"; id: GameId }
  | { kind: "ceo"; id: "chair" }
  | { kind: "prop"; id: string }
  | { kind: "cat"; id: "gata" }
  | { kind: "person"; id: string };

/** Lo que el dueño está haciendo (capa "Interacciones"). */
export type OwnerActivity =
  | { kind: "sit"; prop: RoomProp }
  | { kind: "make"; what: "coffee" | "water" | "snack"; prop: RoomProp; t0: number; dur: number }
  | { kind: "eat"; until: number }
  | { kind: "dance"; until: number };

/** Lo que el HUD muestra de esa actividad. */
export interface ActivityHud {
  label: string;
  hint?: string;
  /** 0..1 mientras prepara algo. */
  progress?: number;
}

/** Contador del día (los muestra el HUD: son las acciones reales de esta visita y las anteriores de hoy). */
export type OwnerStat = "coffee" | "water" | "snack" | "pet" | "greet" | "sit" | "dance" | "gift";

/** Cuánto dura cada cosa (s). */
const MAKE_SECONDS = { coffee: 4, water: 2.2, snack: 1.5 } as const;
const CARRY_SECONDS = { coffee: 150, water: 60 } as const;
const PROP_REACH = 1.1;
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
  /** Minijuego: su HUD cuando cambia (null = se salió). */
  onGame?: (hud: GameHud | null) => void;
  /** Lo que hace el dueño (sentado, preparando un café, con la taza en la mano…); null = nada. */
  onActivity?: (hud: ActivityHud | null) => void;
  /** Una acción real del dueño (para el contador del día). */
  onStat?: (stat: OwnerStat, detail?: string) => void;
  /** Cabina telefónica o de foco: lo resuelve la página (llamada, temporizador). */
  onPropAction?: (kind: "phone" | "focus") => void;
  /** Cada frame mientras alguien te habla: dónde está su globo (null = no hay). */
  onBubble?: (anchor: ScreenAnchor | null, text: string) => void;
  /** Modo CEO: el dueño se sentó (true) o se levantó (false). */
  onCeo?: (on: boolean) => void;
  /** Algo sonó en un minijuego (golpe, punto…) y dónde. */
  onGameEvent?: (ev: GameEvent, at: THREE.Vector3) => void;
  /** Cada frame: dónde está la cabeza de cada NPC con rol (para su etiqueta). */
  onNpcs?: (anchors: (ScreenAnchor & { role: OfficeNpcRole })[]) => void;
  /** Cada frame: los globos de lo que dice la gente entre ella (charlas, reacciones, avisos). */
  onTalk?: (bubbles: (ScreenAnchor & { id: string; text: string })[]) => void;
}

export interface OfficeWorldOptions {
  ownerName: string;
  look: OwnerLook;
}

interface Seated {
  status?: OfficeWorker["status"];
  character: OfficeCharacter;
  laptop: Laptop;
  /** Monitor grande del escritorio con su stream (las líneas de /office/events). */
  monitor: DeskMonitor | null;
  /** El café que le dejó el dueño (se va con el agente). */
  cup?: THREE.Group;
  deskId: string | null;
  leaving: boolean;
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
  /** Capa "Exterior": cielo, ciudad y calle que siguen la hora real. */
  private outdoor: Outdoor | null = null;
  private exteriorOn = true;
  private panoramaLoading = false;
  /** Hora forzada (QA y capturas: __hermesOficinaHour); null = la del reloj. */
  private hourOverride: number | null = null;
  private sky: SkyState = skyAt(hourOf(new Date()));
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
  /** Gente del edificio (interruptor "Ambiente"): personas de ambiente y NPC con rol. */
  private readonly crowd = new OfficeCrowd();
  /** Tableros de pared del piso 1 (issues, PRs, servicios); se rehacen con la sala. */
  private boards: WallBoards | null = null;
  private boardsData: OfficeBoards | null = null;
  private whiteboard: WallWhiteboard | null = null;
  private whiteboardImage: string | null = null;
  private queueBoard: QueueBoard | null = null;
  private queueData: QueueState | null | undefined = undefined;
  private readonly peopleBuf: Collider[] = [];
  /** Tablero de gasto (GET /office/spend) y sala de control (pantallas de todos los agentes). */
  private spendBoard: SpendBoard | null = null;
  private spendData: OfficeSpend | null | undefined = undefined;
  private planData: PlanUsage | null | undefined = undefined;
  private controlWall: ControlWall | null = null;
  private projectNamer: (slug: string) => string = (s) => s;
  private workerList: OfficeWorker[] = [];
  private nickMap: ReadonlyMap<string, string> = new Map();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  /** Minijuego en curso: la cámara y la entrada son suyos hasta salir. */
  private game: MiniGame | null = null;
  private readonly gameKeys = new Set<string>();
  private gamePadA = false;
  private gameSynth: Partial<GameInput> | null = null;
  private gamePrevAction = false;
  private gameHudKey = "";
  private gameSaved = false;
  private gameMoved: string[] = [];
  private lastGameEvent: GameEvent | null = null;
  private readonly gameLook = new THREE.Vector3();
  /** Oficina de CEO: sus pantallas, el modo sentado y a quién mira la cámara. */
  private ceoSpend: SpendBoard | null = null;
  private ceoInbox: CeoInbox | null = null;
  private ceoAgenda: CeoAgenda | null = null;
  private calendar: UpcomingCalendar | null = null;
  private ceoOn = false;
  private meetingScreen: MeetingScreen | null = null;
  /** Capas nuevas (interruptor "Capas"): datos, oficina de CEO y zonas. */
  private layers: RoomLayers = { ...ALL_LAYERS };
  private freeZonesCache: { key: string; zones: unknown } | null = null;
  private ceoPick: string | null = null;
  private readonly ceoLook = new THREE.Vector3();
  private gameHudAt = 0;
  private gameOverAt = 0;
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
    // El contorno dibuja la escena dos veces: el contador se reinicia a mano por frame (si no, solo cuenta la segunda pasada).
    renderer.info.autoReset = false;
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
    this.setExterior(true);
    // Texturas HD: la sala se rearma una vez cuando terminan de cargar (antes, los canvas de siempre).
    void preloadHd().then((ok) => {
      if (!ok || !this.layers.hd || !this.layout || this.disposed) return;
      this.roomKey = "";
      this.setLayout(this.layout);
    });

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
    this.scene.add(this.crowd.group);
    this.player = new PlayerController(this.camera);
    noOutline(this.scene);

    const el = renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  // ── Vistas ─────────────────────────────────────────────────────────────

  setMode(mode: OfficeMode) {
    if (mode === this.mode) return;
    // Cambiar de vista saca del minijuego y de la silla (la cámara vuelve a ser de la vista).
    if (this.game) this.exitGame();
    if (this.ceoOn) this.exitCeo();
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
      this.syncWalk();
      // La cámara vuelve detrás del dueño desde donde esté (se desliza).
      this.player.camYaw = Math.atan2(this.camera.position.x - this.player.pos.x, this.camera.position.z - this.player.pos.z);
    }
    this.hooks.onMode?.(mode);
  }

  /** Mientras hay un diálogo abierto el dueño no camina (las teclas son del diálogo). */
  setInputEnabled(on: boolean) {
    this.inputOn = on;
    this.syncWalk();
  }
  private inputOn = true;

  // ── Minijuegos de la azotea ───────────────────────────────────────────

  /** Entra a un minijuego: el dueño se para en su puesto y la cámara y la entrada pasan al juego. */
  startGame(id: GameId): boolean {
    if (!this.gamesOn) return false;
    this.standUp();
    const spot = this.room?.gameSpots[id];
    if (!spot || !this.room) return false;
    this.exitGame();
    if (this.mode !== "explore") this.setMode("explore");
    this.player.spawn(spot.stand.x, spot.stand.z, spot.stand.facing, FLOOR_Y[spot.floor]);
    this.player.setEnabled(false);
    for (const o of spot.hide) o.visible = false;
    this.game = createGame(id, { spot, room: this.room, palette: this.palette, seed: Math.floor(performance.now()) });
    noOutline(this.game.group);
    this.scene.add(this.game.group);
    // Quien estaba jugando ahí se aparta (y nadie vuelve mientras juegas).
    const poi = GAME_INFO[id].poi;
    this.gameMoved = poi ? this.crowd.reservePoi(poi) : [];
    this.gameKeys.clear();
    this.gamePrevAction = true; // la tecla que abrió el juego no cuenta como primera acción
    this.gameSaved = false;
    this.gameOverAt = 0;
    this.lastGameEvent = null;
    this.gameHudKey = "";
    this.camera.getWorldDirection(this.gameLook).multiplyScalar(3).add(this.camera.position);
    this.emitGameHud();
    return true;
  }

  /** Sale del minijuego (Esc/B): guarda el récord, devuelve las piezas de adorno y la cámara al dueño. */
  exitGame() {
    const g = this.game;
    if (!g) return;
    if (!this.gameSaved) writeBest(g.id, g.score);
    const spot = this.room?.gameSpots[g.id];
    for (const o of spot?.hide ?? []) o.visible = true;
    g.dispose();
    this.game = null;
    if (g.id === "arcade" && this.room) paintArcadeIdle(this.room.arcadeScreen, readBest("arcade"));
    this.crowd.reservePoi(null);
    this.gameMoved = [];
    this.gameSynth = null;
    this.syncWalk();
    this.hooks.onGame?.(null);
  }

  // ── Oficina de CEO ─────────────────────────────────────────────────────

  /** Sentarse en la silla ejecutiva: la cámara mira el salón por el vidrio; el dueño no camina. */
  enterCeo(): boolean {
    const c = this.room?.ceo;
    if (!c) return false;
    this.exitGame();
    this.standUp();
    if (this.mode !== "explore") this.setMode("explore");
    this.ceoOn = true;
    this.ceoPick = null;
    this.player.spawn(c.chair.reach.x, c.chair.reach.z, c.chair.facing, 0);
    this.player.setEnabled(false);
    this.owner.setPose("sit");
    this.ceoAim(null);
    this.camera.getWorldDirection(this.gameLook).multiplyScalar(3).add(this.camera.position);
    this.hooks.onCeo?.(true);
    return true;
  }

  exitCeo() {
    if (!this.ceoOn) return;
    this.ceoOn = false;
    this.ceoPick = null;
    this.owner.setPose("stand");
    const c = this.room?.ceo;
    if (c) this.player.spawn(c.chair.reach.x, c.chair.reach.z, c.chair.facing + Math.PI, 0);
    this.syncWalk();
    this.setSelected(null);
    this.hooks.onCeo?.(false);
  }

  get ceoActive(): boolean {
    return this.ceoOn;
  }

  /** En modo CEO, la cámara voltea hacia el escritorio de un agente (null = el salón entero). */
  ceoAim(workerId: string | null) {
    this.ceoPick = workerId;
    const deskId = workerId ? this.seated.get(workerId)?.deskId : null;
    const view = deskId ? this.desks.get(deskId) : undefined;
    if (view) this.ceoLook.set(view.desk.x, 0.3, view.desk.z);
    else {
      const pods = this.layout?.pods ?? [];
      const xs = pods.flatMap((p) => p.desks.map((d) => d.x));
      const zs = pods.map((p) => p.z);
      this.ceoLook.set(xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, 0, zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0);
    }
    this.setSelected(workerId ? { kind: "worker", id: workerId } : null);
  }

  get gameId(): GameId | null {
    return this.game?.id ?? null;
  }

  /** QA: entrada sintética del minijuego (se suma a teclado y control; null la quita). */
  gameInput(input: Partial<GameInput> | null) {
    this.gameSynth = input;
  }

  /** QA y HUD: el estado del juego en curso. */
  gameState() {
    const g = this.game;
    if (!g) return null;
    return { ...g.hud(), id: g.id, best: readBest(g.id), moved: this.gameMoved, lastEvent: this.lastGameEvent, inner: g.debug?.() ?? null };
  }

  private gameInputNow(): GameInput {
    const k = this.gameKeys;
    const axis = (pos: string[], neg: string[]) => (pos.some((c) => k.has(c)) ? 1 : 0) - (neg.some((c) => k.has(c)) ? 1 : 0);
    const syn = this.gameSynth ?? {};
    const pad = this.padInput.move;
    const x = Math.max(-1, Math.min(1, axis(["ArrowRight", "KeyD"], ["ArrowLeft", "KeyA"]) + pad.x + (syn.x ?? 0)));
    const y = Math.max(-1, Math.min(1, axis(["ArrowUp", "KeyW"], ["ArrowDown", "KeyS"]) + pad.y + (syn.y ?? 0)));
    const action = ["Space", "Enter", "KeyE"].some((c) => k.has(c)) || this.gamePadA || !!syn.action;
    const pressed = (action && !this.gamePrevAction) || !!syn.pressed;
    this.gamePrevAction = action;
    if (syn.pressed) this.gameSynth = { ...syn, pressed: false };
    return { ...NO_INPUT, x, y, action, pressed };
  }

  private emitGameHud() {
    const g = this.game;
    if (!g) return;
    const hud: GameHud = { ...g.hud(), id: g.id, best: readBest(g.id) };
    const key = JSON.stringify(hud);
    if (key === this.gameHudKey) return;
    this.gameHudKey = key;
    this.hooks.onGame?.(hud);
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.gameKeys.delete(e.code);
  };

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

  /** Interruptor "Ambiente": gente de ambiente + NPC con rol. Apagado, la oficina queda como sin él. */
  setAmbient(on: boolean, liveSessions: number, seed?: number) {
    this.crowd.setEnabled(on, liveSessions, seed);
    this.refreshColliders();
  }

  /** Pantalla compartida en la TV del lounge (null = vuelve el feed). La sala se rehace: se re-aplica. */
  private tvVideo: HTMLVideoElement | null = null;
  setTvVideo(video: HTMLVideoElement | null) {
    this.tvVideo = video;
    this.room?.setTvVideo(video);
  }

  /** La cola real (GET /office/queue): undefined = cargando, null = sin respuesta. */
  setQueue(q: QueueState | null | undefined) {
    this.queueData = q;
    this.queueBoard?.setState(q);
    this.ceoInbox?.setData(this.workerList, this.nickMap, q);
  }

  /** Gasto de tokens (GET /office/spend): undefined = cargando, null = el agente no respondió. */
  setSpend(data: OfficeSpend | null | undefined) {
    this.spendData = data;
    this.spendBoard?.setData(data, this.projectNamer);
    this.ceoSpend?.setData(data, this.projectNamer);
  }

  /** Uso del plan de Claude (GET /office/plan-usage): sesión, semana, límites por modelo. */
  setPlanUsage(plan: PlanUsage | null | undefined) {
    this.planData = plan;
    this.spendBoard?.setPlan(plan);
    this.ceoSpend?.setPlan(plan);
  }

  /** La agenda real (snapshot.calendar de /dashboard) para la oficina de CEO y la sala de juntas. */
  setCalendar(cal: UpcomingCalendar | null) {
    this.calendar = cal;
    this.ceoAgenda?.setData(cal, new Date());
    this.meetingScreen?.setData(cal, new Date());
  }

  /** Prende o apaga capas: la sala se rehace (apagadas, queda como antes de existir). */
  setLayers(layers: RoomLayers) {
    const next = { ...this.layers, ...layers };
    const same = next.data === this.layers.data && next.ceo === this.layers.ceo && next.zones === this.layers.zones && next.hd === this.layers.hd;
    if (same) return;
    this.layers = next;
    if (this.ceoOn && !layers.ceo) this.exitCeo();
    // Los monitores de los escritorios son de la capa de datos.
    if (!layers.data) for (const st of this.seated.values()) {
      st.monitor?.dispose();
      st.monitor = null;
    }
    if (this.layout) {
      this.roomKey = "";
      this.setLayout(this.layout);
      if (layers.data) this.setWorkers(this.workerList, this.lastSeats, this.lastVoices, this.nickMap);
    }
  }
  private lastSeats: ReadonlyMap<string, string> = new Map();
  private gamesOn = true;
  /** Capa "Interacciones": sentarse, café, gata, saludar… */
  private interactOn = true;
  private activity: OwnerActivity | null = null;
  private carry: { what: "coffee" | "water"; until: number } | null = null;
  private activityKey = "";
  private activityAt = 0;
  private bubble: { id: string; text: string; until: number } | null = null;
  /** Lo que dice la gente cuando la saludas: lo arma la página con datos reales. */
  private chatter: (() => string) | null = null;
  private lampOff = new Set<number>();
  private readonly bubbleAt = new THREE.Vector3();

  setInteractionsEnabled(on: boolean) {
    this.interactOn = on;
    if (!on) {
      this.standUp();
      this.activity = null;
      this.carry = null;
    }
  }

  /** Voces de la gente (página): cada persona habla con la suya. */
  private peopleVoices: PeopleVoices | null = null;
  private voiceKey = "";
  private voiceAt = 0;

  setPeopleVoices(v: PeopleVoices | null) {
    this.peopleVoices = v;
    this.voiceKey = "";
    this.crowd.levelOf = v ? (id) => v.levelOf(id) : null;
    this.crowd.onSay = v
      ? (id, text, line, at) => {
          // Mismo piso y cerca: una charla se oye bajito y de su lado; lejos o en otro piso, solo su globo.
          const sameFloor = floorAt(at.y + 0.05) === floorAt(this.player.pos.y);
          const d = Math.hypot(at.x - this.player.pos.x, at.z - this.player.pos.z);
          const staff = id.startsWith("npc:");
          const near = Math.max(0, Math.min(1, 1 - (d - 2) / 8));
          const volume = !sameFloor ? 0 : staff ? Math.max(0.55, near) : near * 0.8;
          const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
          const dir = this.tmp.set(at.x - this.camera.position.x, 0, at.z - this.camera.position.z).normalize();
          v.say(id, text, { volume, line, pan: dir.dot(right) * 0.8 });
        }
      : null;
  }

  /** Datos reales para las charlas (hora, clima, agentes trabajando): los arma la página. */
  setChatContext(fn: Parameters<OfficeCrowd["setChatContext"]>[0]) {
    this.crowd.setChatContext(fn);
  }

  /** Capa "Gente viva": charlas y reacciones. */
  setLively(on: boolean) {
    this.crowd.setLively(on);
  }

  /** Reparte voces cuando cambia quién está en el edificio (una vez por segundo como mucho). */
  private syncVoices(now: number) {
    const v = this.peopleVoices;
    if (!v || now - this.voiceAt < 1000) return;
    this.voiceAt = now;
    const req = this.crowd.voiceRequests();
    const d = v.debug();
    const key = `${req.map((r) => r.id).join(",")}|${d.catalog}|${d.premium}`;
    if (key === this.voiceKey) return;
    this.voiceKey = key;
    v.assign(req);
  }

  setChatter(fn: (() => string) | null) {
    this.chatter = fn;
  }

  /** ¿Puede caminar el dueño? (nada de diálogo, juego, silla de CEO ni actividad que lo ocupe). */
  private syncWalk() {
    const busy = this.activity && this.activity.kind !== "dance";
    this.player.setEnabled(this.inputOn && this.mode === "explore" && !this.game && !this.ceoOn && !busy);
  }

  /** Qué es un objeto de la sala (para el aviso de "E" en la página) y si su lámpara está apagada. */
  propInfo(id: string): { kind: RoomProp["kind"]; name: string; off?: boolean } | null {
    const pr = this.room?.props.find((x) => x.id === id);
    if (!pr) return null;
    return { kind: pr.kind, name: pr.name, off: pr.lamp !== undefined ? this.lampOff.has(pr.lamp) : undefined };
  }

  get ownerBusy(): boolean {
    return !!this.activity && this.activity.kind !== "dance";
  }

  get sitting(): boolean {
    return this.activity?.kind === "sit";
  }

  /** Usar algo con "E": un asiento, la cafetera, el agua, los snacks, una cabina, una lámpara, la gata o alguien. */
  use(hit: OfficeHit): boolean {
    if (!this.interactOn || this.game || this.ceoOn) return false;
    const t = this.t;
    if (hit.kind === "cat") {
      const cat = this.crowd.catNow;
      if (!cat) return false;
      cat.pet(this.player.pos, t);
      this.owner.wave();
      this.audio?.fx("purr");
      this.hooks.onStat?.("pet");
      return true;
    }
    if (hit.kind === "person") {
      if (!this.crowd.greet(hit.id)) return false;
      this.owner.wave();
      this.bubble = { id: hit.id, text: this.chatter?.() ?? "¡Hola!", until: t + 6 };
      // Te contesta con SU voz (la del sistema: la frase lleva datos reales).
      this.peopleVoices?.say(hit.id, this.bubble.text, { volume: 1 });
      this.hooks.onStat?.("greet");
      return true;
    }
    if (hit.kind !== "prop") return false;
    const prop = this.room?.props.find((x) => x.id === hit.id);
    if (!prop) return false;
    switch (prop.kind) {
      case "seat":
        this.sitOn(prop);
        return true;
      case "coffee":
      case "water":
      case "snack": {
        const what = prop.kind;
        this.player.spawn(prop.at.x, prop.at.z, prop.facing, FLOOR_Y[prop.floor]);
        this.activity = { kind: "make", what, prop, t0: t, dur: MAKE_SECONDS[what] };
        this.audio?.fx(what === "coffee" ? "brew" : what === "water" ? "pour" : "crunch");
        this.syncWalk();
        return true;
      }
      case "lamp":
        if (prop.lamp === undefined) return false;
        if (this.lampOff.has(prop.lamp)) this.lampOff.delete(prop.lamp);
        else this.lampOff.add(prop.lamp);
        this.applyFloorLamps();
        this.audio?.fx("click");
        return true;
      case "phone":
      case "focus":
        this.owner.wave();
        this.hooks.onPropAction?.(prop.kind);
        return true;
    }
  }

  private sitOn(prop: RoomProp) {
    if (!prop.seat) return;
    this.player.spawn(prop.at.x, prop.at.z, prop.facing, FLOOR_Y[prop.floor]);
    // Quien estaba sentado ahí se levanta y busca otro lugar (y nadie lo toma mientras estés).
    if (prop.poi) this.crowd.reservePoi(prop.poi);
    this.activity = { kind: "sit", prop };
    this.audio?.fx("sit");
    this.hooks.onStat?.("sit", prop.id);
    this.syncWalk();
  }

  /** Levantarse (o dejar lo que está haciendo). */
  standUp() {
    const a = this.activity;
    if (!a) return;
    if (a.kind === "sit" && a.prop.poi) this.crowd.reservePoi(null);
    this.activity = null;
    this.syncWalk();
  }

  /**
   * Con el café en la mano, hablarle a un agente se lo deja en el escritorio:
   * la taza queda junto a su laptop mientras siga ahí (decorado, no dato).
   */
  private giftCup(workerId: string): boolean {
    if (this.carry?.what !== "coffee") return false;
    const s = this.seated.get(workerId);
    const view = s?.deskId ? this.desks.get(s.deskId) : undefined;
    if (!s || !view || s.leaving || s.cup) return false;
    const cup = new THREE.Group();
    cup.add(mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.11, 10), toon("#f4f1ea"), 0, 0.055, 0, false));
    cup.add(mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.01, 10), toon("#6f4e37"), 0, 0.105, 0, false));
    cup.add(mesh(new THREE.TorusGeometry(0.03, 0.009, 5, 10), toon("#f4f1ea"), 0.06, 0.06, 0, false));
    cup.position.set(-0.55, DESK_SIZE.height, -0.15);
    noOutline(cup);
    view.group.add(cup);
    s.cup = cup;
    this.carry = null;
    this.audio?.fx("click");
    this.hooks.onStat?.("gift");
    return true;
  }

  /** Un sorbo de lo que lleva en la mano. */
  sip(): boolean {
    if (!this.carry) return false;
    this.audio?.fx("sip");
    return true;
  }

  /** Q: saludar · F: bailar (un rato, o hasta que camine). */
  emote(kind: "wave" | "dance") {
    if (!this.interactOn || this.game || this.ceoOn || this.mode !== "explore") return;
    if (kind === "wave") this.owner.wave();
    else if (!this.activity) {
      this.activity = { kind: "dance", until: this.t + 5 };
      this.hooks.onStat?.("dance");
      // Los que están cerca se apartan un paso y te miran.
      this.crowd.react("dance", this.player.pos.clone(), floorAt(this.player.pos.y));
    }
  }

  /** La pose del dueño según lo que hace y lo que lleva en la mano. */
  private ownerPose(): import("./person").PersonPose {
    const a = this.activity;
    if (a?.kind === "sit") return this.carry ? "sitcup" : "sit";
    if (a?.kind === "make") return "hands";
    if (a?.kind === "eat") return "eat";
    if (a?.kind === "dance") return "dance";
    return this.carry ? "cup" : "stand";
  }

  /** Avanza la actividad (cada frame) y avisa al HUD lo que hace falta. */
  private tickActivity(now: number) {
    const t = this.t;
    const a = this.activity;
    if (a?.kind === "make" && t - a.t0 >= a.dur) {
      if (a.what === "snack") this.activity = { kind: "eat", until: t + 3 };
      else {
        this.activity = null;
        this.carry = { what: a.what, until: t + CARRY_SECONDS[a.what] };
      }
      this.hooks.onStat?.(a.what);
      this.syncWalk();
    } else if ((a?.kind === "eat" || a?.kind === "dance") && t >= a.until) {
      this.activity = null;
      this.syncWalk();
    }
    // Bailar se corta al caminar.
    if (this.activity?.kind === "dance" && this.player.speed > 0.1) this.activity = null;
    if (this.carry && t >= this.carry.until) this.carry = null;
    this.owner.setPose(this.ownerPose());
    if (now - this.activityAt < 200) return;
    this.activityAt = now;
    const cur = this.activity;
    let hud: ActivityHud | null = null;
    if (cur?.kind === "sit") hud = { label: `Sentado en ${cur.prop.name}${this.carry ? (this.carry.what === "coffee" ? " con tu café" : " con tu agua") : ""}`, hint: "E, Espacio o caminar: levantarte" };
    else if (cur?.kind === "make") hud = { label: cur.what === "coffee" ? "Preparando un café…" : cur.what === "water" ? "Sirviendo agua…" : "Sacando un snack…", progress: Math.min(1, (t - cur.t0) / cur.dur), hint: "Esc: dejarlo" };
    else if (cur?.kind === "eat") hud = { label: "Comiendo un snack" };
    else if (cur?.kind === "dance") hud = { label: "Bailando", hint: "camina para parar" };
    else if (this.carry) {
      const left = Math.max(0, Math.ceil(this.carry.until - t));
      hud = { label: `${this.carry.what === "coffee" ? "☕ Café" : "💧 Agua"} en la mano · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, hint: "E con nada cerca: un sorbo · siéntate donde quieras" };
    }
    const key = JSON.stringify(hud && { ...hud, progress: hud.progress === undefined ? undefined : Math.round(hud.progress * 20) });
    if (key === this.activityKey) return;
    this.activityKey = key;
    this.hooks.onActivity?.(hud);
  }
  /** Sonido de ambiente (lo crea la página: sobrevive a los cambios de tema). */
  private audio: OfficeAudio | null = null;
  private typists: AudioSource[] = [];
  private typistsAt = 0;
  private readonly espressoAt = new THREE.Vector3();

  setAudio(audio: OfficeAudio | null) {
    this.audio = audio;
  }

  /** Capa "Minijuegos": apagada, los juegos de la azotea no se alcanzan con "E" (y el que corre se cierra). */
  setGamesEnabled(on: boolean) {
    this.gamesOn = on;
    if (!on) this.exitGame();
  }
  private lastVoices: ReadonlyMap<string, string> | undefined;

  /** QA (capturas y zonas nuevas): los rectángulos vacíos más grandes de cada piso, medidos en la rejilla de la gente. */
  freeZones(): unknown {
    const nav = this.crowd.navGrid;
    if (!nav || !this.room) return null;
    const key = `${this.room.key}|${this.layout?.desks.length}`;
    if (this.freeZonesCache?.key !== key) this.freeZonesCache = { key, zones: FLOOR_Y.map((_, f) => nav.openZones(f, 3)) };
    return this.freeZonesCache.zones;
  }

  /** Cómo se llama cada proyecto (slug → nombre del vault), para tableros y pantallas. */
  setProjectNamer(fn: (slug: string) => string) {
    this.projectNamer = fn;
    this.spendBoard?.setData(this.spendData, fn);
    this.controlWall?.setWorkers(this.workerList, this.nickMap, fn);
  }

  /** El dibujo de la pizarra libre (data URL PNG, o null = limpia). */
  setWhiteboard(image: string | null) {
    this.whiteboardImage = image;
    this.whiteboard?.setImage(image);
  }

  /** Datos reales de los tableros de pared (GET /office/boards). */
  setBoardsData(data: OfficeBoards | null) {
    this.boardsData = data;
    this.boards?.setData(data);
  }

  /** El NPC con rol mira al dueño mientras su diálogo está abierto. */
  setNpcTalking(role: OfficeNpcRole | null) {
    this.crowd.setTalking(role);
  }

  private refreshColliders() {
    this.player.colliders = [...(this.room?.colliders ?? []), ...this.deskColliders, ...this.crowd.staticColliders()];
  }

  // ── Control de juego (lo alimenta la página cada frame) ────────────────

  /** Sticks y gatillos: mover, cámara, correr y zoom continuo (cruceta ↑↓). */
  setPad(p: { move: { x: number; y: number }; look: { x: number; y: number }; run: boolean; zoom: number; a?: boolean }) {
    this.padInput = p;
    this.gamePadA = !!p.a;
  }

  /** Lo mismo que E: habla con el agente o contrata en el escritorio al alcance. */
  interact(): boolean {
    if (this.game) return false;
    // Ocupado (sentado, preparando algo): la acción lo levanta o lo deja.
    if (this.ownerBusy) {
      this.standUp();
      return true;
    }
    if (this.mode === "explore" && !this.near && this.carry) return this.sip();
    if (this.mode !== "explore" || !this.near || !this.player.enabled) return false;
    if (this.near.kind === "worker") this.giftCup(this.near.id);
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

  /** Lo que cuesta dibujar un frame (promedio de los últimos ~60): draw calls, triángulos y memoria. */
  private renderAcc = { calls: 0, triangles: 0, n: 0 };
  private renderStats = { calls: 0, triangles: 0 };
  private sampleRender() {
    const r = this.renderer.info.render;
    const a = this.renderAcc;
    a.calls += r.calls;
    a.triangles += r.triangles;
    if (++a.n >= 60) {
      this.renderStats = { calls: Math.round(a.calls / a.n), triangles: Math.round(a.triangles / a.n) };
      a.calls = a.triangles = a.n = 0;
    }
  }

  /** Presupuesto de render (QA): draw calls y triángulos por frame, texturas y su memoria estimada en GPU. */
  renderInfo() {
    // Por imagen subida (Source), no por objeto Texture: los clones de una textura HD comparten la misma.
    const seen = new Set<THREE.Source<unknown>>();
    let bytes = 0;
    this.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        for (const v of Object.values(m)) {
          if (!(v instanceof THREE.Texture) || seen.has(v.source)) continue;
          seen.add(v.source);
          const img = v.image as { width?: number; height?: number; videoWidth?: number } | undefined;
          const w = img?.width ?? 0;
          const h = img?.height ?? 0;
          // RGBA8 con mipmaps (≈ 4/3).
          bytes += w * h * 4 * (v.generateMipmaps && v.minFilter !== THREE.LinearFilter && v.minFilter !== THREE.NearestFilter ? 4 / 3 : 1);
        }
      }
    });
    const mem = this.renderer.info.memory;
    return {
      calls: this.renderStats.calls,
      triangles: this.renderStats.triangles,
      textures: mem.textures,
      geometries: mem.geometries,
      textureMB: +(bytes / 1048576).toFixed(1),
      sceneTextures: seen.size,
      pixelRatio: this.renderer.getPixelRatio(),
    };
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
      render: this.renderInfo(),
      voices: this.peopleVoices?.debug() ?? null,
      hd: { on: !!this.layers.hd, state: hdState(), applied: !!this.room?.key.endsWith("1"), megabytes: hdMegabytes() },
      exterior: { on: this.exteriorOn, hour: +this.sky.hour.toFixed(2), forced: this.hourOverride !== null, ...(this.outdoor?.state ?? {}), counts: this.outdoor?.counts ?? null },
      ...this.crowd.debug(),
      ambient: this.crowd.on,
      monitors: Object.fromEntries([...this.seated].filter(([, s]) => s.monitor && !s.leaving).map(([id, s]) => [id, { lines: s.monitor!.shown(), paints: s.monitor!.paints }])),
      controlWall: this.controlWall?.debug() ?? null,
      game: this.gameState(),
      owner: { activity: this.activity ? { kind: this.activity.kind, prop: "prop" in this.activity ? this.activity.prop.id : null } : null, carry: this.carry?.what ?? null, walking: this.player.enabled },
      props: this.room?.props.map((p) => p.id) ?? [],
      cat: this.crowd.catNow ? { pets: this.crowd.catNow.pets, x: +this.crowd.catNow.pos.x.toFixed(2), z: +this.crowd.catNow.pos.z.toFixed(2) } : null,
      bubble: this.bubble ? { id: this.bubble.id, text: this.bubble.text } : null,
      lampsOff: [...this.lampOff],
      gifts: [...this.seated].filter(([, s]) => s.cup && !s.leaving).map(([id]) => id),
      ceo: this.room?.ceo
        ? {
            on: this.ceoOn,
            pick: this.ceoPick,
            nameplate: this.room.ceo.nameplate,
            inbox: this.ceoInbox?.lines ?? [],
            bounds: this.room.ceo.bounds,
          }
        : null,
      layers: this.layers,
      meeting: this.meetingScreen?.text ?? null,
      freeZones: this.freeZones(),
      spend: this.spendData === undefined ? "loading" : this.spendData ? { costUsd: this.spendData.today.costUsd, runs: this.spendData.today.runs } : null,
      plan: this.planData === undefined ? "loading" : this.planData ? this.planData.windows.map((w) => ({ label: w.label, utilization: w.utilization })) : null,
    };
  }

  /** Lleva al dueño junto a un escritorio o personaje (lista del equipo en vista explorar). */
  walkTo(hit: OfficeHit) {
    if (hit.kind === "prop") {
      const pr = this.room?.props.find((x) => x.id === hit.id);
      if (!pr) return;
      this.standUp();
      if (this.mode !== "explore") this.setMode("explore");
      this.player.spawn(pr.at.x, pr.at.z, pr.facing, FLOOR_Y[pr.floor]);
      return;
    }
    if (hit.kind === "cat" || hit.kind === "person") {
      const target = hit.kind === "cat" ? this.crowd.catNow?.pos.clone() : this.crowd.headOf(hit.id, new THREE.Vector3())?.setY(0);
      if (!target) return;
      this.standUp();
      if (this.mode !== "explore") this.setMode("explore");
      const y = hit.kind === "cat" ? this.crowd.catNow!.pos.y : FLOOR_Y[floorAt((this.crowd.headOf(hit.id, new THREE.Vector3())?.y ?? 2) - 2)];
      this.player.spawn(target.x + 1.1, target.z + 0.4, Math.atan2(-1.1, -0.4), y);
      // Cámara sobre el hombro, como junto a un agente: la persona queda a la vista.
      this.player.camYaw += 0.7;
      return;
    }
    if (hit.kind === "ceo") {
      const c = this.room?.ceo;
      if (!c) return;
      if (this.ceoOn) this.exitCeo();
      if (this.mode !== "explore") this.setMode("explore");
      this.player.spawn(c.chair.reach.x, c.chair.reach.z, Math.atan2(c.chair.x - c.chair.reach.x, c.chair.z - c.chair.reach.z), 0);
      return;
    }
    if (hit.kind === "game") {
      const spot = this.room?.gameSpots[hit.id];
      if (!spot) return;
      if (this.mode !== "explore") this.setMode("explore");
      this.player.spawn(spot.stand.x, spot.stand.z, spot.stand.facing, FLOOR_Y[spot.floor]);
      return;
    }
    if (hit.kind === "spend" || hit.kind === "control") {
      const spot = hit.kind === "spend" ? this.room?.spendSpot : this.room?.controlSpot;
      if (!spot) return;
      if (this.mode !== "explore") this.setMode("explore");
      this.player.spawn(spot.front.x, spot.front.z, Math.atan2(spot.x - spot.front.x, spot.z - spot.front.z));
      return;
    }
    if (hit.kind === "whiteboard" || hit.kind === "queue") {
      const wb = hit.kind === "queue" ? this.room?.queueSpot : this.room?.whiteboardSpot;
      if (!wb) return;
      if (this.mode !== "explore") this.setMode("explore");
      this.player.spawn(wb.front.x, wb.front.z, Math.atan2(wb.x - wb.front.x, wb.z - wb.front.z));
      return;
    }
    if (hit.kind === "tv") {
      const tv = this.room?.tv;
      if (!tv) return;
      if (this.mode !== "explore") this.setMode("explore");
      this.player.spawn(tv.front.x, tv.front.z, Math.atan2(tv.x - tv.front.x, tv.z - tv.front.z), FLOOR_Y[tv.floor]);
      return;
    }
    if (hit.kind === "board") {
      const spot = this.boards?.spot(hit.id);
      if (!spot) return;
      if (this.mode !== "explore") this.setMode("explore");
      this.player.spawn(spot.front.x, spot.front.z, Math.atan2(spot.x - spot.front.x, spot.z - spot.front.z));
      return;
    }
    if (hit.kind === "npc") {
      // Frente al NPC, en su punto de atención (a la barista, del otro lado de la isla).
      const s = this.crowd.staffAt(hit.id);
      if (!s) return;
      if (this.mode !== "explore") this.setMode("explore");
      const { talk, floor } = s.spot;
      this.player.spawn(talk.x, talk.z, Math.atan2(s.pos.x - talk.x, s.pos.z - talk.z), FLOOR_Y[floor]);
      this.player.camYaw += 0.4;
      return;
    }
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
        s.monitor?.dispose();
        s.monitor = null;
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
    const roomKey = `${f.minX},${f.maxX},${f.minZ},${f.maxZ}|${layout.pods.map((p) => `${p.project}:${p.desks.length}`).join(",")}|${+this.layers.data}${+this.layers.ceo}${+this.layers.zones}${+!!(this.layers.hd && hdReady())}`;
    if (!this.room || roomKey !== this.roomKey) {
      this.roomKey = roomKey;
      if (this.room) {
        this.scene.remove(this.room.group);
        this.room.dispose();
      }
      this.room = buildRoom(layout, this.palette, this.ownerName, this.layers);
      this.room.setOutdoorViews(this.exteriorOn);
      this.outdoor?.setBounds(this.room.bounds);
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
      this.boards?.dispose();
      this.boards = new WallBoards(this.room.boardSpots, this.palette.font, this.palette.mono);
      this.boards.setData(this.boardsData);
      this.boards.group.traverse((o) => ((o as THREE.Mesh).receiveShadow = true));
      this.scene.add(this.boards.group);
      this.whiteboard?.dispose();
      this.whiteboard = new WallWhiteboard(this.room.whiteboardSpot, this.palette.font);
      this.whiteboard.setImage(this.whiteboardImage);
      this.scene.add(this.whiteboard.group);
      this.queueBoard?.dispose();
      this.queueBoard = new QueueBoard(this.room.queueSpot, this.palette.font);
      this.queueBoard.setState(this.queueData);
      this.scene.add(this.queueBoard.group);
      this.spendBoard?.dispose();
      this.controlWall?.dispose();
      this.spendBoard = null;
      this.controlWall = null;
      if (this.layers.data) {
        this.spendBoard = new SpendBoard(this.room.spendSpot, { font: this.palette.font, mono: this.palette.mono, projectName: this.projectNamer });
        this.spendBoard.setData(this.spendData);
        this.spendBoard.setPlan(this.planData);
        this.scene.add(this.spendBoard.group);
        this.controlWall = new ControlWall(this.room.controlSpot, this.palette);
        this.controlWall.setWorkers(this.workerList, this.nickMap, this.projectNamer);
        this.scene.add(this.controlWall.group);
      }
      // Oficina de CEO: monitor grande de uso, bandeja y agenda.
      for (const old of [this.ceoSpend, this.ceoInbox, this.ceoAgenda, this.meetingScreen]) old?.dispose();
      this.ceoSpend = this.ceoInbox = this.ceoAgenda = this.meetingScreen = null;
      if (this.room.meetingSpot) {
        this.meetingScreen = new MeetingScreen(this.room.meetingSpot, this.palette.font);
        this.meetingScreen.setData(this.calendar, new Date());
        this.scene.add(this.meetingScreen.group);
      }
      const ceo = this.room.ceo;
      if (ceo) {
      this.ceoSpend = new SpendBoard(ceo.spendSpot, { font: this.palette.font, mono: this.palette.mono, projectName: this.projectNamer, big: true, pxPerM: 1300 }, "#1f2024");
      this.ceoSpend.setData(this.spendData);
      this.ceoSpend.setPlan(this.planData);
      this.ceoInbox = new CeoInbox(ceo.inboxSpot, this.palette.font);
      this.ceoInbox.setData(this.workerList, this.nickMap, this.queueData);
      this.ceoAgenda = new CeoAgenda(ceo.agendaSpot, this.palette.font);
      this.ceoAgenda.setData(this.calendar, new Date());
      this.scene.add(this.ceoSpend.group, this.ceoInbox.group, this.ceoAgenda.group);
      }
      if (this.ceoOn) this.exitCeo();
      this.room.setFeed(this.feed);
      this.room.setBoard(this.board);
      // La sala nueva trae su arcade en blanco: su espera con el récord real (o sin récord).
      if (this.game) {
        this.game.dispose();
        this.game = null;
        this.hooks.onGame?.(null);
        this.crowd.reservePoi(null);
      }
      paintArcadeIdle(this.room.arcadeScreen, readBest("arcade"));
      if (this.tvVideo) this.room.setTvVideo(this.tvVideo);
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
    if (this.room) this.crowd.setWorld(this.room, this.navBoxes(layout, this.room), `${this.room.key}|${layout.desks.map((d) => d.id).join(",")}`);
    this.refreshColliders();
    this.refreshVacancies();
  }

  /**
   * Lo que estorba a la gente de ambiente: la sala, los escritorios y, además,
   * cada pod con sus sillas (nadie de ambiente camina entre los agentes) y los NPC con rol.
   */
  private navBoxes(layout: OfficeLayout, room: Room): NavBox[] {
    const pods = layout.desks.map((d) => {
      const a = deskToWorld(d, { x: -DESK_SIZE.width / 2 - 0.25, z: -DESK_SIZE.depth / 2 - 0.25 });
      const b = deskToWorld(d, { x: DESK_SIZE.width / 2 + 0.25, z: SEAT_ANCHOR.z + 0.55 });
      return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), top: 2 };
    });
    // La oficina de CEO es privada: obstáculo solo para la gente de ambiente (el dueño entra por la puerta).
    return [...room.colliders, ...this.deskColliders, ...pods, ...(room.ceo ? [room.ceo.privateZone] : []), ...this.crowd.staticNavBoxes(room)];
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
    if (hit.kind === "tv" || hit.kind === "whiteboard" || hit.kind === "queue" || hit.kind === "game" || hit.kind === "ceo" || hit.kind === "prop" || hit.kind === "cat" || hit.kind === "person") return;
    if (hit.kind === "board" || hit.kind === "spend" || hit.kind === "control") {
      const spot = hit.kind === "board" ? this.boards?.spot(hit.id) : hit.kind === "spend" ? this.room?.spendSpot : this.room?.controlSpot;
      if (!spot) return;
      this.aerialFloor = 0;
      const target = new THREE.Vector3(spot.x, spot.y, spot.z);
      this.focusGoal = { target, pos: target.clone().add(new THREE.Vector3(spot.front.x - spot.x, 1.2, spot.front.z - spot.z).normalize().multiplyScalar(6)) };
      return;
    }
    if (hit.kind === "npc") {
      const s = this.crowd.staffAt(hit.id);
      if (!s) return;
      this.aerialFloor = s.spot.floor;
      const target = new THREE.Vector3(s.pos.x, s.pos.y + 0.8, s.pos.z);
      this.focusGoal = { target, pos: target.clone().add(FRAME_DIR.clone().multiplyScalar(7.5)) };
      return;
    }
    const deskId = hit.kind === "desk" ? hit.id : this.seated.get(hit.id)?.deskId;
    const view = deskId ? this.desks.get(deskId) : undefined;
    if (!view) return;
    const target = new THREE.Vector3(view.desk.x, 0.8, view.desk.z);
    this.focusGoal = { target, pos: target.clone().add(FRAME_DIR.clone().multiplyScalar(7.5)) };
  }

  // ── Personajes ─────────────────────────────────────────────────────────

  /** Quién suena ahora en la llamada del equipo (id + volumen 0..1); lo lee cada frame. */
  speakingProbe: (() => { id: string; level: number } | null) | null = null;

  setWorkers(workers: OfficeWorker[], seats: ReadonlyMap<string, string>, voices?: ReadonlyMap<string, string>, nicks?: ReadonlyMap<string, string>) {
    this.workerList = workers;
    this.nickMap = nicks ?? new Map();
    this.lastSeats = seats;
    this.lastVoices = voices;
    this.controlWall?.setWorkers(workers, this.nickMap, this.projectNamer);
    this.ceoInbox?.setData(workers, this.nickMap, this.queueData);
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
        s.monitor?.dispose();
        this.seated.delete(w.id);
        s = undefined;
      }
      if (!s) {
        const character = new OfficeCharacter(w.id, this.podColor.get(w.project) ?? this.palette.accent, this.palette);
        const laptop = new Laptop(this.palette);
        noOutline(character.root);
        noOutline(laptop.root);
        s = { character, laptop, monitor: null, deskId: null, leaving: false };
        this.seated.set(w.id, s);
      }
      if (s.deskId !== deskId) {
        desk.seatAnchor.add(s.character.root);
        desk.laptopAnchor.add(s.laptop.root);
        s.monitor?.dispose();
        s.monitor = null;
        s.deskId = deskId;
      }
      if (!s.monitor && this.layers.data) {
        s.monitor = new DeskMonitor(desk.desk, this.palette);
        noOutline(s.monitor.root);
        desk.group.add(s.monitor.root);
      }
      s.monitor?.setWorker(w, nicks?.get(w.id) ?? "");
      if (w.status === "done" && s.status && s.status !== "done") {
        const at = s.character.root.getWorldPosition(new THREE.Vector3());
        this.confetti.burst(at.x, at.y + 1.3, at.z, 140);
        // La gente del piso que lo ve, aplaude (capa "Gente viva").
        this.crowd.react("done", at, 0);
      }
      // Recepción avisa (con su voz) cuando un agente levanta la mano: el dato sale de la solicitud real.
      if (w.status === "needs_you" && s.status && s.status !== "needs_you" && w.approval && this.crowd.isLively) {
        this.crowd.staffSay("reception", `${nicks?.get(w.id) ?? w.name} te necesita: ${w.approval.summary}`);
      }
      s.status = w.status;
      s.character.setState(w, voices?.get(w.id), nicks?.get(w.id));
      s.character.setSelected(this.selected?.kind === "worker" && this.selected.id === w.id);
      s.laptop.setLines(w.lines);
    }
    for (const [id, s] of this.seated) {
      if (live.has(id) || s.leaving) continue;
      s.leaving = true;
      s.character.vanish();
      s.laptop.close();
      s.cup?.removeFromParent();
      // El monitor se apaga con su dueño: una pantalla sin agente no muestra nada.
      s.monitor?.dispose();
      s.monitor = null;
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
    if (hit.kind === "game") {
      const a = this.room?.gameSpots[hit.id]?.anchor;
      return a ? this.project(this.tmp.set(a.x, a.y, a.z)) : null;
    }
    if (hit.kind === "prop" || hit.kind === "cat" || hit.kind === "person") return null;
    if (hit.kind === "ceo") {
      const c = this.room?.ceo?.chair;
      return c ? this.project(this.tmp.set(c.x, 1.0, c.z)) : null;
    }
    if (hit.kind === "spend" || hit.kind === "control") {
      const spot = hit.kind === "spend" ? this.room?.spendSpot : this.room?.controlSpot;
      return spot ? this.project(this.tmp.set(spot.x, spot.y, spot.z)) : null;
    }
    if (hit.kind === "tv") return this.room ? this.project(this.tmp.set(this.room.tv.x, this.room.tv.y, this.room.tv.z)) : null;
    if (hit.kind === "whiteboard" || hit.kind === "queue") {
      const wb = hit.kind === "queue" ? this.room?.queueSpot : this.room?.whiteboardSpot;
      return wb ? this.project(this.tmp.set(wb.x, wb.y, wb.z)) : null;
    }
    if (hit.kind === "board") {
      const spot = this.boards?.spot(hit.id);
      return spot ? this.project(this.tmp.set(spot.x, spot.y, spot.z)) : null;
    }
    if (hit.kind === "npc") {
      const s = this.crowd.staffAt(hit.id);
      return s ? this.project(this.tmp.set(s.pos.x, s.pos.y + 1.1, s.pos.z)) : null;
    }
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
    if (this.ceoOn || this.game || this.ownerBusy) {
      if (this.near) {
        this.near = null;
        this.hooks.onNear?.(null);
      }
      return;
    }
    // Los escritorios están en el piso 1: desde arriba no se alcanzan.
    if (this.mode === "explore" && floorAt(this.player.pos.y) === 0) {
      const p = this.player.pos;
      for (const view of this.desks.values()) {
        const seat = deskToWorld(view.desk, { x: 0, z: SEAT_ANCHOR.z });
        const d = Math.hypot(seat.x - p.x, seat.z - p.z);
        if (d > REACH || (best && d >= best.d)) continue;
        let hit: OfficeHit = { kind: "desk", id: view.desk.id };
        for (const [id, s] of this.seated) if (s.deskId === view.desk.id && !s.leaving) hit = { kind: "worker", id };
        best = { hit, d, at: new THREE.Vector3(view.desk.x, DESK_SIZE.height + 0.15, view.desk.z) };
      }
    }
    // La silla de la oficina de CEO (piso 1): sentarse = modo CEO.
    const ceo = this.room?.ceo;
    if (!best && ceo && this.mode === "explore" && !this.ceoOn && floorAt(this.player.pos.y) === 0) {
      const d = Math.hypot(ceo.chair.reach.x - this.player.pos.x, ceo.chair.reach.z - this.player.pos.z);
      if (d <= 1.0) best = { hit: { kind: "ceo", id: "chair" }, d, at: new THREE.Vector3(ceo.chair.x, 1.9, ceo.chair.z) };
    }
    // Tableros y NPC con rol solo si no hay escritorio al alcance: "Contratar aquí" y "Hablar con X" mandan.
    if (!best && this.mode === "explore") {
      const floor = floorAt(this.player.pos.y);
      const s = this.crowd.nearStaff(this.player.pos, floor);
      if (s) best = { hit: { kind: "npc", id: s.role }, d: s.d, at: new THREE.Vector3(s.at.x, s.at.y + 2.35, s.at.z) };
      // La gata a tus pies gana sobre un NPC con rol más lejos (le gusta echarse junto a Recepción).
      const cat = this.interactOn ? this.crowd.catNow : null;
      if (cat && floor === 0) {
        const d = Math.hypot(cat.pos.x - this.player.pos.x, cat.pos.z - this.player.pos.z);
        if (d <= 1.8 && (!best || d < best.d)) best = { hit: { kind: "cat", id: "gata" }, d, at: new THREE.Vector3(cat.pos.x, cat.pos.y + 0.8, cat.pos.z) };
      }
      const b = floor === 0 ? this.boards?.near(this.player.pos.x, this.player.pos.z, BOARD_REACH) : null;
      if (b && (!best || b.d < best.d)) best = { hit: { kind: "board", id: b.id }, d: b.d, at: b.at };
      if (floor === 0 && this.room && this.layers.data) {
        for (const [kind, spot] of [
          ["spend", this.room.spendSpot],
          ["control", this.room.controlSpot],
        ] as const) {
          const d = Math.hypot(spot.front.x - this.player.pos.x, spot.front.z - this.player.pos.z);
          if (d <= BOARD_REACH && (!best || d < best.d)) best = { hit: { kind, id: "wall" }, d, at: new THREE.Vector3(spot.x, spot.y + spot.h / 2 + 0.3, spot.z) };
        }
      }
      const qs = this.room?.queueSpot;
      if (qs && floor === 0) {
        const d = Math.hypot(qs.front.x - this.player.pos.x, qs.front.z - this.player.pos.z);
        if (d <= BOARD_REACH && (!best || d < best.d)) best = { hit: { kind: "queue", id: "main" }, d, at: new THREE.Vector3(qs.x, qs.y + qs.h / 2 + 0.3, qs.z) };
      }
      const wb = this.room?.whiteboardSpot;
      if (wb && floor === 0) {
        const d = Math.hypot(wb.front.x - this.player.pos.x, wb.front.z - this.player.pos.z);
        if (d <= BOARD_REACH && (!best || d < best.d)) best = { hit: { kind: "whiteboard", id: "free" }, d, at: new THREE.Vector3(wb.x, wb.y + wb.h / 2 + 0.3, wb.z) };
      }
      if (this.room && !this.game && this.gamesOn) {
        for (const spot of Object.values(this.room.gameSpots)) {
          if (spot.floor !== floor) continue;
          const d = Math.hypot(spot.stand.x - this.player.pos.x, spot.stand.z - this.player.pos.z);
          if (d <= GAME_REACH && (!best || d < best.d)) best = { hit: { kind: "game", id: spot.id }, d, at: new THREE.Vector3(spot.anchor.x, spot.anchor.y + 0.7, spot.anchor.z) };
        }
      }
      const tv = this.room?.tv;
      if (tv && floor === tv.floor) {
        const d = Math.hypot(tv.front.x - this.player.pos.x, tv.front.z - this.player.pos.z);
        if (d <= BOARD_REACH && (!best || d < best.d)) best = { hit: { kind: "tv", id: "lounge" }, d, at: new THREE.Vector3(tv.x - 0.2, tv.y + 1.2, tv.z) };
      }
    }
    // Lo último: objetos de la sala, la gata y la gente (escritorios, NPC con rol, tableros y juegos mandan).
    if (!best && this.mode === "explore" && this.interactOn && this.room) {
      const p = this.player.pos;
      const floor = floorAt(p.y);
      for (const pr of this.room.props) {
        if (pr.floor !== floor) continue;
        const d = Math.hypot(pr.at.x - p.x, pr.at.z - p.z);
        if (d <= PROP_REACH && (!best || d < best.d)) {
          const sx = pr.seat?.x ?? pr.at.x;
          const sz = pr.seat?.z ?? pr.at.z;
          best = { hit: { kind: "prop", id: pr.id }, d, at: new THREE.Vector3(sx, FLOOR_Y[pr.floor] + 1.6, sz) };
        }
      }
      const cat = this.crowd.catNow;
      if (cat && floor === 0) {
        const d = Math.hypot(cat.pos.x - p.x, cat.pos.z - p.z);
        if (d <= 1.8 && (!best || d < best.d)) best = { hit: { kind: "cat", id: "gata" }, d, at: new THREE.Vector3(cat.pos.x, cat.pos.y + 0.8, cat.pos.z) };
      }
      const person = this.crowd.nearPerson(p, floor, 2.0);
      if (person && (!best || person.d < best.d)) best = { hit: { kind: "person", id: person.id }, d: person.d, at: person.head };
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
    if (this.game && !isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // En un minijuego las teclas son del juego: Esc sale; flechas y Espacio no mueven la página.
      if (e.code === "Escape") {
        this.exitGame();
        return;
      }
      if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
      this.gameKeys.add(e.code);
      return;
    }
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    // En modo CEO las teclas son de la página (recorrer agentes, abrir, levantarse).
    if (this.ceoOn) return;
    if (e.code === "KeyV") {
      this.setMode(this.mode === "explore" ? "aerial" : "explore");
      return;
    }
    // Sentado o preparando algo: E, Espacio, Esc o caminar lo levantan.
    if (this.ownerBusy && /^(KeyE|Space|Escape|KeyW|KeyA|KeyS|KeyD|Arrow)/.test(e.code)) {
      if (e.code === "Space") e.preventDefault();
      this.standUp();
      return;
    }
    if (this.mode === "explore" && this.player.enabled && this.interactOn) {
      if (e.code === "KeyQ") return this.emote("wave");
      if (e.code === "KeyF") return this.emote("dance");
    }
    if (e.code === "KeyE" && this.mode === "explore" && this.near && this.player.enabled) {
      if (this.near.kind === "worker") this.giftCup(this.near.id);
      this.owner.wave();
      this.hooks.onClick?.(this.near);
      return;
    }
    if (e.code === "KeyE" && this.mode === "explore" && !this.near && this.carry) this.sip();
  };

  private hitAt(clientX: number, clientY: number): OfficeHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Viendo el piso 2 o 3, la losa tapa a los agentes: nada del piso 1 se clickea a través de ella.
    if (this.shownFloor > 0) return this.npcHit();
    return this.podHit() ?? this.dataWallHit() ?? this.boardHit() ?? this.whiteboardHit() ?? this.npcHit();
  }

  /** Sala de control (clic en una pantalla = ese agente) y tablero de gasto. */
  private dataWallHit(): OfficeHit | null {
    if (this.controlWall) {
      const hit = this.raycaster.intersectObject(this.controlWall.surface, false)[0];
      if (hit) {
        const id = hit.uv ? this.controlWall.tileAt(hit.uv) : null;
        return id ? { kind: "worker", id } : { kind: "control", id: "wall" };
      }
    }
    for (const b of [this.spendBoard, this.ceoSpend]) if (b && this.raycaster.intersectObject(b.surface, false).length) return { kind: "spend", id: "wall" };
    return null;
  }

  private whiteboardHit(): OfficeHit | null {
    if (this.queueBoard && this.raycaster.intersectObject(this.queueBoard.surface, false).length) return { kind: "queue", id: "main" };
    if (!this.whiteboard) return null;
    return this.raycaster.intersectObject(this.whiteboard.surface, false).length ? { kind: "whiteboard", id: "free" } : null;
  }

  /** Tablero de pared bajo el puntero (piso 1). */
  private boardHit(): OfficeHit | null {
    if (!this.boards) return null;
    const hit = this.raycaster.intersectObjects(this.boards.surfaces(), false)[0];
    const id = hit?.object.userData.boardId;
    return isOfficeBoardId(id) ? { kind: "board", id } : null;
  }

  /** NPC con rol del piso que se ve, bajo el puntero (después de agentes y escritorios). */
  private npcHit(): OfficeHit | null {
    const targets = this.crowd.hitTargets(Math.max(0, this.shownFloor));
    if (!targets.length) return null;
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const role = hit?.object.userData.npcId;
    return isOfficeNpcRole(role) ? { kind: "npc", id: role } : null;
  }

  private podHit(): OfficeHit | null {
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

  /** Al perder el foco se sueltan las teclas (si no, una flecha queda "presionada" para siempre). */
  private onBlur = () => {
    this.gameKeys.clear();
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
    // Las que el dueño apagó con "E" quedan en 0 (sin quitarlas: cambiar cuántas luces hay recompila shaders).
    this.room.lamps.forEach((l, i) => (l.intensity = this.room!.lampFloor[i] === this.shownFloor && !this.lampOff.has(i) ? this.lampBase : 0));
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
    const now = this.now();
    this.sky = skyAt(hourOf(now));
    if (this.outdoor && this.exteriorOn) {
      this.outdoor.update(this.sky, this.scene.fog as THREE.Fog);
      (this.scene.background as THREE.Color).copy((this.scene.fog as THREE.Fog).color);
    }
    if (!this.room) return;
    const d = this.room.tick(now);
    this.ceoAgenda?.setData(this.calendar, new Date());
    this.meetingScreen?.setData(this.calendar, new Date());
    const dark = this.palette.dark;
    const w = this.sky.weights;
    this.sun.intensity = (dark ? 0.55 : 0.7) + d.day * (dark ? 1.05 : 1.4);
    // Sol tibio y largo al atardecer, frío y bajo de noche (la luna), blanco cálido de día.
    this.sun.color.setRGB(0, 0, 0).add(new THREE.Color("#fff1d6").multiplyScalar(w.day)).add(new THREE.Color("#ffa864").multiplyScalar(w.dusk)).add(new THREE.Color("#a9b8ff").multiplyScalar(w.night));
    this.hemi.intensity = (dark ? 0.8 : 1.05) + d.day * 0.4;
    // El cielo del hemisferio es el cielo de verdad (un poco aclarado: la sala no debe verse azul).
    this.hemi.color.set("#fff5e6").lerp(new THREE.Color(this.sky.zenith), this.exteriorOn ? 0.25 : 0);
    // El sol viene de donde está el sol (sobre el centro de la planta).
    if (this.room) {
      const b = this.room.bounds;
      const s = this.sky.sun;
      const c = this.sun.target.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
      this.sun.position.set(c.x + s.x * 40, s.y * 40, c.z + s.z * 40);
    }
    this.lampBase = 0.6 + (1 - d.day) * 2.6;
    this.applyFloorLamps();
  }

  /** La hora que manda: la del reloj o la forzada para QA. */
  private now(): Date {
    if (this.hourOverride === null) return new Date();
    const d = new Date();
    const h = ((this.hourOverride % 24) + 24) % 24;
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    return d;
  }

  /** Fuerza la hora del cielo y la luz (QA y capturas); null vuelve al reloj. */
  setHour(h: number | null) {
    this.hourOverride = h === null || !Number.isFinite(h) ? null : h;
    this.applyDaylight();
  }

  /**
   * Capa "Exterior". Prendida: domo, panorama, calle y ciudad; niebla y fondo
   * con el color del horizonte; las ventanas dejan ver afuera. Apagada: como
   * antes (fondo de la interfaz y el plano neutro).
   */
  private exteriorApplied = false;

  setExterior(on: boolean) {
    if (this.exteriorApplied && on === this.exteriorOn) return;
    this.exteriorApplied = true;
    this.exteriorOn = on;
    if (on && !this.outdoor) {
      this.outdoor = new Outdoor(this.palette.dark);
      this.scene.add(this.outdoor.group);
      if (this.room) this.outdoor.setBounds(this.room.bounds);
      this.loadPanorama();
    }
    if (this.outdoor) this.outdoor.group.visible = on;
    this.outside.visible = !on;
    this.room?.setOutdoorViews(on);
    const bg = new THREE.Color(this.palette.bg);
    if (!on) {
      this.scene.background = bg;
      this.scene.fog = new THREE.Fog(bg, 60, 130);
    } else {
      this.scene.background = new THREE.Color();
      this.scene.fog = new THREE.Fog(new THREE.Color(), 70, 190);
    }
    this.applyDaylight();
  }

  /** Los tres panoramas (día, atardecer, noche) de public/oficina; si fallan, queda el domo con sus cerros. */
  private loadPanorama() {
    if (this.panoramaLoading) return;
    this.panoramaLoading = true;
    const loader = new THREE.TextureLoader();
    const load = (name: string) =>
      new Promise<THREE.Texture>((res, rej) =>
        loader.load(
          `/oficina/panorama-${name}.webp`,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 4;
            res(t);
          },
          undefined,
          rej,
        ),
      );
    Promise.all([load("dia"), load("atardecer"), load("noche")])
      .then(([day, dusk, night]) => {
        if (!this.outdoor) return [day, dusk, night].forEach((t) => t.dispose());
        this.disposables.push(day, dusk, night);
        this.outdoor.setPanorama({ day, dusk, night });
      })
      .catch(() => this.outdoor?.setPanorama(null, "error"));
  }

  private frame(dt: number, now: number) {
    const t = this.t;
    if (now - this.clockAt > 1000) {
      this.clockAt = now;
      this.applyDaylight();
    }
    if (this.ceoOn && this.room?.ceo) {
      // Modo CEO: sentado detrás del escritorio, mirando el salón por el vidrio.
      const c = this.room.ceo.chair;
      const k = 1 - Math.exp(-dt * 4);
      // Los ojos del dueño sentado (él no se dibuja: sus rulos taparían todo): monitores abajo, el salón al fondo.
      this.camera.position.lerp(this.tmp.set(c.x + 0.95, 1.9, c.z + 0.1), k);
      this.gameLook.lerp(this.ceoLook, k);
      this.camera.lookAt(this.gameLook);
    } else if (this.game) {
      // Minijuego: la entrada va al juego y la cámara a su puesto (se desliza hasta ahí).
      const g = this.game;
      const input = this.gameInputNow();
      // Con la partida terminada, la acción (después de un respiro) empieza otra.
      if (g.over) {
        if (!this.gameOverAt) this.gameOverAt = now;
        if (input.pressed && now - this.gameOverAt > 800) {
          g.restart();
          this.gameSaved = false;
          this.gameOverAt = 0;
        }
      } else this.gameOverAt = 0;
      const ev = g.update(dt, input);
      if (ev) {
        this.lastGameEvent = ev;
        this.audio?.game(ev);
        this.hooks.onGameEvent?.(ev, new THREE.Vector3(g.camera.target.x, g.camera.target.y, g.camera.target.z));
      }
      if (g.over && !this.gameSaved) {
        this.gameSaved = true;
        writeBest(g.id, g.score);
      }
      const k = 1 - Math.exp(-dt * 6);
      this.camera.position.lerp(g.camera.pos, k);
      this.gameLook.lerp(g.camera.target, k);
      // Sin player.update: reubicaría la cámara detrás del dueño en cada frame.
      this.camera.lookAt(this.gameLook);
      if (now - this.gameHudAt > 100) {
        this.gameHudAt = now;
        this.emitGameHud();
      }
    } else if (this.mode === "explore") {
      const pad = this.padInput;
      this.player.setPad(pad.move.x, pad.move.y, pad.run);
      if (pad.look.x || pad.look.y) this.player.padLook(pad.look.x, pad.look.y, dt);
      if (pad.zoom) this.player.zoom(pad.zoom * 900 * dt);
      this.player.people = this.crowd.peopleColliders(this.peopleBuf);
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
    // Jugando, la cámara es la del juego: el dueño taparía la mesa o la pantalla.
    if (this.game) this.owner.root.visible = false;
    this.tickActivity(now);
    // Sentado: el cuerpo va al cojín (el controlador se queda de pie al lado, para la cámara).
    const act = this.activity;
    if (act?.kind === "sit" && act.prop.seat) {
      const st = act.prop.seat;
      this.owner.root.position.set(st.x, FLOOR_Y[act.prop.floor] + st.y - PERSON_SEAT_OFFSET, st.z);
    }
    // Sentado en la silla ejecutiva; la cámara son sus ojos, así que no se dibuja.
    if (this.ceoOn && this.room?.ceo) {
      const c = this.room.ceo.chair;
      this.owner.root.position.set(c.x, c.seatY - PERSON_SEAT_OFFSET, c.z);
      this.owner.root.visible = false;
    }
    this.owner.root.rotation.y = this.ceoOn && this.room?.ceo ? this.room.ceo.chair.facing : act?.kind === "sit" || act?.kind === "make" ? act.prop.facing : this.player.facing;
    this.owner.update(dt, t, this.mode === "explore" ? this.player.speed : 0, !this.player.grounded);
    this.crowd.update(dt, t, this.player.pos, this.shownFloor);
    this.syncVoices(now);

    const explore = this.mode === "explore";
    const speaking = this.speakingProbe?.() ?? null;
    // Lo que no se ve no se repinta: monitores y sala de control solo dentro de cámara y en el piso 1.
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const floor1 = this.shownFloor <= 0;
    for (const [id, s] of this.seated) {
      s.character.setTalking(speaking?.id === id ? 0.35 + Math.min(1, speaking.level * 2.5) * 0.65 : 0);
      s.character.update(dt, t);
      const pos = s.character.root.getWorldPosition(this.tmp);
      const dist = pos.distanceTo(this.camera.position);
      s.laptop.update(dt, dist);
      if (s.monitor) s.monitor.update(now, dist, floor1 && this.frustum.containsPoint(pos));
      // En explorar: tarjetas más chicas y solo las de los agentes cercanos (o el seleccionado).
      const mine = this.selected?.kind === "worker" && this.selected.id === id;
      s.character.setCard(explore ? 0.72 : 1, !explore || dist < 13 || mine);
      if (s.leaving && s.character.gone) {
        s.character.root.removeFromParent();
        s.laptop.root.removeFromParent();
        s.character.dispose();
        s.laptop.dispose();
        s.monitor?.dispose();
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

    if (this.controlWall) {
      const cw = this.controlWall;
      this.sphere.center.set(cw.spot.x, cw.spot.y, cw.spot.z);
      this.sphere.radius = cw.spot.w / 2;
      cw.update(now, floor1 && this.frustum.intersectsSphere(this.sphere));
    }
    this.room?.animate(t);
    this.confetti.update(dt);
    if (this.audio?.on) this.feedAudio(now);
    if (this.outdoor && this.exteriorOn) this.outdoor.follow(this.camera);
    this.renderer.info.reset();
    this.effect.render(this.scene, this.camera);
    this.sampleRender();
    this.emitAnchors();

    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
  }

  /** Lo que el sonido necesita de la escena (quién teclea se recalcula 4 veces por segundo). */
  private feedAudio(now: number) {
    if (now - this.typistsAt > 250) {
      this.typistsAt = now;
      this.typists = [];
      for (const [id, s] of this.seated) {
        if (s.leaving || s.status !== "working") continue;
        this.typists.push({ id, pos: s.character.root.getWorldPosition(new THREE.Vector3()) });
      }
    }
    const e = this.room?.espresso;
    if (e) this.espressoAt.set(e.x, e.y, e.z);
    this.audio!.frame({
      camera: this.camera,
      floor: Math.max(0, this.shownFloor),
      owner: { pos: this.player.pos, speed: this.mode === "explore" && !this.game && !this.ceoOn ? this.player.speed : 0, grounded: this.player.grounded, running: this.player.speed > 1.2 },
      typists: this.typists,
      espresso: e ? this.espressoAt : null,
    });
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
    if (this.hooks.onNpcs) {
      const explore = this.mode === "explore";
      this.hooks.onNpcs(
        this.crowd.staffHeads().map((h) => {
          const far = explore && h.at.distanceTo(this.camera.position) > 12;
          const a = this.project(h.at);
          return { role: h.role, ...a, visible: a.visible && h.visible && !far };
        }),
      );
    }
    if (this.hooks.onTalk) {
      const explore = this.mode === "explore";
      this.hooks.onTalk(
        this.crowd.talkBubbles().map((b) => {
          const far = b.at.distanceTo(this.camera.position) > (explore ? 16 : 40);
          const a = this.project(b.at);
          // El globo del saludo (onBubble) manda sobre el de la charla de la misma persona.
          const greeted = this.bubble?.id === b.id;
          return { id: b.id, text: b.text, ...a, visible: a.visible && !far && !greeted && b.floor <= this.shownFloor };
        }),
      );
    }
    if (this.hooks.onBubble) {
      const b = this.bubble;
      if (b && this.t < b.until && this.crowd.headOf(b.id, this.bubbleAt)) this.hooks.onBubble(this.project(this.bubbleAt), b.text);
      else if (b) {
        this.bubble = null;
        this.hooks.onBubble(null, "");
      }
    }
    if (this.hooks.onPlayer) {
      const head = this.project(this.tmp.set(this.player.pos.x, this.player.pos.y + 2.05, this.player.pos.z));
      // Mientras alguien te habla, su globo manda: el aviso "E · Saludar" no se le encima.
      const talking = this.bubble && this.near?.kind === "person" && this.near.id === this.bubble.id;
      const near = this.near && !talking ? this.project(this.tmp.copy(this.nearAt)) : null;
      this.hooks.onPlayer(head, near);
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private disposed = false;

  dispose() {
    this.disposed = true;
    this.stop();
    this.observer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.exitGame();
    this.controls.dispose();
    this.player.dispose();
    this.owner.dispose();
    this.crowd.dispose();
    this.boards?.dispose();
    this.whiteboard?.dispose();
    this.queueBoard?.dispose();
    this.spendBoard?.dispose();
    this.controlWall?.dispose();
    this.ceoSpend?.dispose();
    this.ceoInbox?.dispose();
    this.ceoAgenda?.dispose();
    this.meetingScreen?.dispose();
    for (const s of this.seated.values()) {
      s.character.dispose();
      s.laptop.dispose();
      s.monitor?.dispose();
    }
    this.seated.clear();
    for (const view of this.desks.values()) view.dispose();
    this.desks.clear();
    for (const r of this.rugs) {
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    this.room?.dispose();
    this.outdoor?.dispose();
    for (const d of this.disposables) d.dispose();
    this.confetti.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
