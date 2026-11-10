"""Parte el CLAUDE.md de 155 KB en docs/contexto/<función>.md sin perder texto.

Uso: python3 split-claude-md.py <repo> [--check]
Lee el CLAUDE.md ORIGINAL del commit base (git show <base>:CLAUDE.md) para que se pueda
volver a correr después de reescribir el índice. Con --check solo verifica que cada línea
del original está completa en algún documento.
"""
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
check_only = "--check" in sys.argv
BASE = "f9f2a36"
original = subprocess.run(["git", "-C", str(repo), "show", f"{BASE}:CLAUDE.md"], capture_output=True, text=True, check=True).stdout
lines = original.split("\n")

def L(n):  # línea 1-indexada
    return lines[n - 1]

# slug → (título, cuándo leerlo, líneas del original)
DOCS = {
    "memoria-conocimiento": ("Memoria y capa de conocimiento", "Tocar memorias, búsqueda de conocimiento, embeddings o el vault como fuente", [8, 9]),
    "identidad-dueno": ("Identidad del dueño fuera del código", "Prompts, SOUL.md, nombres propios, defaults personales", [10]),
    "aprendizaje-y-tareas": ("Aprendizaje, USER.md, skills y tareas programadas", "USER.md, skills aprendidas, curador, loop de aprendizaje, tareas programadas y su cron", [11]),
    "seguridad-proceso-hijo": ("Proceso hijo, guardrails y tests", "Llamar al modelo, permisos de tools, secretos, cómo se escriben los tests", [12, 13, 14]),
    "juntas-en-vivo": ("Junta EN VIVO y copiloto en tiempo real", "Reuniones en vivo, capa rápida, coach, STT en streaming, ingest del acta", [16, 17, 18, 19, 20, 21, 38]),
    "reunion-equipo": ("Reunión de equipo EN VIVO", "Modo equipo, aportes con ángulo, audio del sistema, pool de motores", [22]),
    "lente": ("Lente (tarjetas para gafas)", "Evento `cue`, /lente, baraja de tarjetas, gafas", [23]),
    "articulacion-gimnasio": ("Articulación y gimnasio", "Reglas de articulación, «Dilo más claro», /gimnasio", [24, 25]),
    "dojo": ("Dojo de algoritmos", "/dojo, Pyodide, trazador, máquinas", [26]),
    "entender": ("Entender (tutor de proyecto)", "/entender, pizarra, repos de un proyecto, modo voz", [27]),
    "ingles": ("Inglés: tutora, clase en vivo y plan", "Tutora por voz, clase por Meet, compañera, plan de estudios", [28, 29, 30]),
    "red-y-multimaquina": ("Red, centro y multi-máquina", "Rutas LAN/Tailscale, hub, varias máquinas, historial único, transferencias", [31, 32]),
    "modo-avion": ("Modo avión (modelo local)", "llama-server, chat sin internet, modelos locales", [33]),
    "hermes-phone": ("Hermes Phone, compañero y juntas desde el teléfono", "Lado del agente del teléfono: /phone/ws, avisos, foco, finanzas desde avisos, compañero, juntas", [34, 35, 36]),
    "movil-expo-y-acceso-remoto": ("Acceso remoto y app móvil Expo (heredada)", "Túnel, auth por JWT, grabador nativo, subida por partes, jobs durables", [37]),
    "upwork": ("Oportunidades de Upwork desde Gmail", "Gmail readonly, puntaje de ofertas, borradores", [39]),
    "teker-ia": ("TeKer IA", "Tool teker_ia y su chat en Equipo", [40]),
    "linear-y-tareas": ("Linear y el tablero de tareas", "Issues, Copy prompt, ejecutar desde Linear, triage de accionables", [41, 42]),
    "estudio": ("Estudio (creación de contenido)", "/estudio: piezas, etapas, teleprompter, voz en off, edición automática, métricas", [43]),
    "composicion": ("Composición (canciones)", "/composicion: sesiones, temas, letras; confidencial", [44]),
    "estacion": ("Tótem de estación", "/estacion, GTFS, elenco anfitrión, QR al celular", [45]),
    "gestos": ("Control por gestos y señas", "MediaPipe, cursor por mano, señas configurables, manos sobre la UI", [46]),
    "navegador": ("Control del navegador", "Abrir sitios, pestañas, navegación con chrome-devtools-mcp", [47]),
    "cuarto-luces-y-tv": ("El cuarto: luces y TV", "Tira Kasa, Hermes TV, escenas, Mi día, despertar", [48, 49]),
    "mac-y-vision": ("La Mac por voz y visión en vivo", "mac_open/mac_media, /vision/ws, gafas Ray-Ban Meta", [50]),
    "avatar": ("Avatar Terminator (demo)", "/dev/terminator, proveedores de imagen", [51]),
    "grafo-de-codigo": ("Grafo de código y vista 3D", "query_code_graph, codebase-memory-mcp, graphify, grafo 3D con manos", [52, 53, 54, 55]),
    "oficina": ("Oficina de agentes 3D", "/oficina: personajes, aprobaciones, modos, pisos, trazas, vista pública", [56]),
    "sala": ("Sala de Agentes 3D", "/sala: marioneta por pose, elenco multi-voz", [57]),
    "ruloview": ("RuloView", "/ruloview: presencia por WiFi sobre el escaneo del cuarto", [58]),
    "dashboard": ("Dashboard: marca, sistema de diseño y shell", "Cualquier cambio de interfaz web: tokens, temas, shell, comandos, riel", list(range(61, 80))),
}

# Lo que se queda en el índice (corto y de uso constante).
KEEP = [1, 3, 5, 6, 7, 15, 60, 81, 82, 83, 84, 85, 86, 87, 89, 90, 91]

covered = set(KEEP)
for slug, (_, _, nums) in DOCS.items():
    covered.update(nums)
missing = [n for n in range(1, len(lines) + 1) if L(n).strip() and n not in covered]
if missing:
    sys.exit(f"líneas del original sin destino: {missing}")

out_dir = repo / "docs" / "contexto"
if not check_only:
    out_dir.mkdir(parents=True, exist_ok=True)
    for slug, (title, when, nums) in DOCS.items():
        body = "\n".join(L(n) for n in nums)
        path = out_dir / f"{slug}.md"
        # Si el documento ya existe (se agregó algo de v6 debajo), se conserva lo que haya después de la marca.
        tail = ""
        if path.exists():
            old = path.read_text()
            mark = "\n<!-- v6 -->\n"
            if mark in old:
                tail = mark + old.split(mark, 1)[1]
        path.write_text(f"# {title}\n\n> Cuándo leerlo: {when.lower()}.\n\n{body}\n{tail}")

# Verificación: cada línea no vacía del original está completa en algún documento o se queda en el índice.
texts = {p.name: p.read_text() for p in out_dir.glob("*.md")}
index_text = (repo / "CLAUDE.md").read_text()
lost = []
for n in range(1, len(lines) + 1):
    line = L(n)
    if not line.strip() or n in KEEP:
        continue
    if not any(line in t for t in texts.values()):
        lost.append(n)
if lost:
    sys.exit(f"PERDIDAS: líneas {lost} del original no están completas en docs/contexto/")
total = sum(len(t.encode()) for t in texts.values())
print(f"ok: {len(texts)} documentos, {total} bytes en docs/contexto; índice actual {len(index_text.encode())} bytes")
for slug, (title, when, _) in DOCS.items():
    print(f"| {title} | `docs/contexto/{slug}.md` | {when} |")
