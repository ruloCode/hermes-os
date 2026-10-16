"use client";

// El cuarto de RuloView en 3D (three.js). Todo se arma en UN efecto (como
// SalaScene: StrictMode re-monta y un objeto creado en otro efecto quedaría
// colgado de una escena ya destruida). Lee la métrica y la pose por REF en su
// propio rAF: React no se entera de cada frame.
//
// Dos cuerpos que NUNCA se confunden:
//  - ESQUELETO MEDIDO: los 33 puntos de MediaPipe Pose (cámara maestra),
//    sólido, anclado en `room.anchor`.
//  - FIGURA APROXIMADA: sin cámara, el WiFi solo dice "hay alguien y por
//    dónde": una silueta translúcida sobre el tramo del enlace más perturbado.
//    No es una pose medida y la etiqueta lo dice.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { EscenarioState, LinkMetric, PuppetFrame, RuNodeId, RuPosKey, RuRoom } from "@hermes/shared";
import { RU_NODE_IDS } from "@hermes/shared";
import { readToken } from "@/components/ui/tones";
import { PuppetMesh } from "@/lib/sala/puppet-mesh";

/** Colores de identidad de cada placa física (los mismos del fork). */
export const RU_NODE_COLORS: Record<RuPosKey, string> = { T: "#ffb347", "1": "#ff6b6b", "2": "#3ddc97", "3": "#5ab4ff" };

/** Qué se está ubicando con un clic: un nodo, la cámara maestra o hacia dónde mira. */
export type EditTarget = RuPosKey | "cam" | "camlook";

export interface PoseFeed {
  frame: PuppetFrame | null;
  at: number;
}

interface Props {
  room: RuRoom;
  metricRef: React.RefObject<LinkMetric | null>;
  escRef: React.RefObject<EscenarioState>;
  poseRef: React.RefObject<PoseFeed>;
  /** Escaneo del cuarto ya alineado (lo carga y lo dueña la página), o null = cajas. */
  scan: THREE.Group | null;
  /** Qué se está ubicando (clic sobre el escaneo/muebles/piso), o null. */
  editing: EditTarget | null;
  onPlace: (target: EditTarget, p: { x: number; y: number; z: number }) => void;
  /** "top" = planta cenital con rejilla de 50 cm rotulada (para ubicar con precisión). */
  view?: "persp" | "top";
}

function label(text: string, color: string, bg: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 112;
  const g = c.getContext("2d")!;
  g.font = "600 44px Inter, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(8, 12, 496, 88, 22);
  g.fill();
  g.fillStyle = color;
  g.fillText(text, 256, 58);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.9, 0.2, 1);
  s.renderOrder = 10;
  return s;
}

export function RoomScene({ room, metricRef, escRef, poseRef, scan, editing, onPlace, view = "persp" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editRef = useRef(editing);
  editRef.current = editing;
  const placeRef = useRef(onPlace);
  placeRef.current = onPlace;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const tone = {
      bg: readToken("--color-bg", "#121110"),
      floor: readToken("--color-panel", "#1a1917"),
      line: readToken("--color-line", "#2e2c28"),
      faint: readToken("--color-text-faint", "#8f8a80"),
      text: readToken("--color-text", "#f0ede6"),
      accent: readToken("--color-accent", "#d97757"),
    };
    const { w, d } = room.size;
    // Un escaneo de celular rara vez llega al techo: el contorno cubre también al nodo más alto.
    const h = Math.max(room.size.h, ...(["T", "1", "2", "3"] as const).map((k) => room.nodes[k].y + 0.25));

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(tone.bg);
    const camera = new THREE.PerspectiveCamera(48, host.clientWidth / host.clientHeight, 0.05, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    if (view === "top") {
      // Planta: desde arriba, con el fondo del cuarto (z=0) arriba de la pantalla.
      camera.position.set(w / 2, Math.max(w, d) * 1.55 + 1, d / 2 + 0.001);
      controls.target.set(w / 2, 0, d / 2);
      controls.enableRotate = false;
    } else {
      // Alta y al pie del cuarto: desde la puerta el mueble más alto tapa media escena.
      camera.position.set(w * 0.45, Math.max(4.2, h + 1.8), d + 2.3);
      controls.target.set(w / 2, 0.4, d / 2 - 0.3);
    }
    controls.enableDamping = true;
    if (view !== "top") controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 1.2;
    controls.maxDistance = 14;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(tone.floor), 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(w * 0.3, h + 2, d + 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    // piso + rejilla de 50 cm
    const floor = new THREE.Mesh(
      track(new THREE.PlaneGeometry(w, d)),
      track(new THREE.MeshStandardMaterial({ color: tone.floor, roughness: 0.95, transparent: Boolean(scan), opacity: scan ? 0.05 : 1 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2, 0, d / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(Math.max(w, d), Math.round(Math.max(w, d) / 0.5), tone.line, tone.line);
    grid.position.set(w / 2, 0.002, d / 2);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    // paredes del fondo y de la izquierda (bajas y translúcidas: la cámara siempre ve)
    const wallMat = track(new THREE.MeshStandardMaterial({ color: tone.faint, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    const back = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), wallMat);
    back.position.set(w / 2, h / 2, 0);
    const left = new THREE.Mesh(track(new THREE.PlaneGeometry(d, h)), wallMat);
    left.rotation.y = Math.PI / 2;
    left.position.set(0, h / 2, d / 2);
    // planta: rejilla de 50 cm SOBRE todo y rótulos en metros por los bordes
    if (view === "top") {
      const pts: THREE.Vector3[] = [];
      // A la altura del PISO (con perspectiva, una rejilla alta se ve más grande que el piso y miente)
      for (let x = 0; x <= w + 1e-6; x += 0.5) pts.push(new THREE.Vector3(x, 0.01, 0), new THREE.Vector3(x, 0.01, d));
      for (let z = 0; z <= d + 1e-6; z += 0.5) pts.push(new THREE.Vector3(0, 0.01, z), new THREE.Vector3(w, 0.01, z));
      const gmat = track(new THREE.LineBasicMaterial({ color: tone.accent, transparent: true, opacity: 0.55, depthTest: false }));
      const gl = new THREE.LineSegments(track(new THREE.BufferGeometry().setFromPoints(pts)), gmat);
      gl.renderOrder = 5;
      scene.add(gl);
      const tick = (t: string, x: number, z: number) => {
        const s = label(t, "#f0ede6", "rgba(18,18,20,0.75)");
        s.scale.set(0.42, 0.1, 1);
        s.position.set(x, 0.02, z);
        scene.add(s);
      };
      for (let x = 0; x <= w + 1e-6; x += 0.5) tick(`x ${x.toFixed(1).replace(".", ",")}`, x, -0.18);
      for (let z = 0.5; z <= d + 1e-6; z += 0.5) tick(`z ${z.toFixed(1).replace(".", ",")}`, -0.3, z);
    }
    // con escaneo, las paredes reales mandan
    if (!scan) scene.add(back, left);
    grid.visible = !scan;
    const edges = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))),
      track(new THREE.LineBasicMaterial({ color: tone.faint, transparent: true, opacity: 0.35 })),
    );
    edges.position.set(w / 2, h / 2, d / 2);
    scene.add(edges);

    // muebles
    const kindColor: Record<string, string> = {
      mueble: "#8a7560",
      cama: "#b9ae9c",
      pantalla: "#1e2230",
      planta: "#4f8a55",
      ventana: "#6b5040",
    };
    const pickables: THREE.Object3D[] = [];
    if (scan) {
      scene.add(scan);
      scan.traverse((o) => {
        if (o instanceof THREE.Mesh) pickables.push(o);
      });
    }
    for (const f of scan ? [] : room.furniture) {
      const y0 = f.y0 ?? 0;
      const geo = track(new THREE.BoxGeometry(Math.max(0.02, f.x1 - f.x0), Math.max(0.02, f.h - y0), Math.max(0.02, f.z1 - f.z0)));
      // Lo alto (clóset, repisas) va translúcido: no puede tapar un nodo ni a la persona.
      const tall = f.h > 1.5 && f.kind !== "ventana";
      const mat = track(
        new THREE.MeshStandardMaterial({
          color: kindColor[f.kind ?? "mueble"],
          roughness: 0.85,
          transparent: f.kind === "ventana" || tall,
          opacity: f.kind === "ventana" ? 0.55 : tall ? 0.38 : 1,
          depthWrite: !tall,
        }),
      );
      const m = new THREE.Mesh(geo, mat);
      m.position.set((f.x0 + f.x1) / 2, (y0 + f.h) / 2, (f.z0 + f.z1) / 2);
      m.castShadow = f.kind !== "ventana";
      m.receiveShadow = true;
      scene.add(m);
      if (f.kind !== "ventana") pickables.push(m);
    }
    pickables.push(floor);

    // zona de captura
    const { zone } = room;
    const zoneMat = track(new THREE.MeshBasicMaterial({ color: tone.accent, transparent: true, opacity: 0.08, depthWrite: false }));
    const zonePlane = new THREE.Mesh(track(new THREE.PlaneGeometry(zone.x1 - zone.x0, zone.z1 - zone.z0)), zoneMat);
    zonePlane.rotation.x = -Math.PI / 2;
    zonePlane.position.set((zone.x0 + zone.x1) / 2, 0.01, (zone.z0 + zone.z1) / 2);
    const zoneEdge = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(zonePlane.geometry)),
      track(new THREE.LineBasicMaterial({ color: tone.accent, transparent: true, opacity: 0.7 })),
    );
    zoneEdge.rotation.copy(zonePlane.rotation);
    zoneEdge.position.copy(zonePlane.position);
    scene.add(zonePlane, zoneEdge);

    // nodos y router
    // Los sprites flotan sobre la escena: fondo oscuro y texto claro en AMBOS temas.
    const labelBg = "rgba(18,18,20,0.8)";
    const labelInk = "#f0ede6";
    const markers = {} as Record<RuPosKey, { group: THREE.Group; core: THREE.Mesh; halo: THREE.Mesh; pole: THREE.Mesh }>;
    for (const key of ["T", "1", "2", "3"] as const) {
      const p = room.nodes[key];
      const col = RU_NODE_COLORS[key];
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        key === "T" ? track(new THREE.BoxGeometry(0.22, 0.05, 0.14)) : track(new THREE.BoxGeometry(0.07, 0.025, 0.05)),
        track(new THREE.MeshBasicMaterial({ color: col })),
      );
      const halo = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.09, 20, 14)),
        track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25, depthWrite: false })),
      );
      // línea hasta el piso: se lee la altura del nodo
      const pole = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.004, 0.004, Math.max(0.01, p.y), 6)),
        track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45 })),
      );
      pole.position.y = -p.y / 2;
      const name = key === "T" ? "Router" : `Nodo ${key}`;
      const l = label(`${name} · ${p.y.toFixed(2).replace(".", ",")} m`, col, labelBg);
      l.position.y = 0.22;
      g.add(core, halo, pole, l);
      g.position.set(p.x, p.y, p.z);
      scene.add(g);
      markers[key] = { group: g, core, halo, pole };
    }

    // enlaces router → nodo, con partículas que corren más rápido con la perturbación
    const PCOUNT = 12;
    const beams = {} as Record<RuNodeId, { curve: THREE.QuadraticBezierCurve3; tubeMat: THREE.MeshBasicMaterial; pMat: THREE.MeshBasicMaterial; parts: THREE.Mesh[] }>;
    const pGeo = track(new THREE.SphereGeometry(0.025, 10, 8));
    for (const id of RU_NODE_IDS) {
      const a = new THREE.Vector3(room.nodes.T.x, room.nodes.T.y, room.nodes.T.z);
      const n = room.nodes[String(id) as RuPosKey];
      const b = new THREE.Vector3(n.x, n.y, n.z);
      const mid = a.clone().lerp(b, 0.5);
      mid.y += 0.12;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const col = RU_NODE_COLORS[String(id) as RuPosKey];
      const tubeMat = track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(new THREE.Mesh(track(new THREE.TubeGeometry(curve, 64, 0.012, 8, false)), tubeMat));
      const pMat = track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      const parts: THREE.Mesh[] = [];
      for (let i = 0; i < PCOUNT; i++) {
        const m = new THREE.Mesh(pGeo, pMat);
        m.userData.t = i / PCOUNT;
        scene.add(m);
        parts.push(m);
      }
      beams[id] = { curve, tubeMat, pMat, parts };
    }

    // cámara maestra (solo se dibuja)
    if (room.camera) {
      const cam = room.camera;
      const yawR = THREE.MathUtils.degToRad(cam.yaw);
      const pitchR = THREE.MathUtils.degToRad(cam.pitch);
      const fwd = new THREE.Vector3(Math.sin(yawR) * Math.cos(pitchR), Math.sin(pitchR), Math.cos(yawR) * Math.cos(pitchR));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd);
      const tx = Math.tan(THREE.MathUtils.degToRad(cam.hfov) / 2);
      const ty = tx * (9 / 16);
      const origin = new THREE.Vector3(cam.x, cam.y, cam.z);
      const L = 1.2;
      const corners = [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ].map(([sx, sy]) => origin.clone().add(fwd.clone().add(right.clone().multiplyScalar(sx * tx)).add(up.clone().multiplyScalar(sy * ty)).multiplyScalar(L)));
      const pts: THREE.Vector3[] = [];
      for (const c of corners) pts.push(origin, c);
      for (let i = 0; i < 4; i++) pts.push(corners[i], corners[(i + 1) % 4]);
      const frustum = new THREE.LineSegments(
        track(new THREE.BufferGeometry().setFromPoints(pts)),
        track(new THREE.LineBasicMaterial({ color: tone.accent, transparent: true, opacity: 0.8 })),
      );
      scene.add(frustum);
      const camBox = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.05, 0.05)), track(new THREE.MeshBasicMaterial({ color: labelInk })));
      camBox.position.set(room.camera.x, room.camera.y, room.camera.z);
      const cl = label("Cámara maestra", labelInk, labelBg);
      cl.position.set(room.camera.x, room.camera.y + 0.16, room.camera.z);
      scene.add(camBox, cl);
    }

    // figura APROXIMADA (WiFi): cápsulas translúcidas
    const figMat = track(new THREE.MeshStandardMaterial({ color: tone.accent, transparent: true, opacity: 0, depthWrite: false, emissive: new THREE.Color(tone.accent), emissiveIntensity: 0.4 }));
    const fig = new THREE.Group();
    const part = (r: number, len: number, x: number, y: number) => {
      const p = new THREE.Mesh(track(new THREE.CapsuleGeometry(r, len, 6, 12)), figMat);
      p.position.set(x, y, 0);
      fig.add(p);
      return p;
    };
    part(0.16, 0.42, 0, 1.12);
    const headF = new THREE.Mesh(track(new THREE.SphereGeometry(0.12, 18, 12)), figMat);
    headF.position.y = 1.6;
    fig.add(headF);
    const legL = part(0.07, 0.6, -0.09, 0.45);
    const legR = part(0.07, 0.6, 0.09, 0.45);
    const armL = part(0.055, 0.46, -0.24, 1.1);
    const armR = part(0.055, 0.46, 0.24, 1.1);
    for (const p of [legL, legR, armL, armR]) {
      p.geometry.translate(0, -0.28, 0);
      p.position.y += 0.28;
    }
    const figLabel = label("Aproximado (WiFi)", "#f3a07f", labelBg);
    figLabel.position.y = 1.95;
    fig.add(figLabel);
    fig.visible = false;
    scene.add(fig);
    let figOp = 0;
    let figPh = 0;
    const figPos = new THREE.Vector3(room.anchor.x, 0, room.anchor.z);

    // esqueleto MEDIDO (cámara)
    const puppet = new PuppetMesh(tone.text, tone.accent);
    puppet.group.visible = false;
    scene.add(puppet.group);
    const poseLabel = label("Medido (cámara)", labelInk, labelBg);
    poseLabel.visible = false;
    scene.add(poseLabel);

    // clic en el piso = reubicar el nodo en edición
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const key = editRef.current;
      if (!key) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      if (!hit) return;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      placeRef.current(key, { x: r2(hit.point.x), y: r2(Math.max(0, hit.point.y)), z: r2(hit.point.z) });
    };
    renderer.domElement.addEventListener("click", onClick);

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let raf = 0;
    const tmpTarget = new THREE.Vector3();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.elapsedTime;
      const m = metricRef.current;
      const live = m ? m.live(performance.now()) : false;

      let best: RuNodeId | null = null;
      for (const id of RU_NODE_IDS) {
        const s = m?.nodes[id];
        const on = Boolean(s && !s.stale && live);
        const dd = on && s ? s.d : 0;
        const b = beams[id];
        b.tubeMat.opacity = on ? 0.18 + 0.6 * dd : 0.04;
        b.pMat.opacity = on ? 0.5 + 0.5 * dd : 0;
        const speed = reduceMotion ? 0 : 0.1 + 0.7 * dd;
        for (const p of b.parts) {
          p.userData.t = (p.userData.t + dt * speed) % 1;
          p.position.copy(b.curve.getPointAt(p.userData.t));
          p.scale.setScalar(0.7 + 1.8 * dd);
        }
        const mk = markers[String(id) as RuPosKey];
        mk.halo.scale.setScalar(1 + (on ? dd * 1.6 + 0.12 * Math.sin(t * 3) : 0));
        (mk.core.material as THREE.MeshBasicMaterial).color.set(on ? RU_NODE_COLORS[String(id) as RuPosKey] : "#555");
        if (on && s && s.d > 0.15 && (best == null || s.d > (m?.nodes[best].d ?? 0))) best = id;
      }
      markers.T.halo.scale.setScalar(1 + (live ? 0.15 * Math.sin(t * 2) : 0));

      const st = m?.stage;
      zoneMat.opacity = st?.available ? 0.06 + 0.4 * st.score : 0.03;
      (zoneEdge.material as THREE.LineBasicMaterial).opacity = st?.on ? 1 : 0.5;

      // esqueleto medido: si llegó un frame en el último medio segundo
      const pf = poseRef.current;
      const poseLive = Boolean(pf?.frame && performance.now() - pf.at < 500);
      if (poseLive && pf?.frame) {
        puppet.update(pf.frame);
        const head = pf.frame.points[33];
        poseLabel.position.set(head.x, head.y + 0.35, head.z);
      }
      puppet.group.visible = poseLive;
      poseLabel.visible = poseLive;

      // figura aproximada: solo si el servidor dice que hay alguien y no hay esqueleto medido
      const esc = escRef.current;
      const present = live && esc.shown !== "absent";
      const show = present && !poseLive;
      if (show) {
        if (st?.on && st.mid) tmpTarget.set(st.mid.x, 0, st.mid.z);
        else if (best != null) {
          const pp = beams[best].curve.getPointAt(0.55);
          tmpTarget.set(pp.x, 0, pp.z);
        } else tmpTarget.set(room.anchor.x, 0, room.anchor.z);
        figPos.lerp(tmpTarget, Math.min(dt * 1.5, 1));
      }
      figOp += ((show ? 0.55 : 0) - figOp) * Math.min(dt * 3, 1);
      figMat.opacity = figOp;
      fig.visible = figOp > 0.01;
      fig.position.copy(figPos);
      fig.lookAt(camera.position.x, 0, camera.position.z);
      const moving = esc.shown === "present_moving";
      if (!reduceMotion && moving) figPh += dt * 5;
      const sw = moving ? Math.sin(figPh) * 0.45 : 0;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.8;
      armR.rotation.x = sw * 0.8;

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    });
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      puppet.dispose();
      if (scan) scene.remove(scan);
      for (const x of disposables) x.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [room, metricRef, escRef, poseRef, scan, view]);

  return <div ref={hostRef} className="absolute inset-0" aria-label="Cuarto en 3D con los nodos WiFi y los enlaces en vivo" />;
}
