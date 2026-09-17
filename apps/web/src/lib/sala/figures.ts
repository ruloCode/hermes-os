// Figuras de los agentes de la Sala 3D: la MISMA silueta base (cápsula de
// cuerpo + cabeza) con tres variables — forma de la cabeza, altura y
// complexión — más el color. Con eso se distinguen a diez metros sin leer el
// nombre. Cada figura expone lo que las fases siguientes necesitan tocar por
// frame (anillo de dwell, emisivo de selección, pulso de voz) sin re-crear
// nada: solo materiales y escalas.

import * as THREE from "three";
import type { SalaAgentPublic, SalaBuild, SalaHead } from "@hermes/shared";

/** Radio de la cápsula por complexión (unidades de escena ≈ metros). */
const BUILD_RADIUS: Record<SalaBuild, number> = { slim: 0.21, medium: 0.27, wide: 0.34 };

export interface SalaFigure {
  key: string;
  group: THREE.Group;
  /** Altura total (para colgar la tarjeta del nombre encima). */
  height: number;
  /** Esfera de acierto del rayo de señalar (centro del torso, radio 0.6). */
  hitSphere: THREE.Sphere;
  /** 0..1: cuánto lleva cargado el dwell (anillo que se llena en la base). */
  setProgress(p: number): void;
  /** Seleccionada = emisivo alto + anillo completo. */
  setSelected(on: boolean): void;
  /** 0..1 volumen de la voz: la figura respira/pulsa con él. */
  setPulse(v: number): void;
  /** Respiración en reposo (fase 6): t en segundos. */
  idle(t: number): void;
  dispose(): void;
}

function headGeometry(head: SalaHead): THREE.BufferGeometry {
  switch (head) {
    case "sphere":
      return new THREE.SphereGeometry(0.17, 32, 24);
    case "cube":
      return new THREE.BoxGeometry(0.3, 0.3, 0.3);
    case "icosahedron":
      return new THREE.IcosahedronGeometry(0.2, 0);
    case "cone":
      return new THREE.ConeGeometry(0.18, 0.36, 24);
    case "torus":
      return new THREE.TorusGeometry(0.14, 0.06, 16, 40);
  }
}

export function buildFigure(agent: SalaAgentPublic): SalaFigure {
  const color = new THREE.Color(agent.color);
  const group = new THREE.Group();
  group.name = `agent:${agent.key}`;

  const radius = BUILD_RADIUS[agent.build];
  // Reparto vertical: el cuerpo llega al 72% de la altura, la cabeza flota
  // arriba con un cuello de aire (se lee como figura, no como muñeco pegado).
  const bodyTop = agent.height * 0.72;
  const bodyLength = Math.max(0.3, bodyTop - radius * 2 - 0.04);

  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.12,
    emissive: color,
    emissiveIntensity: 0.06,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, bodyLength, 6, 20), mat);
  body.position.y = 0.04 + radius + bodyLength / 2;
  body.castShadow = true;
  group.add(body);

  const headMat = mat.clone();
  const head = new THREE.Mesh(headGeometry(agent.head), headMat);
  head.position.y = agent.height * 0.88;
  if (agent.head === "torus") head.rotation.x = 0; // el agujero mira al frente (+z)
  if (agent.head === "cube") head.rotation.y = Math.PI / 4;
  head.castShadow = true;
  group.add(head);

  // Sombra suave de contacto: un disco oscuro casi transparente en la base.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.9, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  group.add(shadow);

  // Anillo base: guía fija muy tenue + arco de progreso del dwell encima.
  const ringR1 = 0.5;
  const ringR2 = 0.56;
  const guide = new THREE.Mesh(
    new THREE.RingGeometry(ringR1, ringR2, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false }),
  );
  guide.rotation.x = -Math.PI / 2;
  guide.position.y = 0.01;
  group.add(guide);

  const arcMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  let arc: THREE.Mesh | null = null;
  let lastProgress = -1;
  const setArc = (p: number) => {
    // Regenerar la geometría solo cuando el progreso cambia de verdad (48
    // segmentos: barato, y así el arco se llena continuo, no a saltos).
    const q = Math.max(0, Math.min(1, p));
    if (Math.abs(q - lastProgress) < 0.004) return;
    lastProgress = q;
    if (arc) {
      group.remove(arc);
      arc.geometry.dispose();
      arc = null;
    }
    if (q <= 0) return;
    arc = new THREE.Mesh(
      new THREE.RingGeometry(ringR1, ringR2, 48, 1, Math.PI / 2, -q * Math.PI * 2),
      arcMat,
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = 0.012;
    group.add(arc);
  };

  let selected = false;
  let pulse = 0;
  const baseEmissive = 0.06;
  const applyEmissive = () => {
    const e = (selected ? 0.55 : baseEmissive) + pulse * 0.9;
    mat.emissiveIntensity = e;
    headMat.emissiveIntensity = e * 1.25;
  };

  const hitSphere = new THREE.Sphere(new THREE.Vector3(0, agent.height * 0.55, 0), 0.6);

  return {
    key: agent.key,
    group,
    height: agent.height,
    hitSphere,
    setProgress: setArc,
    setSelected(on) {
      selected = on;
      guide.material.opacity = on ? 0.5 : 0.14;
      if (on) setArc(1);
      else setArc(0);
      applyEmissive();
    },
    setPulse(v) {
      pulse = Math.max(0, Math.min(1, v));
      // Pulso visible pero contenido: ±4% de escala en el cuerpo, la cabeza
      // "asiente" un poco más.
      const s = 1 + pulse * 0.04;
      body.scale.set(s, 1 + pulse * 0.02, s);
      head.scale.setScalar(1 + pulse * 0.08);
      applyEmissive();
    },
    idle(t) {
      if (pulse > 0.01) return;
      const b = Math.sin(t * 1.6 + agent.height * 7) * 0.006;
      body.scale.set(1 + b, 1 + b * 0.5, 1 + b);
      head.position.y = agent.height * 0.88 + Math.sin(t * 1.6 + agent.height * 7) * 0.008;
    },
    dispose() {
      body.geometry.dispose();
      head.geometry.dispose();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      guide.geometry.dispose();
      guide.material.dispose();
      arc?.geometry.dispose();
      arcMat.dispose();
      mat.dispose();
      headMat.dispose();
    },
  };
}
