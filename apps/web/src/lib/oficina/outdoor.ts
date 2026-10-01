// El mundo de afuera de la Oficina (capa "Exterior"): cielo, ciudad y calle que
// siguen la hora REAL, en los dos temas. Antes, afuera del edificio solo había
// un plano del color de fondo de la interfaz (casi negro en el tema oscuro):
// en la azotea, a mediodía, el cielo se veía negro.
//
// Capas, de lejos a cerca:
//  - Domo de cielo con gradiente (shader): cénit y horizonte de `skyAt` y una
//    silueta de cerros procedural por si el panorama no ha cargado.
//  - Cilindro de panorama: tres imágenes 21:9 (día, atardecer, noche) fundidas
//    con los pesos de la hora. Se repite espejado ×4 alrededor, así la costura
//    no existe. Sigue a la cámara (está "en el infinito": sin paralaje).
//  - Suelo, andenes y calles alrededor del edificio, árboles y postes
//    instanciados, edificios vecinos low-poly con ventanas que se prenden de
//    noche y charcos de luz bajo los postes.
//
// Nada de esto proyecta sombras ni lleva contorno (pocas draw calls: ~15).
// La niebla toma el color del horizonte, así el suelo se funde con el cielo.

import * as THREE from "three";
import { mulberry32, type SkyState } from "@hermes/shared";
import { toonUnique } from "./toon";

export interface PanoramaSet {
  day: THREE.Texture;
  dusk: THREE.Texture;
  night: THREE.Texture;
}

export interface OutdoorBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const DOME_R = 200;
const PANO_R = 175;
/** Copias del panorama alrededor del cilindro (espejadas: la costura no existe). */
const PANO_TILES = 4;
/** El tema oscuro baja un poco el exterior: la interfaz es oscura, no la hora. */
const DARK_DIM = 0.86;

const SIDEWALK = 3;
const STREET = 8;

function noOutlineMat(m: THREE.Material) {
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** Cielo y cerros como función de la dirección: lo comparten el domo y el borde superior del panorama. */
const SKY_GLSL = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uDim;
uniform float uNight;
vec3 skyColor(vec3 dir) {
  float y = dir.y;
  vec3 up = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, y));
  vec3 down = mix(uHorizon, uGround, smoothstep(0.0, -0.25, y));
  return y >= 0.0 ? up : down;
}
`;

function skyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uDim: { value: 1 },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // siempre al fondo
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        // Cerros lejanos por si el panorama aún no carga: dos crestas suaves por acimut.
        float az = atan(d.z, d.x);
        float ridge = 0.035 + 0.03 * sin(az * 3.0 + 0.6) + 0.018 * sin(az * 7.0 + 1.3) + 0.01 * sin(az * 17.0);
        if (d.y < ridge && d.y > -0.02) c = mix(c, mix(uHorizon, vec3(0.32, 0.45, 0.38), 0.45), 0.6);
        // Estrellas de noche, cerca del cénit.
        vec2 g = floor(vec2(az * 120.0, d.y * 220.0));
        float star = step(0.9965, hash(g)) * smoothstep(0.25, 0.6, d.y) * uNight;
        c += vec3(star * 0.8);
        gl_FragColor = vec4(c * uDim, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  noOutlineMat(mat);
  const m = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

function panoramaCylinder(): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
  const circumference = 2 * Math.PI * PANO_R;
  const tileW = circumference / PANO_TILES;
  const height = tileW / (21 / 9);
  const geo = new THREE.CylinderGeometry(PANO_R, PANO_R, height, 96, 1, true);
  // La base queda bajo el horizonte de la cámara: la línea de techos del panorama cae un poco abajo de los ojos.
  geo.translate(0, height / 2 - height * 0.38, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uDim: { value: 1 },
      uNight: { value: 0 },
      uDay: { value: null as THREE.Texture | null },
      uDusk: { value: null as THREE.Texture | null },
      uNightTex: { value: null as THREE.Texture | null },
      uW: { value: new THREE.Vector3(1, 0, 0) },
      uTiles: { value: PANO_TILES },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform sampler2D uDay;
      uniform sampler2D uDusk;
      uniform sampler2D uNightTex;
      uniform vec3 uW;
      uniform float uTiles;
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        // Espejado: copias pares al derecho, impares al revés (el borde de una es el de la siguiente).
        float u = vUv.x * uTiles;
        float k = floor(u);
        float f = fract(u);
        f = mod(k, 2.0) < 0.5 ? f : 1.0 - f;
        vec2 uv = vec2(f, vUv.y);
        vec3 c = texture2D(uDay, uv).rgb * uW.x + texture2D(uDusk, uv).rgb * uW.y + texture2D(uNightTex, uv).rgb * uW.z;
        // Arriba se funde con el domo; abajo, con el horizonte (donde la niebla entrega el suelo).
        vec3 sky = skyColor(normalize(vDir));
        c = mix(c, sky, smoothstep(0.72, 0.98, vUv.y));
        c = mix(c, uHorizon, smoothstep(0.06, 0.0, vUv.y));
        gl_FragColor = vec4(c * uDim, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  noOutlineMat(mat);
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -9;
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

/** Asfalto con línea central discontinua (el largo de la calle va en `u`). */
function asphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#55585e";
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(5);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    g.fillRect(rng() * 256, rng() * 256, 2, 2);
  }
  // Línea central amarilla discontinua y bordes blancos.
  g.fillStyle = "#e9c46a";
  g.fillRect(0, 124, 150, 8);
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.fillRect(0, 10, 256, 4);
  g.fillRect(0, 242, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Fachada: ventanas en rejilla; el rincón superior derecho es muro liso (de ahí sale el color del techo). */
function facadeTextures(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const S = 256;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    return c;
  };
  const a = mk();
  const b = mk();
  const ga = a.getContext("2d")!;
  const gb = b.getContext("2d")!;
  ga.fillStyle = "#ffffff";
  ga.fillRect(0, 0, S, S);
  gb.fillStyle = "#000000";
  gb.fillRect(0, 0, S, S);
  const rng = mulberry32(11);
  // 4 × 4 ventanas por paño (un paño = 4 m × 3,2 m: ver la escala de UV de cada clase).
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 4; col++) {
      if (r === 0 && col === 3) continue; // rincón liso
      const x = col * 64 + 14;
      const y = r * 64 + 16;
      ga.fillStyle = "#4a6680"; // vidrio apagado: azul pizarra, no negro (de noche, con el tinte, quedaba en negro)
      ga.fillRect(x, y, 36, 34);
      ga.fillStyle = "rgba(255,255,255,0.18)";
      ga.fillRect(x + 3, y + 3, 12, 28);
      // De noche, más o menos la mitad encendidas.
      if (rng() < 0.55) {
        gb.fillStyle = rng() < 0.7 ? "#ffd08a" : "#cfe6ff";
        gb.fillRect(x, y, 36, 34);
      }
    }
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(a), glow: tex(b) };
}

/** Charco de luz bajo un poste (degradado radial, aditivo). */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,214,150,0.9)");
  grad.addColorStop(0.5, "rgba(255,200,130,0.35)");
  grad.addColorStop(1, "rgba(255,200,130,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class Outdoor {
  readonly group = new THREE.Group();
  private readonly dome = skyDome();
  private readonly pano = panoramaCylinder();
  private readonly dim: number;
  private built = "";
  private readonly parts = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private partDisposables: { dispose(): void }[] = [];
  private facade: { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } | null = null;
  private facadeMats: THREE.MeshToonMaterial[] = [];
  private lampHeads: THREE.MeshToonMaterial | null = null;
  private poolMat: THREE.MeshBasicMaterial | null = null;
  private panorama: PanoramaSet | null = null;
  /** Materiales del exterior con su color de día: se tiñen con la hora (cálido al atardecer, azul de noche). */
  private tinted: { mat: THREE.MeshToonMaterial; base: THREE.Color }[] = [];
  /** Lo que se ve ahora (QA): pesos del panorama y si cargó. */
  state = { panorama: "sin cargar" as "sin cargar" | "cargado" | "error", weights: { day: 1, dusk: 0, night: 0 }, label: "", zenith: "", horizon: "", tint: "" };

  constructor(dark: boolean) {
    this.dim = dark ? DARK_DIM : 1;
    this.group.add(this.dome, this.pano, this.parts);
    this.disposables.push(this.dome.geometry, this.dome.material, this.pano.geometry, this.pano.material);
  }

  /** Los tres panoramas ya cargados (null = solo el domo con sus cerros). */
  setPanorama(set: PanoramaSet | null, status: "cargado" | "error" = "cargado") {
    this.panorama = set;
    const u = this.pano.material.uniforms;
    u.uDay.value = set?.day ?? null;
    u.uDusk.value = set?.dusk ?? null;
    u.uNightTex.value = set?.night ?? null;
    this.pano.visible = !!set;
    this.state.panorama = set ? "cargado" : status === "error" ? "error" : "sin cargar";
  }

  /** Arma calle, andenes, árboles, postes y edificios alrededor de la planta (solo si cambió). */
  setBounds(b: OutdoorBounds) {
    const key = [b.minX, b.maxX, b.minZ, b.maxZ].map((n) => n.toFixed(1)).join(",");
    if (key === this.built) return;
    this.built = key;
    for (const d of this.partDisposables) d.dispose();
    this.partDisposables = [];
    this.parts.clear();
    this.facadeMats = [];
    this.tinted = [];
    this.buildStreets(b);
  }

  private buildStreets(b: OutdoorBounds) {
    const D = this.partDisposables;
    const keep = <T extends { dispose(): void }>(x: T) => (D.push(x), x);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;

    // Suelo: pasto de parque, muy grande (la niebla lo entrega al horizonte).
    const grass = keep(toonUnique("#7fa36b"));
    noOutlineMat(grass);
    this.tinted.push({ mat: grass, base: grass.color.clone() });
    const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(700, 700)), grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.03, cz);
    ground.receiveShadow = true;
    this.parts.add(ground);

    // Anillos: andén pegado al edificio → calle → andén de enfrente.
    const ring = (inner: Rect, w: number): Rect[] => [
      { minX: inner.minX - w, maxX: inner.maxX + w, minZ: inner.minZ - w, maxZ: inner.minZ },
      { minX: inner.minX - w, maxX: inner.maxX + w, minZ: inner.maxZ, maxZ: inner.maxZ + w },
      { minX: inner.minX - w, maxX: inner.minX, minZ: inner.minZ, maxZ: inner.maxZ },
      { minX: inner.maxX, maxX: inner.maxX + w, minZ: inner.minZ, maxZ: inner.maxZ },
    ];
    const lot: Rect = { minX: b.minX - 0.3, maxX: b.maxX + 0.3, minZ: b.minZ - 0.3, maxZ: b.maxZ + 0.3 };
    const walk1 = ring(lot, SIDEWALK);
    const out1: Rect = { minX: lot.minX - SIDEWALK, maxX: lot.maxX + SIDEWALK, minZ: lot.minZ - SIDEWALK, maxZ: lot.maxZ + SIDEWALK };
    const road = ring(out1, STREET);
    const out2: Rect = { minX: out1.minX - STREET, maxX: out1.maxX + STREET, minZ: out1.minZ - STREET, maxZ: out1.maxZ + STREET };
    const walk2 = ring(out2, SIDEWALK);
    const out3: Rect = { minX: out2.minX - SIDEWALK, maxX: out2.maxX + SIDEWALK, minZ: out2.minZ - SIDEWALK, maxZ: out2.maxZ + SIDEWALK };

    // Andenes: una sola malla (losas de concreto claro con un bordillo).
    const slabs: THREE.BufferGeometry[] = [];
    for (const r of [...walk1, ...walk2]) {
      const g = new THREE.BoxGeometry(r.maxX - r.minX, 0.12, r.maxZ - r.minZ);
      g.translate((r.minX + r.maxX) / 2, 0.03, (r.minZ + r.maxZ) / 2);
      g.deleteAttribute("uv");
      slabs.push(g);
    }
    // Se fusionan a mano (mismo material): mergeGeometries vive en toon.ts vía mergeByMaterial; aquí basta concatenar.
    const walkMat = keep(toonUnique("#c9c2b8"));
    noOutlineMat(walkMat);
    this.tinted.push({ mat: walkMat, base: walkMat.color.clone() });
    const walkGeo = keep(mergeBoxes(slabs));
    const walks = new THREE.Mesh(walkGeo, walkMat);
    walks.receiveShadow = true;
    this.parts.add(walks);

    // Calles: cada tramo con su asfalto a lo largo (u = largo).
    const asphalt = keep(asphaltTexture());
    const roadGeos: THREE.BufferGeometry[] = [];
    for (const r of road) {
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const alongX = w >= d;
      const len = alongX ? w : d;
      const g = new THREE.PlaneGeometry(alongX ? w : d, alongX ? d : w);
      // La textura repite cada 6 m a lo largo y cubre el ancho entero.
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 6));
      g.rotateX(-Math.PI / 2);
      if (!alongX) g.rotateY(Math.PI / 2);
      g.translate((r.minX + r.maxX) / 2, -0.01, (r.minZ + r.maxZ) / 2);
      roadGeos.push(g);
    }
    const roadMat = keep(toonUnique("#ffffff"));
    roadMat.map = asphalt;
    noOutlineMat(roadMat);
    this.tinted.push({ mat: roadMat, base: roadMat.color.clone() });
    const roads = new THREE.Mesh(keep(mergeBoxes(roadGeos, true)), roadMat);
    roads.receiveShadow = true;
    this.parts.add(roads);

    // Árboles y postes sobre el andén de enfrente; los árboles también en la cuadra de afuera.
    const rng = mulberry32(Math.round(cx * 13 + cz * 7 + (b.maxX - b.minX) * 3));
    const trees: { x: number; z: number; s: number }[] = [];
    const lamps: { x: number; z: number }[] = [];
    const along = (r: Rect, step: number, fn: (x: number, z: number) => void) => {
      const alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
      const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
      const n = Math.max(1, Math.floor(len / step));
      for (let i = 0; i <= n; i++) {
        const t = (i + 0.5) / (n + 1);
        const x = alongX ? r.minX + (r.maxX - r.minX) * t : (r.minX + r.maxX) / 2;
        const z = alongX ? (r.minZ + r.maxZ) / 2 : r.minZ + (r.maxZ - r.minZ) * t;
        fn(x, z);
      }
    };
    walk2.forEach((r, i) => along(r, 9, (x, z) => (i % 2 ? lamps.push({ x, z }) : trees.push({ x, z, s: 0.9 + rng() * 0.5 }))));
    walk2.forEach((r) => along(r, 13, (x, z) => lamps.push({ x: x + 4, z: z + 4 })));
    walk1.slice(0, 1).forEach((r) => along(r, 7, (x, z) => trees.push({ x, z, s: 0.8 + rng() * 0.3 })));
    // Frente: árboles junto a la entrada, sin tapar la puerta (centro libre ±5 m).
    walk1.slice(1, 2).forEach((r) => along(r, 6, (x, z) => Math.abs(x - cx) > 5 && trees.push({ x, z: z + 0.6, s: 0.8 + rng() * 0.3 })));

    // Edificios vecinos: cuadras afuera del anillo, más altos atrás (−z) y a los lados, bajos al frente (la cámara aérea mira desde +z).
    const blocks: { x: number; z: number; w: number; d: number; h: number; c: THREE.Color }[] = [];
    const facadeColors = ["#c96f4a", "#d9b48f", "#e8dcc5", "#b5563a", "#a3b1b8", "#e2c799", "#8f6b52"];
    const addRow = (x0: number, x1: number, z0: number, z1: number, axis: "x" | "z", hMin: number, hMax: number) => {
      let u = axis === "x" ? x0 : z0;
      const end = axis === "x" ? x1 : z1;
      while (u < end - 4) {
        const w = 7 + rng() * 7;
        const span = Math.min(w, end - u);
        const depth = 8 + rng() * 6;
        const h = hMin + rng() * (hMax - hMin);
        const c = new THREE.Color(facadeColors[Math.floor(rng() * facadeColors.length)]);
        if (axis === "x") blocks.push({ x: u + span / 2, z: z0 + (z1 > z0 ? depth / 2 : -depth / 2), w: span - 0.8, d: depth, h, c });
        else blocks.push({ x: x0 + (x1 > x0 ? depth / 2 : -depth / 2), z: u + span / 2, w: depth, d: span - 0.8, h, c });
        u += span;
        // A veces una plaza con árboles en vez de edificio.
        if (rng() < 0.18) {
          const gap = 6;
          for (let k = 0; k < 2; k++) {
            const tx = axis === "x" ? u + 1.5 + k * 3 : x0 + (x1 > x0 ? 3 : -3);
            const tz = axis === "x" ? z0 + (z1 > z0 ? 3 : -3) : u + 1.5 + k * 3;
            trees.push({ x: tx, z: tz, s: 1 + rng() * 0.4 });
          }
          u += gap;
        }
      }
    };
    const pad = 1.5;
    // Alturas pensadas para que desde la azotea (ojos a ~9 m) se vean los cerros del panorama por encima.
    addRow(out3.minX - 20, out3.maxX + 20, out3.minZ - pad, out3.minZ - pad - 1, "x", 4.5, 10); // atrás
    addRow(out3.minX - 34, out3.maxX + 34, out3.minZ - pad - 22, out3.minZ - pad - 23, "x", 6, 10.5); // segunda fila, más lejos (bajo los ojos en la azotea)
    addRow(out3.maxX + pad, out3.maxX + pad + 1, out3.minZ - 10, out3.maxZ + 6, "z", 4, 9); // este
    addRow(out3.minX - pad, out3.minX - pad - 1, out3.minZ - 10, out3.maxZ + 6, "z", 4, 9); // oeste
    addRow(out3.minX - 20, out3.maxX + 20, out3.maxZ + pad + 6, out3.maxZ + pad + 7, "x", 3.5, 5.5); // frente, bajos y lejos

    // Fachadas: UNA InstancedMesh para todos. El UV sale de la posición en el mundo (shader), así
    // cualquier edificio tiene ventanas de 4 × 3,2 m sin estirarse, y el techo es muro liso.
    this.facade ??= facadeTextures();
    if (blocks.length) {
      const geo = keep(new THREE.BoxGeometry(1, 1, 1));
      geo.translate(0, 0.5, 0);
      const mat = keep(toonUnique("#ffffff"));
      mat.map = this.facade.map;
      mat.emissiveMap = this.facade.glow;
      mat.emissive = new THREE.Color("#ffffff");
      mat.emissiveIntensity = 0;
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
          {
            vec4 fw = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vec3 fn = normalize(mat3(instanceMatrix) * normal);
            vec2 fuv = abs(fn.y) > 0.5 ? vec2(0.93, 0.93) : vec2((abs(fn.x) > 0.5 ? fw.z : fw.x) / 4.0, fw.y / 3.2);
            vMapUv = fuv;
            vEmissiveMapUv = fuv;
          }`,
        );
      };
      noOutlineMat(mat);
      this.facadeMats.push(mat);
      this.tinted.push({ mat, base: new THREE.Color("#ffffff") });
      const im = new THREE.InstancedMesh(geo, mat, blocks.length);
      const m4b = new THREE.Matrix4();
      blocks.forEach((k, i) => {
        m4b.compose(new THREE.Vector3(k.x, 0, k.z), new THREE.Quaternion(), new THREE.Vector3(k.w, k.h, k.d));
        im.setMatrixAt(i, m4b);
        im.setColorAt(i, k.c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.receiveShadow = true;
      this.parts.add(im);
    }

    // Árboles: tronco + copa (dos instancias por árbol, dos draw calls en total).
    const trunkGeo = keep(new THREE.CylinderGeometry(0.12, 0.18, 1.8, 6));
    trunkGeo.translate(0, 0.9, 0);
    const crownGeo = keep(new THREE.IcosahedronGeometry(1.2, 1));
    crownGeo.translate(0, 2.6, 0);
    const trunkMat = keep(toonUnique("#7a5236"));
    const crownMat = keep(toonUnique("#ffffff"));
    noOutlineMat(trunkMat);
    this.tinted.push({ mat: trunkMat, base: trunkMat.color.clone() });
    noOutlineMat(crownMat);
    this.tinted.push({ mat: crownMat, base: crownMat.color.clone() });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
    const greens = ["#4f9d55", "#5fb760", "#3f8a4a", "#6aaa5e", "#7cb86a"];
    const m4 = new THREE.Matrix4();
    trees.forEach((t, i) => {
      m4.compose(new THREE.Vector3(t.x, 0, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6), new THREE.Vector3(t.s, t.s, t.s));
      trunks.setMatrixAt(i, m4);
      crowns.setMatrixAt(i, m4);
      crowns.setColorAt(i, new THREE.Color(greens[Math.floor(rng() * greens.length)]));
    });
    trunks.castShadow = crowns.castShadow = false;
    this.parts.add(trunks, crowns);

    // Postes: poste negro + cabeza que se prende de noche, con su charco de luz en el piso.
    const poleGeo = keep(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6));
    poleGeo.translate(0, 2.1, 0);
    const headGeo = keep(new THREE.SphereGeometry(0.22, 10, 8));
    headGeo.translate(0, 4.3, 0);
    const poleMat = keep(toonUnique("#2a2b30"));
    const headMat = keep(toonUnique("#fff1d0"));
    headMat.emissive = new THREE.Color("#ffcf7a");
    headMat.emissiveIntensity = 0;
    noOutlineMat(poleMat);
    this.tinted.push({ mat: poleMat, base: poleMat.color.clone() });
    noOutlineMat(headMat);
    this.lampHeads = headMat;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
    const poolGeo = keep(new THREE.PlaneGeometry(7, 7));
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, 0.1, 0);
    const poolTex = keep(poolTexture());
    const poolMat = keep(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    noOutlineMat(poolMat);
    this.poolMat = poolMat;
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);
    lamps.forEach((l, i) => {
      m4.makeTranslation(l.x, 0, l.z);
      poles.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
      pools.setMatrixAt(i, m4);
    });
    pools.renderOrder = 1;
    this.parts.add(poles, heads, pools);
    this.counts = { trees: trees.length, lamps: lamps.length, buildings: blocks.length };
  }

  counts = { trees: 0, lamps: 0, buildings: 0 };

  /** Cada segundo (o al forzar la hora): colores, pesos del panorama, luces de la ciudad. */
  update(sky: SkyState, fog: THREE.Fog | null) {
    const zen = new THREE.Color(sky.zenith);
    const hor = new THREE.Color(sky.horizon);
    // Bajo el horizonte: el horizonte un poco más denso (bruma de ciudad), nunca negro.
    const below = hor.clone().lerp(new THREE.Color("#3a4a5a"), 0.35);
    for (const m of [this.dome.material, this.pano.material]) {
      m.uniforms.uZenith.value.copy(zen);
      m.uniforms.uHorizon.value.copy(hor);
      m.uniforms.uGround.value.copy(below);
      m.uniforms.uDim.value = this.dim;
      m.uniforms.uNight.value = sky.weights.night;
    }
    this.pano.material.uniforms.uW.value.set(sky.weights.day, sky.weights.dusk, sky.weights.night);
    if (fog) fog.color.copy(hor).multiplyScalar(this.dim);
    for (const m of this.facadeMats) m.emissiveIntensity = sky.cityLights * 0.95;
    // La luz del interior es la de la sala (lámparas, tema); el exterior se tiñe con la hora.
    const tint = new THREE.Color(0, 0, 0)
      .add(new THREE.Color("#ffffff").multiplyScalar(sky.weights.day))
      .add(new THREE.Color("#ffc7a1").multiplyScalar(sky.weights.dusk))
      .add(new THREE.Color("#8e9acb").multiplyScalar(sky.weights.night))
      .multiplyScalar(this.dim);
    for (const t of this.tinted) t.mat.color.copy(t.base).multiply(tint);
    this.state.tint = `#${tint.getHexString()}`;
    if (this.lampHeads) this.lampHeads.emissiveIntensity = 0.15 + sky.cityLights * 1.6;
    if (this.poolMat) this.poolMat.opacity = sky.cityLights * 0.55;
    this.state.weights = { day: +sky.weights.day.toFixed(3), dusk: +sky.weights.dusk.toFixed(3), night: +sky.weights.night.toFixed(3) };
    this.state.label = sky.label;
    this.state.zenith = sky.zenith;
    this.state.horizon = sky.horizon;
  }

  /** Cada frame: el cielo y el panorama están "en el infinito" (siguen a la cámara). */
  follow(camera: THREE.Camera) {
    this.dome.position.copy(camera.position);
    this.pano.position.copy(camera.position);
  }

  dispose() {
    for (const d of this.partDisposables) d.dispose();
    for (const d of this.disposables) d.dispose();
    this.facade?.map.dispose();
    this.facade?.glow.dispose();
    this.group.removeFromParent();
  }
}

/** Concatena geometrías del mismo tipo de atributos (posición, normal y, si se pide, UV). */
function mergeBoxes(geos: THREE.BufferGeometry[], withUv = false): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = withUv ? new Float32Array(total * 2) : null;
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    if (uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  if (uv) out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  for (const g of geos) g.dispose();
  for (const g of parts) g.dispose();
  return out;
}
