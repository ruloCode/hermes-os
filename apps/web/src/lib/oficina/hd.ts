// Texturas y arte en alta (capa "Texturas y arte"): ladrillo, concreto pulido,
// deck, madera, tela y tiza de 1024 px sin costura, más los cuadros y el afiche.
// Todo generado con Higgsfield con prompts propios y procesado con
// scripts/oficina-assets.py (procedencia en public/oficina/README.md).
//
// Una imagen se sube UNA vez a la GPU: cada uso es un `clone()` que comparte la
// misma `Source` (three.js la reutiliza) y solo cambia su `repeat`. El estilo no
// cambia: siguen siendo MeshToonMaterial con su rampa de tres pasos.
//
// Se precarga al montar la escena; la sala usa lo HD solo si ya cargó (si no,
// los canvas de siempre) y se rearma una vez cuando termina.

import * as THREE from "three";
import { toonUnique } from "./toon";

export const HD_TEXTURES = ["ladrillo", "concreto", "deck", "madera", "tela", "tiza"] as const;
export const HD_ART = ["arte-circulos", "arte-cafetal", "afiche-cafe", "arte-amanecer"] as const;
export type HdTexture = (typeof HD_TEXTURES)[number];
export type HdArt = (typeof HD_ART)[number];

const base = new Map<string, THREE.Texture>();
let pending: Promise<boolean> | null = null;
let ready = false;
let failed = false;

/** Carga todo una vez (las siguientes llamadas devuelven la misma promesa). true = todo cargó. */
export function preloadHd(): Promise<boolean> {
  if (pending) return pending;
  const loader = new THREE.TextureLoader();
  const one = (file: string, tile: boolean) =>
    new Promise<void>((res, rej) =>
      loader.load(
        `/oficina/${file}.webp`,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          if (tile) t.wrapS = t.wrapT = THREE.RepeatWrapping;
          base.set(file, t);
          res();
        },
        undefined,
        rej,
      ),
    );
  pending = Promise.all([...HD_TEXTURES.map((n) => one(`tex-${n}`, true)), ...HD_ART.map((n) => one(n, false))])
    .then(() => (ready = true))
    .catch(() => {
      failed = true;
      return false;
    });
  return pending;
}

export function hdReady(): boolean {
  return ready;
}

export function hdState(): "cargado" | "cargando" | "error" | "sin pedir" {
  return ready ? "cargado" : failed ? "error" : pending ? "cargando" : "sin pedir";
}

/** La imagen del arte (para pintarla en un canvas, como la pizarra de tiza) o null si no cargó. */
export function hdImage(name: HdTexture | HdArt): CanvasImageSource | null {
  const t = base.get(name.startsWith("arte") || name.startsWith("afiche") ? name : `tex-${name}`);
  return (t?.image as CanvasImageSource | undefined) ?? null;
}

/** Una copia de la textura con su repeat (comparte la imagen subida). null si no cargó. */
export function hdTexture(name: HdTexture | HdArt, repeatU = 1, repeatV = 1): THREE.Texture | null {
  const t = base.get(name.startsWith("arte") || name.startsWith("afiche") ? name : `tex-${name}`);
  if (!t) return null;
  const c = t.clone();
  c.repeat.set(repeatU, repeatV);
  return c;
}

const mats = new Map<string, THREE.MeshToonMaterial>();

/**
 * Material toon con textura HD, teñido por `color` (la tela del sofá es la misma
 * imagen gris en terracota o verde). Cacheado por textura, color y repeat.
 */
export function hdToon(name: HdTexture, color: THREE.ColorRepresentation, repeatU = 1, repeatV = 1): THREE.MeshToonMaterial | null {
  const key = `${name}|${new THREE.Color(color).getHexString()}|${repeatU}|${repeatV}`;
  const hit = mats.get(key);
  if (hit) return hit;
  const map = hdTexture(name, repeatU, repeatV);
  if (!map) return null;
  const m = toonUnique(color);
  m.map = map;
  mats.set(key, m);
  return m;
}

/** Cuánto pesan las imágenes base en la GPU (RGBA8 con mipmaps), para el presupuesto del QA. */
export function hdMegabytes(): number {
  let b = 0;
  for (const t of base.values()) {
    const img = t.image as { width?: number; height?: number } | undefined;
    b += (img?.width ?? 0) * (img?.height ?? 0) * 4 * (4 / 3);
  }
  return +(b / 1048576).toFixed(1);
}
