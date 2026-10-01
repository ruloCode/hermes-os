"""QA de las funciones de pared y de la cola en la Oficina (/oficina), sin
gastar tokens ni tocar datos reales:

  1. Tableros de pared (Issues de Linear, PRs de GitHub, Servicios): "E" frente
     a cada uno abre su panel, y lo que dice coincide con GET /office/boards.
  2. "→ Cola" en un issue existe y, en simulación, está deshabilitado.
  3. TV del café: "E" la alcanza; un stream de prueba entra por la misma ruta
     que getDisplayMedia y "dejar de compartir" la apaga.
  4. Pizarra libre: "E" abre el editor, se dibuja y se cierra SIN guardar
     (la pizarra real no se toca).
  5. Cola: "E" en su tablero abre el panel; Coordinación (con Ambiente) también;
     en simulación no se puede proponer ni encolar.
  6. Apodos: cada agente de la simulación tiene uno distinto y el aviso lo usa.
  7. La gata existe con Ambiente y desaparece sin él. fps ≥ 55, sin errores.

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-features-qa.py [--url http://localhost:31999] [--out <carpeta>]
"""

import argparse
import json
import re
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999")
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "oficina-features-qa"))
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
            page.on("dialog", lambda d: d.accept())
            page.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}')")
            page.goto(f"{args.url}/oficina?seed=7", wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaDebug === 'function'", timeout=60000)
            page.wait_for_function("() => window.__hermesOficinaDebug().boards !== null", timeout=30000)
            time.sleep(2.5)
            page.mouse.move(800, 480)

            def dbg():
                return page.evaluate("() => window.__hermesOficinaDebug()")

            def walk(kind: str, id: str):
                page.evaluate("([k, i]) => window.__hermesOficinaWalkTo({ kind: k, id: i })", [kind, id])
                time.sleep(1.1)

            def dialog(name: str):
                return page.locator(f"[role=dialog][aria-label='{name}']")

            # 1. Tableros de pared.
            counts = dbg()["boards"]
            for bid, title in (("issues", "Issues"), ("prs", "Pull requests"), ("services", "Servicios")):
                walk("board", bid)
                check(dbg()["near"] == {"kind": "board", "id": bid}, f"[{theme}] frente al tablero {title}, E lo alcanza")
                page.keyboard.press("e")
                time.sleep(0.6)
                d = dialog(title)
                check(d.count() == 1, f"[{theme}] E abre el panel {title}")
                text = d.first.inner_text() if d.count() else ""
                if bid == "issues" and counts["issues"]:
                    shown = sum(int(n) for n in re.findall(r"(?:Por hacer|En curso|Hecho)\s*\n?\s*(\d+)", text))
                    check(shown == counts["issues"], f"[{theme}] el panel de Issues cuenta lo mismo que el agente ({shown} de {counts['issues']})")
                if bid == "prs" and counts["prs"] == 0:
                    check("No hay PRs abiertos" in text, f"[{theme}] sin PRs lo dice tal cual")
                if bid == "services":
                    ports = re.findall(r":(\d{2,5})", text)
                    check(len(ports) == counts["services"], f"[{theme}] el panel de Servicios lista {len(ports)} de {counts['services']}")
                page.screenshot(path=str(out / f"tablero-{bid}-{tag}.png"))
                page.keyboard.press("Escape")
                time.sleep(0.3)
                check(dialog(title).count() == 0, f"[{theme}] Esc cierra {title}")

            # 2. "→ Cola" en simulación está deshabilitado.
            page.evaluate("() => window.__hermesOficinaSim('demo')")
            time.sleep(2)
            if counts["issues"]:
                walk("board", "issues")
                page.keyboard.press("e")
                time.sleep(0.6)
                btn = dialog("Issues").get_by_role("button", name="→ Cola")
                check(btn.count() >= 1 and btn.first.is_disabled(), f"[{theme}] «→ Cola» existe y en simulación no encola")
                page.keyboard.press("Escape")
                time.sleep(0.3)

            # 6. Apodos.
            ws = dbg()["workers"]
            nicks = [w.get("nick") for w in ws]
            check(all(nicks) and len(set(nicks)) == len(nicks), f"[{theme}] cada agente tiene un apodo distinto ({nicks[:4]}…)")
            walk("worker", ws[0]["id"])
            check(page.get_by_text(f"Hablar con {ws[0]['nick']}").count() >= 1, f"[{theme}] el aviso usa el apodo («Hablar con {ws[0]['nick']}»)")
            page.screenshot(path=str(out / f"apodos-{tag}.png"))

            # 3. TV del café.
            walk("tv", "lounge")
            check(dbg()["near"] == {"kind": "tv", "id": "lounge"}, f"[{theme}] frente a la TV del café, E la alcanza")
            page.evaluate("() => window.__hermesOficinaShareTest()")
            time.sleep(2)
            check(dbg()["sharing"] is True, f"[{theme}] la TV muestra lo compartido")
            page.screenshot(path=str(out / f"tv-{tag}.png"))
            page.get_by_role("button", name="dejar de compartir").click()
            time.sleep(0.5)
            check(dbg()["sharing"] is False, f"[{theme}] «dejar de compartir» apaga la TV")

            # 4. Pizarra libre (sin guardar).
            before = dbg()["whiteboard"]["hasImage"]
            walk("whiteboard", "free")
            check(dbg()["near"] == {"kind": "whiteboard", "id": "free"}, f"[{theme}] frente a la pizarra, E la alcanza")
            page.keyboard.press("e")
            time.sleep(0.6)
            canvas = dialog("Pizarra libre").locator("canvas")
            check(canvas.count() == 1, f"[{theme}] E abre el editor de la pizarra")
            box = canvas.bounding_box()
            if box:
                page.mouse.move(box["x"] + 80, box["y"] + 80)
                page.mouse.down()
                for i in range(20):
                    page.mouse.move(box["x"] + 80 + i * 20, box["y"] + 80 + (i % 5) * 15)
                page.mouse.up()
            check(page.get_by_text("sin guardar").count() >= 1, f"[{theme}] dibujar marca la pizarra como sin guardar")
            page.screenshot(path=str(out / f"pizarra-{tag}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.5)
            check(dialog("Pizarra libre").count() == 0 and dbg()["whiteboard"]["hasImage"] == before, f"[{theme}] cerrar sin guardar no toca la pizarra real")

            # 5. Cola.
            walk("queue", "main")
            check(dbg()["near"] in ({"kind": "queue", "id": "main"}, {"kind": "npc", "id": "queue"}), f"[{theme}] frente a la cola, E la alcanza ({dbg()['near']})")
            page.keyboard.press("e")
            time.sleep(0.6)
            q = dialog("Cola de agentes")
            check(q.count() == 1, f"[{theme}] E abre la cola de agentes")
            if q.count():
                q.first.locator("textarea").fill("prueba")
                check(q.first.get_by_role("button", name="Proponer tareas").is_disabled(), f"[{theme}] en simulación no se le pide trabajo al coordinador")
            page.screenshot(path=str(out / f"cola-{tag}.png"))
            page.keyboard.press("Escape")
            time.sleep(0.3)
            page.evaluate("() => window.__hermesOficinaWalkTo({ kind: 'npc', id: 'queue' })")
            time.sleep(1.1)
            if dbg()["near"] == {"kind": "npc", "id": "queue"}:
                page.keyboard.press("e")
                time.sleep(0.6)
                check(dialog("Cola de agentes").count() == 1, f"[{theme}] hablar con Coordinación abre la cola")
                page.keyboard.press("Escape")
                time.sleep(0.3)
            else:
                check(dbg()["near"] in ({"kind": "queue", "id": "main"}, {"kind": "npc", "id": "queue"}), f"[{theme}] Coordinación está junto a la cola")

            # 7. La gata y fps.
            check(dbg()["cat"] is not None, f"[{theme}] la gata pasea con Ambiente")
            time.sleep(1.5)
            fps = dbg()["fps"]
            check(fps >= 55, f"[{theme}] fps con todo ≥ 55 ({fps})")
            page.get_by_role("button", name="Ambiente").click()
            time.sleep(0.6)
            check(dbg()["cat"] is None, f"[{theme}] sin Ambiente no hay gata")
            page.get_by_role("button", name="Ambiente").click()
            time.sleep(0.4)
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
