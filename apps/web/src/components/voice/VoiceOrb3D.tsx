"use client";

// Orbe de voz en 3D (WebGL). Reemplaza al orbe CSS como PROTAGONISTA del home:
// una esfera de icosaedro deformada por ruido simplex en el vertex shader, cuyo
// relieve monta sobre el volumen REAL de la llamada (getInputVolume cuando
// escuchas · getOutputVolume cuando habla Hermes).
//
// Skills de referencia (convención del repo, igual que KnowledgeGraph):
//  - threejs-fundamentals   → escena/cámara/renderer + dispose exhaustivo
//  - threejs-shaders        → ShaderMaterial, ruido simplex, fresnel
//  - threejs-postprocessing → UnrealBloomPass + OutputPass
//
// Decisiones que NO son de gusto:
//  - El canvas es FIJO a toda la ventana y el orbe rastrea un ancla del DOM.
//    Dentro de una caja del tamaño del orbe, los anillos (r≈2) y las partículas
//    (r≈2.6) se recortan contra el borde. Aquí el CSS manda la posición y el
//    WebGL solo garantiza que nada se corte.
//  - ACES + OutputPass son obligatorios: el roll-off de altas luces es lo que
//    impide el white-out. Sin ellos, subir el brillo satura a blanco y la
//    esfera se aplana a un disco (misma regla del bloom del Knowledge Network).
//  - En el muelle el relieve se ALISA: el mismo ruido a ~28px de radio se lee
//    como suciedad. Encoger no basta — hay que simplificar.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { readToken } from "@/components/ui/tones";
import type { OrbState } from "./orbState";

// Mismo lenguaje de color que el resto de la UI de voz (label, pill de estado):
// el orbe no inventa tonos, los hereda. `rim` mantiene la dualidad de marca
// violeta↔cian en el borde.
const ORB_COLORS: Record<OrbState, { accent: [string, string]; rim: [string, string] }> = {
  na: { accent: ["--color-text-dim", "#8891c5"], rim: ["--color-text-dim", "#8891c5"] },
  off: { accent: ["--color-violet", "#a78bfa"], rim: ["--color-cyan", "#67e8f9"] },
  connecting: { accent: ["--color-amber", "#fbbf24"], rim: ["--color-violet-hot", "#c4b5fd"] },
  listening: { accent: ["--color-green", "#6ee7a0"], rim: ["--color-cyan", "#67e8f9"] },
  speaking: { accent: ["--color-violet-hot", "#c4b5fd"], rim: ["--color-cyan", "#67e8f9"] },
  exec: { accent: ["--color-cyan", "#67e8f9"], rim: ["--color-violet-hot", "#c4b5fd"] },
};

// Ruido simplex 3D (Ashima) — compartido por los shaders del orbe.
const NOISE = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// Capa lenta = respiración · capa rápida = voz.
const DISPLACE = `
float fbm(vec3 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<3;i++){ v += a*snoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
float noiseAt(vec3 p){
  float t = uTime * 0.28;
  float slow = fbm(p*1.25 + vec3(0.0, 0.0, t));
  float fast = fbm(p*3.1 + vec3(t*1.7, t*1.1, t*0.6));
  float d = slow * (0.070 + uBass*0.20) + fast * (0.014 + uAudio*0.14);
  return d * mix(0.16, 1.0, uAux);
}
float mouseAmt(vec3 p){
  return smoothstep(0.15, 1.0, dot(normalize(p), uMouseDir)) * uHover;
}
// En la esfera unidad la normal ES el propio punto: usar el atributo 'normal'
// aquí desplazaría los VECINOS en la dirección del vértice central y las
// normales recalculadas saldrían mal (relieve plano).
vec3 displace(vec3 p){
  float d = noiseAt(p) + mouseAmt(p) * 0.14 * mix(0.3, 1.0, uAux);
  return p + normalize(p) * d;
}
`;

interface Props {
  /** Elemento del DOM que el orbe debe rastrear. Se lee cada frame. */
  getAnchor: () => HTMLElement | null;
  /** Muelle: alisa el relieve y apaga anillos/jaula/partículas. */
  simplified?: boolean;
  state: OrbState;
  /** Volumen real de la llamada (0..1). Devuelve 0 si no hay llamada. */
  getVolume: () => number;
}

export function VoiceOrb3D({ getAnchor, simplified = false, state, getVolume }: Props) {
  // Props que lee el loop → refs, así deps=[] y la escena NUNCA se remonta
  // (patrón de KnowledgeGraph: remontar WebGL en cada render es carísimo).
  const getAnchorRef = useRef(getAnchor);
  getAnchorRef.current = getAnchor;
  const getVolumeRef = useRef(getVolume);
  getVolumeRef.current = getVolume;
  const stateRef = useRef(state);
  stateRef.current = state;
  const simplifiedRef = useRef(simplified);
  simplifiedRef.current = simplified;

  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reduceMotion = mq?.matches ?? false;
    const onMotionChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
    };
    mq?.addEventListener?.("change", onMotionChange);

    const color = (t: [string, string]) => new THREE.Color(readToken(t[0], t[1]));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // Tope 1.75: el bloom corre a pantalla completa, no en una caja pequeña.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.className = "h-full w-full";
    host.appendChild(renderer.domElement);

    // Todo el conjunto en un rig: se mueve y escala como una pieza.
    const rig = new THREE.Group();
    scene.add(rig);

    const uniforms = {
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uBass: { value: 0 },
      uDim: { value: 1 },
      uAux: { value: 1 },
      uHover: { value: 0 },
      uMouseDir: { value: new THREE.Vector3(0, 0, 1) },
      uDpr: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
      uAccent: { value: color(ORB_COLORS.off.accent) },
      uRim: { value: color(ORB_COLORS.off.rim) },
      uHot: { value: color(["--color-violet-hot", "#c4b5fd"]) },
    };

    const orbGeo = new THREE.IcosahedronGeometry(1, 48);
    const orbMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        uniform float uTime, uAudio, uBass, uHover, uAux;
        uniform vec3 uMouseDir;
        varying vec3 vNormal; varying vec3 vWorld; varying float vDisp; varying float vM;
        ${NOISE}
        ${DISPLACE}
        void main(){
          vec3 dp = displace(position);
          vDisp = noiseAt(position);
          vM = mouseAmt(position);
          // Normal recalculada con dos vecinos sobre la tangente: sin esto el
          // fresnel usa la normal de la esfera y el relieve se ve plano.
          vec3 ref = abs(normal.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
          vec3 t1 = normalize(cross(normal, ref));
          vec3 t2 = normalize(cross(normal, t1));
          vec3 n1 = displace(normalize(position + t1*0.035));
          vec3 n2 = displace(normalize(position + t2*0.035));
          vec3 N  = normalize(cross(n1 - dp, n2 - dp));
          if(dot(N, normal) < 0.0) N = -N;
          vNormal = normalize(normalMatrix * N);
          vWorld = (modelMatrix * vec4(dp, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(dp, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uAccent, uRim, uHot;
        uniform float uAudio, uDim, uAux;
        varying vec3 vNormal; varying vec3 vWorld; varying float vDisp; varying float vM;
        void main(){
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(V, N), 0.0), 2.6);

          // CUERPO OSCURO + BORDE VIVO: así se lee esfera. Si el interior brilla
          // tanto como el borde, se aplana a disco.
          float crest = smoothstep(-0.10, 0.16, vDisp);
          vec3 col = uAccent * (0.03 + crest * 0.14);

          // Luz de estudio falsa: volumen sin meter un light real
          float key = max(dot(N, normalize(vec3(0.6, 0.7, 0.5))), 0.0);
          col += uAccent * pow(key, 3.0) * 0.30;

          // Grietas de plasma: solo los picos brillan → contraste, no una masa.
          col += uHot * pow(crest, 3.0) * (0.22 + uAudio * 0.95) * mix(0.30, 1.0, uAux);
          col += uRim * pow(crest, 6.0) * uAudio * 0.55 * uAux;

          // Muelle: ambiente mínimo para que no se apague al perder relieve
          col += uAccent * (1.0 - uAux) * 0.07;

          col += uRim * fres * (0.38 + uAudio * 0.42);
          col += uHot * pow(vM, 1.6) * 0.30;

          gl_FragColor = vec4(col * uDim, 1.0);
        }
      `,
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    rig.add(orb);

    // Atmósfera: cara interna + fresnel aditivo = halo con volumen real.
    const atmoGeo = new THREE.IcosahedronGeometry(1.24, 5);
    const atmoMat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vNormal; varying vec3 vWorld;
        void main(){
          vNormal = normalize(normalMatrix * normal);
          vWorld = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `
        uniform vec3 uAccent; uniform float uAudio, uDim;
        varying vec3 vNormal; varying vec3 vWorld;
        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          // abs(), no max(): en BackSide dot(V,N) es NEGATIVO en toda la cara
          // trasera, así que max() lo aplanaría a f=1 → disco sólido, no halo.
          float f = pow(1.0 - abs(dot(V, normalize(vNormal))), 3.0);
          gl_FragColor = vec4(uAccent * f * (0.55 + uAudio*0.70) * uDim, f*0.85*uDim);
        }`,
    });
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    rig.add(atmo);

    // Jaula geodésica: la retícula HUD.
    const shellSrc = new THREE.IcosahedronGeometry(1.55, 1);
    const shellGeo = new THREE.WireframeGeometry(shellSrc);
    const shellMat = new THREE.LineBasicMaterial({
      color: readToken("--color-violet", "#a78bfa"),
      transparent: true,
      opacity: 0.07,
    });
    const shell = new THREE.LineSegments(shellGeo, shellMat);
    rig.add(shell);

    // Anillos: dan eje y escala. Inclinados ~22° — a π/2 exactos quedan de
    // canto y se leen como una raya que cruza el orbe.
    const TILT = Math.PI * 0.5 - 0.38;
    const ringAGeo = new THREE.TorusGeometry(1.78, 0.0045, 8, 220);
    const ringAMat = new THREE.MeshBasicMaterial({
      color: readToken("--color-cyan", "#67e8f9"),
      transparent: true,
      opacity: 0.34,
    });
    const ringA = new THREE.Mesh(ringAGeo, ringAMat);
    ringA.rotation.x = TILT;
    rig.add(ringA);

    const ringBGeo = new THREE.TorusGeometry(2.02, 0.0035, 8, 220);
    const ringBMat = new THREE.MeshBasicMaterial({
      color: readToken("--color-violet", "#a78bfa"),
      transparent: true,
      opacity: 0.24,
    });
    const ringB = new THREE.Mesh(ringBGeo, ringBMat);
    ringB.rotation.x = TILT + 0.3;
    ringB.rotation.y = 0.42;
    rig.add(ringB);

    // Partículas en órbita
    const N = 520;
    const pp = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = 1.75 + Math.random() * 0.85;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pp[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pp[i * 3 + 1] = r * Math.cos(ph) * 0.55;
      pp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      seed[i] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pp, 3));
    dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const dustMat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        uniform float uTime, uAudio, uDpr; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position * (1.0 + uAudio*0.16);
          p.y += sin(uTime*0.55 + aSeed*6.28) * 0.05;
          vA = 0.25 + 0.75*abs(sin(uTime*0.8 + aSeed*9.0));
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          // gl_PointSize son PÍXELES del drawing buffer, no unidades de mundo:
          // con un factor grande, 520 puntos aditivos inundan el canvas.
          gl_PointSize = (0.8 + aSeed*1.2 + uAudio*1.6) * uDpr * (5.5 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uAccent; uniform float uDim, uAux; varying float vA;
        void main(){
          float d = length(gl_PointCoord - vec2(0.5));
          if(d > 0.5) discard;
          gl_FragColor = vec4(uAccent, smoothstep(0.5, 0.0, d) * vA * 0.65 * uDim * uAux);
        }`,
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    rig.add(dust);

    // Bloom CONTENIDO — misma regla que el Knowledge Network: acento de marca,
    // jamás white-out (threshold 0.55).
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.4, 0.55);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // ── Cursor ────────────────────────────────────────────────
    // El canvas es pointer-events:none (la UI manda), así que se escucha en
    // window y se aplica al rig a mano.
    const mouse = { x: 0, y: 0, has: false };
    const ptr = { x: 0, y: 0, hover: 0 };
    const onPointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.has = true;
    };
    const onPointerLeave = () => {
      mouse.has = false;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);

    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();
    const accentTarget = new THREE.Color();
    const rimTarget = new THREE.Color();

    const DEG = Math.PI / 180;
    const worldH = () => 2 * Math.tan((camera.fov / 2) * DEG) * camera.position.z;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const place = { x: 0, y: 0, s: 0.3, dim: 1, aux: 1 };
    const para = { x: 0, y: 0 };

    let raf = 0;
    const clock = new THREE.Clock();

    const step = () => {
      const t = clock.getElapsedTime();
      const st = stateRef.current;
      const simple = simplifiedRef.current;

      // Volumen real de la llamada
      const raw = getVolumeRef.current();
      const level = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      // Suavizado asimétrico: ataque rápido, caída lenta — así se siente vivo
      const up = level > uniforms.uAudio.value;
      uniforms.uAudio.value = lerp(uniforms.uAudio.value, level, up ? 0.45 : 0.09);
      uniforms.uBass.value = lerp(uniforms.uBass.value, level * 0.75, up ? 0.4 : 0.07);
      uniforms.uTime.value = reduceMotion ? 0 : t;

      // Color según estado (lerp: los cambios de estado no dan saltos)
      const c = ORB_COLORS[st] ?? ORB_COLORS.off;
      accentTarget.set(readToken(c.accent[0], c.accent[1]));
      rimTarget.set(readToken(c.rim[0], c.rim[1]));
      uniforms.uAccent.value.lerp(accentTarget, 0.05);
      uniforms.uRim.value.lerp(rimTarget, 0.05);

      // Rastreo del ancla: un punto en z=0 se proyecta a NDC = (x/(w/2),
      // y/(h/2)); despejando colocamos el rig justo sobre el elemento.
      const anchor = getAnchorRef.current();
      const wh = worldH();
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        if (r.width > 0) {
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const pxPerWorld = window.innerHeight / wh;
          const radiusPx = r.height * (simple ? 0.3 : 0.4);
          place.x = lerp(place.x, ((cx / window.innerWidth) * 2 - 1) * ((wh * camera.aspect) / 2), 0.1);
          place.y = lerp(place.y, -((cy / window.innerHeight) * 2 - 1) * (wh / 2), 0.1);
          place.s = lerp(place.s, radiusPx / pxPerWorld, 0.08);
          place.dim = lerp(place.dim, simple ? 0.9 : 1, 0.06);
          place.aux = lerp(place.aux, simple ? 0 : 1, 0.08);
        }
      }
      rig.position.set(place.x, place.y, 0);
      rig.scale.setScalar(place.s);
      uniforms.uDim.value = place.dim;
      uniforms.uAux.value = place.aux;

      // Cursor → dirección en espacio del orbe + cercanía
      const W = window.innerWidth;
      const H = window.innerHeight;
      ptr.x = lerp(ptr.x, mouse.has ? (mouse.x / W) * 2 - 1 : 0, 0.07);
      ptr.y = lerp(ptr.y, mouse.has ? -((mouse.y / H) * 2 - 1) : 0, 0.07);
      const pxPerWorld = H / wh;
      tmp.set(place.x, place.y, 0).project(camera);
      const ocx = (tmp.x * 0.5 + 0.5) * W;
      const ocy = (-tmp.y * 0.5 + 0.5) * H;
      const rPx = Math.max(1, place.s * pxPerWorld);
      const dist = mouse.has ? Math.hypot(mouse.x - ocx, mouse.y - ocy) : 1e9;
      const near = 1 - Math.min(1, Math.max(0, (dist - rPx * 0.9) / (rPx * 2.4)));
      ptr.hover = lerp(ptr.hover, near, 0.08);
      uniforms.uHover.value = ptr.hover;

      ndc.set(ptr.x, ptr.y);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        rig.updateMatrixWorld();
        const local = rig.worldToLocal(hit.clone());
        // El +z sesga la deformación al hemisferio frontal: sin él el bulto se
        // iría siempre al ecuador.
        uniforms.uMouseDir.value.set(local.x, local.y, 1.15).normalize();
      }

      if (!reduceMotion) {
        para.y = lerp(para.y, ptr.x * 0.3, 0.05);
        para.x = lerp(para.x, -ptr.y * 0.22, 0.05);
        rig.rotation.y = para.y;
        rig.rotation.x = para.x;
        orb.rotation.y = t * 0.09;
        orb.rotation.x = Math.sin(t * 0.22) * 0.14;
        atmo.rotation.y = -t * 0.05;
        shell.rotation.y = -t * 0.07;
        ringA.rotation.z = t * 0.16;
        ringB.rotation.z = -t * 0.11;
        dust.rotation.y = t * 0.045;
        const idle = 0.5 + 0.5 * Math.sin(t * 0.6);
        orb.scale.setScalar(1 + idle * 0.012 + uniforms.uAudio.value * 0.1);
      }

      shellMat.opacity = (0.06 + uniforms.uAudio.value * 0.16) * place.dim * place.aux;
      ringAMat.opacity = 0.34 * place.dim * place.aux;
      ringBMat.opacity = 0.24 * place.dim * place.aux;
      bloom.strength = (0.38 + uniforms.uAudio.value * 0.22) * place.dim;

      composer.render();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    // ── Limpieza total (skill: fundamentals — dispose de GPU) ───────────
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      mq?.removeEventListener?.("change", onMotionChange);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      orbGeo.dispose();
      orbMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      shellSrc.dispose();
      shellGeo.dispose();
      shellMat.dispose();
      ringAGeo.dispose();
      ringAMat.dispose();
      ringBGeo.dispose();
      ringBMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pointer-events-none: el canvas cubre la ventana pero la UI sigue clicable.
  return <div ref={hostRef} className="pointer-events-none fixed inset-0 z-1" aria-hidden />;
}
