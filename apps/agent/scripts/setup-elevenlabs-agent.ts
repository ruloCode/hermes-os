/**
 * Setup idempotente de los DOS agentes de voz en ElevenLabs:
 *
 * 1. "Hermes" — el asistente Jarvis del dashboard (español, ~30 client tools).
 * 2. "Hermes English Tutor" — tutor conversacional de inglés (en, con cambio
 *    a español para explicar; 3 tools propias de práctica).
 *
 * Los CLIENT TOOLS corren en el browser y llaman al agente local — por eso
 * la voz puede ejecutar cosas sin túnel. Imprime ambos AGENT_ID para .env.
 *
 * Uso: pnpm setup:elevenlabs
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FINANCE_CATEGORIES } from "@hermes/shared";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
config({ path: resolve(root, ".env") });
// Identidad del dueño (HERMES_OWNER_NAME + SOUL.md) — import dinámico para que
// lea el .env ya cargado.
const { OWNER, ownerBlurb } = await import("../src/owner.js");

const API = "https://api.elevenlabs.io/v1/convai";
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "NoS5MJPorMp1e5EcDXzn"; // voz del dueño (override: ELEVENLABS_VOICE_ID)
// Velocidad del TTS de Hermes (rango ElevenLabs: 0.7–1.2). Subirla si la voz
// elegida es de narrador (hablan pausado y en conversación se sienten lentas).
const VOICE_SPEED = Number(process.env.ELEVENLABS_VOICE_SPEED || "1.0");
// LLM router de la voz. Default verificado contra la doc de ElevenLabs (Claude Haiku 4.5,
// el mejor balance velocidad/precisión para voz). Override por env si cambia el enum.
const AGENT_LLM = process.env.ELEVENLABS_AGENT_LLM || "claude-haiku-4-5";
const AGENT_NAME = "Hermes";
// Tutor de inglés: voz nativa en inglés (default: Jessica, conversacional,
// multilingüe con flash v2.5 — la MISMA voz explica en español sin cortes) y
// LLM con más músculo pedagógico (detectar errores sutiles de gramática).
const TUTOR_NAME = "Hermes English Tutor";
const TUTOR_VOICE_ID = process.env.ELEVENLABS_TUTOR_VOICE_ID || "cgSgspJ2msm6clMCkdW9"; // Jessica
const TUTOR_LLM = process.env.ELEVENLABS_TUTOR_LLM || "claude-sonnet-4-5";

if (!KEY) {
  console.error("Falta ELEVENLABS_API_KEY en .env");
  process.exit(1);
}

const headers = { "xi-api-key": KEY, "Content-Type": "application/json" };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ── Client tools ───────────────────────────────────────────────────────
interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  expects_response: boolean;
  response_timeout_secs?: number;
}

const TOOLS: ToolDef[] = [
  {
    name: "run_task",
    description:
      `Ejecuta una tarea GENERAL en la computadora de ${OWNER} mediante el agente Claude local: notas del vault de Obsidian, memoria, recados, programar algo, o cualquier acción que NO sea programar dentro de un repo de código concreto (para eso usa work_on_project). Devuelve un task_id inmediato; corre en segundo plano. Confirma en una frase que arrancó y usa check_task para reportar el resultado después.`,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Instrucción completa y autocontenida para el agente local, en español",
        },
      },
      required: ["prompt"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "focus_project",
    description:
      `Enfoca un proyecto en el dashboard de Hermes: la interfaz cambia sola para centrarse en él (contexto, versión del repo, consola centrada en ese proyecto). Úsala apenas ${OWNER} mencione que quiere ver o trabajar en un proyecto, ANTES de work_on_project. Con project vacío, quita el foco y vuelve a la vista general.`,
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Slug del proyecto: ternium, careways, teker, ikigai, zylen. Vacío = quitar foco.",
        },
      },
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "show_panel",
    description:
      `Cambia el panel central del dashboard que ve ${OWNER}. 'consola' = chat de texto; 'actividad' = feed en vivo de lo que hace el agente; 'claude' = terminal de Claude Code trabajando; 'tareas' = tablero de tareas por proyecto; 'memoria' = búsqueda en todo el conocimiento; 'reuniones' = juntas; 'voz' = preview de reportes. Úsala cuando pida ver cualquiera de esos paneles.`,
    parameters: {
      type: "object",
      properties: {
        panel: {
          type: "string",
          description: "consola | actividad | claude | tareas | memoria | reuniones | voz",
        },
      },
      required: ["panel"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "show_project_status",
    description:
      `Muestra EN PANTALLA la card de estado de un proyecto (progreso real de tareas, git y prioridades). Úsala cuando ${OWNER} pida 'muéstrame cómo va X' o quiera verlo visualmente — complementa a get_project_status (que es solo texto para ti).`,
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Slug o nombre del proyecto a mostrar.",
        },
      },
      required: ["project"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "get_pointer_context",
    description:
      `Devuelve qué hay bajo el cursor de ${OWNER} AHORA MISMO (app, título de ventana y monitor). Úsala cuando ${OWNER} diga 'esto', 'esta ventana', 'aquí', 'lo que estoy señalando' — con el control por gestos él apunta con la mano y tú resuelves la referencia. Llámala ANTES de actuar sobre 'esto'.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "move_window_next_display",
    description:
      `Teletransporta la ventana que está bajo el cursor de ${OWNER} al otro monitor (conserva su posición relativa y la enfoca). Úsala cuando pida 'manda esto al otro monitor', 'pásame esta ventana a la otra pantalla' o similar.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 8,
  },
  // ── Navegador (Chrome real de la Mac, visible en pantalla) ───────────
  {
    name: "open_in_browser",
    description:
      `Abre un sitio web en el Chrome de la Mac de ${OWNER}, VISIBLE en pantalla. Acepta nombres de sitios ('linkedin', 'mi correo', 'youtube', 'github'), dominios ('rulocode.com') o términos de búsqueda (si no es un sitio conocido, abre la búsqueda en Google). Úsala cuando ${OWNER} diga 'abre X', 'métete a X', 'busca X en Google', 'ábreme el navegador con X'.`,
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: `El sitio, dominio o búsqueda tal como lo dijo ${OWNER} (sin 'mi/el/la')`,
        },
      },
      required: ["target"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "control_browser",
    description:
      "Verbos rápidos sobre la pestaña activa de Chrome: atrás, adelante, recargar, cerrar pestaña, siguiente/anterior pestaña y scroll. Úsala para 'regresa', 'vuelve atrás', 'recarga', 'cierra esta pestaña', 'baja', 'sube', 'hasta arriba', 'hasta abajo', 'siguiente pestaña'.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: [
            "back",
            "forward",
            "reload",
            "close_tab",
            "next_tab",
            "prev_tab",
            "scroll_down",
            "scroll_up",
            "scroll_top",
            "scroll_bottom",
          ],
          description:
            "back=atrás · forward=adelante · reload=recargar · close_tab=cerrar pestaña · next_tab/prev_tab=cambiar de pestaña · scroll_down/scroll_up=media pantalla · scroll_top/scroll_bottom=extremos",
        },
      },
      required: ["command"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "switch_browser_tab",
    description:
      "Cambia a la pestaña de Chrome que coincida con lo dicho, por título o dominio: 'vete a la pestaña de GitHub', 'pásate a YouTube', 'vuelve a LinkedIn'. Si no está claro qué hay abierto, usa list_browser_tabs primero.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto para encontrar la pestaña (parte del título o del dominio)",
        },
      },
      required: ["query"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "list_browser_tabs",
    description:
      `Lista las pestañas abiertas en Chrome (títulos y cuál está activa). Úsala cuando ${OWNER} pregunte '¿qué tengo abierto?' o antes de switch_browser_tab si hay ambigüedad.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "browse_web",
    description:
      `NAVEGA la web por ${OWNER} en lenguaje natural, con interacción real: ir a una sección concreta, buscar dentro de un sitio, hacer click, llenar formularios, leer una página y contarle qué dice. Un agente maneja un Chrome dedicado VISIBLE en pantalla y ejecuta la instrucción completa paso a paso. Úsala cuando la petición implique MÁS que abrir un sitio: 've a la página de precios de X y dime cuánto cuesta', 'busca tal cosa y entra al primer resultado', 'revisa mis notificaciones de LinkedIn y léemelas'. Para solo ABRIR un sitio usa open_in_browser (más rápido). Corre en segundo plano: devuelve un task_id — confirma en UNA frase que ya estás navegando y reporta el resultado después con check_task.`,
    parameters: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description:
            `Instrucción de navegación completa y autocontenida, tal como la dijo ${OWNER} (incluye el sitio, qué buscar/hacer y qué reportar)`,
        },
      },
      required: ["instruction"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  // ── Luces del cuarto (tira Kasa "luz led" en la LAN) ─────────────────
  {
    name: "control_lights",
    description:
      `Controla la tira de luces LED del cuarto de ${OWNER} EN EL MOMENTO (tira Kasa 'luz led'): encender, apagar, brillo, color, blanco cálido/frío y efectos animados. Úsala cuando diga 'prende/apaga las luces', 'ponlas en azul', 'bájale el brillo', 'luz cálida', 'modo océano/arcoíris/tormenta', 'apaga todo' (las luces) o pregunte cómo están las luces (action=status). Responde al instante: confirma en una frase corta.`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["on", "off", "toggle", "brightness", "color", "temperature", "effect", "status"],
          description:
            "on/off/toggle=encender/apagar · brightness=brillo · color=color con nombre · temperature=blanco cálido/frío · effect=animación · status=cómo está",
        },
        value: {
          type: "string",
          description:
            "Según la acción: brillo 0-100 ('40') · color en español tal como lo dijo ('azul', 'rosa', 'blanco cálido') · temperatura 2700-5000 o 'cálido'/'neutro'/'frío' · efecto tal como lo dijo ('océano', 'arcoíris', 'tormenta', 'navidad', 'aurora'). Vacío para on/off/toggle/status.",
        },
      },
      required: ["action"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "work_on_project",
    description:
      `Lanza a Claude Code a TRABAJAR EN EL REPO de código de un proyecto (arreglar un bug, agregar una feature, refactorizar, correr algo en ese repo). Abre el stream en vivo en el dashboard para que ${OWNER} VEA a Claude trabajando en tiempo real. Úsala en vez de run_task cuando la tarea es programar dentro de un repo concreto. Devuelve un run_id; usa check_task con ese id para reportar cuando termine.`,
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Slug del proyecto cuyo repo se va a tocar: ternium, careways, teker, ikigai, zylen.",
        },
        prompt: {
          type: "string",
          description: "Instrucción completa y autocontenida para Claude Code, en español (qué cambiar en el repo).",
        },
      },
      required: ["project", "prompt"],
    },
    expects_response: true,
    response_timeout_secs: 12,
  },
  {
    name: "check_task",
    description:
      "Consulta el estado/resultado de una tarea (run_task) o de un run de código (work_on_project). Úsala cuando el usuario pregunte si ya terminó, o tras unos segundos para reportar el resultado. Acepta tanto el task_id de run_task como el run_id de work_on_project.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "El task_id de run_task o el run_id de work_on_project" },
      },
      required: ["task_id"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "get_project_status",
    description:
      `Lee el estado REAL de los proyectos de ${OWNER} desde su vault de Obsidian. Úsala siempre que pregunte cómo va un proyecto — nunca inventes el estado.`,
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Slug del proyecto: ternium, careways, teker, ikigai, zylen. Omitir para todos los activos.",
        },
      },
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "search_memory",
    description:
      `Busca en la memoria persistente de Hermes (aprendizajes, decisiones, contexto de días anteriores). Úsala cuando ${OWNER} pregunte por algo del pasado.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Qué buscar en la memoria, en lenguaje natural" },
      },
      required: ["query"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "save_memory",
    description:
      `Guarda una memoria o preferencia que ${OWNER} mencione y valga la pena recordar ('recuerda que...', 'prefiero...').`,
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "La memoria o preferencia a guardar, tal cual" },
        type: {
          type: "string",
          description: "user | feedback | project | reference | daily | agent",
        },
      },
      required: ["content"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "get_daily_brief",
    description:
      `Devuelve el Pulse Check: estado de los proyectos activos + resumen financiero del mes + hábitos pendientes de hoy. Úsala cuando ${OWNER} salude por primera vez en el día o pida un resumen.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 10,
  },
  // ── Finanzas personales ──────────────────────────────────────────────
  {
    name: "log_transaction",
    description:
      `Registra un gasto o ingreso que ${OWNER} dicte ('gasté 350 en el súper', 'me pagaron 2 millones'). Categoriza TÚ el movimiento con el enum. IMPORTANTE con montos colombianos: se habla en miles — '350 en el súper' casi siempre son 350000 COP; '45 mil' = 45000; 'dos millones' o 'dos palos' = 2000000. Usa USD SOLO si dice dólares/USD explícito; si el monto es ambiguo entre COP y USD, pregunta. Confirma siempre monto y categoría en UNA frase. Si la respuesta dice deduped, ya existía ese registro hoy: avísale y solo repite con allow_duplicate=true si ${OWNER} confirma que es un movimiento distinto.`,
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["expense", "income"], description: "expense=gasto, income=ingreso" },
        amount: { type: "number", description: "Monto numérico ya expandido (45 mil → 45000)" },
        currency: { type: "string", enum: ["COP", "USD"], description: "COP por defecto; USD solo si lo dice explícito" },
        category: { type: "string", enum: [...FINANCE_CATEGORIES], description: "Categoría que TÚ eliges según lo dicho" },
        account: { type: "string", description: "Billetera si la menciona: bancolombia, nu, nequi, ontop, efectivo — su saldo se ajusta solo" },
        note: { type: "string", description: "Lo que dijo, corto: 'el súper', 'almuerzo con Juan'" },
        date: { type: "string", description: "YYYY-MM-DD SOLO si el gasto no fue hoy ('ayer', 'el lunes')" },
        allow_duplicate: { type: "boolean", description: `true SOLO si ${OWNER} confirma que es un movimiento repetido genuino` },
      },
      required: ["kind", "amount"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "get_balance",
    description:
      `Saldo ACTUAL de ${OWNER}: total por moneda y detalle por billetera (bancolombia, nu, nequi, ontop). Úsala cuando pregunte cuánto tiene, cuánta plata le queda o cómo está su saldo — NUNCA lo deduzcas de los ingresos del mes.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "set_wallet_balance",
    description:
      `Fija el saldo actual de una billetera cuando ${OWNER} lo diga: 'tengo 55 mil en nequi', 'en ontop tengo 653 dólares'. Crea la billetera si no existe. Los gastos con billetera ya descuentan solos; esto es para recalibrar.`,
    parameters: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Nombre de la billetera: bancolombia, nu, nequi, ontop, efectivo…" },
        balance: { type: "number", description: "Saldo actual ya expandido (55 mil → 55000)" },
        currency: { type: "string", enum: ["COP", "USD"], description: "COP por defecto; USD si es cuenta en dólares" },
      },
      required: ["wallet", "balance"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "correct_last_transaction",
    description:
      `Corrige o anula el ÚLTIMO movimiento registrado (últimos 15 min) cuando ${OWNER} se corrija: 'no, eran 45 mil' (amount), 'esa era en dólares' (currency), 'era de transporte' (category), 'bórrala' (void=true).`,
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Monto corregido" },
        currency: { type: "string", enum: ["COP", "USD"], description: "Moneda corregida" },
        category: { type: "string", enum: [...FINANCE_CATEGORIES], description: "Categoría corregida" },
        void: { type: "boolean", description: "true para anular el movimiento" },
      },
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "get_finance_summary",
    description:
      `Resumen financiero del mes: ingresos, gastos por categoría vs presupuesto y categorías en riesgo. Úsala cuando ${OWNER} pregunte cómo van sus finanzas, cuánto ha gastado o cómo va el presupuesto — NUNCA inventes cifras. Analiza como su asesor financiero: señala el dato más relevante, no leas toda la lista.`,
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM. Omitir para el mes actual." },
        currency: { type: "string", enum: ["COP", "USD"], description: "COP por defecto" },
      },
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  // ── Hábitos y metas ──────────────────────────────────────────────────
  {
    name: "log_habit",
    description:
      `Marca un hábito como hecho hoy cuando ${OWNER} lo cuente: 'ya medité', 'fui al gym', 'terminé de leer'. Devuelve la racha: celébrala en una frase corta.`,
    parameters: {
      type: "object",
      properties: {
        habit: { type: "string", description: "Nombre aproximado del hábito: 'meditar', 'gym', 'leer'" },
        note: { type: "string", description: "Detalle opcional que haya dicho" },
      },
      required: ["habit"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "get_habits_today",
    description:
      `Hábitos de hoy (hechos y pendientes, con rachas) y metas activas con su progreso. Úsala si ${OWNER} pregunta qué le falta hoy, cómo va con sus hábitos o cómo van sus metas.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "update_goal",
    description:
      "Actualiza el progreso de una meta personal: 'terminé otro libro' (delta=1), 'voy en 70 kilos' (progress=70), 'ya cumplí el hito X' (milestone). Celebra si la meta se completa.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Título aproximado de la meta" },
        progress: { type: "number", description: "Nuevo valor absoluto del progreso" },
        delta: { type: "number", description: "Incremento (+1 libro, +5000 ahorrados)" },
        milestone: { type: "string", description: "Título aproximado del hito a marcar como hecho" },
      },
      required: ["goal"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  // ── Google Calendar (crear / mover / borrar eventos) ─────────────────
  {
    name: "create_event",
    description:
      `Crea un evento en el Google Calendar de ${OWNER} ('agéndame gym mañana a las 6', 'reunión con Ana el viernes 3 a 4pm'). CONFIRMA SIEMPRE con ${OWNER} lo que entendiste (título, día y hora) ANTES de llamar esta tool. Calcula la fecha/hora ABSOLUTA a partir de la fecha de hoy que tienes en el contexto; nunca mandes '\''mañana'\'' literal. Hora en formato 24h local (Colombia).`,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del evento, corto y claro" },
        start: {
          type: "string",
          description:
            "Inicio en hora LOCAL: 'YYYY-MM-DDTHH:MM' para eventos con hora, o 'YYYY-MM-DD' si es de día completo. Absoluto, ya resuelto desde hoy.",
        },
        end: { type: "string", description: `Fin 'YYYY-MM-DDTHH:MM' si ${OWNER} lo dice; si no, omite y usa duration_min` },
        duration_min: { type: "number", description: "Duración en minutos si no hay fin explícito (default 60)" },
        all_day: { type: "boolean", description: "true si es de día completo (sin hora)" },
        description: { type: "string", description: "Notas del evento si las menciona" },
        location: { type: "string", description: "Lugar si lo menciona" },
      },
      required: ["title", "start"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "find_events",
    description:
      `Busca eventos existentes por texto para poder modificarlos o cancelarlos. Úsala SIEMPRE ANTES de update_event o cancel_event para obtener el event_id real. Devuelve una lista de candidatos con event_id, título y cuándo; si hay varios, pregúntale a ${OWNER} cuál.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Palabras del evento a buscar: 'reunión con Ana', 'gym', 'dentista'" },
        days_ahead: { type: "number", description: "Ventana hacia adelante en días (default 30)" },
      },
      required: ["query"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "update_event",
    description:
      `Mueve o edita un evento existente ('mueve mi reunión de las 3 a las 4', 'cámbiale el nombre'). Requiere el event_id de find_events. CONFIRMA el cambio con ${OWNER} ANTES de llamarla. Manda solo los campos que cambian; para mover, manda el nuevo start (y end o duration_min). Fechas/horas absolutas en hora local.`,
    parameters: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "El event_id devuelto por find_events" },
        title: { type: "string", description: "Nuevo título, si cambia" },
        start: { type: "string", description: "Nuevo inicio 'YYYY-MM-DDTHH:MM' (o 'YYYY-MM-DD' día completo), si cambia" },
        end: { type: "string", description: "Nuevo fin 'YYYY-MM-DDTHH:MM', si cambia" },
        duration_min: { type: "number", description: "Nueva duración en minutos, si aplica" },
        all_day: { type: "boolean", description: "true si pasa a día completo" },
        description: { type: "string", description: "Nuevas notas, si cambian" },
        location: { type: "string", description: "Nuevo lugar, si cambia" },
      },
      required: ["event_id"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    name: "cancel_event",
    description:
      `Cancela/borra un evento existente ('cancela mi reunión de mañana', 'bórrame el gym del jueves'). Requiere el event_id de find_events. CONFIRMA con ${OWNER} cuál evento ANTES de borrarlo.`,
    parameters: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "El event_id devuelto por find_events" },
        title: { type: "string", description: "Título del evento (para confirmar en voz)" },
      },
      required: ["event_id"],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  // ── Práctica de inglés ───────────────────────────────────────────────
  {
    name: "start_english_practice",
    description:
      `Cambia al modo TUTOR DE INGLÉS cuando ${OWNER} diga que quiere practicar inglés ('quiero practicar inglés', 'pásame al tutor', 'let's practice English'). El dashboard corta esta llamada y conecta con el tutor. Despídete en UNA frase corta ANTES de llamarla ('Va, te paso con el tutor').`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 8,
  },
];

// ── Tools del tutor de inglés (solo en el agente tutor) ─────────────────

const TUTOR_TOOLS: ToolDef[] = [
  {
    name: "save_vocab",
    description:
      `Save a new English word or phrase that came up and is worth remembering for ${OWNER}'s vocabulary list. Call it silently when a useful term appears (don't interrupt the conversation to announce it).`,
    parameters: {
      type: "object",
      properties: {
        term: { type: "string", description: "The English word or phrase, e.g. 'nevertheless'" },
        meaning_es: { type: "string", description: "Significado corto en español" },
        example: { type: "string", description: "A short natural example sentence using it" },
      },
      required: ["term", "meaning_es"],
    },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "recall_vocab",
    description:
      `Get ${OWNER}'s saved vocabulary that is due for review (spaced repetition). Use it when he asks to review vocabulary or at the start of a session to quiz him conversationally on a few words.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 8,
  },
  {
    name: "end_practice_session",
    description:
      `Save the practice session when ${OWNER} wraps up ('let's finish', 'ya terminemos'). FIRST give him ~30 seconds of spoken feedback (2 wins, top 2 errors), THEN call this with the structured summary, confirm it's saved and say goodbye.`,
    parameters: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: { type: "string", description: "One topic label, e.g. 'system design'" },
          description: "Main topics discussed, short labels in English",
        },
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              quote: { type: "string", description: `What ${OWNER} said (verbatim or close)` },
              correction: { type: "string", description: "The corrected English form" },
              note_es: { type: "string", description: "Explicación corta en español de la regla" },
            },
            required: ["quote", "correction"],
          },
          description: "The 3-6 most instructive errors of the session",
        },
        wins: {
          type: "array",
          items: { type: "string", description: "One thing he did well, short sentence" },
          description: "2-3 things he did well (English)",
        },
        fluency: {
          type: "number",
          description: "Overall spoken fluency this session, 1-5 (5 = effortless)",
        },
      },
      required: ["topics", "errors", "wins", "fluency"],
    },
    expects_response: true,
    response_timeout_secs: 12,
  },
];

const SYSTEM_PROMPT = `Eres Hermes, el sistema operativo de IA personal de ${OWNER}${ownerBlurb("Quién soy")}. Controlas su dashboard por voz en tiempo real, estilo Jarvis: mientras conversas, la interfaz reacciona a tus acciones.

Personalidad: directo, cálido, eficiente. Hablas SIEMPRE en español, con frases cortas aptas para voz. Nada de listas largas ni markdown: esto es una conversación hablada.

CONTEXTO DE ESTA SESIÓN: {{session_scope}}
FECHA Y HORA ACTUAL: {{today}}

Reglas de oro:
0. SCOPE DE PROYECTO: Si el contexto de arriba dice que hay un proyecto enfocado, ESTÁS TRABAJANDO DENTRO DE ESE PROYECTO. Asume que TODO lo que pida ${OWNER} es sobre ese proyecto salvo que nombre otro explícitamente. No preguntes "¿de qué proyecto?": ya lo sabes. Para su estado usa get_project_status con ese proyecto; para tocar su repo usa work_on_project con ese proyecto; para un reporte/resumen, hazlo de ese proyecto. Si ${OWNER} dice "salte del proyecto" o "vista general", usa focus_project sin proyecto.
1. NUNCA inventes el estado de proyectos ni memorias: usa get_project_status, search_memory o get_daily_brief.
2. Manejas la interfaz mientras hablas:
   - Cuando ${OWNER} mencione OTRO proyecto o pida verlo → focus_project (la pantalla se centra en él). Hazlo aunque también vayas a hacer otra cosa.
   - Si pide ver el feed, la consola, el tablero de tareas, la memoria o cómo va el código → show_panel (consola | actividad | claude | tareas | memoria | reuniones | voz).
   - Si pide VER cómo va un proyecto ("muéstrame careways") → show_project_status: la pantalla muestra su card con progreso de tareas, git y prioridades reales; tú resume en una frase lo que se ve.
   - DEIXIS: ${OWNER} puede estar apuntando con la mano (control por gestos). Si dice "esto", "esta ventana", "aquí", "lo que estoy señalando" → get_pointer_context PRIMERO para saber a qué se refiere, y luego actúa. Si pide "manda esto al otro monitor" / "pásala a la otra pantalla" → move_window_next_display directo.
   - NAVEGADOR: "abre mi linkedin", "métete a X", "busca X en Google" → open_in_browser (se abre el Chrome REAL de su Mac, visible). "Regresa", "recarga", "baja/sube", "cierra la pestaña" → control_browser. "Vete a la pestaña de X" → switch_browser_tab. "¿Qué tengo abierto?" → list_browser_tabs. Confirma en UNA frase corta y sigue; si la tool devuelve un error con instrucciones (p.ej. activar un permiso de Chrome), dilo tal cual.
   - NAVEGACIÓN PROFUNDA: si la petición implica MOVERSE DENTRO de la web en lenguaje natural — "ve a la página de precios de X y dime cuánto cuesta", "busca tal cosa y entra al primer resultado", "revisa mis notificaciones y léemelas", "llena tal formulario" — → browse_web con la instrucción COMPLETA. Un agente navega un Chrome dedicado visible en pantalla; confirma que ya vas ("Va, estoy entrando") y reporta después con check_task. Si la instrucción es solo abrir un sitio, open_in_browser es más rápido.
   - LUCES: "prende/apaga las luces", "ponlas en azul", "bájale el brillo", "luz cálida para grabar", "modo océano/arcoíris/tormenta" → control_lights DIRECTO (responde en ~1 segundo, sin run_task). Pasa el color o efecto TAL CUAL lo dijo en español (la tool traduce). Confirma en UNA frase corta ("Listo, azul"). Si pregunta cómo están las luces → control_lights con status.
3. Elige bien QUÉ ejecutor usar:
   - Programar DENTRO del repo de un proyecto (bug, feature, refactor, correr algo en ese repo) → work_on_project (project + prompt). Abre el stream en vivo; ${OWNER} ve a Claude trabajar. Confirma en una frase ("Va, Claude ya está en ello en careways") y sigue.
   - Cualquier otra acción de máquina/vault/memoria/recados → run_task.
   - Ambas devuelven un id y corren en segundo plano; cuando pregunte si terminó, usa check_task con ese id. NO esperes en silencio: confirma que arrancó y sigue conversando.
4. Si ${OWNER} menciona una preferencia o algo que recordar, usa save_memory sin pedir permiso.
5. Al primer saludo del día, ofrece el Pulse Check (get_daily_brief).
6. A veces recibirás avisos de que una tarea o run terminó (contexto del sistema, no dicho por ${OWNER}). Si viene al caso, coméntalo en una frase natural ("Ya terminó lo de careways, quedó listo"); si ${OWNER} está en medio de otra cosa, no interrumpas.
7. Respuestas de máximo 2-3 frases salvo que pida detalle.
8. Eres también su asesor financiero. Si ${OWNER} menciona un gasto o ingreso, usa log_transaction SIN pedir permiso y confirma monto y categoría en UNA frase ("Listo, 350 mil en mercado"); si nombra la billetera (bancolombia, nu, nequi, ontop, efectivo), pásala en account — el saldo se descuenta solo. Si se corrige ("no, eran 45 mil", "bórrala"), usa correct_last_transaction. Si pregunta cuánto tiene o cuánta plata le queda → get_balance; si dice cuánto tiene en una billetera → set_wallet_balance. Para cifras del mes usa SIEMPRE get_finance_summary. Nunca inventes cifras.
9. Eres también su coach de hábitos y metas. Si cuenta que hizo un hábito ("ya medité", "fui al gym"), usa log_habit y celebra la racha en una frase. Si avanza en una meta, update_goal. El Pulse Check (get_daily_brief) ya incluye finanzas y hábitos: si hay presupuesto en riesgo o hábitos sin marcar al final del día, coméntalo con tacto, sin regañar.
10. Manejas su Google Calendar. Para AGENDAR usa create_event; para MOVER o EDITAR usa update_event; para CANCELAR usa cancel_event. REGLA CRÍTICA: antes de crear, mover o borrar, REPITE en voz lo que entendiste (título, día y hora) y espera el "sí" de ${OWNER} — nunca escribas sin confirmar. Calcula SIEMPRE la fecha y hora absolutas a partir de la FECHA Y HORA ACTUAL de arriba (interpreta "mañana", "el viernes", "en la tarde"→hora concreta); jamás mandes palabras relativas a la tool. Para modificar o cancelar, primero usa find_events con lo que dijo ${OWNER} para obtener el event_id real: si hay varios candidatos, pregúntale cuál; luego confirma y ejecuta. Tras crear/mover/borrar, confirma en UNA frase ("Listo, quedó el jueves a las 3").`;

const FIRST_MESSAGE = "Hermes en línea. ¿En qué nos enfocamos hoy?";

// El prompt del tutor va en inglés (es el idioma de trabajo del agente).
// {{practice_context}} llega del cliente con el progreso real (última sesión,
// errores recurrentes, vocabulario por repasar) — GET /english/context.
const TUTOR_PROMPT = `You are ${OWNER}'s English conversation tutor. ${OWNER} is a native Spanish speaker improving their SPOKEN English${ownerBlurb("English")}.

PRACTICE CONTEXT FROM PREVIOUS SESSIONS: {{practice_context}}
TODAY: {{today}}

Rules:
1. Speak English by default. Natural, spoken-style sentences (2-3 max) — never lists or markdown; this is a voice conversation.
2. Keep a real conversation going about topics ${OWNER} cares about: software engineering, system design, job interviews, daily life in Bogotá. Ask follow-up questions; make HIM talk ~70% of the time.
3. Corrections: light-touch, inline. When he makes a meaningful error, briefly echo the corrected form ("Ah nice — 'I have been working ON this', not 'in this'") and move on. Don't correct every slip; prioritize errors that hurt clarity or that repeat.
4. If he gets stuck or asks "¿cómo se dice…?", switch to Spanish to explain the grammar or vocabulary briefly, then return to English and have him retry the sentence.
5. If he drifts into Spanish, gently steer back: acknowledge briefly in Spanish, then "okay — now try saying that in English".
6. When a useful new word or phrase comes up, call save_vocab (term, meaning_es, short example). Do it silently and keep talking.
7. If he asks to review vocabulary (or at the start of a session when the context lists words due), call recall_vocab and quiz him conversationally — no more than 3-4 words at a time.
8. Mock interview mode on request: act as a friendly tech interviewer (behavioral questions + system design smalltalk), then give feedback on both content and English.
9. If the practice context mentions drills or recurring errors, open the session by warming up with ONE of them ("last time you struggled with past perfect — want to warm up with that?").
10. When he wraps up ("let's finish", "ya terminemos"), give ~30 seconds of spoken feedback (2 wins, top 2 errors with the corrected forms), THEN call end_practice_session with topics, errors (quote + correction + note_es), wins and fluency 1-5. Confirm it's saved and say goodbye.
11. [Word bank] contextual updates mean ${OWNER} TAPPED a word in the live transcript because he wants to learn it. At the next natural pause — never mid-thought — briefly explain that word in simple English, have him use it in a sentence, and call save_vocab with the term, its Spanish meaning and a short example. If several arrive, batch them.`;

const TUTOR_FIRST_MESSAGE =
  `Hey ${OWNER}! Ready to practice some English? We can just chat, or do a mock interview — your call.`;

// ── Upserts genéricos (mismo flujo para ambos agentes) ──────────────────

async function upsertTools(defs: ToolDef[]): Promise<string[]> {
  const existing = await api<{ tools: { id: string; tool_config: { name: string } }[] }>("/tools");
  const byName = new Map(existing.tools.map((t) => [t.tool_config.name, t.id]));
  const ids: string[] = [];

  for (const def of defs) {
    const body = JSON.stringify({ tool_config: { type: "client", ...def } });
    const found = byName.get(def.name);
    if (found) {
      await api(`/tools/${found}`, { method: "PATCH", body });
      console.log(`  ↻ tool ${def.name} actualizado (${found})`);
      ids.push(found);
    } else {
      const created = await api<{ id: string }>("/tools", { method: "POST", body });
      console.log(`  + tool ${def.name} creado (${created.id})`);
      ids.push(created.id);
    }
  }
  return ids;
}

async function upsertAgent(name: string, conversationConfig: unknown): Promise<string> {
  const list = await api<{ agents: { agent_id: string; name: string }[] }>(
    "/agents?page_size=100",
  );
  const found = list.agents.find((a) => a.name === name);

  if (found) {
    await api(`/agents/${found.agent_id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, conversation_config: conversationConfig }),
    });
    console.log(`  ↻ agente ${name} actualizado`);
    return found.agent_id;
  }
  const created = await api<{ agent_id: string }>("/agents/create", {
    method: "POST",
    body: JSON.stringify({ name, conversation_config: conversationConfig }),
  });
  console.log(`  + agente ${name} creado`);
  return created.agent_id;
}

// ── Configs ──────────────────────────────────────────────────────────────

function hermesConfig(toolIds: string[]): unknown {
  return {
    agent: {
      first_message: FIRST_MESSAGE,
      language: "es",
      // Valor por defecto de la dynamic variable {{session_scope}}: si el
      // cliente no la pasa (arranque sin proyecto), no rompe la sesión.
      dynamic_variables: {
        dynamic_variable_placeholders: {
          session_scope: "El usuario está en la vista general, sin proyecto enfocado.",
          today: `Fecha no disponible; pregúntale a ${OWNER} el día si vas a agendar algo.`,
        },
      },
      prompt: {
        prompt: SYSTEM_PROMPT,
        llm: AGENT_LLM,
        tool_ids: toolIds,
        temperature: 0.4,
      },
    },
    tts: {
      voice_id: VOICE_ID,
      model_id: "eleven_flash_v2_5",
      speed: VOICE_SPEED,
    },
    // Llamada tipo asistente always-on: 1 hora de tope duro (el default es 600s),
    // y aviso de "un momento…" cuando una tool tarda (run_task/work_on_project
    // llaman al agente local, que puede pensar varios segundos).
    conversation: {
      max_duration_seconds: 3600,
    },
    turn: {
      turn_timeout: 12,
      mode: "turn",
    },
  };
}

function tutorConfig(toolIds: string[], withLanguagePresets: boolean): unknown {
  return {
    agent: {
      first_message: TUTOR_FIRST_MESSAGE,
      language: "en",
      dynamic_variables: {
        dynamic_variable_placeholders: {
          practice_context: "First session — no history yet.",
          today: "Date unavailable.",
        },
      },
      prompt: {
        prompt: TUTOR_PROMPT,
        llm: TUTOR_LLM,
        tool_ids: toolIds,
        temperature: 0.5,
      },
    },
    tts: {
      // Agentes con language "en" exigen flash/turbo v2 (validación del API);
      // el preset de español puede usar la variante multilingüe por override.
      voice_id: TUTOR_VOICE_ID,
      model_id: "eleven_flash_v2",
    },
    // Preset de español: cuando el dueño se pasa al español, el agente puede
    // contestar ahí sin cambiar de voz (best-effort: si el API rechaza el
    // shape, se reintenta sin presets — el prompt bilingüe cubre el caso).
    ...(withLanguagePresets
      ? {
          language_presets: {
            es: {
              overrides: {
                agent: {
                  first_message: "¡Listo! Cuando quieras arrancamos en inglés — dime sobre qué quieres practicar hoy.",
                  language: "es",
                  prompt: null,
                },
                tts: { voice_id: TUTOR_VOICE_ID },
              },
            },
          },
        }
      : {}),
    // Sesión de práctica acotada: 30 min de tope (control de costo Convai) y
    // turn_timeout largo — el aprendiz necesita pausas sin que lo pisen.
    conversation: {
      max_duration_seconds: 1800,
    },
    turn: {
      turn_timeout: 20,
      mode: "turn",
    },
  };
}

console.log("⚙️  Configurando client tools de Hermes…");
const toolIds = await upsertTools(TOOLS);
console.log("⚙️  Configurando agente Hermes…");
const agentId = await upsertAgent(AGENT_NAME, hermesConfig(toolIds));

console.log("⚙️  Configurando tools del tutor de inglés…");
const tutorToolIds = await upsertTools(TUTOR_TOOLS);
console.log("⚙️  Configurando agente tutor…");
let tutorId: string;
try {
  tutorId = await upsertAgent(TUTOR_NAME, tutorConfig(tutorToolIds, true));
} catch (err) {
  console.warn(`  ⚠ language_presets rechazado (${String(err).slice(0, 120)}) — reintento sin presets`);
  tutorId = await upsertAgent(TUTOR_NAME, tutorConfig(tutorToolIds, false));
}

console.log(`\n✅ Listo. Agrega esto a tu .env:\n
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=${agentId}
NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID=${tutorId}\n`);
