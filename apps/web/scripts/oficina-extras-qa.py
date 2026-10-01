"""QA de los extras de la Oficina (/oficina), en los dos temas y sin gastar
tokens (la simulación y los seams hacen todo):

  1. Uso de Claude y gasto: el tablero y el panel dicen lo mismo que GET
     /office/plan-usage y GET /office/spend del agente (se piden aparte, aquí).
  2. Pantallas: el monitor de un agente de la simulación muestra SUS líneas; la
     sala de control tiene una pantalla por agente, abre el panel del que se
     elige y el panel se pone a pantalla completa y vuelve.
  3. Minijuegos: cada uno entra (E en su puesto o el seam), suma puntaje con
     entradas sintéticas (el QA juega: sigue la pelota, alinea las varillas,
     atrapa tokens) y sale limpio con Esc (cámara y control de vuelta al dueño).
  4. Oficina de CEO: la placa dice el nombre del dueño; E en la silla = modo
     CEO; ← → recorre agentes, Enter abre, Esc levanta.
  5. Sonido: arranca apagado (sin AudioContext) y prende con un clic real.
  6. Capas: apagar "Pantallas y uso" quita sala de control y monitores; prender las devuelve.
  7. fps ≥ 55 y sin errores de consola.

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-extras-qa.py [--url http://localhost:31999] [--agent http://localhost:8650] [--out <carpeta>]
"""

import argparse
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]


def env_value(key: str) -> str:
    try:
        for line in (ROOT / ".env").read_text().splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return ""


def agent_get(base: str, path: str):
    req = urllib.request.Request(f"{base}{path}")
    key = env_value("HERMES_API_KEY")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())


def usd(n):
    if n is None:
        return "—"
    if 0 < n < 0.01:
        return "<$0.01"
    return f"${n:.2f}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999")
    ap.add_argument("--agent", default="http://localhost:8650")
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "oficina-extras-qa"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    fails: list[str] = []
    owner = env_value("NEXT_PUBLIC_HERMES_OWNER_NAME")

    def check(ok: bool, what: str) -> None:
        print(("✓ " if ok else "✕ ") + what)
        if not ok:
            fails.append(what)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist", "--autoplay-policy=user-gesture-required"])
        for theme in ("dark", "light"):
            ctx = browser.new_context(viewport={"width": 1600, "height": 960})
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}'); localStorage.removeItem('hermes-oficina-capas')")
            page.goto(f"{args.url}/oficina?seed=7", wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaGame === 'object'", timeout=90000)
            page.wait_for_function("() => { const d = window.__hermesOficinaDebug(); return d.spendData !== 'loading' && d.planUsage !== 'loading'; }", timeout=60000)
            time.sleep(2)
            page.mouse.move(800, 480)

            def dbg():
                return page.evaluate("() => window.__hermesOficinaDebug()")

            def walk(hit):
                page.evaluate("(h) => window.__hermesOficinaWalkTo(h)", hit)
                time.sleep(1.0)

            # 5. Sonido: apagado al cargar.
            a = page.evaluate("() => window.__hermesOficinaAudio()")
            check(not a["on"] and a["context"] == "sin crear", f"[{theme}] el sonido arranca apagado y sin AudioContext")

            # 1. Uso de Claude y gasto contra el agente.
            spend = agent_get(args.agent, "/office/spend")
            plan = agent_get(args.agent, "/office/plan-usage")
            d = dbg()
            check(d["spendData"]["costUsd"] == spend["today"]["costUsd"] and d["spendData"]["runs"] == spend["today"]["runs"], f"[{theme}] el tablero tiene el gasto de hoy del agente ({usd(spend['today']['costUsd'])}, {spend['today']['runs']} ejecuciones)")
            if plan.get("available"):
                mine = {w["label"]: w["utilization"] for w in d["planUsage"]["windows"]}
                theirs = {w["label"]: w["utilization"] for w in plan["windows"]}
                check(set(mine) == set(theirs) and all(abs(mine[k] - theirs[k]) <= 2 for k in theirs), f"[{theme}] el uso del plan coincide con /office/plan-usage ({theirs})")
                check(page.locator("[data-plan-pill]").count() == 1, f"[{theme}] la píldora de uso está en el HUD")
            else:
                check(d["planUsage"] is not None and not d["planUsage"]["available"], f"[{theme}] sin límites de plan el tablero lo dice ({plan.get('error')})")
            walk({"kind": "spend", "id": "wall"})
            check(dbg()["near"] == {"kind": "spend", "id": "wall"}, f"[{theme}] frente al tablero de uso, E lo alcanza")
            page.screenshot(path=str(out / f"uso-pared-{theme}.png"))
            page.keyboard.press("e")
            time.sleep(0.8)
            panel = page.locator("[role=dialog][aria-label='Uso de Claude']")
            check(panel.count() == 1, f"[{theme}] E abre el panel de uso")
            text = panel.first.inner_text() if panel.count() else ""
            check(usd(spend["today"]["costUsd"]) in text, f"[{theme}] el panel dice el gasto real de hoy")
            if plan.get("available"):
                check(all(f"{round(w['utilization'])}% usado" in text for w in plan["windows"]), f"[{theme}] el panel trae cada barra del plan con su %")
                check("Se restablece" in text, f"[{theme}] cada barra dice cuándo se restablece")
            page.screenshot(path=str(out / f"uso-panel-{theme}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.4)
            check(panel.count() == 0, f"[{theme}] Esc cierra el panel de uso")

            # 2. Pantallas (simulación de 8 agentes).
            page.evaluate("() => window.__hermesOficinaSim('demo', 8)")
            time.sleep(1.5)
            d = dbg()
            w0 = next(w for w in d["workers"] if w["id"] == "sim-0")
            check(d["monitors"].get("sim-0", {}).get("lines") == w0["lines"], f"[{theme}] el monitor de sim-0 muestra sus líneas reales")
            check(len(d["monitors"]) == len(d["workers"]), f"[{theme}] un monitor por escritorio ocupado ({len(d['monitors'])})")
            check(d["controlWall"]["tiles"] == [w["id"] for w in d["workers"]][:12], f"[{theme}] la sala de control tiene una pantalla por agente")
            walk({"kind": "control", "id": "wall"})
            page.screenshot(path=str(out / f"sala-control-{theme}.png"))
            page.keyboard.press("e")
            time.sleep(0.8)
            room = page.locator("[role=dialog][aria-label='Sala de control']")
            check(room.count() == 1 and page.locator("[data-control-tile]").count() == len(d["workers"]), f"[{theme}] E abre la sala de control con todas las terminales")
            page.locator("[data-control-tile='sim-1']").click()
            time.sleep(0.8)
            check(dbg()["selected"] == {"kind": "worker", "id": "sim-1"}, f"[{theme}] clic en una pantalla abre el panel de ese agente")
            page.get_by_role("button", name="Pantalla completa").click()
            time.sleep(0.4)
            check(page.locator("aside[data-expanded='true']").count() == 1, f"[{theme}] el panel se pone a pantalla completa")
            page.screenshot(path=str(out / f"terminal-completa-{theme}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.3)
            check(page.locator("aside[data-expanded='true']").count() == 0 and dbg()["selected"] is not None, f"[{theme}] Esc sale de pantalla completa sin cerrar el panel")
            page.keyboard.press("Escape")
            time.sleep(0.4)

            # 3. Minijuegos.
            def gstate():
                return page.evaluate("() => window.__hermesOficinaGame.state()")

            def play(gid: str, seconds: float, step):
                t0 = time.time()
                while time.time() - t0 < seconds:
                    st = gstate()
                    if st and st["score"] > 0:
                        return st
                    step(st)
                    time.sleep(0.03)
                return gstate()

            walk({"kind": "game", "id": "darts"})
            check(dbg()["near"] == {"kind": "game", "id": "darts"}, f"[{theme}] en la azotea, E alcanza los dardos")
            page.keyboard.press("e")
            time.sleep(1.2)
            st = gstate()
            check(st is not None and st["id"] == "darts", f"[{theme}] E entra a los dardos")
            for _ in range(3):
                page.evaluate("() => window.__hermesOficinaGame.input({ pressed: true })")
                time.sleep(0.7)
            st = gstate()
            check(st["score"] > 0, f"[{theme}] dardos: suma puntaje ({st['score']}, {st['status']})")
            page.screenshot(path=str(out / f"dardos-{theme}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.6)
            d = dbg()
            check(d["game"] is None and d["mode"] == "explore" and page.locator("[data-game]").count() == 0, f"[{theme}] Esc sale de los dardos limpio")

            page.evaluate("() => window.__hermesOficinaGame.start('basket')")
            time.sleep(1.2)
            for _ in range(5):
                page.evaluate("() => window.__hermesOficinaGame.input({ action: true })")
                time.sleep(0.37)
                page.evaluate("() => window.__hermesOficinaGame.input(null)")
                time.sleep(1.6)
                if gstate()["score"] > 0:
                    break
            st = gstate()
            check(st["score"] > 0, f"[{theme}] canasta: encesta con ángulo y fuerza sintéticos ({st['status']})")
            page.screenshot(path=str(out / f"canasta-{theme}.png"))

            page.evaluate("() => window.__hermesOficinaGame.start('pingpong')")
            time.sleep(1.0)

            def pong_step(st):
                i = st["inner"]
                # Pegarle con el borde: la pelota sale cruzada y el rival (más lento) no llega.
                target = i["ball"]["z"] + (0.11 if i["ball"]["z"] < 0 else -0.11)
                x = max(-1, min(1, (target - i["you"]) * 12))
                page.evaluate("(x) => window.__hermesOficinaGame.input({ x })", x)

            st = play("pingpong", 60, pong_step)
            check(st["score"] > 0, f"[{theme}] ping-pong: le gana un punto a la CPU ({st['status']})")
            page.screenshot(path=str(out / f"pingpong-{theme}.png"))

            page.evaluate("() => window.__hermesOficinaGame.start('foosball')")
            time.sleep(1.0)
            def foos_step(st):
                # Tus varillas (las de la mesa): alinear el muñeco que mejor alcanza la pelota y patear cuando llega.
                i = st["inner"]
                b = i["ball"]
                rods = [(r["x"], r["men"]) for r in i["rods"]]
                behind = [r for r in rods if r[0] <= b["x"] + 0.05] or rods
                rod = min(behind, key=lambda r: abs(r[0] - b["x"]))
                man = min(rod[1], key=lambda m: abs(b["z"] - (m + i["you"])))
                want = b["z"] - man
                y = max(-1, min(1, -(want - i["you"]) * 12))
                near = abs(b["x"] - rod[0]) < 0.07 and abs(b["z"] - (man + i["you"])) < 0.05
                page.evaluate("([y, k]) => window.__hermesOficinaGame.input({ y, pressed: k })", [y, near])

            st = play("foosball", 60, foos_step)
            check(st["score"] > 0, f"[{theme}] futbolín: mete un gol con las varillas sintéticas ({st['status']})")
            page.screenshot(path=str(out / f"futbolin-{theme}.png"))

            page.evaluate("() => window.__hermesOficinaGame.start('arcade')")
            time.sleep(1.0)

            def arcade_step(st):
                i = st["inner"]
                tokens = [it for it in i["items"] if not it["bug"] and it["y"] < 0.93]
                tx = max(tokens, key=lambda it: it["y"])["x"] if tokens else 0.5
                page.evaluate("(x) => window.__hermesOficinaGame.input({ x })", max(-1, min(1, (tx - i["cursor"]) * 10)))

            st = play("arcade", 40, arcade_step)
            check(st["score"] > 0, f"[{theme}] arcade: atrapa tokens ({st['status']})")
            page.screenshot(path=str(out / f"arcade-{theme}.png"))
            page.evaluate("() => window.__hermesOficinaGame.input(null)")
            page.keyboard.press("Escape")
            time.sleep(0.6)
            d = dbg()
            check(d["game"] is None and d["player"]["grounded"], f"[{theme}] Esc sale de la arcade y el dueño vuelve a caminar")
            best = page.evaluate("() => localStorage.getItem('hermes-oficina-record-arcade')")
            check(best is not None and int(best) > 0, f"[{theme}] la arcade guardó su récord real ({best})")

            # 4. Oficina de CEO.
            d = dbg()
            check(d["ceo"] is not None and d["ceo"]["nameplate"] == (owner or "Oficina privada"), f"[{theme}] la placa de la puerta dice «{d['ceo']['nameplate'] if d['ceo'] else None}»")
            walk({"kind": "ceo", "id": "chair"})
            check(dbg()["near"] == {"kind": "ceo", "id": "chair"}, f"[{theme}] junto a la silla, E es «modo CEO»")
            page.keyboard.press("e")
            time.sleep(2.0)
            check(dbg()["ceo"]["on"] and page.locator("[data-ceo-bar]").count() == 1, f"[{theme}] sentado: modo CEO")
            page.keyboard.press("ArrowRight")
            time.sleep(1.2)
            pick = dbg()["ceo"]["pick"]
            check(pick is not None, f"[{theme}] → elige un agente sin caminar ({pick})")
            page.screenshot(path=str(out / f"ceo-{theme}.png"))
            page.keyboard.press("Enter")
            time.sleep(0.8)
            check(dbg()["selected"] == {"kind": "worker", "id": pick}, f"[{theme}] Enter abre su panel")
            page.keyboard.press("Escape")
            time.sleep(0.4)
            check(dbg()["ceo"]["on"], f"[{theme}] la primera Esc cierra el panel y sigue sentado")
            page.keyboard.press("Escape")
            time.sleep(0.8)
            check(not dbg()["ceo"]["on"] and page.locator("[data-ceo-bar]").count() == 0, f"[{theme}] la segunda Esc lo levanta")

            # 6. Capas: pantallas fuera y de vuelta.
            page.get_by_role("button", name="Capas").click()
            time.sleep(0.3)
            page.locator("[data-layer='data']").uncheck()
            time.sleep(1.5)
            d = dbg()
            check(d["controlWall"] is None and d["monitors"] == {} and page.locator("[data-plan-pill]").count() == 0, f"[{theme}] sin «Pantallas y uso» no hay sala de control, monitores ni píldora")
            page.locator("[data-layer='data']").check()
            time.sleep(1.5)
            d = dbg()
            check(d["controlWall"] is not None and len(d["monitors"]) == len(d["workers"]), f"[{theme}] al prenderla vuelven")
            check(d["pois"]["dropped"] == [], f"[{theme}] todos los lugares de la gente siguen alcanzables ({len(d['pois']['kept'])})")
            page.keyboard.press("Escape")

            # 5. Sonido con un clic real.
            page.get_by_role("button", name="🔇 Sonido").click()
            time.sleep(1.0)
            a = page.evaluate("() => window.__hermesOficinaAudio()")
            check(a["on"] and a["context"] == "running", f"[{theme}] un clic en «Sonido» lo prende ({a['context']})")
            page.get_by_role("button", name="🔈 Sonido").click()

            # 7. fps.
            page.evaluate("() => window.__hermesOficinaMode('aerial')")
            time.sleep(2.5)
            fps = dbg()["fps"]
            check(fps >= 55, f"[{theme}] fps con todo ≥ 55 ({fps})")
            ctx.close()
        browser.close()

    check(not errors, f"sin errores de consola ({len(errors)})")
    for e in errors[:5]:
        print("   ", e[:200])
    print(json.dumps({"fails": fails}, ensure_ascii=False))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
