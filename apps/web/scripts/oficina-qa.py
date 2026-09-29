"""QA de la Oficina de agentes (/oficina) sin gastar tokens.

Abre la página, inyecta la oficina de demostración (window.__hermesOficinaSim),
captura los dos temas, hace clic en un personaje (panel), Esc (cierra) y en un
escritorio libre (diálogo de contratar, sin enviar). Falla si hay errores de
consola o si algo no aparece.

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-qa.py [--url http://localhost:31999] [--out docs/img]

Nunca espera networkidle: la página tiene un SSE abierto.
"""

import argparse
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999")
    ap.add_argument("--out", default="docs/img")
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
        page = browser.new_page(viewport={"width": 1600, "height": 960})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        for theme in ("dark", "light"):
            page.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}')")
            page.goto(f"{args.url}/oficina", wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaSim === 'function'", timeout=30000)
            page.wait_for_function("() => document.querySelector('main canvas') !== null", timeout=30000)
            time.sleep(2.5)
            live = page.evaluate("() => window.__hermesOficinaDebug()")
            check(live["pods"] >= 1, f"[{theme}] planta con {live['pods']} pods y {live['desks']} escritorios (en vivo: {len(live['workers'])} sesiones)")
            page.evaluate("() => window.__hermesOficinaSim('demo')")
            time.sleep(3)
            dbg = page.evaluate("() => window.__hermesOficinaDebug()")
            check(dbg["simulated"] and len(dbg["workers"]) == 8, f"[{theme}] simulación con 8 personajes")
            check(len(dbg["seats"]) == 8, f"[{theme}] los 8 tienen escritorio")
            check(len(set(dbg["seats"].values())) == 8, f"[{theme}] ninguno comparte escritorio")
            check(dbg["fps"] >= 20, f"[{theme}] fps = {dbg['fps']}")
            shot = out / f"oficina-{'oscuro' if theme == 'dark' else 'claro'}.png"
            page.screenshot(path=str(shot))
            print(f"  captura → {shot}")

        # Clic REAL en un personaje (posición en pantalla por el seam del mundo).
        wid = page.evaluate("() => window.__hermesOficinaDebug().workers[0]?.id ?? null")
        check(wid is not None, "hay un personaje para seleccionar")
        page.evaluate("(id) => window.__hermesOficinaFocus({ kind: 'worker', id })", wid)
        time.sleep(1.8)
        xy = page.evaluate("(id) => window.__hermesOficinaScreenOf({ kind: 'worker', id })", wid)
        check(xy is not None, "el personaje está en cuadro")
        if xy:
            page.mouse.click(xy["x"], xy["y"] - 40)
            time.sleep(0.6)
            sel = page.evaluate("() => window.__hermesOficinaDebug().selected")
            check(sel is not None and sel.get("kind") == "worker", f"clic → seleccionado {sel}")
            check(page.locator("aside").count() == 1, "se abre el panel del personaje")
            page.screenshot(path=str(out / "oficina-panel.png"))
            page.keyboard.press("Escape")
            time.sleep(0.4)
            check(page.evaluate("() => window.__hermesOficinaDebug().selected") is None, "Esc cierra el panel")

        # En vivo: clic en un escritorio libre abre "Contratar" (sin enviar nada).
        page.evaluate("() => window.__hermesOficinaSim(null)")
        time.sleep(1.5)
        free = page.evaluate(
            """() => {
              const d = window.__hermesOficinaDebug();
              const taken = new Set(Object.values(d.seats));
              for (let i = 0; i < d.freeDesks.length; i++) if (!taken.has(d.freeDesks[i])) return d.freeDesks[i];
              return null;
            }"""
        )
        if free:
            page.evaluate("(id) => window.__hermesOficinaFocus({ kind: 'desk', id })", free)
            time.sleep(1.8)
        xy = page.evaluate("(id) => window.__hermesOficinaScreenOf({ kind: 'desk', id })", free) if free else None
        check(xy is not None, f"escritorio libre en cuadro ({free})")
        if xy:
            page.mouse.click(xy["x"], xy["y"])
            time.sleep(0.6)
            check(page.get_by_text("Contratar un agente").count() == 1, "clic en escritorio libre → diálogo de contratar")
            page.screenshot(path=str(out / "oficina-contratar.png"))
            page.keyboard.press("Escape")
            time.sleep(0.4)
            check(page.get_by_text("Contratar un agente").count() == 0, "Esc cierra el diálogo")

        browser.close()

    real_errors = [e for e in errors if "favicon" not in e and "Download the React DevTools" not in e]
    check(not real_errors, f"sin errores de consola ({len(real_errors)})")
    for e in real_errors[:10]:
        print("   ·", e[:240])
    print(json.dumps({"fails": fails}, ensure_ascii=False))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
