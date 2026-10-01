"""QA de la Oficina "por dentro" (modo tarima, traza del loop, tools, system
prompt, vista pública y vitrina), en los dos temas y SIN gastar tokens: repite
la traza real grabada que viene con la página (public/oficina/traza-demo.jsonl,
el caso 1 de la demo) con el mismo reductor y la misma UI.

  1. La traza llega completa y en orden (los seq de la fixture, uno por fila).
  2. Los errores se marcan y la corrección apunta al paso correcto: el `npm test`
     que falla (paso 2) lo corrige el del paso 8; el `Edit` sin leer (paso 4),
     el `Edit` del paso 6. Clic en "→ corregido" salta a esa fila.
  3. Vista pública: se siembran secretos FALSOS solo en memoria (una llave, un
     JWT, un Bearer, un correo, un teléfono, un cliente y un .env leído) y
     ninguno aparece en el DOM; con la vista pública apagada sí aparecen
     (control: la prueba mide).
  4. El system prompt coincide byte a byte con el capturado (vista pública
     apagada) y con su versión redactada (prendida); lo personal queda con su
     título y "oculto en vista pública".
  5. El inventario coincide con la configuración real de session.ts (la del
     agente si responde; si no, la que viene en la fixture) y con los pasos.
  6. Modo tarima a 1920×1080 (P, pestañas 1-2-3, ↑↓/Enter, cruceta del control,
     View sale), la vitrina entra sola por inactividad y sale con una tecla,
     fps ≥ 55 y sin errores de consola.

  ~/.cache/hermes-pw-venv/bin/python apps/web/scripts/oficina-traza-qa.py [--url http://localhost:31998] [--agent http://localhost:8651] [--shots docs/img/oficina-tarima]
"""

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "apps/web/public/oficina/traza-demo.jsonl"

FAKE_PAD = """
(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = { id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)", index: 0, mapping: "standard", connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons,
    vibrationActuator: { type: "dual-rumble", playEffect: () => Promise.resolve("complete") } };
  window.__fakePad = pad;
  navigator.getGamepads = () => [pad, null, null, null];
})();
"""
BTN = {"A": 0, "B": 1, "X": 2, "Y": 3, "LB": 4, "RB": 5, "VIEW": 8, "MENU": 9, "UP": 12, "DOWN": 13, "LEFT": 14, "RIGHT": 15}

# Secretos FALSOS, sembrados solo en la copia en memoria de la fixture (la del repo no se toca).
FAKE = {
    "llave": "sk-proj-QAFAKE00000000000000000000",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJxYSI6ImZha2UifQ.QAfakeSignature123",
    "bearer": "QAFAKETOKEN1234567890abcdef",
    "correo": "qa.falso@example.com",
    "teléfono": "300 123 4567",
    "cliente": "",  # se llena con un término oculto real del agente (GET /office/public-view)
    "env": "NOMBRE_QA=solo-en-el-env",
}


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
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def seeded_fixture(text: str) -> str:
    """La fixture + eventos de QA al final (seq nuevos), marcados en su texto como sembrados por el QA."""
    lines = [json.loads(l) for l in text.splitlines() if l.strip()]
    events = [l["event"] for l in lines if l["type"] == "event"]
    last = max(e["seq"] for e in events)
    t0 = max(e["t"] for e in events)
    turn = max(e["turn"] for e in events)
    extra = [
        {"seq": last + 1, "t": t0 + 100, "turn": turn, "kind": "tool_use", "tool": "Read", "id": "qa-env", "input": json.dumps({"file_path": "/tmp/qa/.env"})},
        {"seq": last + 2, "t": t0 + 200, "turn": turn, "kind": "tool_result", "tool": "Read", "id": "qa-env", "output": f"{FAKE['env']}\nOTRA_COSA=valor-normal"},
        {"seq": last + 3, "t": t0 + 300, "turn": turn, "kind": "tool_use", "tool": "Bash", "id": "qa-sec", "input": json.dumps({"command": f"curl -H 'Authorization: Bearer {FAKE['bearer']}' https://api.example.com"})},
        {
            "seq": last + 4,
            "t": t0 + 400,
            "turn": turn,
            "kind": "tool_result",
            "tool": "Bash",
            "id": "qa-sec",
            "output": f"[sembrado por el QA] OPENAI_API_KEY={FAKE['llave']}\nSUPABASE={FAKE['jwt']}\nescríbeme a {FAKE['correo']} o al +57 {FAKE['teléfono']}\nel repo de {FAKE['cliente']} está en ~/dev/{FAKE['cliente']}",
        },
    ]
    meta = next(l for l in lines if l["type"] == "meta")
    meta["meta"] = {**meta["meta"], "id": "qa-sembrada"}
    head = [l for l in lines if l["type"] != "event"]
    return "\n".join(json.dumps(l, ensure_ascii=False) for l in head + [{"type": "event", "event": e} for e in events + extra]) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:31998")
    ap.add_argument("--agent", default="http://localhost:8651")
    ap.add_argument("--shots", default="")
    args = ap.parse_args()
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    fails: list[str] = []
    errors: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("✓ " if ok else "✕ ") + what)
        if not ok:
            fails.append(what)

    fixture_text = FIXTURE.read_text()
    fx = [json.loads(l) for l in fixture_text.splitlines() if l.strip()]
    fx_events = sorted((l["event"] for l in fx if l["type"] == "event"), key=lambda e: e["seq"])
    fx_prompt = next(l["prompt"] for l in fx if l["type"] == "prompt")
    fx_config = next((l["config"] for l in fx if l["type"] == "config"), {})
    fx_init = next(e["init"] for e in fx_events if e["kind"] == "init")
    try:
        live_cfg = agent_get(args.agent, "/office/trace/985a9d4f").get("config", {}).get("sdk")
    except Exception:
        live_cfg = None
    sdk_cfg = live_cfg or fx_config.get("sdk") or {}
    # Un proyecto oculto de verdad (el primero que reporta el agente): así el QA no lleva nombres de clientes escritos.
    try:
        hidden = [t for t in agent_get(args.agent, "/office/public-view").get("hiddenTerms", []) if t.islower() and len(t) >= 5]
    except Exception:
        hidden = []
    FAKE["cliente"] = hidden[0] if hidden else "proyecto-oculto-qa"
    print(f"· configuración de permisos: {'la del agente ' + args.agent if live_cfg else 'la de la fixture'}")

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"])
        for theme in ("dark", "light"):
            print(f"\n── tema {theme} ──")
            ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(f"[{theme}] {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"[{theme}] {e}"))
            page.add_init_script(f"localStorage.setItem('hermes-theme', '{theme}'); localStorage.removeItem('hermes-oficina-vista-publica')")
            page.add_init_script(FAKE_PAD)
            page.goto(f"{args.url}/oficina?seed=7", wait_until="domcontentloaded")
            page.wait_for_function("() => typeof window.__hermesOficinaTraceReplay === 'function'", timeout=120000)
            time.sleep(2.5)
            dbg = lambda: page.evaluate("() => window.__hermesOficinaDebug()")

            # ── P entra a tarima con la vista pública prendida ──
            page.mouse.click(960, 540)
            page.keyboard.press("p")
            time.sleep(0.8)
            d = dbg()
            check(d["stage"]["on"] and page.locator("[data-stage]").count() == 1, "P abre el modo tarima")
            check(d["stage"]["publicView"] and page.locator("[data-public-toggle]").inner_text().startswith("👁"), "la vista pública viene prendida, con su indicador")

            # ── 1. La fixture repetida: completa y en orden ──
            rid = page.evaluate("(t) => window.__hermesOficinaTraceReplay(t, { speed: 30 })", fixture_text)
            page.wait_for_function("() => { const t = window.__hermesOficinaDebug().trace; return t && t.done; }", timeout=60000)
            time.sleep(0.6)
            d = dbg()
            seqs = [e["seq"] for e in d["trace"]["events"]]
            check(seqs == [e["seq"] for e in fx_events], f"la traza llega completa y en orden ({len(seqs)} de {len(fx_events)} eventos)")
            check(d["trace"]["replay"] and d["trace"]["replay"].startswith("repetición de las"), f"marcada como repetición ({d['trace']['replay']})")
            check(page.locator("[data-stage-replay]").inner_text().startswith("⟲ repetición"), "el encabezado dice 'repetición de las HH:MM'")
            check(int(page.locator("[data-trace-list]").get_attribute("data-trace-count")) == len(fx_events), "una fila por evento")

            # ── 2. Errores y correcciones ──
            errs = {e["step"]: e for e in d["trace"]["errors"]}
            steps = {s["n"]: s for s in d["trace"]["steps"]}
            check(set(errs) == {2, 4}, f"dos errores reales: el test (paso 2) y el Edit sin leer (paso 4) → {sorted(errs)}")
            check(errs.get(2, {}).get("fixedBy", {}) and errs[2]["fixedBy"]["step"] == 8, "el test fallido lo corrige el `npm test` del paso 8")
            check(errs.get(4, {}).get("fixedBy", {}) and errs[4]["fixedBy"]["step"] == 6, "el Edit fallido lo corrige el Edit del paso 6 (no el Read)")
            check(d["trace"]["summary"].startswith("9 vueltas · 8 tools · 2 errores, ambos corregidos (pasos 6 y 8)"), f"resumen con datos de la traza: {d['trace']['summary']}")
            # Fila del error del Edit (su tool_result) → data-fixed-by = el resultado del paso 6.
            # El chip del error en el encabezado salta a su fila y deja de seguir el final (como lo haría alguien en tarima).
            page.locator("[data-stage-errors] button").nth(1).click()
            row = page.locator(f"[data-trace-row='{steps[4]['resultSeq']}']")
            row.wait_for(timeout=10000)
            check(row.get_attribute("data-error") == "true" and row.get_attribute("data-fixed-by") == str(steps[6]["resultSeq"]), "la fila del error va en rojo y apunta al paso que lo corrigió")
            row.locator("[data-jump]").click()
            time.sleep(0.5)
            check(dbg()["stage"]["focusSeq"] == steps[6]["resultSeq"], "clic en '→ corregido' salta a la fila de la corrección")
            fs = page.locator(f"[data-trace-row='{steps[6]['resultSeq']}'] button").first.evaluate("el => parseFloat(getComputedStyle(el).fontSize)")
            check(fs >= 22, f"letra de la traza legible a 10 m ({fs:.0f} px)")

            # ── Teclado: ↑↓ y Enter ──
            page.keyboard.press("ArrowUp")
            page.keyboard.press("Enter")
            time.sleep(0.4)
            f = dbg()["stage"]["focusSeq"]
            check(f is not None and page.locator(f"[data-trace-row='{f}']").get_attribute("data-open") in ("true", None), "↑ mueve la selección y Enter despliega")

            # ── 4. System prompt byte a byte ──
            page.keyboard.press("2")
            time.sleep(0.4)
            check(dbg()["stage"]["tab"] == "prompt", "2 abre la pestaña System prompt")

            def open_sections():
                for sid in [s["id"] for s in fx_prompt["sections"]]:
                    if page.locator(f"[data-prompt-text='{sid}']").count() == 0:
                        page.locator(f"[data-prompt-section='{sid}'] > button").click()
                time.sleep(0.2)

            open_sections()
            sp = dbg()["systemPrompt"]
            red = sp["redacted"]
            ok_pub = all(page.locator(f"[data-prompt-text='{s['id']}']").text_content() == red["raw"][s["start"]:s["end"]] for s in red["sections"])
            check(ok_pub, "con vista pública: cada sección = la versión redactada, byte a byte")
            soul = page.locator("[data-prompt-text='soul']").text_content()
            check("oculto en vista pública" in soul and soul.startswith("# Sobre"), "lo personal (SOUL.md) queda con su título y 'oculto en vista pública'")
            check(page.locator("[data-prompt-section='vaultProfile'] [data-prompt-why]").inner_text() == "Sin motivo escrito.", "la sección sin motivo lo dice ('Sin motivo escrito.')")
            check("Por qué:" in page.locator("[data-prompt-section='skills'], [data-prompt-section='identity']").first.locator("[data-prompt-why]").inner_text(), "cada sección muestra su porqué")
            page.locator("[data-public-toggle]").click()
            time.sleep(0.5)
            open_sections()
            raw = fx_prompt["raw"]
            ok_raw = all(page.locator(f"[data-prompt-text='{s['id']}']").text_content() == raw[s["start"]:s["end"]] for s in fx_prompt["sections"])
            joined = "\n\n---\n\n".join(raw[s["start"]:s["end"]] for s in fx_prompt["sections"])
            check(ok_raw and joined == raw, "sin vista pública: el prompt coincide byte a byte con el capturado")
            page.locator("[data-public-toggle]").click()
            time.sleep(0.4)

            # ── 5. Inventario vs configuración real ──
            page.keyboard.press("1")
            time.sleep(0.4)
            inv = {c["name"]: c for c in dbg()["inventory"]}
            allowed = set(sdk_cfg.get("allowedTools", []))
            check(len([c for c in inv.values() if c["origin"] != "skill"]) == len(fx_init["tools"]), f"una ficha por tool que el modelo tuvo ({len(fx_init['tools'])}, del init)")
            check(len([c for c in inv.values() if c["origin"] == "skill"]) == len(fx_init["skills"]), f"y una por skill ({len(fx_init['skills'])})")
            perm_ok = True
            for name, c in inv.items():
                if c["origin"] == "skill":
                    continue
                prefix_allowed = any(a == name or (a.startswith("mcp__") and a.count("__") == 1 and name.startswith(a + "__")) for a in allowed)
                expected = "free" if prefix_allowed else "checked" if name.startswith("mcp__chrome-devtools__") else "guardrail" if name in sdk_cfg.get("guardedTools", []) else "checked"
                if c["permission"] != expected:
                    perm_ok = False
                    print(f"   {name}: {c['permission']} ≠ {expected}")
            check(perm_ok, "el permiso de cada tool sale de la configuración real (allowedTools, guardrail, canUseTool)")
            check(inv.get("Bash", {}).get("steps") == [1, 2, 3, 8] and inv.get("Edit", {}).get("steps") == [4, 6, 7] and inv.get("Read", {}).get("steps") == [5], "cada ficha dice en qué pasos se usó")
            check(inv.get("mcp__hermes__search_knowledge", {}).get("hasDescription") is True, "las tools de Hermes traen la descripción que ve el modelo")
            check(page.locator("[data-tool-card='Bash'] [data-jump-step='8']").count() >= 1, "la ficha de Bash enlaza a sus pasos")
            page.locator("[data-tool-card='Bash'] [data-jump-step='8']").first.click()
            time.sleep(0.5)
            check(dbg()["stage"]["focusSeq"] == steps[8]["useSeq"], "clic en un paso de la ficha salta a la traza")
            if shots:
                page.screenshot(path=str(shots / f"tarima-tools-{theme}.png"))
            page.keyboard.press("2")
            time.sleep(0.3)
            if shots:
                page.screenshot(path=str(shots / f"tarima-prompt-{theme}.png"))

            # ── Log completo: una entrada por evento, con las salidas enteras ──
            page.keyboard.press("3")
            time.sleep(0.5)
            n_log = page.locator("[data-log-line]").count()
            log_text = page.locator("[data-logs]").text_content()
            check(n_log == len(fx_events), f"Logs = el log completo de la traza: una entrada por evento ({n_log} de {len(fx_events)})")
            check("Expected values to be strictly equal" in log_text and "+ '$ 1,234,567'" in log_text, "con la salida ENTERA de cada tool (el diff del test que falló)")
            check(page.locator("[data-log-download]").count() == 1, "y se puede bajar en .txt")

            # ── 3. Vista pública: secretos sembrados ──
            page.evaluate("(t) => window.__hermesOficinaTraceReplay(t, { speed: 60, label: 'repetición QA (secretos falsos sembrados)' })", seeded_fixture(fixture_text))
            page.wait_for_function("(n) => { const t = window.__hermesOficinaDebug().trace; return t && t.id === 'replay-qa-sembrada' && t.events.length >= n; }", arg=len(fx_events) + 4, timeout=60000)
            time.sleep(0.8)
            last = dbg()["trace"]["events"][-4:]

            def set_open(seq: int, want: bool) -> None:
                """Abre o cierra una fila mirando su estado (el auto-scroll puede mover lo que hay bajo el mouse)."""
                for _ in range(3):
                    page.keyboard.press("End")
                    time.sleep(0.25)
                    row = page.locator(f"[data-trace-row='{seq}']")
                    if not row.count():
                        return
                    if (row.get_attribute("data-open") == "true") == want:
                        return
                    row.locator("> button").click()
                    time.sleep(0.3)

            def sweep() -> str:
                """Despliega cada fila sembrada DE A UNA (visible: la lista está virtualizada) y junta el DOM de cada paso."""
                seen = ""
                for e in last:
                    set_open(e["seq"], True)
                    seen += page.content()
                    set_open(e["seq"], False)
                return seen

            html = sweep()
            leaked = [k for k, v in FAKE.items() if v.lower() in html.lower()]
            check(not leaked, f"vista pública: ningún secreto sembrado llega al DOM, con cada fila desplegada (fugas: {leaked or 'ninguna'})")
            check("contenido de un .env" in html, "la salida de un .env se oculta entera")
            if shots:
                set_open(last[-1]["seq"], True)
                page.screenshot(path=str(shots / f"tarima-vista-publica-{theme}.png"))
                set_open(last[-1]["seq"], False)
            page.locator("[data-public-toggle]").click()
            time.sleep(0.6)
            html_off = sweep()
            shown = [k for k, v in FAKE.items() if v.lower() in html_off.lower()]
            check(len(shown) == len(FAKE), f"control: sin vista pública los mismos datos sí se ven ({len(shown)} de {len(FAKE)}: {shown}) — la prueba mide")
            check(page.locator("[data-public-toggle]").inner_text().startswith("⚠"), "apagada, el indicador avisa en rojo")
            page.locator("[data-public-toggle]").click()
            time.sleep(0.4)

            # ── Control Xbox en tarima ──
            def press(name: str):
                page.evaluate("([i]) => { const b = window.__fakePad.buttons[i]; b.value = 1; b.pressed = true; }", [BTN[name]])
                time.sleep(0.12)
                page.evaluate("([i]) => { const b = window.__fakePad.buttons[i]; b.value = 0; b.pressed = false; }", [BTN[name]])
                time.sleep(0.3)

            tab0 = dbg()["stage"]["tab"]
            press("RIGHT")
            check(dbg()["stage"]["tab"] != tab0, "cruceta ▶ cambia de pestaña")
            f0 = dbg()["stage"]["focusSeq"]
            press("UP")
            check(dbg()["stage"]["focusSeq"] not in (None, f0), "cruceta ▲ recorre la traza")
            press("A")
            fsq = dbg()["stage"]["focusSeq"]
            check(page.locator(f"[data-trace-row='{fsq}']").get_attribute("data-open") == "true" or page.locator(f"[data-trace-row='{fsq}'] > button span").count() > 0, "A despliega la fila")

            # ── fps con el panel abierto ──
            time.sleep(2)
            fps = dbg()["fps"]
            check(fps >= 55, f"fps con la traza abierta: {fps}")
            if shots:
                page.locator("[data-trace-list]").evaluate("el => el.scrollTop = 0")
                page.keyboard.press("1")
                time.sleep(0.3)
                page.screenshot(path=str(shots / f"tarima-traza-{theme}.png"))

            # ── Aprobar desde la tarima (simulación: un agente pide permiso) ──
            page.evaluate("() => window.__hermesOficinaTraceReplay(null)")
            time.sleep(0.5)
            page.evaluate("() => window.__hermesOficinaSim('demo')")
            time.sleep(1.5)
            asking = None
            for _ in range(12):
                d = dbg()
                w = next((x for x in d["workers"] if x["id"] == d["stage"]["agentId"]), None)
                if w and w["status"] == "needs_you":
                    asking = w
                    break
                page.keyboard.press("Tab")
                time.sleep(0.3)
            check(asking is not None and page.locator("[data-stage-approval]").count() == 1, "un agente que levanta la mano muestra su permiso en la tarima")
            if asking:
                page.keyboard.press("a")
                time.sleep(0.6)
                w = next((x for x in dbg()["workers"] if x["id"] == asking["id"]), None)
                check(w is not None and w["status"] != "needs_you" and page.locator("[data-stage-approval]").count() == 0, "A lo aprueba sin salir de la tarima")
            page.evaluate("() => window.__hermesOficinaSim(null)")
            time.sleep(0.8)

            # ── El panel de cada agente (fuera de la tarima) tiene su pestaña Log ──
            page.keyboard.press("p")
            time.sleep(0.6)
            page.evaluate("() => window.__hermesOficinaSim('demo')")
            time.sleep(1.5)
            wid = dbg()["workers"][0]["id"]
            page.evaluate("(id) => window.__hermesOficinaMode('aerial')", wid)
            time.sleep(0.8)
            page.evaluate("(id) => window.__hermesOficinaFocus({ kind: 'worker', id })", wid)
            time.sleep(1.5)
            pt = page.evaluate("(id) => window.__hermesOficinaScreenOf({ kind: 'worker', id })", wid)
            if pt:
                page.mouse.click(pt["x"], pt["y"])
                time.sleep(0.8)
            if page.locator("[data-drawer-tab='log']").count():
                page.locator("[data-drawer-tab='log']").click()
                time.sleep(0.5)
            check(page.locator("[data-drawer-tab='log'][aria-selected='true']").count() == 1 and page.locator("[data-logs] [data-log-line]").count() > 0, "el panel de un agente tiene la pestaña Log con su log")
            page.keyboard.press("Escape")
            page.evaluate("() => window.__hermesOficinaSim(null)")
            time.sleep(0.6)
            page.keyboard.press("p")
            time.sleep(0.6)

            # ── 6. Vitrina: entra sola por inactividad y sale con una tecla ──
            page.evaluate("() => window.__hermesOficinaVitrina(false, 3000)")
            page.wait_for_function("() => window.__hermesOficinaDebug().stage.replayKind === 'vitrina'", timeout=20000)
            d = dbg()
            check(d["stage"]["vitrina"].startswith("repetición de las"), f"la vitrina entra sola tras la inactividad: '{d['stage']['vitrina']}'")
            check("cualquier tecla" in page.locator("[data-stage-replay]").inner_text(), "dice cómo volver a lo vivo")
            time.sleep(2)
            if shots:
                page.screenshot(path=str(shots / f"tarima-vitrina-{theme}.png"))
            page.keyboard.press("x")
            time.sleep(0.5)
            check(dbg()["stage"]["vitrina"] is None, "una tecla vuelve a lo vivo")
            page.evaluate("() => window.__hermesOficinaVitrina(false, 120000)")
            press("VIEW")
            time.sleep(0.4)
            check(not dbg()["stage"]["on"] and page.locator("[data-stage]").count() == 0, "View (o P) sale del modo tarima")
            ctx.close()
        browser.close()

    noise = [e for e in errors if "Failed to load resource" not in e and "net::ERR" not in e]
    check(not noise, f"sin errores de consola ({len(noise)})")
    for e in noise[:8]:
        print("   ", e[:200])
    print(f"\n{'OK' if not fails else 'FALLÓ'}: {len(fails)} fallas")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
