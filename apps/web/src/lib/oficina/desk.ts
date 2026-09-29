// Mobiliario de la Oficina: escritorio con silla y su "+" de vacante, y el
// tapete de color que agrupa el pod de cada proyecto. Todo procedural.
//
// El escritorio sigue a buildDesk de agent-office (AgentSystemLabs, MIT —
// src/client/world/office.ts): mismas medidas, anclas de asiento y laptop, y
// la silla a 0,9 m. Colores del tema en vez de la paleta fija.

import * as THREE from "three";
import { CHAIR_Z, DESK_SIZE, LAPTOP_ANCHOR, SEAT_ANCHOR, type OfficeDesk, type OfficePod } from "@hermes/shared";
import { mesh, roundedBox, toon } from "./toon";
import type { OfficePalette } from "./palette";

export interface DeskView {
  desk: OfficeDesk;
  group: THREE.Group;
  seatAnchor: THREE.Object3D;
  laptopAnchor: THREE.Object3D;
  vacancy: THREE.Group;
  /** Caja invisible para el raycast (clic = contratar aquí). */
  hitbox: THREE.Mesh;
  dispose(): void;
}

function box(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}

function plant(scale: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.09 * scale, 0.07 * scale, 0.14 * scale, 10), toon("#b5654a"), 0, 0.07 * scale, 0));
  const leaf = toon("#5fa35a");
  for (const [x, y, z, r] of [
    [0, 0.26, 0, 0.12],
    [0.07, 0.22, 0.03, 0.09],
    [-0.06, 0.23, -0.03, 0.1],
  ] as const) {
    g.add(mesh(new THREE.SphereGeometry(r * scale, 10, 8), leaf, x * scale, y * scale, z * scale));
  }
  return g;
}

function chair(color: string): THREE.Group {
  const g = new THREE.Group();
  const seat = toon(color);
  const metal = toon("#8d99ae");
  g.add(mesh(roundedBox(0.52, 0.08, 0.5, 0.08), seat, 0, 0.46, 0));
  // Respaldo del lado de afuera (el personaje mira al escritorio, hacia -z).
  g.add(mesh(roundedBox(0.5, 0.5, 0.07, 0.06), seat, 0, 0.78, 0.24));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), metal, 0, 0.23, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(box(0.05, 0.03, 0.28), metal, Math.sin(a) * 0.14, 0.03, Math.cos(a) * 0.14);
    leg.rotation.y = a;
    g.add(leg);
  }
  return g;
}

export function buildDesk(desk: OfficeDesk, index: number, p: OfficePalette): DeskView {
  const group = new THREE.Group();
  group.position.set(desk.x, 0, desk.z);
  group.rotation.y = desk.rotY;
  const { width, depth, height } = DESK_SIZE;
  group.add(mesh(roundedBox(width - 0.06, 0.08, depth - 0.04, 0.08), toon(p.desk), 0, height - 0.04, 0));
  const legMat = toon(p.leg);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, height - 0.08, 8), legMat, sx * (width / 2 - 0.14), (height - 0.08) / 2, sz * (depth / 2 - 0.12)));
    }
  }
  // Panel de recato del lado opuesto al personaje.
  group.add(mesh(box(width - 0.3, 0.32, 0.03), toon(p.deskTrim), 0, height - 0.26, -depth / 2 + 0.06));
  // Un adorno por escritorio (taza, planta o libros), como en agent-office.
  const deco = index % 3;
  if (deco === 0) {
    group.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon(p.skins[index % p.skins.length]), width / 2 - 0.25, height + 0.06, -0.2));
  } else if (deco === 1) {
    const pl = plant(1.4);
    pl.position.set(-width / 2 + 0.25, height, -0.25);
    group.add(pl);
  } else {
    const books = new THREE.Group();
    p.skins.slice(0, 3).forEach((c, i) => books.add(mesh(box(0.08, 0.24, 0.18), toon(c), i * 0.09, 0.12, 0)));
    books.position.set(width / 2 - 0.35, height, -0.3);
    group.add(books);
  }

  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(LAPTOP_ANCHOR.x, LAPTOP_ANCHOR.y, LAPTOP_ANCHOR.z);
  laptopAnchor.scale.setScalar(LAPTOP_ANCHOR.scale);
  group.add(laptopAnchor);

  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(SEAT_ANCHOR.x, SEAT_ANCHOR.y, SEAT_ANCHOR.z);
  seatAnchor.rotation.y = SEAT_ANCHOR.rotY;
  seatAnchor.scale.setScalar(SEAT_ANCHOR.scale);
  group.add(seatAnchor);

  const ch = chair(p.chair);
  ch.position.set(0, 0, CHAIR_Z);
  group.add(ch);

  // "+" flotante sobre el escritorio libre: aquí se contrata.
  const vacancy = new THREE.Group();
  const plus = toon(p.accent, { emissive: p.accent });
  plus.emissiveIntensity = 0.35;
  vacancy.add(mesh(box(0.28, 0.08, 0.08), plus, 0, 0, 0, false));
  vacancy.add(mesh(box(0.08, 0.28, 0.08), plus, 0, 0, 0, false));
  vacancy.position.set(0, height + 0.55, 0.2);
  group.add(vacancy);

  const hitbox = new THREE.Mesh(box(width, 1.4, depth + 1.4), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.set(0, 0.7, 0.55);
  hitbox.userData.deskId = desk.id;
  group.add(hitbox);

  return {
    desk,
    group,
    seatAnchor,
    laptopAnchor,
    vacancy,
    hitbox,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      (hitbox.material as THREE.Material).dispose();
    },
  };
}

/** Tapete redondeado bajo el pod, del color del proyecto: agrupa sin paredes. */
export function buildPodRug(pod: OfficePod, color: string, p: OfficePalette): THREE.Mesh {
  const pairs = Math.ceil(pod.desks.length / 2);
  const w = pairs * DESK_SIZE.width + 1.2;
  const d = DESK_SIZE.depth * 2 + 2.6;
  // Centro x del pod según las parejas que tiene (0, -W, +W).
  const xs = pod.desks.map((dk) => dk.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const shape = new THREE.Shape();
  const r = 0.5;
  const x0 = -w / 2;
  const z0 = -d / 2;
  shape.moveTo(x0 + r, z0);
  shape.lineTo(x0 + w - r, z0);
  shape.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
  shape.lineTo(x0 + w, z0 + d - r);
  shape.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
  shape.lineTo(x0 + r, z0 + d);
  shape.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r);
  shape.lineTo(x0, z0 + r);
  shape.quadraticCurveTo(x0, z0, x0 + r, z0);
  const geo = new THREE.ShapeGeometry(shape, 6);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshToonMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color(p.floor), p.dark ? 0.72 : 0.78),
    side: THREE.DoubleSide,
  });
  const rug = new THREE.Mesh(geo, mat);
  rug.position.set(cx, 0.006, pod.z);
  rug.receiveShadow = true;
  return rug;
}
