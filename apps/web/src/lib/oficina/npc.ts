// La gente del edificio en la Oficina: personas de ambiente que van por café,
// se sientan en el sofá, juegan ping-pong o miran por la ventana en los tres
// pisos, y tres NPC con rol y lugar fijo a los que se les habla (Recepción,
// Barista y Respiro en la azotea).
//
// NO son agentes y se nota a simple vista: son humanos chibi (`Person`, como el
// dueño) y no frijoles con audífonos; nunca se sientan en un escritorio de pod,
// no tienen bombilla ni tarjeta de estado y no cuentan en el HUD ni en la
// pizarra (el mundo no los mezcla con los personajes de las sesiones).
//
// Quién va a dónde lo decide el planificador puro (office-ambient.ts); por
// dónde camina, la rejilla de capas (office-nav.ts), que sube las escaleras
// escalón por escalón. Todo detrás del interruptor "Ambiente": apagado, nada
// de esto existe en la escena.

import * as THREE from "three";
import {
  AmbientPlanner,
  NavGrid,
  ambientPopulation,
  floorOfHeight,
  mulberry32,
  type AmbientActivity,
  type AmbientPoi,
  type AmbientSlot,
  type NavBox,
  type NavPoint,
  type OfficeNpcRole,
} from "@hermes/shared";
import { Person, PERSON_SEAT_OFFSET, type PersonPose } from "./person";
import { FLOOR_Y, type NpcSpot, type Room } from "./room";
import type { Collider } from "./player";
import { HAIR_COLORS, HAIR_STYLES, SHIRT_COLORS, SKIN_TONES, type OwnerLook } from "./look";
import { mesh, noOutline, roundedBox, toon } from "./toon";
import { OfficeCat } from "./pet";

const WALK_SPEED = 1.6;
/** Distancia a la que "E" alcanza a un NPC con rol (desde él o desde su punto de atención). */
export const NPC_REACH = 1.9;
const SEAT_TIME = 0.45;

const POSE_OF: Record<AmbientActivity, PersonPose> = {
  coffee: "cup",
  water: "cup",
  snack: "point",
  sit: "sit",
  window: "window",
  board: "point",
  books: "point",
  tv: "sit",
  pingpong: "paddle",
  foosball: "hands",
  darts: "throw",
  arcade: "hands",
  lights: "lookup",
  view: "window",
};

/** Peinados de la gente: sin "Rulos" (es el del dueño) ni "Rizado" (70 esferas: caro por persona). */
const CROWD_STYLES = ["Corto", "Largo", "Moño", "Puntas", "Cola", "Calvo"].map((s) => HAIR_STYLES.indexOf(s as (typeof HAIR_STYLES)[number]));

/** Apariencia sembrada de una persona de ambiente (camiseta nunca blanca: esa es la del dueño). */
function crowdLook(rng: () => number): OwnerLook {
  const pick = (n: number) => Math.floor(rng() * n);
  return {
    skin: pick(SKIN_TONES.length),
    hair: pick(HAIR_COLORS.length),
    style: CROWD_STYLES[pick(CROWD_STYLES.length)],
    shirt: 1 + pick(SHIRT_COLORS.length - 1),
    beard: rng() < 0.18,
    glasses: rng() < 0.25,
    extras: false,
  };
}

const STAFF_LOOK: Record<OfficeNpcRole, OwnerLook> = {
  reception: { skin: 2, hair: 0, style: HAIR_STYLES.indexOf("Moño"), shirt: 2, beard: false, glasses: true, extras: false },
  barista: { skin: 6, hair: 1, style: HAIR_STYLES.indexOf("Cola"), shirt: 5, beard: false, glasses: false, extras: false },
  rooftop: { skin: 4, hair: 3, style: HAIR_STYLES.indexOf("Puntas"), shirt: 3, beard: true, glasses: false, extras: false },
  queue: { skin: 7, hair: 4, style: HAIR_STYLES.indexOf("Largo"), shirt: 6, beard: false, glasses: true, extras: false },
};

type NpcState = "idle" | "walking" | "seating" | "unseating" | "at";

class Npc {
  readonly person: Person;
  readonly root: THREE.Object3D;
  readonly pos = new THREE.Vector3();
  facing = 0;
  path: NavPoint[] = [];
  pathI = 0;
  state: NpcState = "idle";
  poi: AmbientPoi | null = null;
  slot: AmbientSlot | null = null;
  /** Orden del planificador que espera camino (se calcula uno por frame). */
  pending: { poi: AmbientPoi; slot: AmbientSlot } | null = null;
  seatT = 0;
  readonly seatFrom = new THREE.Vector3();
  readonly seatTo = new THREE.Vector3();
  /** Tiempo detenido frente al dueño (después de un rato, se hace a un lado). */
  waitT = 0;
  /** Sin lugar para hacerse a un lado (una escalera): pasa de largo hasta este momento. */
  passUntil = 0;
  speed = 0;
  pose: PersonPose = "stand";
  /** Solo los NPC con rol: caja invisible para el clic en vista aérea. */
  hitbox: THREE.Mesh | null = null;
  talking = false;
  /** Barista: mira a la cafetera un rato cada tanto. */
  busyUntil = 0;
  nextBusy = 0;

  constructor(
    readonly id: string,
    look: OwnerLook,
    readonly role?: OfficeNpcRole,
  ) {
    this.person = new Person(look);
    this.root = this.person.root;
    this.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    noOutline(this.root);
    if (role) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
      (box.material as THREE.Material).userData.outlineParameters = { visible: false };
      box.position.y = 0.95;
      box.userData.npcId = role;
      this.root.add(box);
      this.hitbox = box;
    }
  }

  setPose(p: PersonPose) {
    if (p === this.pose) return;
    this.pose = p;
    this.person.setPose(p);
    noOutline(this.root); // la taza o la raqueta recién creadas
  }

  dispose() {
    this.root.removeFromParent();
    this.person.dispose();
    if (this.hitbox) {
      this.hitbox.geometry.dispose();
      (this.hitbox.material as THREE.Material).dispose();
    }
  }
}

/** Mandil de la barista: se lee "trabaja aquí" desde lejos. */
function apron(): THREE.Group {
  const g = new THREE.Group();
  const cloth = toon("#6f4e37");
  g.add(mesh(roundedBox(0.36, 0.42, 0.04, 0.02), cloth, 0, 0.66, 0.27, false));
  g.add(mesh(new THREE.TorusGeometry(0.27, 0.012, 4, 20), cloth, 0, 0.82, 0, false));
  g.children[1].rotation.x = Math.PI / 2;
  return g;
}

/** Atril de recepción: madera y una tablet con luz. */
function podium(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.55, 1.05, 1.0, 0.05), toon("#a86b44"), 0, 0.525, 0));
  g.add(mesh(roundedBox(0.62, 0.05, 1.08, 0.02), toon("#1f2024"), 0, 1.075, 0));
  const tab = mesh(new THREE.BoxGeometry(0.02, 0.22, 0.32), toon("#2b2d42", { emissive: "#3a86ff" }), 0.12, 1.2, 0, false);
  tab.rotation.z = 0.35;
  g.add(tab);
  return g;
}

export interface CrowdDebug {
  id: string;
  role: OfficeNpcRole | null;
  floor: number;
  x: number;
  y: number;
  z: number;
  activity: string | null;
  state: string;
}

export class OfficeCrowd {
  readonly group = new THREE.Group();
  private nav: NavGrid | null = null;
  private navKey = "";
  private room: Room | null = null;
  private boxes: NavBox[] = [];
  private worldKey = "";
  private planner: AmbientPlanner | null = null;
  /** Lugares que quedaron tras ajustarlos a la rejilla (y los descartados, para el QA). */
  private poiIds: { kept: string[]; dropped: string[] } = { kept: [], dropped: [] };
  private readonly people = new Map<string, Npc>();
  private readonly staff = new Map<OfficeNpcRole, Npc>();
  private props: THREE.Object3D[] = [];
  /** La gata del piso de los equipos. */
  private cat: OfficeCat | null = null;
  private enabled = false;
  private sessions = 0;
  private seed = 1;
  private looks: () => number = mulberry32(1);
  private nextId = 0;
  private queue: string[] = [];
  private t = 0;
  private shownFloor = 0;
  /** Cuántas personas cruzaron de piso (QA: alguien usa la escalera). */
  floorChanges = 0;

  /** La sala o los pods cambiaron. La rejilla se rehace solo si cambia `key` (y solo con el ambiente prendido). */
  setWorld(room: Room, boxes: NavBox[], key: string) {
    // La sala se reconstruye cuando cambian los pods; si su tamaño es el mismo,
    // los lugares también: la gente sigue donde está (solo la rejilla se rehace).
    const roomChanged = !this.room || room.key !== this.room.key;
    this.room = room;
    this.boxes = boxes;
    this.worldKey = key;
    if (!this.enabled) return;
    if (roomChanged) this.restart();
    else this.ensureNav();
  }

  /** Prende/apaga el ambiente; `sessions` (vivas) decide cuánta gente; una semilla nueva rehace la coreografía. */
  setEnabled(on: boolean, sessions: number, seed?: number) {
    const reseed = seed !== undefined && seed !== this.seed;
    if (seed !== undefined) this.seed = seed;
    this.sessions = sessions;
    if (!on) {
      if (this.enabled) this.clear();
      this.enabled = false;
      return;
    }
    if (!this.enabled || reseed) {
      this.enabled = true;
      this.restart();
      return;
    }
    this.fitPopulation();
  }

  get on() {
    return this.enabled;
  }

  private ensureNav(): NavGrid | null {
    const room = this.room;
    if (!room) return null;
    if (this.nav && this.navKey === this.worldKey) return this.nav;
    this.navKey = this.worldKey;
    this.nav = new NavGrid({ bounds: room.bounds, boxes: this.boxes, floorY: FLOOR_Y });
    return this.nav;
  }

  private clear() {
    for (const n of [...this.people.values(), ...this.staff.values()]) n.dispose();
    this.people.clear();
    this.staff.clear();
    for (const p of this.props) {
      p.removeFromParent();
      p.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    this.props = [];
    this.cat?.dispose();
    this.cat = null;
    this.planner = null;
    this.queue = [];
  }

  private restart() {
    this.clear();
    const room = this.room;
    const nav = this.ensureNav();
    if (!room || !nav) return;
    this.looks = mulberry32(this.seed * 7919 + 13);
    this.nextId = 0;
    this.floorChanges = 0;

    // Lugares: cada puesto se ajusta a la rejilla (un puesto sin piso firme se descarta).
    const pois: AmbientPoi[] = [];
    for (const poi of room.pois) {
      const slots = poi.slots.flatMap((s) => {
        const p = nav.snap(poi.floor, s.x, s.z, 0.8);
        return p ? [{ ...s, x: p.x, z: p.z }] : [];
      });
      if (slots.length === poi.slots.length) pois.push({ ...poi, slots });
    }
    this.poiIds = { kept: pois.map((p) => p.id), dropped: room.pois.filter((p) => !pois.some((q) => q.id === p.id)).map((p) => p.id) };
    this.planner = new AmbientPlanner(pois, this.seed);
    this.planner.reserve(this.reservedPoi, this.t);

    for (const role of ["reception", "barista", "rooftop", "queue"] as const) this.addStaff(role, room.npcSpots[role]);
    const rp = room.npcSpots.reception;
    const desk = podium();
    desk.position.set(rp.x - 0.75, FLOOR_Y[0], rp.z);
    desk.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    noOutline(desk);
    this.group.add(desk);
    this.props.push(desk);

    // La gata arranca en algún punto del piso de los equipos.
    const catAt = nav.snap(0, room.door.x - 3, room.door.z - 4, 3);
    if (catAt) {
      this.cat = new OfficeCat(mulberry32(this.seed * 31 + 7));
      this.cat.place(catAt);
      this.group.add(this.cat.root);
    }

    // La oficina abre viva: cada uno ya está en algún lugar.
    for (let i = 0; i < ambientPopulation(this.sessions); i++) this.addPerson(true);
  }

  private addStaff(role: OfficeNpcRole, spot: NpcSpot) {
    const n = new Npc(`npc:${role}`, STAFF_LOOK[role], role);
    if (role === "barista") n.root.add(apron());
    n.pos.set(spot.x, FLOOR_Y[spot.floor], spot.z);
    n.facing = spot.facing;
    n.state = "at";
    n.setPose(role === "rooftop" ? "window" : "stand");
    n.nextBusy = this.t + 6;
    this.group.add(n.root);
    this.staff.set(role, n);
  }

  private addPerson(settled: boolean) {
    const planner = this.planner;
    const room = this.room;
    if (!planner || !room) return;
    const id = `amb-${this.nextId++}`;
    const n = new Npc(id, crowdLook(this.looks));
    this.people.set(id, n);
    this.group.add(n.root);
    planner.add(id, 0, this.t);
    const placed = settled ? planner.place(id, this.t) : null;
    if (placed) {
      const slot = placed.poi.slots[placed.slot];
      n.poi = placed.poi;
      n.slot = slot;
      n.facing = slot.facing;
      n.state = "at";
      if (slot.seat) {
        n.pos.set(slot.seat.x, FLOOR_Y[placed.poi.floor] + slot.seat.y - PERSON_SEAT_OFFSET, slot.seat.z);
        n.setPose("sit");
      } else {
        n.pos.set(slot.x, FLOOR_Y[placed.poi.floor], slot.z);
        n.setPose(POSE_OF[placed.poi.activity]);
      }
    } else {
      // Quien llega después entra por la puerta.
      n.pos.set(room.door.x, 0, room.door.z);
      n.facing = Math.PI;
    }
  }

  /** Ajusta cuánta gente hay a las sesiones vivas: llegan por la puerta, se van los últimos en llegar. */
  private fitPopulation() {
    if (!this.planner) return;
    const want = ambientPopulation(this.sessions);
    while (this.people.size < want) this.addPerson(false);
    while (this.people.size > want) {
      const id = [...this.people.keys()].pop()!;
      this.people.get(id)!.dispose();
      this.people.delete(id);
      this.planner.remove(id);
      this.queue = this.queue.filter((q) => q !== id);
    }
  }

  private reservedPoi: string | null = null;

  /** La rejilla de la gente (null con el ambiente apagado): mide el espacio vacío de cada piso. */
  get navGrid(): NavGrid | null {
    return this.nav;
  }

  /** El dueño juega en ese lugar (un minijuego): quien estaba se aparta y nadie va hasta liberarlo. */
  reservePoi(id: string | null): string[] {
    this.reservedPoi = id;
    return this.planner?.reserve(id, this.t) ?? [];
  }

  // ── Por frame ─────────────────────────────────────────────────────────

  update(dt: number, t: number, owner: THREE.Vector3, shownFloor: number) {
    this.t = t;
    this.shownFloor = shownFloor;
    if (!this.enabled || !this.planner || !this.nav) return;
    const nav = this.nav;
    for (const o of this.planner.tick(t)) {
      const n = this.people.get(o.id);
      if (!n) continue;
      n.pending = { poi: o.poi, slot: o.poi.slots[o.slot] };
      if (n.state === "at" && n.slot?.seat) this.unseat(n);
      if (!this.queue.includes(o.id)) this.queue.push(o.id);
    }
    // Un camino por frame: A* entre pisos puede tardar unos ms y no debe juntarse.
    for (let k = 0; k < this.queue.length; k++) {
      const id = this.queue[k];
      const n = this.people.get(id);
      if (!n || n.state === "unseating") continue;
      this.queue.splice(k, 1);
      if (n.pending) this.route(n, nav);
      break;
    }

    for (const n of this.people.values()) this.step(n, dt, t, owner, nav);
    if (this.cat && this.room) {
      this.cat.update(dt, t, nav, this.room.bounds, owner);
      this.cat.root.visible = floorOfHeight(this.cat.pos.y + 0.05, FLOOR_Y) <= shownFloor;
    }
    for (const [role, n] of this.staff) this.stepStaff(role, n, dt, t, owner);

    for (const n of [...this.people.values(), ...this.staff.values()]) {
      n.root.position.copy(n.pos);
      n.root.rotation.y = n.facing;
      n.root.visible = floorOfHeight(n.pos.y + 0.05, FLOOR_Y) <= shownFloor;
      n.person.update(dt, t, n.speed, false);
    }
  }

  private route(n: Npc, nav: NavGrid) {
    const goal = n.pending!;
    n.pending = null;
    const y = FLOOR_Y[goal.poi.floor];
    const path = nav.findPath({ x: n.pos.x, y: n.pos.y, z: n.pos.z }, { x: goal.slot.x, y, z: goal.slot.z });
    if (!path) {
      this.planner?.failed(n.id, this.t);
      n.state = "idle";
      return;
    }
    n.poi = goal.poi;
    n.slot = goal.slot;
    n.path = path;
    n.pathI = path.length > 1 ? 1 : 0;
    n.state = "walking";
    n.waitT = 0;
    n.setPose("stand");
  }

  private unseat(n: Npc) {
    const s = n.slot!;
    n.state = "unseating";
    n.seatT = 0;
    n.seatFrom.copy(n.pos);
    n.seatTo.set(s.x, FLOOR_Y[n.poi?.floor ?? 0], s.z);
    n.setPose("stand");
  }

  private turnTo(n: Npc, want: number, dt: number, rate = 8) {
    const diff = Math.atan2(Math.sin(want - n.facing), Math.cos(want - n.facing));
    n.facing += diff * Math.min(1, dt * rate);
  }

  private step(n: Npc, dt: number, t: number, owner: THREE.Vector3, nav: NavGrid) {
    n.speed += ((n.state === "walking" ? 0.6 : 0) - n.speed) * Math.min(1, dt * 10);
    if (n.state === "seating" || n.state === "unseating") {
      n.seatT = Math.min(1, n.seatT + dt / SEAT_TIME);
      const k = n.seatT * n.seatT * (3 - 2 * n.seatT);
      n.pos.lerpVectors(n.seatFrom, n.seatTo, k);
      if (n.seatT >= 1) {
        if (n.state === "seating") {
          n.state = "at";
          n.setPose("sit");
        } else n.state = "idle";
      }
      if (n.state === "seating" && n.slot) this.turnTo(n, n.slot.facing, dt);
      return;
    }
    if (n.state === "at") {
      if (n.slot) this.turnTo(n, n.slot.facing, dt, 5);
      // Esperando pareja (ping-pong, futbolín): de pie, sin jugar solo.
      const phase = this.planner?.people.get(n.id)?.phase;
      if (n.poi && !n.slot?.seat) n.setPose(phase === "waiting" ? "stand" : POSE_OF[n.poi.activity]);
      return;
    }
    if (n.state !== "walking") return;
    const target = n.path[n.pathI];
    const dx = target.x - n.pos.x;
    const dz = target.z - n.pos.z;
    const dist = Math.hypot(dx, dz);
    // El dueño en el camino: se detiene y, si sigue ahí, se hace a un lado.
    const ox = owner.x - n.pos.x;
    const oz = owner.z - n.pos.z;
    const od = Math.hypot(ox, oz);
    const sameFloor = Math.abs(owner.y - n.pos.y) < 1.2;
    if (t >= n.passUntil && sameFloor && od < 1.05 && dist > 0.01 && (ox * dx + oz * dz) / (od * dist + 1e-6) > 0.2) {
      n.waitT += dt;
      n.speed *= 0.8;
      this.turnTo(n, Math.atan2(ox, oz), dt, 3);
      if (n.waitT > 1.2 && n.waitT - dt <= 1.2) {
        const px = -dz / (dist || 1);
        const pz = dx / (dist || 1);
        for (const side of [1, -1]) {
          const sx = n.pos.x + px * side * 0.8;
          const sz = n.pos.z + pz * side * 0.8;
          const at = { x: sx, y: nav.heightAt(sx, sz, n.pos.y), z: sz };
          if (Math.hypot(sx - owner.x, sz - owner.z) > 0.9 && nav.clear({ x: n.pos.x, y: n.pos.y, z: n.pos.z }, at)) {
            n.path.splice(n.pathI, 0, at);
            n.waitT = 0;
            break;
          }
        }
      }
      // Sin a dónde hacerse (escalera, pasillo angosto): no se queda trabado; sigue.
      if (n.waitT > 3.5) {
        n.waitT = 0;
        n.passUntil = t + 2.5;
      }
      return;
    }
    n.waitT = 0;
    const move = WALK_SPEED * dt;
    if (dist <= move) {
      n.pos.x = target.x;
      n.pos.z = target.z;
      n.pathI++;
    } else {
      n.pos.x += (dx / dist) * move;
      n.pos.z += (dz / dist) * move;
      this.turnTo(n, Math.atan2(dx, dz), dt);
    }
    // La altura sale de la rejilla: escalón por escalón en la escalera (suavizado corto).
    const before = floorOfHeight(n.pos.y + 0.05, FLOOR_Y);
    const ground = nav.heightAt(n.pos.x, n.pos.z, n.pos.y);
    n.pos.y += (ground - n.pos.y) * Math.min(1, dt * 14);
    if (Math.abs(ground - n.pos.y) < 0.01) n.pos.y = ground;
    if (floorOfHeight(n.pos.y + 0.05, FLOOR_Y) !== before) this.floorChanges++;
    if (n.pathI >= n.path.length) this.arrive(n, t);
  }

  private arrive(n: Npc, t: number) {
    const slot = n.slot;
    const floor = n.poi?.floor ?? 0;
    n.pos.y = FLOOR_Y[floor];
    this.planner?.arrived(n.id, t);
    if (slot?.seat) {
      n.state = "seating";
      n.seatT = 0;
      n.seatFrom.copy(n.pos);
      n.seatTo.set(slot.seat.x, FLOOR_Y[floor] + slot.seat.y - PERSON_SEAT_OFFSET, slot.seat.z);
      return;
    }
    n.state = "at";
    if (n.poi) n.setPose(POSE_OF[n.poi.activity]);
  }

  private stepStaff(role: OfficeNpcRole, n: Npc, dt: number, t: number, owner: THREE.Vector3) {
    const spot = this.room?.npcSpots[role];
    if (!spot) return;
    n.speed = 0;
    if (n.talking) {
      // Habla con el dueño: lo mira.
      this.turnTo(n, Math.atan2(owner.x - n.pos.x, owner.z - n.pos.z), dt, 6);
      n.setPose("stand");
      return;
    }
    if (role === "barista") {
      // Cada tanto se voltea a la cafetera y prepara algo.
      if (t >= n.nextBusy) {
        n.busyUntil = t + 4 + (t % 3);
        n.nextBusy = n.busyUntil + 10 + (t % 7);
      }
      const busy = t < n.busyUntil;
      this.turnTo(n, busy ? -Math.PI / 2 : spot.facing, dt, 4);
      n.setPose(busy ? "hands" : "stand");
      return;
    }
    this.turnTo(n, spot.facing, dt, 4);
    n.setPose(role === "rooftop" ? "window" : "stand");
  }

  // ── Lo que pide el mundo ──────────────────────────────────────────────

  /** El NPC con rol al alcance del dueño (en su piso), con su distancia. */
  nearStaff(owner: THREE.Vector3, floor: number): { role: OfficeNpcRole; d: number; at: THREE.Vector3 } | null {
    if (!this.enabled) return null;
    let best: { role: OfficeNpcRole; d: number; at: THREE.Vector3 } | null = null;
    for (const [role, n] of this.staff) {
      const spot = this.room?.npcSpots[role];
      if (!spot || spot.floor !== floor) continue;
      const d = Math.min(Math.hypot(n.pos.x - owner.x, n.pos.z - owner.z), Math.hypot(spot.talk.x - owner.x, spot.talk.z - owner.z));
      if (d > NPC_REACH || (best && d >= best.d)) continue;
      best = { role, d, at: n.pos };
    }
    return best;
  }

  /** Cajas de clic de los NPC con rol en el piso que se ve (en los de abajo, la losa los tapa). */
  hitTargets(shownFloor: number): THREE.Object3D[] {
    if (!this.enabled) return [];
    const out: THREE.Object3D[] = [];
    for (const [role, n] of this.staff) if (n.hitbox && this.room?.npcSpots[role].floor === shownFloor) out.push(n.hitbox);
    return out;
  }

  staffAt(role: OfficeNpcRole): { pos: THREE.Vector3; spot: NpcSpot } | null {
    const n = this.staff.get(role);
    const spot = this.room?.npcSpots[role];
    return n && spot ? { pos: n.pos, spot } : null;
  }

  /** Empieza o termina una conversación: el NPC mira al dueño y saluda. */
  setTalking(role: OfficeNpcRole | null) {
    for (const [r, n] of this.staff) {
      const on = r === role;
      if (on && !n.talking) n.person.wave();
      n.talking = on;
    }
  }

  /** Cajas fijas que estorban al dueño (el atril y los NPC con rol). */
  staticColliders(): Collider[] {
    if (!this.enabled || !this.room) return [];
    const out: Collider[] = [];
    for (const [, spot] of Object.entries(this.room.npcSpots)) {
      const y = FLOOR_Y[spot.floor];
      out.push({ minX: spot.x - 0.28, maxX: spot.x + 0.28, minZ: spot.z - 0.28, maxZ: spot.z + 0.28, bottom: y, top: y + 1.7 });
    }
    const rp = this.room.npcSpots.reception;
    out.push({ minX: rp.x - 1.03, maxX: rp.x - 0.47, minZ: rp.z - 0.5, maxZ: rp.z + 0.5, bottom: 0, top: 1.1 });
    return out;
  }

  /** Lo mismo como cajas de navegación: la gente de ambiente tampoco atraviesa a los NPC. */
  staticNavBoxes(room: Room): NavBox[] {
    const out: NavBox[] = [];
    for (const spot of Object.values(room.npcSpots)) {
      const y = FLOOR_Y[spot.floor];
      out.push({ minX: spot.x - 0.25, maxX: spot.x + 0.25, minZ: spot.z - 0.25, maxZ: spot.z + 0.25, bottom: y, top: y + 1.7 });
    }
    const rp = room.npcSpots.reception;
    out.push({ minX: rp.x - 1.03, maxX: rp.x - 0.47, minZ: rp.z - 0.5, maxZ: rp.z + 0.5, bottom: 0, top: 1.1 });
    return out;
  }

  /**
   * La gente quieta en su lugar como cajas (el dueño choca con ellas). Quien
   * camina NO bloquea al dueño: es quien esquiva. Si bloqueara, en la escalera
   * (sin a dónde hacerse a un lado) los dos se quedaban esperándose.
   */
  peopleColliders(out: Collider[]): Collider[] {
    out.length = 0;
    if (!this.enabled) return out;
    for (const n of this.people.values()) {
      if (n.state !== "at" || n.slot?.seat) continue; // sentado: el mueble ya estorba
      out.push({ minX: n.pos.x - 0.22, maxX: n.pos.x + 0.22, minZ: n.pos.z - 0.22, maxZ: n.pos.z + 0.22, bottom: n.pos.y, top: n.pos.y + 1.6 });
    }
    return out;
  }

  /** Cabeza de cada NPC con rol, para su etiqueta (solo los del piso que se ve: los de abajo quedan bajo la losa). */
  staffHeads(): { role: OfficeNpcRole; at: THREE.Vector3; visible: boolean }[] {
    if (!this.enabled) return [];
    return [...this.staff].map(([role, n]) => ({
      role,
      at: new THREE.Vector3(n.pos.x, n.pos.y + 2.05, n.pos.z),
      visible: n.root.visible && this.room?.npcSpots[role].floor === this.shownFloor,
    }));
  }

  debug(): {
    npcs: CrowdDebug[];
    cat: { x: number; z: number } | null;
    floorChanges: number;
    seed: number;
    navNodes: number;
    pois: { kept: string[]; dropped: string[] };
  } {
    const row = (n: Npc): CrowdDebug => ({
      id: n.role ?? n.id,
      role: n.role ?? null,
      floor: floorOfHeight(n.pos.y + 0.05, FLOOR_Y),
      x: +n.pos.x.toFixed(2),
      y: +n.pos.y.toFixed(2),
      z: +n.pos.z.toFixed(2),
      activity: n.role ? null : (n.poi?.activity ?? null),
      state: n.state,
    });
    return {
      npcs: this.enabled ? [...[...this.staff.values()].map(row), ...[...this.people.values()].map(row)] : [],
      cat: this.cat ? { x: +this.cat.pos.x.toFixed(2), z: +this.cat.pos.z.toFixed(2) } : null,
      floorChanges: this.floorChanges,
      seed: this.seed,
      navNodes: this.nav?.nodes ?? 0,
      pois: this.poiIds,
    };
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
