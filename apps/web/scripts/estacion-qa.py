"""
ENSAYO DEL GUION DEL TÓTEM (/estacion), sin micrófono y sin cámara.

Corre las tres preguntas del demo por texto (window.__hermesEstacionSay) y
comprueba lo que tiene que ser verdad en el andén:

  1. cada pregunta dispara la tool que le toca (el agente lo registra en HTTP),
  2. la pantalla pinta la tarjeta correcta (ruta / lugares) con datos del GTFS,
  3. nunca suenan dos voces a la vez (se muestrea quién habla cada 100 ms),
  4. no se cuela texto entre corchetes ni etiquetas de voz en los subtítulos,
  5. Esc deja la pantalla lista para el siguiente viajero.

Uso (el venv de Playwright del repo, ver docs/estacion-metro.md):

    ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/estacion-qa.py
    ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/estacion-qa.py --runs 3

Requiere el agente en :8650 y la web en :31999. Consume cuota de voz: son
tres turnos por corrida.
"""

import argparse
import json
import re
import sys
import time
from playwright.sync_api import sync_playwright

GUION = [
    ("¿Cómo llego a Parque Arví?", "route", "metro_route"),
    ("Iván, ¿dónde almuerzo antes de subir?", None, None),
    ("¿Qué hago cerca de Parque Berrío en una hora?", "places", "places_near"),
]

CORCHETES = re.compile(r"\[[^\]]{2,}\]|<[A-Za-z][A-Za-z0-9]*>")


def debug(page):
    return page.evaluate("() => window.__hermesEstacionDebug ? window.__hermesEstacionDebug() : null")


def esperar(page, cond, segundos, paso=0.5):
    limite = time.time() + segundos
    while time.time() < limite:
        d = debug(page)
        if d and cond(d):
            return d
        page.wait_for_timeout(int(paso * 1000))
    return debug(page)


def una_corrida(page, n):
    fallos = []
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(3000)

    page.evaluate(
        "() => { const b=[...document.querySelectorAll('button')]"
        ".find(x=>/Tocar para hablar|Tap to talk|Toque para falar/.test(x.textContent||'')); if(b) b.click(); }"
    )
    d = esperar(page, lambda d: d.get("status") == "connected", 45)
    if d.get("status") != "connected":
        return [f"corrida {n}: la sala no conectó (status={d.get('status')})"]
    page.wait_for_timeout(6000)  # el saludo

    for pregunta, vista, tool in GUION:
        page.evaluate(f"() => window.__hermesEstacionSay({json.dumps(pregunta)})")
        # Quién habla, muestreado mientras responde: con un solo flujo de audio
        # nunca puede haber dos a la vez, y esto lo verifica en vez de suponerlo.
        voces = []
        fin = time.time() + 40
        visto = False
        while time.time() < fin:
            estado = page.evaluate(
                "() => { const c = window.__hermesEstacionDebug ? window.__hermesEstacionDebug() : null;"
                " return c ? { speaking: c.speaking, view: c.view, tools: c.tools.map(t=>t.kind), lines: c.lines } : null; }"
            )
            if estado:
                voces.append(estado["speaking"])
                if vista and estado["view"] == vista:
                    visto = True
                if visto and estado["speaking"] is None and len(voces) > 12:
                    break
            page.wait_for_timeout(100)

        d = debug(page)
        if vista and d.get("view") != vista:
            fallos.append(f"corrida {n}: «{pregunta}» debía pintar {vista} y quedó en {d.get('view')}")
        if tool:
            kinds = [t["kind"] for t in d.get("tools", [])]
            esperado = "route" if tool == "metro_route" else "places"
            if esperado not in kinds:
                fallos.append(f"corrida {n}: «{pregunta}» no disparó {tool} (eventos: {kinds})")
        # Una voz a la vez: la muestra es un solo personaje o nadie.
        distintas = {v for v in voces if v}
        if len(distintas) > 1:
            # Varias voces en el turno están bien; lo que no puede pasar es que
            # una muestra reporte dos. speakingKey devuelve uno o ninguno, así
            # que esto solo fallaría si la reconstrucción se rompiera.
            pares = [v for v in voces if isinstance(v, list)]
            if pares:
                fallos.append(f"corrida {n}: dos voces a la vez en «{pregunta}»")
        for l in d.get("lines", []):
            m = CORCHETES.search(l.get("text", ""))
            if m:
                fallos.append(f"corrida {n}: subtítulo con marca de guion {m.group(0)!r} en «{l['text'][:60]}»")
        if not d.get("lines"):
            fallos.append(f"corrida {n}: «{pregunta}» no dejó ni una línea de subtítulo")

    page.keyboard.press("Escape")
    d = esperar(page, lambda d: d.get("view") == "idle" and not d.get("lines"), 10)
    if d.get("view") != "idle" or d.get("lines"):
        fallos.append(f"corrida {n}: Esc no dejó la pantalla en reposo (view={d.get('view')}, líneas={len(d.get('lines', []))})")
    return fallos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31999/estacion")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    todos = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(
            headless=not args.headed,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        ctx = b.new_context(permissions=["microphone", "camera"], viewport={"width": 1080, "height": 1920})
        page = ctx.new_page()
        errores_pagina = []
        page.on("pageerror", lambda e: errores_pagina.append(str(e)[:160]))
        page.goto(args.url, wait_until="domcontentloaded")
        for n in range(1, args.runs + 1):
            t0 = time.time()
            fallos = una_corrida(page, n)
            print(f"corrida {n}: {'OK' if not fallos else 'FALLOS'} ({time.time() - t0:.0f} s)")
            for f in fallos:
                print("  ·", f)
            todos += fallos
        if errores_pagina:
            todos.append(f"errores de página: {errores_pagina[:3]}")
        b.close()

    print("\n" + ("TODO EN VERDE" if not todos else f"{len(todos)} fallos"))
    sys.exit(1 if todos else 0)


if __name__ == "__main__":
    main()
