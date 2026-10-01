"""Procesa el arte generado de la Oficina (v8) a lo que carga three.js.

  python3 apps/web/scripts/oficina-assets.py pano  <entrada.png> <salida.webp>
  python3 apps/web/scripts/oficina-assets.py tile  <entrada.png> <salida.webp> [--size 1024] [--band 0.14]
  python3 apps/web/scripts/oficina-assets.py exact <entrada.png> <salida.webp> --crop x0,y0,x1,y1 [--size 1024]
  python3 apps/web/scripts/oficina-assets.py art   <entrada.png> <salida.webp> [--w 512 --h 640]

- pano: recorta a 21:9 dejando la franja del horizonte (el cielo plano de arriba
  sobra: el domo lo pinta) y escala a 2048 × 1024 (potencia de 2: mipmaps).
- tile: hace la textura SIN COSTURA. Mezcla la imagen con ella misma corrida
  media vuelta solo en una banda junto al borde (`--band`, fracción del lado):
  en el borde manda la copia corrida (que ahí es continua al envolverse) y
  adentro la original, así el "fantasma" de la mezcla queda en una franja
  angosta. Escala a `--size` (potencia de 2).
- exact: para patrones REGULARES (ladrillo, tablones), donde mezclar deja una
  franja borrosa: se recorta a un número entero de períodos medidos (juntas de
  mortero, tablas) y se escala, sin mezclar nada. Repite exacto.
- art: recorta al centro con la proporción pedida y escala (cuadros y afiches).

Usa el python3 del sistema (solo PIL) y `cwebp` (Homebrew). No hay
dependencias del repo.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops


def webp(img: Image.Image, out: Path, q: int = 82) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        subprocess.run(["cwebp", "-quiet", "-q", str(q), "-m", "6", tmp.name, "-o", str(out)], check=True)
    print(f"{out}  {img.width}×{img.height}  {out.stat().st_size // 1024} KB")


def pano(src: Path, out: Path) -> None:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    # Misma FRACCIÓN de alto en las tres horas (las ediciones salen con unos px de diferencia):
    # el 75 % de abajo de un 16:9 es ≈ 21:9 y así día, atardecer y noche quedan alineados.
    ch = round(h * 0.75)
    im = im.crop((0, h - ch, w, h))
    webp(im.resize((2048, 1024), Image.LANCZOS), out, 80)


def tile(src: Path, out: Path, size: int, band: float) -> None:
    im = Image.open(src).convert("RGB")
    s = min(im.size)
    im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width - s) // 2 + s, (im.height - s) // 2 + s)).resize((size, size), Image.LANCZOS)
    rolled = ImageChops.offset(im, size // 2, size // 2)
    # Peso de la original: 0 en el borde, 1 al salir de la banda (suavizado); el resto, la copia corrida.
    ramp = []
    for i in range(size):
        t = min(1.0, min(i, size - 1 - i) / (size * band))
        ramp.append(round(255 * t * t * (3 - 2 * t)))
    mx = Image.new("L", (size, 1))
    mx.putdata(ramp)
    mx = mx.resize((size, size), Image.NEAREST)
    my = mx.transpose(Image.Transpose.ROTATE_90)
    mask = ImageChops.darker(mx, my)
    webp(Image.composite(im, rolled, mask), out, 82)


def exact(src: Path, out: Path, crop: str, size: int, xband: float) -> None:
    x0, y0, x1, y1 = (int(v) for v in crop.split(","))
    im = Image.open(src).convert("RGB").crop((x0, y0, x1, y1)).resize((size, size), Image.LANCZOS)
    if xband > 0:
        # Tablones que corren de lado a lado: se mezcla solo a lo ancho (correr en x no mueve las filas).
        rolled = ImageChops.offset(im, size // 2, 0)
        ramp = []
        for i in range(size):
            t = min(1.0, min(i, size - 1 - i) / (size * xband))
            ramp.append(round(255 * t * t * (3 - 2 * t)))
        mx = Image.new("L", (size, 1))
        mx.putdata(ramp)
        im = Image.composite(im, rolled, mx.resize((size, size), Image.NEAREST))
    webp(im, out, 82)


def art(src: Path, out: Path, w: int, h: int) -> None:
    im = Image.open(src).convert("RGB")
    target = w / h
    cw, chh = im.size
    if cw / chh > target:
        nw = round(chh * target)
        im = im.crop(((cw - nw) // 2, 0, (cw - nw) // 2 + nw, chh))
    else:
        nh = round(cw / target)
        im = im.crop((0, (chh - nh) // 2, cw, (chh - nh) // 2 + nh))
    webp(im.resize((w, h), Image.LANCZOS), out, 84)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["pano", "tile", "exact", "art"])
    ap.add_argument("--crop", default="")
    ap.add_argument("--xband", type=float, default=0.0)
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--band", type=float, default=0.14)
    ap.add_argument("--w", type=int, default=512)
    ap.add_argument("--h", type=int, default=640)
    a = ap.parse_args()
    if a.mode == "pano":
        pano(a.src, a.out)
    elif a.mode == "exact":
        exact(a.src, a.out, a.crop, a.size, a.xband)
    elif a.mode == "tile":
        tile(a.src, a.out, a.size, a.band)
    else:
        art(a.src, a.out, a.w, a.h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
