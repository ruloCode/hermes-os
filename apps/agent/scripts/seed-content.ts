/**
 * Seed del ESTUDIO: las 20 piezas del mes 1 de la estrategia de marca
 * personal 2026 (vault: projects/rulocode/docs/estrategia-marca-personal-2026.md),
 * la sesión batch #1 y el radar (tendencias + referentes de la investigación
 * 2026-07-23). Idempotente por local_key — re-correrlo re-escribe los campos
 * sembrados de esas mismas filas, no duplica.
 *
 *   pnpm --filter @hermes/agent seed:content
 */
import {
  createPiece,
  createSession,
  saveRef,
  type CreatePieceInput,
} from "../src/content/store.js";

// Horas Bogotá (-05): 12:30 → 17:30Z · 8:00 → 13:00Z · 10:00 → 15:00Z.

const PILAR1_SCRIPT = `## Hook (0:00–0:15)

«Esto no es una demo de ChatGPT. **[DEMO: pinza → click]** Estoy controlando mi computador con la mano. **[DEMO: voz → "agéndame la reunión"]** Y también le hablo. Lo construí yo — y en este video te lo muestro por dentro.»

## Contexto (0:15–1:30)

Qué es Hermes: mi sistema operativo agéntico personal. Por qué lo construí (cansado de herramientas sueltas). Qué vas a ver: 3 demos + cómo está hecho. **[B-ROLL: dashboard AGENTIC OS]**

## 3 demos (1:30–8:00)

1. **Voz** — agenda una reunión real, consulta finanzas. **[DEMO EN VIVO]**
2. **Gestos** — cursor con la mano, copiar/pegar en el aire, Mission Control con la palma. **[DEMO EN VIVO]**
3. **Copiloto de juntas** — la IA me sopla la respuesta en ~2 segundos. **[PANTALLA: Junta EN VIVO]**

## Cómo está hecho (8:00–11:00)

Arquitectura en 3 min: agentes (Claude SDK), voz (ElevenLabs), visión (MediaPipe). Honestidad: qué se rompió, cuánto cuesta al mes. **[PANTALLA: grafo 3D del código]**

## CTA (11:00–12:00)

«En el próximo video te muestro cómo construyo una feature completa con agentes — el prompt, los errores y la factura. Si quieres verlo, suscríbete. Y cuéntame en comentarios: ¿qué automatizarías tú primero?»`;

const PIECES: CreatePieceInput[] = [
  // ── Semana 1 (27 jul – 2 ago) — "El Jarvis existe" (P1)
  { title: "Controlo mi computador con la mano (lo construí yo)", pillar: "p1", platforms: ["tiktok", "reels"], format: "vertical", status: "guion", publishAt: "2026-07-27T17:30:00Z", weekLabel: "M1·S1", hook: "Esto no es CGI: pinza = click. Lo construí yo." },
  { title: "La demo de gestos con hook profesional (LinkedIn)", pillar: "p5", platforms: ["linkedin"], format: "vertical", status: "idea", publishAt: "2026-07-28T13:00:00Z", weekLabel: "M1·S1" },
  { title: "Le hablo a mi computador y me agenda las reuniones", pillar: "p1", platforms: ["tiktok", "reels"], format: "vertical", status: "idea", publishAt: "2026-07-29T17:30:00Z", weekLabel: "M1·S1" },
  { title: "3 aprendizajes construyendo mi propio Jarvis", pillar: "p2", platforms: ["linkedin"], format: "post", status: "idea", publishAt: "2026-07-30T13:00:00Z", weekLabel: "M1·S1" },
  { title: "Mi código es una galaxia 3D y la muevo con las manos", pillar: "p1", platforms: ["tiktok", "shorts"], format: "vertical", status: "idea", publishAt: "2026-07-31T17:30:00Z", weekLabel: "M1·S1" },
  { title: "Construí mi propio JARVIS y controla mi computador", pillar: "p1", platforms: ["youtube"], format: "pilar", status: "guion", publishAt: "2026-08-01T15:00:00Z", weekLabel: "M1·S1", hook: "Esto no es una demo de ChatGPT: estoy controlando mi computador con la mano.", scriptMd: PILAR1_SCRIPT },
  // ── Semana 2 (3 – 9 ago) — "El copiloto" (P1→P2)
  { title: "Construí un copiloto que me sopla en las reuniones", pillar: "p1", platforms: ["tiktok", "reels"], format: "vertical", status: "idea", publishAt: "2026-08-03T17:30:00Z", weekLabel: "M1·S2" },
  { title: "El copiloto de reuniones: cuánto vale no perder ningún acuerdo", pillar: "p3", platforms: ["linkedin"], format: "vertical", status: "idea", publishAt: "2026-08-04T13:00:00Z", weekLabel: "M1·S2" },
  { title: "Mi tutor de inglés es una IA y me corrige en tiempo real", pillar: "p1", platforms: ["tiktok"], format: "vertical", status: "idea", publishAt: "2026-08-05T17:30:00Z", weekLabel: "M1·S2" },
  { title: "5 cosas que un agente de IA ya hace en mi día a día", pillar: "p5", platforms: ["linkedin"], format: "carrusel", status: "idea", publishAt: "2026-08-06T13:00:00Z", weekLabel: "M1·S2" },
  { title: "Le pedí a mi agente que trabajara mientras iba al gym", pillar: "p2", platforms: ["tiktok"], format: "vertical", status: "idea", publishAt: "2026-08-07T17:30:00Z", weekLabel: "M1·S2" },
  // ── Semana 3 (10 – 16 ago) — "Así se construye con agentes" (P2)
  { title: "Un agente escribió esta feature: qué hizo bien y qué no", pillar: "p2", platforms: ["linkedin"], format: "vertical", status: "idea", publishAt: "2026-08-11T13:00:00Z", weekLabel: "M1·S3" },
  { title: "Mi agente encontró y arregló un bug solo", pillar: "p2", platforms: ["tiktok"], format: "vertical", status: "idea", publishAt: "2026-08-12T17:30:00Z", weekLabel: "M1·S3" },
  { title: "Caso NevadaTech: automatizamos un proceso — costo y ahorro reales", pillar: "p3", platforms: ["linkedin"], format: "post", status: "idea", publishAt: "2026-08-13T13:00:00Z", weekLabel: "M1·S3" },
  { title: "¿Cuánto cuesta tener tu propio Jarvis? (mi factura)", pillar: "p1", platforms: ["tiktok"], format: "vertical", status: "idea", publishAt: "2026-08-14T17:30:00Z", weekLabel: "M1·S3" },
  { title: "Así construyo software REAL con agentes de IA (Claude Code)", pillar: "p2", platforms: ["youtube"], format: "pilar", status: "idea", publishAt: "2026-08-15T15:00:00Z", weekLabel: "M1·S3", hook: "Un agente escribió esta feature de inicio a fin. Te muestro el prompt, los errores y la factura." },
  // ── Semana 4 (17 – 23 ago) — "Automatización de verdad" (P3) + cierre
  { title: "Automaticé mis finanzas y las consulto por voz", pillar: "p1", platforms: ["tiktok"], format: "vertical", status: "idea", publishAt: "2026-08-17T17:30:00Z", weekLabel: "M1·S4" },
  { title: "n8n no es solo para juguetes: así se ve en producción", pillar: "p3", platforms: ["linkedin"], format: "vertical", status: "idea", publishAt: "2026-08-18T13:00:00Z", weekLabel: "M1·S4" },
  { title: "Edito mis videos con agentes de IA", pillar: "p4", platforms: ["tiktok"], format: "vertical", status: "idea", publishAt: "2026-08-19T17:30:00Z", weekLabel: "M1·S4" },
  { title: "El stack completo de mi asistente personal", pillar: "p2", platforms: ["linkedin"], format: "carrusel", status: "idea", publishAt: "2026-08-20T13:00:00Z", weekLabel: "M1·S4" },
];

const TENDENCIAS = [
  { title: "El híbrido long-form + Shorts crece ~3x más rápido el primer año", body: "YouTube 2026 premia 'satisfacción sostenida': 100% visto de 8 min > 40% de 25 min. Canal nuevo solo-long-form crece lento 3-6 meses.", metric: "~3x", source: "OutlierKit · Miraflow (direccional)", applyStatus: "aplicado" as const },
  { title: "Duración ideal TikTok: hook-valor-payoff con finalización alta", body: "La tasa de finalización es la métrica #1 del algoritmo. En Reels el loop de 7-15s cuenta >100% de retención.", metric: "24–38s", source: "ScrollScript · Dash Social", applyStatus: "aplicado" as const },
  { title: "Video vertical subtitulado + documentos PDF: los formatos #1 de LinkedIn", body: "Video +53% en 2025; PDF ~6.6% engagement. Los devs hispanos no están ahí. Link externo en el cuerpo = −19% reach.", metric: "+53%", source: "Cyberclick · Dataslayer · AuthoredUp", applyStatus: "aplicado" as const },
  { title: "En X los replies con sustancia pesan ~15x más que likes", body: "Regla 70/30 para cuentas nuevas: 70% conversación en el nicho, 30% posts propios. Links en reply, nunca en el post.", metric: "15x", source: "SocialPilot · Teract · SocialRails", applyStatus: "aplicado" as const },
  { title: "El mega-tutorial monolítico sigue siendo el rey del SEO hispano", body: "'Curso completo de X en 4-6h' domina resultados — y sobre Claude Code no hay dueño. Barrera de entrada alta = foso.", metric: "4–6h", source: "Resultados YouTube es · plan: mes 3", applyStatus: "probar" as const },
  { title: "Quality CTR: el thumbnail que sobrepromete ahora se penaliza", body: "CTR alto + abandono en 15-30s baja la distribución. CTR sano bajo 1.000 subs: 6-10%.", metric: "6–10%", source: "ThumbMagic · Humble & Brag", applyStatus: "observar" as const },
  { title: "1 hora de material batch ≈ 5-10 clips publicables", body: "El auto-clipping de IA rinde peor en contenido de pantalla/código que en talking-head — curar a mano qué sale.", metric: "5–10", source: "Askube · Skywork · reviews OpusClip", applyStatus: "aplicado" as const },
];

const REFERENTES = [
  { title: "midudev", metric: "205K Twitch · #1 dev es", body: "COPIAR la máquina directo → clips → shorts → evento propio. EVITAR su volumen: es cadencia de full-timer." },
  { title: "Ringa Tech", metric: "+8%/mes", body: "COPIAR IA práctica con proyecto real por video — el nicho que acelera. EVITAR quedarse en nivel intro." },
  { title: "Pelado Nerd", metric: "~180K", body: "COPIAR ser dueño de UN nicho técnico siendo practicante en activo. EVITAR diluirse en temas generales." },
  { title: "HolaMundo", metric: "834K YT · 13K TikTok", body: "COPIAR opinión con personalidad. EVITAR su error: la autoridad NO se transfiere — cada red exige formato nativo." },
  { title: "Xavier Mitjana", metric: "200K+", body: "COPIAR constancia semanal en IA aplicada. EVITAR competir en noticias: tu ángulo es ingeniería." },
  { title: "Víctor Robles / Basdonax", metric: "nicho n8n", body: "COPIAR monetización curso/agencia sin depender de ads. EVITAR el ángulo 'vende agentes' sin profundidad." },
];

const GUARDADAS = [
  { title: "Hook «esto no es CGI»", body: "Patrón de apertura para demos de gestos", pillar: "p1" as const },
  { title: "Estructura «la factura del proyecto»", body: "Transparencia de costos como gancho de retención — aplicar en la pieza del costo del Jarvis", pillar: "p1" as const },
];

async function main() {
  let ok = 0;
  for (const p of PIECES) {
    const saved = await createPiece(p);
    if (saved) ok++;
    else console.error(`  ✗ pieza: ${p.title}`);
  }
  console.log(`piezas: ${ok}/${PIECES.length}`);

  const session = await createSession({
    title: "Batch #1 — pilar Jarvis + 3 verticales semana 1",
    scheduledAt: "2026-07-25T14:00:00Z",
    checklist: [
      { label: "Guion pilar #1 listo", done: true },
      { label: "Grabar pilar #1 — 5 demos + narración", done: false },
      { label: "Grabar 3 verticales semana 1", done: false },
      { label: "Equipo: mic · OBS 4K · luz · espacio en disco", done: false },
    ],
    folder: "~/Grabaciones/rulocode/2026-07-25-batch1",
  });
  console.log(`sesión: ${session ? "ok" : "✗"}`);

  let refs = 0;
  for (const t of TENDENCIAS) if (await saveRef({ kind: "tendencia", ...t })) refs++;
  for (const r of REFERENTES) if (await saveRef({ kind: "referente", ...r })) refs++;
  for (const g of GUARDADAS) if (await saveRef({ kind: "guardada", ...g })) refs++;
  console.log(`radar: ${refs}/${TENDENCIAS.length + REFERENTES.length + GUARDADAS.length}`);
}

main().then(() => process.exit(0));
