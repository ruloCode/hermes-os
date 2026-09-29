"""QA del control de juego en la Oficina (/oficina), sin control físico.

Playwright no puede conectar un Xbox real, así que se inyecta uno simulado en
navigator.getGamepads() con el MISMO id y mapeo que entrega Chrome para el
Xbox Wireless Controller (045e:02fd, mapping "standard"). Todo lo demás es la
ruta real: Gamepad API → gamepad.ts → mundo → conversación → vibración.

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-pad-qa.py [--url http://localhost:31999] [--out <carpeta>]

No envía nada que gaste tokens: el dictado se prueba con __hermesOficinaDictate
y se cancela antes de enviar.
"""

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

FAKE_PAD = """
(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = {
    id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)",
    index: 0, mapping: "standard", connected: true, timestamp: 0,
    axes: [0, 0, 0, 0], buttons,
    vibrationActuator: { type: "dual-rumble", playEffect: () => { window.__rumbles = (window.__rumbles || 0) + 1; return Promise.resolve("complete"); } },
  };
  window.__fakePad = pad;
  navigator.getGamepads = () => [pad, null, null, null];
})();
"""

BTN = {"A": 0, "B": 1, "X": 2, "Y": 3, "LB": 4, "RB": 5, "LT": 6, "RT": 7, "VIEW": 8, "MENU": 9, "UP": 12, "DOWN": 13}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999")
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "oficina-qa"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    fails: list[str] = []
    errors: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("✓ " if ok else "✕ ") + what)
        if not ok:
            fails.append(what)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
        )
        ctx = browser.new_context(viewport={"width": 1600, "height": 960}, permissions=["microphone"])
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script("localStorage.setItem('hermes-theme','dark')")
        page.add_init_script(FAKE_PAD)
        page.goto(f"{args.url}/oficina", wait_until="domcontentloaded")
        page.wait_for_function("() => typeof window.__hermesOficinaDebug === 'function'", timeout=30000)
        time.sleep(2.5)

        def dbg():
            return page.evaluate("() => window.__hermesOficinaDebug()")

        def axes(lx=0.0, ly=0.0, rx=0.0, ry=0.0):
            page.evaluate("(a) => { window.__fakePad.axes = a; }", [lx, ly, rx, ry])

        def trigger(name: str, value: float):
            page.evaluate("([i, v]) => { const b = window.__fakePad.buttons[i]; b.value = v; b.pressed = v > 0.5; }", [BTN[name], value])

        def press(name: str, hold=0.12):
            trigger(name, 1)
            time.sleep(hold)
            trigger(name, 0)
            time.sleep(0.25)

        check(page.get_by_text("Xbox Wireless Controller").count() >= 1, "el HUD muestra el control conectado")

        # Caminar con el stick, correr con RT, saltar con X.
        d0 = dbg()
        axes(ly=-1)
        time.sleep(1.0)
        axes()
        d1 = dbg()
        walked = d0["player"]["z"] - d1["player"]["z"]
        check(walked > 2.5, f"stick izquierdo arriba camina hacia adelante ({walked:.1f} m)")
        check(d1["usingPad"], "el HUD pasa a mostrar los botones del control")
        axes(ly=0.5)
        time.sleep(0.8)
        axes()
        half = abs(dbg()["player"]["z"] - d1["player"]["z"])
        check(0.8 < half < walked * 0.8, f"el stick a medias camina más lento ({half:.1f} m)")
        d2 = dbg()
        trigger("RT", 1)
        axes(lx=-1)
        time.sleep(0.8)
        axes()
        trigger("RT", 0)
        ran = abs(dbg()["player"]["x"] - d2["player"]["x"])
        check(ran > 4.2, f"RT + stick corre ({ran:.1f} m en 0,8 s)")
        trigger("X", 1)
        time.sleep(0.2)
        jump = dbg()["player"]["y"]
        trigger("X", 0)
        check(jump > 0.3, f"X salta ({jump:.2f} m)")
        time.sleep(0.8)

        # Stick derecho gira la cámara; LT la recentra.
        y0 = dbg()["camYaw"]
        axes(rx=1)
        time.sleep(0.5)
        axes()
        y1 = dbg()["camYaw"]
        check(abs(y1 - y0) > 0.6, f"stick derecho gira la cámara ({y1 - y0:+.2f} rad)")
        press("LT")
        time.sleep(0.3)

        # Ayuda con Menu.
        press("MENU")
        check(page.get_by_text("Esta ayuda").count() == 1, "Menu abre la ayuda de controles")
        page.screenshot(path=str(out / "oficina-pad-ayuda.png"))
        press("B")
        check(page.get_by_text("Esta ayuda").count() == 0, "B cierra la ayuda")

        # Demo: RB lleva junto al siguiente agente; A abre la conversación escuchando.
        page.evaluate("() => window.__hermesOficinaSim('demo')")
        time.sleep(2.5)
        press("RB")
        time.sleep(1.0)
        near = dbg()["near"]
        check(near is not None and near.get("kind") == "worker", f"RB lleva junto a un agente ({near})")
        rumbles = page.evaluate("() => window.__rumbles || 0")
        press("A")
        time.sleep(1.2)
        d = dbg()
        check(page.locator("aside").count() == 1, "A abre la conversación con el agente")
        check(d["voice"]["state"] in ("listening", "transcribing"), f"el micrófono ya está escuchando ({d['voice']})")
        check(page.evaluate("() => window.__rumbles || 0") > rumbles, "el control vibra al interactuar")
        page.screenshot(path=str(out / "oficina-pad-escuchando.png"))
        page.evaluate("() => window.__hermesOficinaDictate('Ahora corre los tests y arregla lo que falle')")
        time.sleep(0.4)
        check(dbg()["voice"]["state"] == "ready", "lo dictado queda listo para enviar")
        check(page.get_by_text("Simulación: aquí no se envía nada.").count() == 1, "en simulación no se envía")
        page.screenshot(path=str(out / "oficina-pad-listo.png"))
        press("B")
        check(dbg()["voice"]["state"] in ("ready", "idle"), "B con texto listo: primero cierra")
        time.sleep(0.3)
        check(page.locator("aside").count() == 0, "B cierra la conversación")

        # LB/RB con el panel abierto cambia de agente.
        press("A")
        time.sleep(0.6)
        first = dbg()["selected"]
        press("RB")
        time.sleep(0.8)
        second = dbg()["selected"]
        check(first and second and first["id"] != second["id"], f"RB con el panel abierto pasa al siguiente agente ({first} → {second})")
        press("B")
        press("B")

        # View alterna la vista; el stick derecho orbita en aérea.
        press("VIEW")
        time.sleep(1.2)
        check(dbg()["mode"] == "aerial", "View cambia a vista aérea")
        c0 = dbg()["camera"]
        axes(rx=1)
        time.sleep(0.6)
        axes()
        c1 = dbg()["camera"]
        check(abs(c1["x"] - c0["x"]) + abs(c1["z"] - c0["z"]) > 1, "en aérea el stick derecho orbita")
        page.screenshot(path=str(out / "oficina-pad-aerea.png"))
        press("VIEW")
        time.sleep(0.8)
        check(dbg()["mode"] == "explore", "View vuelve a explorar")

        # En vivo: A frente a un escritorio libre abre Contratar escuchando; se cancela sin enviar.
        page.evaluate("() => window.__hermesOficinaSim(null)")
        time.sleep(1.5)
        free = page.evaluate("() => { const d = window.__hermesOficinaDebug(); const t = new Set(Object.values(d.seats)); return d.freeDesks.find((x) => !t.has(x)) ?? null; }")
        page.evaluate("(id) => window.__hermesOficinaWalkTo({ kind: 'desk', id })", free)
        time.sleep(1.0)
        press("A")
        time.sleep(1.0)
        check(page.get_by_text("Contratar un agente").count() == 1, "A frente a un escritorio libre abre Contratar")
        check(dbg()["voice"]["state"] in ("listening", "transcribing"), "Contratar abre escuchando")
        page.evaluate("() => window.__hermesOficinaDictate('Lee el README y resume la arquitectura')")
        time.sleep(0.3)
        check(page.locator("button:has-text('Contratar'):not([disabled])").count() >= 1, "con lo dictado, Contratar se habilita")
        page.screenshot(path=str(out / "oficina-pad-contratar.png"))
        press("B")
        time.sleep(0.3)
        check(page.get_by_text("Contratar un agente").count() == 0, "B cancela sin contratar")
        browser.close()

    real = [e for e in errors if "favicon" not in e and "DevTools" not in e]
    check(not real, f"sin errores de consola ({len(real)})")
    for e in real[:8]:
        print("   ·", e[:220])
    print(json.dumps({"fails": fails}, ensure_ascii=False))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
