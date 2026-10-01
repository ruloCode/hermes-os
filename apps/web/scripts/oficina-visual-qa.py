"""QA visual de la Oficina v8 (/oficina): exterior, texturas, voces y charlas. Sin tokens ni créditos.

En los dos temas, con la coreografía sembrada (?seed=7) y la simulación de 6 agentes:
  1. Cero negro: a las 6:30, 12:00, 18:00 y 23:00 (__hermesOficinaHour), en la
     azotea (explorar) y en la vista aérea de los pisos 1 y 3, menos del 1 % de
     ZONAS casi negras (promedio de ~26 px con max(r,g,b) < 20) en el tercio de
     arriba y en el borde de la escena. Un poste de acero o una baranda negra
     no son un hueco; el cielo negro de antes sí. Se lee el FRAMEBUFFER (__hermesOficinaPixels), no la captura:
     el HUD no cuenta. Control negativo (tema oscuro): con la capa Exterior
     apagada la azotea SÍ tiene cielo negro; si no, la prueba no mide nada.
  2. Panorama y texturas HD cargados; la etiqueta del cielo sigue la hora.
  3. Voces: con el catálogo real de Chrome en macOS (inyectado: headless no
     trae voces), cada persona y cada NPC con rol tiene una voz distinta, y
     Recepción es Paulina. Sin catálogo, igual hay perfiles únicos.
  4. Charlas: al menos una en 90 s, con su globo en pantalla, y ningún número
     inventado (las frases con dato solo repiten la hora, el clima o los agentes).
  5. Reacción: bailar (F) junto a alguien hace que reaccione.
  6. Voz pregrabada: con el Sonido prendido por un clic real, una persona con
     voz premium dice su frase por el clip (y nadie habla encima).
  7. Gente viva apagada: no hay charlas ni globos; prendida, vuelven.
  8. Presupuesto: draw calls, triángulos y memoria de texturas dentro de lo
     documentado; fps >= 55; sin errores de consola.

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-visual-qa.py [--url http://localhost:31999] [--shots docs/img/oficina-v8]

Con --shots deja las capturas de "después" (JPEG) en esa carpeta. Nunca espera networkidle (hay SSE).
"""

import argparse
import json
import re
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

# Lo que Chrome expone en macOS (medido el 2026-10-01).
CHROME_MAC = [{"name": f"{n} (Spanish ({c}))", "lang": l} for n in ["Eddy", "Flo", "Grandma", "Grandpa", "Reed", "Rocko", "Sandy", "Shelley"] for c, l in (("Spain", "es-ES"), ("Mexico", "es-MX"))] + [
    {"name": "Mónica", "lang": "es-ES"},
    {"name": "Paulina", "lang": "es-MX"},
]

# Presupuesto (docs/oficina-de-agentes.md, "Calidad visual v8"): la línea base antes de la v8 + margen.
BUDGET = {"calls_floor1": 2400, "calls_aerial3": 6250, "triangles": 600_000, "texture_mb": 170}
HOURS = [6.5, 12, 18, 23]
DARK_MAX = 0.01

VIEWS = {
    "azotea": "() => window.__hermesOficinaWalkTo({kind:'game', id:'darts'})",
    "aerea1": "() => window.__hermesOficinaFloor(0)",
    "aerea2": "() => window.__hermesOficinaFloor(1)",
    "aerea3": "() => window.__hermesOficinaFloor(2)",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999")
    ap.add_argument("--shots", default="", help="carpeta para las capturas de 'después' (vacío = no se guardan)")
    args = ap.parse_args()
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.gettempdir()) / "oficina-visual-qa"
    tmp.mkdir(parents=True, exist_ok=True)
    fails: list[str] = []
    errors: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("✓ " if ok else "✕ ") + what)
        if not ok:
            fails.append(what)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
        for theme in ("dark", "light"):
            tag = "oscuro" if theme == "dark" else "claro"
            ctx = browser.new_context(viewport={"width": 1600, "height": 960})
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}')")
            page.goto(f"{args.url}/oficina?seed=7", wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaDebug === 'function' && document.querySelector('main canvas') !== null", timeout=60000)
            time.sleep(2)
            page.evaluate("() => window.__hermesOficinaSim('demo', 6)")
            page.mouse.move(800, 480)

            def dbg():
                return page.evaluate("() => window.__hermesOficinaDebug()")

            # ── 2. Lo cargado ───────────────────────────────────────────
            page.wait_for_function("() => { const d = window.__hermesOficinaDebug(); return d.exterior && d.exterior.panorama !== 'sin cargar' && d.hd && d.hd.state !== 'cargando' }", timeout=30000)
            time.sleep(1.5)
            d = dbg()
            check(d["exterior"]["on"] and d["exterior"]["panorama"] == "cargado", f"[{tag}] exterior prendido con el panorama cargado")
            check(d["hd"]["state"] == "cargado" and d["hd"]["applied"], f"[{tag}] texturas HD cargadas y aplicadas a la sala")
            counts = d["exterior"]["counts"] or {}
            check(counts.get("buildings", 0) > 10 and counts.get("trees", 0) > 10 and counts.get("lamps", 0) > 10, f"[{tag}] ciudad: {counts}")

            # ── 1. Cero negro a cualquier hora ──────────────────────────
            worst = {"top": 0.0, "border": 0.0}
            labels = {}
            for view, js in VIEWS.items():
                if view == "aerea2":
                    continue
                page.evaluate(js)
                time.sleep(2.5)
                for h in HOURS:
                    page.evaluate(f"() => window.__hermesOficinaHour({h})")
                    time.sleep(0.4)
                    st = page.evaluate("() => window.__hermesOficinaPixels()")
                    labels[h] = dbg()["exterior"]["label"]
                    worst["top"] = max(worst["top"], st["top"])
                    worst["border"] = max(worst["border"], st["border"])
                    if st["top"] >= DARK_MAX or st["border"] >= DARK_MAX:
                        print(f"   {view} {h}: {st}")
            check(worst["top"] < DARK_MAX, f"[{tag}] cielo sin negro en las 4 horas y 3 vistas (peor {worst['top']*100:.2f} %)")
            check(worst["border"] < DARK_MAX, f"[{tag}] borde de la escena sin negro (peor {worst['border']*100:.2f} %)")
            check(labels.get(12) == "día" and labels.get(23) == "noche" and labels.get(18) == "atardecer" and labels.get(6.5) == "amanecer", f"[{tag}] el cielo sigue la hora: {labels}")
            hud = page.locator("main").inner_text()
            check("hora forzada" in hud, f"[{tag}] el HUD avisa que la hora es forzada (no la disfraza de real)")

            # Control negativo: sin exterior, el tema oscuro vuelve a su fondo casi negro.
            if theme == "dark":
                page.evaluate(VIEWS["azotea"])
                page.evaluate("() => window.__hermesOficinaHour(12)")
                page.get_by_role("button", name="Capas").first.click()
                page.locator("[data-layer=exterior]").uncheck()
                time.sleep(1.2)
                off = page.evaluate("() => window.__hermesOficinaPixels()")
                check(not dbg()["exterior"]["on"] and off["top"] > 0.2, f"[{tag}] control negativo: con Exterior apagado el cielo vuelve a ser negro ({off['top']*100:.0f} %), la prueba sí mide")
                page.locator("[data-layer=exterior]").check()
                page.get_by_role("button", name="Capas").first.click()
                time.sleep(1)

            # ── 8. Presupuesto y fps ─────────────────────────────────────
            page.evaluate("() => window.__hermesOficinaHour(12)")
            render = {}
            fps = []
            for view in ("aerea1", "aerea3", "azotea"):
                page.evaluate(VIEWS[view])
                time.sleep(3)
                d = dbg()
                render[view] = d["render"]
                samples = [d["fps"]]
                for _ in range(2):
                    time.sleep(1.1)
                    samples.append(dbg()["fps"])
                fps.append(sorted(samples)[1])
            r1, r3 = render["aerea1"], render["aerea3"]
            check(r1["calls"] <= BUDGET["calls_floor1"], f"[{tag}] draw calls piso 1: {r1['calls']} <= {BUDGET['calls_floor1']}")
            check(r3["calls"] <= BUDGET["calls_aerial3"], f"[{tag}] draw calls aérea piso 3: {r3['calls']} <= {BUDGET['calls_aerial3']}")
            check(max(r["triangles"] for r in render.values()) <= BUDGET["triangles"], f"[{tag}] triángulos <= {BUDGET['triangles']:,} ({max(r['triangles'] for r in render.values()):,})")
            check(r1["textureMB"] <= BUDGET["texture_mb"], f"[{tag}] memoria de texturas {r1['textureMB']} MB <= {BUDGET['texture_mb']}")
            check(min(fps) >= 55, f"[{tag}] fps >= 55 ({fps})")

            # ── 3. Voces únicas ─────────────────────────────────────────
            page.evaluate("() => window.__hermesOficinaVoices(null)")
            time.sleep(1.3)
            bare = dbg()["voices"]["assigned"]
            check(len(bare) >= 10 and len({v["key"] for v in bare.values()}) == len(bare), f"[{tag}] sin voces del sistema (headless): {len(bare)} perfiles únicos")
            page.evaluate("(c) => window.__hermesOficinaVoices(c)", CHROME_MAC)
            time.sleep(1.3)
            d = dbg()
            assigned = d["voices"]["assigned"]
            npcs = [n["id"] for n in d["npcs"]]
            names = [v["voice"] for v in assigned.values()]
            check(len(assigned) == len(npcs) and len(set(names)) == len(names), f"[{tag}] con las 18 voces de macOS, {len(names)} personas y {len(set(names))} voces distintas")
            check(assigned.get("npc:reception", {}).get("voice") == "Paulina", f"[{tag}] Recepción habla con su voz fija (Paulina)")
            premium = {k: v["premium"] for k, v in assigned.items() if v["premium"]}
            check(len(premium) >= 3 and len(set(premium.values())) == len(premium), f"[{tag}] voces pregrabadas sin repetir: {premium}")

            # ── 4. Charlas ──────────────────────────────────────────────
            seen_bubble = False
            bad_numbers = []
            chat_floor = None
            t0 = time.time()
            while time.time() - t0 < 90:
                d = dbg()
                for c in d["chats"]:
                    if c["text"] and re.search(r"\d", c["text"]):
                        nums = re.findall(r"\d+", c["text"])
                        if not (re.search(r"Son las \d\d:\d\d|hacen \d+ grados|Hay \d+ agentes", c["text"])):
                            bad_numbers.append(c["text"])
                if d["chats"] and chat_floor is None:
                    m = next(n for n in d["npcs"] if n["id"] == d["chats"][0]["members"][0])
                    chat_floor = m["floor"]
                    page.evaluate(f"() => window.__hermesOficinaFloor({chat_floor})")
                if chat_floor is not None:
                    vis = page.evaluate("() => [...document.querySelectorAll('[data-talk-bubble]')].filter(e => e.style.opacity === '1').map(e => e.textContent)")
                    if vis:
                        seen_bubble = True
                        print(f"   globo: {vis[0]}")
                        if shots and theme == "dark":
                            page.screenshot(path=str(shots / "despues-charla-oscuro.jpg"), type="jpeg", quality=82)
                        break
                time.sleep(1)
            d = dbg()
            check(d["chatsStarted"] >= 1, f"[{tag}] al menos una charla entre personas en 90 s ({d['chatsStarted']})")
            check(seen_bubble, f"[{tag}] la charla se ve: su globo en pantalla")
            check(not bad_numbers, f"[{tag}] ningún número inventado en las charlas {bad_numbers[:2]}")

            # ── 5. Reacción al baile ───────────────────────────────────
            standing = [n for n in d["npcs"] if not n["role"] and n["state"] == "at" and n["activity"] not in ("sit", "tv", "pingpong", "foosball")]
            if standing:
                page.evaluate("(id) => window.__hermesOficinaWalkTo({kind:'person', id})", standing[0]["id"])
                time.sleep(0.8)
                before = dbg()["reactions"]
                page.keyboard.press("f")
                time.sleep(0.8)
                check(dbg()["reactions"] > before, f"[{tag}] bailar junto a alguien lo hace reaccionar")
            else:
                check(False, f"[{tag}] no encontré a nadie de pie para la prueba del baile")

            # ── 6. Voz pregrabada con un clic real ──────────────────────
            page.get_by_role("button", name="Sonido").first.click()
            time.sleep(1.2)
            who = next(iter(premium), None)
            # Las charlas siguen sonando alrededor: se busca la entrada de ESA persona en el log, no la última.
            ok = False
            for _ in range(20):
                ok = page.evaluate("(id) => window.__hermesOficinaSay(id, 'hola')", who) if who else False
                if ok:
                    break
                time.sleep(0.3)  # alguien más estaba hablando: una sola voz a la vez
            log = dbg()["voices"]["log"]
            mine = [l for l in log if l["id"] == who and l["text"] == "¡Hola! ¿Cómo vas?"]
            check(bool(ok) and mine and mine[-1]["via"] == "clip", f"[{tag}] la frase fija suena con la voz pregrabada de esa persona ({mine[-1] if mine else None})")
            again = page.evaluate("(id) => window.__hermesOficinaSay(id, 'chao')", "npc:reception")
            rec = [l for l in dbg()["voices"]["log"] if l["id"] == "npc:reception"]
            check(not again and rec and rec[-1]["why"] == "ya habla alguien", f"[{tag}] una sola voz a la vez: mientras suena el clip, Recepción no habla encima ({rec[-1] if rec else None})")
            time.sleep(2.5)
            page.get_by_role("button", name="Sonido").first.click()
            time.sleep(0.5)
            check(not dbg()["voices"]["allowed"], f"[{tag}] sin sonido, la gente no habla")

            # ── 7. Gente viva apagada ───────────────────────────────────
            page.get_by_role("button", name="Capas").first.click()
            page.locator("[data-layer=lively]").uncheck()
            time.sleep(1)
            n0 = dbg()["chatsStarted"]
            time.sleep(12)
            d = dbg()
            check(not d["lively"] and not d["chats"] and d["chatsStarted"] == n0, f"[{tag}] con Gente viva apagada no hay charlas")
            page.locator("[data-layer=lively]").check()
            page.get_by_role("button", name="Capas").first.click()
            time.sleep(0.5)
            check(dbg()["lively"], f"[{tag}] prendida de nuevo")

            # ── Capturas de "después" ──────────────────────────────────
            if shots:
                for view in ("aerea1", "aerea2", "aerea3", "azotea"):
                    page.evaluate(VIEWS[view])
                    time.sleep(2.5)
                    for h, name in ((12, "dia"), (18, "atardecer"), (23, "noche")):
                        if view == "aerea2" and h != 12:
                            continue
                        page.evaluate(f"() => window.__hermesOficinaHour({h})")
                        time.sleep(0.8)
                        page.screenshot(path=str(shots / f"despues-{view}-{name}-{tag}.jpg"), type="jpeg", quality=82)
            page.evaluate("() => window.__hermesOficinaHour(null)")
            ctx.close()
        browser.close()

    real_errors = [e for e in errors if "favicon" not in e]
    check(not real_errors, f"sin errores de consola ({len(real_errors)}) {real_errors[:3]}")
    print(json.dumps({"fails": fails}, ensure_ascii=False))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
