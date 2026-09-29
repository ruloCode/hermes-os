"""QA de la Oficina de agentes (/oficina) sin gastar tokens.

Recorre la oficina como un usuario, en los dos temas:
  1. EXPLORAR (por defecto): camina con W, corre con Shift, salta con Espacio.
  2. Con la oficina de demostración (window.__hermesOficinaSim("demo")), el
     dueño va junto a un agente, "E" abre su panel y Esc lo cierra.
  3. "V" cambia a VISTA AÉREA: clic real en un personaje abre su panel.
  4. En vivo: clic en un escritorio libre (aérea) y "E" frente a uno libre
     (explorar) abren "Contratar" — sin enviar nada.
Captura cada paso en --out. Falla si algo no aparece o hay errores de consola.

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-qa.py [--url http://localhost:31999] [--out <carpeta>]

Las capturas van por defecto a una carpeta temporal (no ensucian docs/img).

Nunca espera networkidle: la página tiene SSE abiertos.
"""

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999")
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "oficina-qa"))
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    fails: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("✓ " if ok else "✕ ") + what)
        if not ok:
            fails.append(what)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed, args=["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"])

        for theme in ("dark", "light"):
            tag = "oscuro" if theme == "dark" else "claro"
            page = browser.new_page(viewport={"width": 1600, "height": 960})
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}')")
            page.goto(f"{args.url}/oficina", wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaSim === 'function'", timeout=30000)
            page.wait_for_function("() => document.querySelector('main canvas') !== null", timeout=30000)
            time.sleep(2.5)

            def dbg():
                return page.evaluate("() => window.__hermesOficinaDebug()")

            d0 = dbg()
            check(d0["mode"] == "explore", f"[{theme}] arranca en explorar")
            page.mouse.move(800, 480)

            # 1. Caminar, correr, saltar.
            page.keyboard.down("w")
            time.sleep(1.0)
            page.keyboard.up("w")
            d1 = dbg()
            walked = d0["player"]["z"] - d1["player"]["z"]
            check(walked > 2, f"[{theme}] W camina hacia adelante ({walked:.1f} m)")
            page.keyboard.down("Shift")
            page.keyboard.down("a")
            time.sleep(0.8)
            page.keyboard.up("a")
            page.keyboard.up("Shift")
            d2 = dbg()
            ran = abs(d2["player"]["x"] - d1["player"]["x"])
            check(ran > 3.5, f"[{theme}] Shift+A corre de lado ({ran:.1f} m)")
            page.keyboard.down(" ")
            time.sleep(0.2)
            jump = dbg()["player"]["y"]
            page.keyboard.up(" ")
            check(jump > 0.3, f"[{theme}] Espacio salta ({jump:.2f} m)")
            time.sleep(1)
            page.screenshot(path=str(out / f"oficina-explorar-{tag}.png"))

            # 2. Demo: acercarse a un agente y abrir su panel con E.
            page.evaluate("() => window.__hermesOficinaSim('demo')")
            time.sleep(2.5)
            d = dbg()
            check(len(d["workers"]) == 8 and len(set(d["seats"].values())) == 8, f"[{theme}] simulación: 8 agentes, 8 escritorios")
            wid = d["workers"][0]["id"]
            page.evaluate("(id) => window.__hermesOficinaWalkTo({ kind: 'worker', id })", wid)
            time.sleep(1.2)
            near = dbg()["near"]
            check(near is not None and near.get("id") == wid, f"[{theme}] al lado del agente, E lo alcanza ({near})")
            page.screenshot(path=str(out / f"oficina-cerca-{tag}.png"))
            page.keyboard.press("e")
            time.sleep(0.6)
            check(page.locator("aside").count() == 1, f"[{theme}] E abre el panel del agente")
            page.screenshot(path=str(out / f"oficina-panel-{tag}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.4)
            check(dbg()["selected"] is None, f"[{theme}] Esc cierra el panel")

            # 3. Vista aérea con V y clic real.
            page.keyboard.press("v")
            time.sleep(1.5)
            d = dbg()
            check(d["mode"] == "aerial", f"[{theme}] V cambia a vista aérea")
            check(d["fps"] >= 20, f"[{theme}] fps = {d['fps']}")
            page.screenshot(path=str(out / f"oficina-aerea-{tag}.png"))
            page.evaluate("(id) => window.__hermesOficinaFocus({ kind: 'worker', id })", wid)
            time.sleep(1.8)
            xy = page.evaluate("(id) => window.__hermesOficinaScreenOf({ kind: 'worker', id })", wid)
            if xy:
                page.mouse.click(xy["x"], xy["y"] - 40)
                time.sleep(0.6)
                check(page.locator("aside").count() == 1, f"[{theme}] clic en el agente abre su panel")
                page.keyboard.press("Escape")
                time.sleep(0.3)
            else:
                check(False, f"[{theme}] el agente está en cuadro")

            # 4. En vivo: contratar (clic en aérea, E en explorar), sin enviar.
            page.evaluate("() => window.__hermesOficinaSim(null)")
            time.sleep(1.5)
            free = page.evaluate(
                """() => {
                  const d = window.__hermesOficinaDebug();
                  const taken = new Set(Object.values(d.seats));
                  return d.freeDesks.find((x) => !taken.has(x)) ?? null;
                }"""
            )
            check(free is not None, f"[{theme}] hay un escritorio libre ({free})")
            if free:
                page.evaluate("(id) => window.__hermesOficinaFocus({ kind: 'desk', id })", free)
                time.sleep(1.8)
                xy = page.evaluate("(id) => window.__hermesOficinaScreenOf({ kind: 'desk', id })", free)
                if xy:
                    page.mouse.click(xy["x"], xy["y"])
                    time.sleep(0.6)
                check(page.get_by_text("Contratar un agente").count() == 1, f"[{theme}] clic en escritorio libre → contratar")
                page.keyboard.press("Escape")
                time.sleep(0.4)
                page.keyboard.press("v")
                time.sleep(0.6)
                page.evaluate("(id) => window.__hermesOficinaWalkTo({ kind: 'desk', id })", free)
                time.sleep(1.2)
                page.keyboard.press("e")
                time.sleep(0.6)
                check(page.get_by_text("Contratar un agente").count() == 1, f"[{theme}] E frente a escritorio libre → contratar")
                page.screenshot(path=str(out / f"oficina-contratar-{tag}.png"))
                # Escribir en el diálogo no mueve al personaje.
                before = dbg()["player"]
                page.keyboard.type("wasd")
                time.sleep(0.3)
                after = dbg()["player"]
                check(abs(before["x"] - after["x"]) + abs(before["z"] - after["z"]) < 0.01, f"[{theme}] escribir no mueve al personaje")
                page.keyboard.press("Escape")
                time.sleep(0.3)
            page.close()

        browser.close()

    real_errors = [e for e in errors if "favicon" not in e and "Download the React DevTools" not in e]
    check(not real_errors, f"sin errores de consola ({len(real_errors)})")
    for e in real_errors[:10]:
        print("   ·", e[:240])
    print(json.dumps({"fails": fails}, ensure_ascii=False))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
