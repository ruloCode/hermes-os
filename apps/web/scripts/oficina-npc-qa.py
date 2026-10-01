"""QA de la gente del edificio en la Oficina (/oficina), sin gastar tokens.

Con la coreografía sembrada (?seed=7), en los dos temas:
  1. Con "Ambiente" prendido (default) hay gente en al menos dos pisos, más
     Recepción, Barista, Respiro y Coordinación; nadie de ambiente se mete en un pod.
  2. Recepción: "E" a su lado abre su diálogo y los conteos coinciden con la
     simulación (__hermesOficinaSim("demo")); sus listas nombran a los agentes
     reales de cada estado.
  3. Barista y Respiro: diálogos con datos (sin "undefined"/"NaN"); la pausa de
     5 minutos arranca un temporizador real y se puede terminar.
  4. Prioridad de "E": junto a un agente, gana el agente.
  5. Interruptor apagado: no queda nadie, "E" no alcanza a nadie, se recuerda al
     recargar; prendido de nuevo, vuelven.
  6. fps ≥ 55 con la gente.
Y una vez (tema oscuro): alguien cruza de piso por la escalera en ≤ 150 s, y
mientras va a media altura está sobre una escalera (nunca en el hueco).

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-npc-qa.py [--url http://localhost:31999] [--out <carpeta>]

Capturas en una carpeta temporal. Nunca espera networkidle (SSE abiertos).
"""

import argparse
import json
import re
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright

STATUS_WORDS = {
    "needs_you": ("te necesita", "te necesitan"),
    "working": ("trabajando", "trabajando"),
    "starting": ("arrancando", "arrancando"),
    "thinking": ("pensando", "pensando"),
    "blocked": ("bloqueado", "bloqueados"),
    "done": ("listo", "listos"),
    "error": ("con error", "con error"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999")
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "oficina-npc-qa"))
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
        browser = p.chromium.launch(args=["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"])
        for theme in ("dark", "light"):
            tag = "oscuro" if theme == "dark" else "claro"
            ctx = browser.new_context(viewport={"width": 1600, "height": 960})
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}')")
            page.goto(f"{args.url}/oficina?seed=7", wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaDebug === 'function'", timeout=30000)
            page.wait_for_function("() => document.querySelector('main canvas') !== null", timeout=30000)
            time.sleep(3)
            page.mouse.move(800, 480)

            def dbg():
                return page.evaluate("() => window.__hermesOficinaDebug()")

            def dialog_text() -> str:
                d = page.locator("[role=dialog]")
                return d.first.inner_text() if d.count() else ""

            # 1. Gente en varios pisos.
            d = dbg()
            check(d.get("ambient") is True, f"[{theme}] el ambiente arranca prendido")
            ambient = [n for n in d["npcs"] if not n["role"]]
            staff = {n["role"] for n in d["npcs"] if n["role"]}
            check(staff == {"reception", "barista", "rooftop", "queue"}, f"[{theme}] Recepción, Barista, Respiro y Coordinación en su lugar ({sorted(staff)})")
            check(6 <= len(ambient) <= 9, f"[{theme}] 6 a 9 personas de ambiente ({len(ambient)})")
            floors = Counter(n["floor"] for n in ambient)
            check(len(floors) >= 2, f"[{theme}] gente en al menos dos pisos ({dict(floors)})")
            check(not d["pois"]["dropped"], f"[{theme}] todos los lugares tienen piso firme (descartados: {d['pois']['dropped']})")
            page.screenshot(path=str(out / f"npc-entrada-{tag}.png"))

            # 2. Recepción con la simulación.
            page.evaluate("() => window.__hermesOficinaSim('demo')")
            time.sleep(2)
            d = dbg()
            workers = d["workers"]
            desks = d["deskXZ"]
            in_pod = [
                n["id"]
                for n in d["npcs"]
                if not n["role"] and n["floor"] == 0 and any(abs(n["x"] - x) < 1.4 and abs(n["z"] - z) < 1.6 for x, z in desks)
            ]
            check(not in_pod, f"[{theme}] nadie de ambiente dentro de un pod ({in_pod})")
            page.evaluate("() => window.__hermesOficinaWalkTo({ kind: 'npc', id: 'reception' })")
            time.sleep(1.2)
            near = dbg()["near"]
            check(near == {"kind": "npc", "id": "reception"}, f"[{theme}] frente a Recepción, E la alcanza ({near})")
            check(page.get_by_text("Hablar con Recepción").count() >= 1, f"[{theme}] el aviso dice «Hablar con Recepción»")
            page.keyboard.press("e")
            time.sleep(0.7)
            text = dialog_text()
            check(text.startswith("R") and "Recepción" in text, f"[{theme}] E abre el diálogo de Recepción")
            counts = Counter(w["status"] for w in workers)
            m = re.search(r"Hay (\d+) sesiones vivas: ([^\n]+)\.", text)
            check(m is not None and int(m.group(1)) == len(workers), f"[{theme}] dice cuántas sesiones hay ({m.group(1) if m else '—'} de {len(workers)})")
            if m:
                said = m.group(2)
                ok = all(
                    (f"{n} {STATUS_WORDS[k][0 if n == 1 else 1]}" in said) for k, n in counts.items()
                )
                check(ok, f"[{theme}] los conteos coinciden con la simulación ({said})")
            check("(Simulación)" in text and "simulación" in text, f"[{theme}] dice que es la simulación")
            asking = [w["name"] for w in workers if w["status"] == "needs_you"]
            check(all(n in text for n in asking), f"[{theme}] nombra a quien te necesita ({asking})")
            page.screenshot(path=str(out / f"npc-recepcion-{tag}.png"))
            page.keyboard.press("2")
            time.sleep(0.4)
            text = dialog_text()
            busy = [w["name"] for w in workers if w["status"] in ("working", "thinking", "starting", "blocked")]
            check(all(n in text for n in busy[:6]), f"[{theme}] «¿Quién está trabajando?» lista a los que trabajan")
            page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
            time.sleep(0.4)
            done = [w["name"] for w in workers if w["status"] in ("done", "error")]
            check(all(n in dialog_text() for n in done), f"[{theme}] ↓ + Enter pregunta qué terminó ({done})")
            page.keyboard.press("Escape")
            time.sleep(0.4)
            check(page.locator("[role=dialog]").count() == 0 and dbg()["npcDialog"] is None, f"[{theme}] Esc cierra el diálogo")

            # 3. Barista y Respiro.
            page.evaluate("() => window.__hermesOficinaWalkTo({ kind: 'npc', id: 'barista' })")
            time.sleep(1.2)
            check(dbg()["near"] == {"kind": "npc", "id": "barista"}, f"[{theme}] la Barista se alcanza desde las banquetas")
            page.keyboard.press("e")
            time.sleep(0.8)
            text = dialog_text()
            now = time.localtime()
            hhmm = [time.strftime("%H:%M", now), time.strftime("%H:%M", time.localtime(time.time() - 60))]
            check("Barista" in text and any(f"Son las {h}" in text for h in hhmm), f"[{theme}] la Barista dice la hora real")
            check("undefined" not in text and "NaN" not in text, f"[{theme}] sin datos rotos en la Barista")
            page.screenshot(path=str(out / f"npc-barista-{tag}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.3)
            page.evaluate("() => window.__hermesOficinaWalkTo({ kind: 'npc', id: 'rooftop' })")
            time.sleep(1.2)
            check(dbg()["near"] == {"kind": "npc", "id": "rooftop"}, f"[{theme}] Respiro se alcanza en la azotea")
            page.keyboard.press("e")
            time.sleep(0.6)
            page.keyboard.press("1")
            time.sleep(1.2)
            timer = page.locator("[role=timer]")
            check(timer.count() == 1 and re.search(r"4:5\d|5:00", timer.first.inner_text()) is not None, f"[{theme}] la pausa arranca un temporizador de 5 minutos")
            page.screenshot(path=str(out / f"npc-respiro-{tag}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.3)
            timer.get_by_role("button", name="terminar").click()
            time.sleep(0.3)
            check(page.locator("[role=timer]").count() == 0, f"[{theme}] «terminar» corta la pausa")

            # 4. Junto a un agente gana el agente.
            wid = workers[0]["id"]
            page.evaluate("(id) => window.__hermesOficinaWalkTo({ kind: 'worker', id })", wid)
            time.sleep(1.0)
            check(dbg()["near"] == {"kind": "worker", "id": wid}, f"[{theme}] junto a un agente, E es del agente")

            # 6. fps con la gente, en explorar y en aérea.
            time.sleep(1.5)
            fps_explore = dbg()["fps"]
            page.keyboard.press("v")
            time.sleep(2.5)
            fps_aerial = dbg()["fps"]
            check(fps_explore >= 55 and fps_aerial >= 55, f"[{theme}] fps con la gente ≥ 55 (explorar {fps_explore}, aérea {fps_aerial})")
            page.screenshot(path=str(out / f"npc-aerea-{tag}.png"))
            page.keyboard.press("v")
            time.sleep(0.5)

            # 5. Interruptor apagado (parado frente a Recepción): nadie, "E" ya no alcanza nada, y se recuerda.
            page.evaluate("() => window.__hermesOficinaWalkTo({ kind: 'npc', id: 'reception' })")
            time.sleep(0.8)
            page.get_by_role("button", name="Ambiente").click()
            time.sleep(0.8)
            d = dbg()
            check(d["ambient"] is False and d["npcs"] == [], f"[{theme}] con el interruptor apagado no queda nadie ({len(d['npcs'])})")
            check(d["near"] is None, f"[{theme}] apagado, E no alcanza a ningún NPC ({d['near']})")
            page.screenshot(path=str(out / f"npc-apagado-{tag}.png"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaDebug === 'function'", timeout=30000)
            time.sleep(2.5)
            d = dbg()
            check(d["ambient"] is False and d["npcs"] == [], f"[{theme}] apagado se recuerda al recargar")
            page.get_by_role("button", name="Ambiente").click()
            time.sleep(1.0)
            check(len(dbg()["npcs"]) >= 8, f"[{theme}] prendido de nuevo, vuelven")

            # Una vez: la escalera, de verdad.
            if theme == "dark":
                page.evaluate("() => window.__hermesOficinaSim(null)")
                time.sleep(1)
                d = dbg()
                stair_x_max = d["stairs"][0]["x"] + 2.8  # las dos escaleras van contra el muro oeste
                start = d["floorChanges"]
                mid_ok = True
                crossed_on_stairs = False
                t0 = time.time()
                while time.time() - t0 < 150:
                    d = dbg()
                    for n in d["npcs"]:
                        if n["role"] or n["state"] != "walking":
                            continue
                        between = 0.3 < n["y"] < 3.3 or 3.9 < n["y"] < 6.9
                        if between:
                            crossed_on_stairs = True
                            if n["x"] > stair_x_max:
                                mid_ok = False
                    if d["floorChanges"] > start and crossed_on_stairs:
                        break
                    time.sleep(0.4)
                took = time.time() - t0
                check(d["floorChanges"] > start and crossed_on_stairs, f"alguien cruza de piso por la escalera ({took:.0f} s)")
                check(mid_ok, "a media altura, siempre sobre una escalera (nunca en el hueco)")
            page.close()
            ctx.close()
        browser.close()

    real_errors = [e for e in errors if "favicon" not in e and "Download the React DevTools" not in e]
    check(not real_errors, f"sin errores de consola ({len(real_errors)})")
    for e in real_errors[:10]:
        print("   ·", e[:240])
    print(json.dumps({"fails": fails}, ensure_ascii=False))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
