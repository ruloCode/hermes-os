"""QA de /ruloview con Playwright (datos reales: no simula nada del WiFi).

Uso:  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/ruloview-qa.py [--url http://localhost:31999]

Comprueba: sin errores de página, servidor arriba y en vivo, los 3 enlaces con
lecturas, el canvas 3D pinta (no está en blanco), calibrar/editar responden al
teclado, la cámara maestra abre (cámara falsa de Chromium) y ambos temas.
Capturas en /tmp/ruloview-qa-*.png. No toca room.json (no hace clic en el piso).
"""
import argparse
import json
import sys
import time

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:31999")
args = ap.parse_args()

fails: list[str] = []
oks: list[str] = []


def check(cond: bool, msg: str):
    (oks if cond else fails).append(msg)
    print(("  ok  " if cond else "  FALLA ") + msg, flush=True)


def debug(page):
    return page.evaluate("() => window.__hermesRuloviewDebug && window.__hermesRuloviewDebug()")


def canvas_stats(page):
    # Lee el framebuffer por screenshot (WebGL sin preserveDrawingBuffer).
    import io
    from PIL import Image

    png = page.locator("canvas").first.screenshot()
    im = Image.open(io.BytesIO(png)).convert("RGB").resize((96, 54))
    px = list(im.getdata())
    distinct = len(set((r // 16, g // 16, b // 16) for r, g, b in px))
    return distinct


with sync_playwright() as p:
    browser = p.chromium.launch(
        args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-unsafe-swiftshader"]
    )
    for theme in ("dark", "light"):
        print(f"\n== tema {theme} ==", flush=True)
        ctx = browser.new_context(viewport={"width": 1600, "height": 900}, permissions=["camera"])
        ctx.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}')")
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(f"{args.url}/ruloview", wait_until="domcontentloaded")
        page.wait_for_selector("canvas", timeout=60000)

        # datos vivos: hasta 15 s
        d = None
        for _ in range(60):
            d = debug(page)
            if d and d["snap"]["live"] and d["status"] and d["status"]["serverUp"]:
                break
            time.sleep(0.25)
        snap = d["snap"] if d else {}
        check(bool(d and d["status"] and d["status"]["serverUp"]), "servidor RuView arriba según /ruloview/status")
        check(bool(snap.get("live")), "llegan lecturas en vivo por /ruloview/events")
        check(snap.get("link") in ("ws", "poll"), f"enlace agente→servidor: {snap.get('link')}")
        for nid in ("1", "2", "3"):
            n = snap.get("nodes", {}).get(nid, {})
            check(not n.get("stale", True) and n.get("fps", 0) > 5, f"nodo {nid}: {round(n.get('fps', 0))} lecturas/s · {n.get('rssi')} dBm")
        check(d and d["room"] and d["room"]["fromFile"], "cuarto leído de room.json")
        if d and d["room"]["room"].get("scan"):
            for _ in range(80):
                d = debug(page)
                if d["scan"]["loaded"]:
                    break
                time.sleep(0.25)
            sz = d["room"]["room"]["size"]
            check(d["scan"]["loaded"], f"escaneo del cuarto cargado ({sz['w']:.2f} × {sz['d']:.2f} m)")
        state = page.get_by_test_id("room-state").inner_text()
        check(state not in ("Servidor apagado", "Esperando datos de los nodos"), f"estado mostrado: «{state}»")
        status_txt = page.get_by_test_id("server-status").inner_text()
        check("en vivo" in status_txt, f"pastilla de estado: «{status_txt.strip()}»")

        time.sleep(1.5)
        distinct = canvas_stats(page)
        check(distinct > 25, f"el canvas 3D pinta ({distinct} tonos distintos)")
        page.screenshot(path=f"/tmp/ruloview-qa-{theme}.png")

        if theme == "dark":
            # calibrar (C) arranca una cuenta; X la deja como estaba no hace falta: se limpia al final
            had_ref = snap.get("ref")
            page.keyboard.press("c")
            time.sleep(0.6)
            check(debug(page)["snap"]["calibrating"] is not None, "C inicia la calibración")
            # editar (E + 2) sin hacer clic en el piso: no escribe room.json
            page.keyboard.press("e")
            page.keyboard.press("2")
            time.sleep(0.3)
            dd = debug(page)
            check(dd["editMode"] and dd["editing"] == "2", "E + 2 selecciona el nodo 2 para mover")
            page.keyboard.press("Escape")
            time.sleep(0.2)
            check(not debug(page)["editMode"], "Esc sale de la edición")
            # cámara maestra con la cámara falsa de Chromium
            page.keyboard.press("v")
            phase = None
            for _ in range(80):
                phase = debug(page)["camera"]
                if phase in ("tracking", "error"):
                    break
                time.sleep(0.25)
            check(phase == "tracking", f"la cámara maestra abre (fase: {phase})")
            page.screenshot(path="/tmp/ruloview-qa-camara.png")
            page.keyboard.press("v")
            # no dejar una calibración a medias con el QA: se borra la referencia que haya creado
            if not had_ref:
                page.evaluate("() => localStorage.removeItem('ruloview-ref-v1')")

        real_errors = [e for e in errors if "favicon" not in e and "Download the React DevTools" not in e]
        check(not real_errors, "sin errores de página/consola" + ("" if not real_errors else f": {real_errors[:3]}"))
        ctx.close()

    # El Observatorio del fork con el mismo cuarto (token del docker/.env del clon)
    import os, re
    env_path = os.path.expanduser(os.environ.get("RUVIEW_PATH", "~/dev/side/RuView")) + "/docker/.env"
    token = re.search(r"^RUVIEW_API_TOKEN=(.+)$", open(env_path).read(), re.M).group(1).strip() if os.path.exists(env_path) else ""
    print("\n== observatorio ==", flush=True)
    ctx = browser.new_context(viewport={"width": 1600, "height": 900})
    ctx.add_init_script(f"localStorage.setItem('ruview-api-token', {json.dumps(token)})")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    resp = page.request.get("http://127.0.0.1:3000/ui/vendor/three/build/three.module.js")
    check(resp.status == 200, f"three.js servido por el contenedor ({resp.status})")
    page.goto("http://127.0.0.1:3000/ui/rulostark/observatory.html", wait_until="domcontentloaded")
    obs = None
    for _ in range(80):
        obs = page.evaluate("() => window.__obsRoom && window.__obsRoom()")
        if obs and obs["mode"] == "cuarto" and (obs["scan"] or obs["error"]):
            break
        time.sleep(0.25)
    check(bool(obs) and obs["mode"] == "cuarto", f"observatorio en modo cuarto ({obs and obs['size']})")
    check(bool(obs) and obs["scan"], "observatorio con el escaneo" + (f": {obs['error']}" if obs and obs.get("error") else ""))
    time.sleep(3)
    page.screenshot(path="/tmp/ruloview-qa-observatorio.png")
    check(not errors, "observatorio sin errores de página" + (f": {errors[:2]}" if errors else ""))
    ctx.close()
    browser.close()

print(f"\n{len(oks)} ok · {len(fails)} fallas")
sys.exit(1 if fails else 0)
