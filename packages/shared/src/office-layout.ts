// Planta de la Oficina de agentes: un pod de escritorios por proyecto del vault
// y la asignación de cada personaje a un escritorio. Puro y determinista: las
// posiciones dependen solo del índice del proyecto y del número del escritorio,
// así que nada salta entre polls, crecer un pod no mueve a sus vecinos y
// agregar un proyecto al final no mueve a los anteriores.
//
// Medidas del escritorio y anclas del asiento/laptop: las de agent-office
// (AgentSystemLabs, MIT — src/shared/layout.ts y world/office.ts). Metros, +y arriba.
// A rotY 0 el personaje se sienta del lado +z del escritorio mirando a -z.

import { GENERAL_PROJECT } from "./office.js";

export const DESK_SIZE = { width: 2.2, depth: 1.1, height: 0.78 } as const;
/** Escritorios de un pod vacío (una pareja espalda con espalda). */
export const POD_BASE_DESKS = 2;
/** Tope de un pod: tres parejas. */
export const POD_MAX_DESKS = 6;
/** Columnas fijas de la grilla de pods (fijas = agregar proyectos no re-acomoda). */
export const POD_COLUMNS = 4;
/** Distancia entre centros de pods: cabe un pod lleno con sus sillas y un pasillo. */
export const POD_PITCH = { x: DESK_SIZE.width * 3 + 2.2, z: 6.2 } as const;
/** Anclas locales (en el marco del escritorio). */
export const SEAT_ANCHOR = { x: 0, y: 0.4, z: 0.93, rotY: Math.PI, scale: 0.82 } as const;
export const LAPTOP_ANCHOR = { x: 0, y: DESK_SIZE.height, z: -0.06, scale: 1.3 } as const;
/** Silla (local): dónde queda respecto al escritorio. */
export const CHAIR_Z = 0.9;

export interface OfficeProjectRef {
  slug: string;
  name: string;
}

export interface OfficeDesk {
  id: string;
  project: string;
  /** Número del escritorio dentro del pod (0 = pareja central, lado frontal). */
  n: number;
  x: number;
  z: number;
  rotY: number;
}

export interface OfficePod {
  project: string;
  name: string;
  /** Centro del pod. */
  x: number;
  z: number;
  col: number;
  row: number;
  desks: OfficeDesk[];
}

export interface OfficeLayout {
  pods: OfficePod[];
  desks: OfficeDesk[];
  floor: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function deskId(project: string, n: number): string {
  return `desk:${project}:${n}`;
}

/**
 * Escritorios que necesita un pod con `workers` personajes: siempre queda uno
 * libre para contratar mientras haya lugar, de dos en dos, entre 2 y 6.
 */
export function podDeskCount(workers: number): number {
  const want = Math.max(POD_BASE_DESKS, workers + 1);
  return Math.min(POD_MAX_DESKS, Math.ceil(want / 2) * 2);
}

/** Desplazamiento x de cada pareja: centro, izquierda, derecha (crecer no mueve las anteriores). */
const PAIR_OFFSETS = [0, -DESK_SIZE.width, DESK_SIZE.width];

function podDesks(project: string, cx: number, cz: number, count: number): OfficeDesk[] {
  const desks: OfficeDesk[] = [];
  for (let n = 0; n < count; n++) {
    const pair = Math.floor(n / 2);
    const back = n % 2 === 1;
    desks.push({
      id: deskId(project, n),
      project,
      n,
      x: cx + PAIR_OFFSETS[pair],
      // Frontal: lado +z con el personaje mirando a -z; trasero: al revés.
      z: cz + (back ? -DESK_SIZE.depth / 2 : DESK_SIZE.depth / 2),
      rotY: back ? Math.PI : 0,
    });
  }
  return desks;
}

/** El pod "general" siempre existe y va primero; el resto en el orden recibido, sin repetir. */
export function orderedProjects(projects: OfficeProjectRef[]): OfficeProjectRef[] {
  const seen = new Set<string>([GENERAL_PROJECT]);
  const out: OfficeProjectRef[] = [{ slug: GENERAL_PROJECT, name: "General" }];
  for (const p of projects) {
    if (!p.slug || seen.has(p.slug)) continue;
    seen.add(p.slug);
    out.push(p);
  }
  return out;
}

export function buildOfficeLayout(
  projects: OfficeProjectRef[],
  workersByProject: Record<string, number> = {},
): OfficeLayout {
  const list = orderedProjects(projects);
  const pods: OfficePod[] = list.map((p, i) => {
    const col = i % POD_COLUMNS;
    const row = Math.floor(i / POD_COLUMNS);
    const x = (col - (POD_COLUMNS - 1) / 2) * POD_PITCH.x;
    const z = row * POD_PITCH.z;
    return {
      project: p.slug,
      name: p.name || p.slug,
      x,
      z,
      col,
      row,
      desks: podDesks(p.slug, x, z, podDeskCount(workersByProject[p.slug] ?? 0)),
    };
  });
  const rows = Math.max(1, Math.ceil(list.length / POD_COLUMNS));
  const margin = 2.5;
  return {
    pods,
    desks: pods.flatMap((p) => p.desks),
    floor: {
      minX: -(POD_COLUMNS * POD_PITCH.x) / 2 - margin / 2,
      maxX: (POD_COLUMNS * POD_PITCH.x) / 2 + margin / 2,
      minZ: -POD_PITCH.z / 2 - margin,
      maxZ: (rows - 1) * POD_PITCH.z + POD_PITCH.z / 2 + margin,
    },
  };
}

/** Rota un punto local del escritorio a coordenadas del piso. */
export function deskToWorld(desk: OfficeDesk, local: { x: number; z: number }): { x: number; z: number } {
  const c = Math.cos(desk.rotY);
  const s = Math.sin(desk.rotY);
  return { x: desk.x + local.x * c + local.z * s, z: desk.z - local.x * s + local.z * c };
}

/**
 * Asigna escritorios. Pegajoso: quien ya tenía uno de su proyecto se queda.
 * Los nuevos toman el primer libre de su pod; si su pod está lleno (o su
 * proyecto no tiene pod) van al "general" y luego a cualquiera libre. Nunca
 * dos en el mismo escritorio. Los que no caben quedan en `unseated`.
 */
export function assignSeats(
  workers: { id: string; project: string }[],
  desks: OfficeDesk[],
  previous: ReadonlyMap<string, string> = new Map(),
): { seats: Map<string, string>; unseated: string[] } {
  const byId = new Map(desks.map((d) => [d.id, d]));
  const taken = new Set<string>();
  const seats = new Map<string, string>();
  const pending: { id: string; project: string }[] = [];

  for (const w of workers) {
    const prev = previous.get(w.id);
    const desk = prev ? byId.get(prev) : undefined;
    if (desk && !taken.has(desk.id)) {
      seats.set(w.id, desk.id);
      taken.add(desk.id);
    } else pending.push(w);
  }

  const podOf = new Map<string, OfficeDesk[]>();
  for (const d of desks) {
    const list = podOf.get(d.project) ?? [];
    list.push(d);
    podOf.set(d.project, list);
  }
  const firstFree = (list: OfficeDesk[] | undefined) =>
    list?.slice().sort((a, b) => a.n - b.n).find((d) => !taken.has(d.id));

  const unseated: string[] = [];
  for (const w of pending) {
    const desk =
      firstFree(podOf.get(w.project)) ??
      firstFree(podOf.get(GENERAL_PROJECT)) ??
      desks.find((d) => !taken.has(d.id));
    if (!desk) {
      unseated.push(w.id);
      continue;
    }
    seats.set(w.id, desk.id);
    taken.add(desk.id);
  }
  return { seats, unseated };
}
