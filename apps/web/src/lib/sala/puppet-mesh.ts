// Malla de la marioneta: 34 articulaciones (esferas) + huesos (cilindros) en
// DOS InstancedMesh — dos draw calls para todo el cuerpo, se actualiza por
// frame con matrices, nada se crea ni destruye al moverse. Recibe el
// PuppetFrame ya suavizado y en coordenadas de escena (lógica pura de
// @hermes/shared); aquí solo hay three.js.

import * as THREE from "three";
import { jointRadius, PUPPET_BONES, PUPPET_HEAD, PUPPET_POINT_COUNT, type PuppetFrame } from "@hermes/shared";

const BONE_RADIUS = 0.016;
const UP = new THREE.Vector3(0, 1, 0);

export class PuppetMesh {
  readonly group = new THREE.Group();
  private readonly joints: THREE.InstancedMesh;
  private readonly bones: THREE.InstancedMesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly headMat: THREE.MeshStandardMaterial;
  private readonly head: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(color: string) {
    const c = new THREE.Color(color);
    this.mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.2, emissive: c, emissiveIntensity: 0.12 });
    this.headMat = this.mat.clone();

    // Esfera unitaria: el radio va en la matriz (escala) por articulación.
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), this.mat, PUPPET_POINT_COUNT);
    this.joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Las instancias se mueven cada frame: la esfera envolvente que three
    // calcula UNA vez quedaría vieja y el culling escondería el cuerpo.
    this.joints.frustumCulled = false;
    this.joints.castShadow = true;
    // Cilindro unitario a lo largo de Y, de -0.5 a 0.5: escala Y = largo del hueso.
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), this.mat, PUPPET_BONES.length);
    this.bones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bones.frustumCulled = false;
    this.bones.castShadow = true;
    // La cabeza va aparte: es la única con material propio (se "enciende" al hablar el humano — futuro).
    this.head = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), this.headMat);
    this.head.castShadow = true;

    this.group.add(this.joints, this.bones, this.head);
    this.group.visible = false;
  }

  update(frame: PuppetFrame): void {
    let any = false;
    for (let i = 0; i < PUPPET_POINT_COUNT; i++) {
      if (!frame.visible[i] || i === PUPPET_HEAD) {
        this.joints.setMatrixAt(i, this.hidden);
        continue;
      }
      any = true;
      const p = frame.points[i];
      const r = jointRadius(i);
      this.m.compose(this.a.set(p.x, p.y, p.z), this.q.identity(), this.s.set(r, r, r));
      this.joints.setMatrixAt(i, this.m);
    }
    this.joints.instanceMatrix.needsUpdate = true;

    for (let k = 0; k < PUPPET_BONES.length; k++) {
      const [i, j] = PUPPET_BONES[k];
      if (!frame.visible[i] || !frame.visible[j]) {
        this.bones.setMatrixAt(k, this.hidden);
        continue;
      }
      const pa = frame.points[i];
      const pb = frame.points[j];
      this.a.set(pa.x, pa.y, pa.z);
      this.b.set(pb.x, pb.y, pb.z);
      this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);
      this.dir.subVectors(this.b, this.a);
      const len = this.dir.length();
      if (len < 1e-4) {
        this.bones.setMatrixAt(k, this.hidden);
        continue;
      }
      this.q.setFromUnitVectors(UP, this.dir.multiplyScalar(1 / len));
      this.m.compose(this.mid, this.q, this.s.set(BONE_RADIUS, len, BONE_RADIUS));
      this.bones.setMatrixAt(k, this.m);
    }
    this.bones.instanceMatrix.needsUpdate = true;

    if (frame.visible[PUPPET_HEAD]) {
      const h = frame.points[PUPPET_HEAD];
      this.head.visible = true;
      this.head.position.set(h.x, h.y, h.z);
      this.head.scale.setScalar(jointRadius(PUPPET_HEAD));
      any = true;
    } else {
      this.head.visible = false;
    }
    this.group.visible = any;
  }

  hide(): void {
    this.group.visible = false;
  }

  /** QA: dónde quedó la cabeza y si el grupo se dibuja. */
  debug(): { visible: boolean; head: { x: number; y: number; z: number } | null; inScene: boolean } {
    let root: THREE.Object3D = this.group;
    while (root.parent) root = root.parent;
    return {
      visible: this.group.visible,
      head: this.head.visible ? { x: this.head.position.x, y: this.head.position.y, z: this.head.position.z } : null,
      inScene: root instanceof THREE.Scene,
    };
  }

  dispose(): void {
    this.joints.geometry.dispose();
    this.bones.geometry.dispose();
    this.head.geometry.dispose();
    this.mat.dispose();
    this.headMat.dispose();
    this.joints.dispose();
    this.bones.dispose();
  }
}
