// El escaneo del cuarto (GLB de Scaniverse/Polycam/Luma) en three.js.
//
// - Se parsea en memoria: el archivo llega por fetch con Bearer (un loader de
//   three no manda credenciales).
// - Materiales SIN luz (MeshBasic): la textura del escaneo ya trae la luz real
//   del cuarto; iluminarla otra vez la oscurece y cambia los colores.
// - Solo cara FRONTAL: las paredes de un escaneo interior miran hacia adentro,
//   así que vistas desde afuera desaparecen solas y el cuarto queda a la vista
//   sin cortar nada (el techo inclinado tampoco tapa la vista desde arriba).
// - Alineación: `dominantYaw` (shared, probado) sobre las normales horizontales
//   ponderadas por área; después el piso a y=0 y la esquina (x0, z0) al origen.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { dominantYaw, type RuNormalSample, type RuScan } from "@hermes/shared";

export interface ScanAlignment {
  yaw: number;
  scale: number;
  offset: { x: number; y: number; z: number };
  size: { w: number; d: number; h: number };
}

export async function parseScan(buf: ArrayBuffer): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().parseAsync(buf, "");
  const group = new THREE.Group();
  group.name = "ruloview-scan";
  group.add(gltf.scene);
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const old = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.MeshStandardMaterial[];
    const next = old.map(
      (m) =>
        new THREE.MeshBasicMaterial({
          map: m.map ?? null,
          color: m.map ? 0xffffff : (m.color ?? new THREE.Color(0xcccccc)),
          vertexColors: Boolean(o.geometry.getAttribute("color")),
          side: THREE.FrontSide,
          transparent: m.transparent,
          opacity: m.opacity,
        }),
    );
    for (const m of old) m.dispose();
    o.material = Array.isArray(o.material) ? next : next[0];
    o.userData.ruloviewScan = true;
  });
  return group;
}

/** Normales horizontales + área de los triángulos (submuestreado a ~200k triángulos). */
export function scanNormals(group: THREE.Group): RuNormalSample[] {
  group.updateMatrixWorld(true);
  const out: RuNormalSample[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let triangles = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) triangles += (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) / 3;
  });
  const step = Math.max(1, Math.floor(triangles / 200_000));
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute("position");
    const idx = o.geometry.index;
    const n = (idx?.count ?? pos.count) / 3;
    for (let t = 0; t < n; t += step) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      ab.cross(ac);
      const area = ab.length() / 2;
      if (area <= 0) continue;
      ab.normalize();
      out.push([ab.x, ab.z, area]);
    }
  });
  return out;
}

/** Aplica un giro/traslado guardado (room.scan) al grupo del escaneo. */
export function applyScan(group: THREE.Group, scan: Pick<RuScan, "yaw" | "offset" | "scale">) {
  group.rotation.set(0, THREE.MathUtils.degToRad(scan.yaw), 0);
  group.scale.setScalar(scan.scale || 1);
  group.position.set(scan.offset.x, scan.offset.y, scan.offset.z);
  group.updateMatrixWorld(true);
}

/**
 * Alineación automática (+ giros de 90° que pide el humano: el escaneo no sabe
 * cuál pared es "el fondo") y escala: un escaneo SIN LiDAR (modo foto) sale con
 * la textura bien pero el tamaño estimado — se corrige con una medida real
 * (escala = medida real ÷ la misma medida en el escaneo).
 */
export function alignScan(group: THREE.Group, extraTurns = 0, scale = 1): ScanAlignment {
  applyScan(group, { yaw: 0, offset: { x: 0, y: 0, z: 0 }, scale: 1 });
  const yaw = dominantYaw(scanNormals(group)) + extraTurns * 90;
  applyScan(group, { yaw, offset: { x: 0, y: 0, z: 0 }, scale });
  // Medida sobre los VÉRTICES ya girados, con percentiles: Box3.setFromObject
  // sin `precise` encierra la caja girada en otra caja (infla el cuarto ~2×
  // con 23° de giro) y un escaneo trae triángulos sueltos que agregan decenas de cm.
  const box = trimmedBox(group, 0.002);
  const offset = { x: -box.min.x, y: -box.min.y, z: -box.min.z };
  applyScan(group, { yaw, offset, scale });
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    yaw: r(yaw),
    scale,
    offset: { x: r(offset.x), y: r(offset.y), z: r(offset.z) },
    size: { w: r(box.max.x - box.min.x), d: r(box.max.z - box.min.z), h: r(box.max.y - box.min.y) },
  };
}

/** Caja de los vértices (en coordenadas del mundo) descartando la fracción `trim` de cada extremo. */
export function trimmedBox(group: THREE.Group, trim: number): THREE.Box3 {
  group.updateMatrixWorld(true);
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const v = new THREE.Vector3();
  let total = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) total += o.geometry.getAttribute("position").count;
  });
  const step = Math.max(1, Math.floor(total / 150_000));
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      xs.push(v.x);
      ys.push(v.y);
      zs.push(v.z);
    }
  });
  const q = (a: number[], f: number) => {
    const s = Float64Array.from(a).sort();
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))] ?? 0;
  };
  return new THREE.Box3(
    new THREE.Vector3(q(xs, trim), q(ys, trim), q(zs, trim)),
    new THREE.Vector3(q(xs, 1 - trim), q(ys, 1 - trim), q(zs, 1 - trim)),
  );
}

export function disposeScan(group: THREE.Group | null) {
  group?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}
