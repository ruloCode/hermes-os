# X + noticias tech en Hermes — terreno, costos y diseño

> Investigado el 2026-08-27. El terreno de X cambió DOS veces este año y las dos
> veces en contra de lo gratis: hay que decidir con números, no con supuestos.

## TL;DR

1. **La ruta gratis de scraping está muerta y es peligrosa.** X Corp mandó
   cease-and-desist el **24 de agosto de 2026** y tumbó Nitter y xcancel — las
   dos fuentes de las que colgaban todos los "RSS de Twitter". Cualquier
   proveedor tercero barato (twitterapi.io, socialdata, getxapi) usa exactamente
   la técnica que X acaba de declarar ilegal. **No integramos scrapers.**
2. **La API oficial ya no tiene plan gratis ni Basic/Pro nuevos.** Desde el
   **6 de febrero de 2026** es pay-per-use con créditos: **$0.005 por post
   leído**, sin mínimo de compra, tope de 3M posts/mes.
3. **El hallazgo que cambia el diseño**: `GET /2/news/search` devuelve las
   noticias YA agrupadas y resumidas por X (título, `hook`, `summary`,
   entidades, tickers y los post ids del clúster). **No aparece en la tabla de
   recursos facturables** — hay que verificarlo contra el balance de créditos,
   pero si se confirma, una sola llamada trae 100 historias por ~$0.
4. **Recomendación**: híbrido de 3 capas. Capa 0 gratis (Techmeme + HN +
   blogs oficiales) como base, `news/search` como la vista de X, y post reads
   solo bajo demanda. **~$15-25/mes con tope duro**, no $200.

---

## 1. El terreno real (agosto 2026)

### 1.1 Precios oficiales (verificados en `docs.x.com/x-api/getting-started/pricing`)

| Recurso | Costo |
| --- | --- |
| **Post: Read** | $0.005 por recurso |
| **List: Read** | $0.005 por recurso |
| **User: Read** | $0.010 por recurso |
| **Note: Read** | $0.005 por recurso |
| **Like: Read** | $0.001 por recurso |
| **Owned Reads** (tus posts, bookmarks, likes, listas propias) | **$0.001 por recurso** |
| Post: Create | $0.015 por request |
| **Post: Create (con URL)** | **$0.200 por request** |
| Trends | $0.010 por request |

Detalles que importan:

- **Sin mínimo de compra, sin suscripción.** Créditos prepagados en la consola
  de desarrollador, se descuentan en tiempo real. Auto-recarga configurable
  (dejarla **apagada** hasta medir consumo real).
- **Dedupe de 24 h UTC**: pedir el mismo post dos veces el mismo día cobra una
  sola vez. Esto hace que pollear seguido sea mucho más barato de lo que parece
  — el costo lo marca el volumen de posts *únicos*, no el número de llamadas.
- **Tope de 3M post reads/mes** en pay-per-use (irrelevante para nosotros).
- Los planes **Basic ($200/mes) y Pro ($5.000/mes) ya no se pueden contratar**;
  sobreviven solo para quien ya estaba suscrito. Enterprise arranca ~$42k/mes.
- Comprar créditos de X devuelve **hasta 20% en créditos de la API de xAI**.

> ⚠️ **Para el pipeline de auto-publicación del Estudio**: publicar en X con un
> link cuesta **$0.20**, 13× más que un post sin link ($0.015). Si algún día
> auto-publicamos a X, el link va aparte o se asume el costo a ojos abiertos.

### 1.2 Lo que se murió hace tres días

- **24-26 de agosto de 2026**: X Corp envía cease-and-desist a Nitter exigiendo
  el takedown permanente del proyecto y sus repos. Cae Nitter y cae
  **xcancel.com** (la única instancia con RSS que quedaba viva). Sobrevive una
  instancia en Singapur.
- La acusación de X: "circunvenir ilegalmente los sistemas de X para scrapear
  datos y acceder a cuentas y session tokens".
- **Consecuencia directa para nosotros**: todo el ecosistema de "RSS de Twitter
  gratis" (RSS-Bridge, twiiit, feeds de nitter) queda roto o en la mira. Y los
  proveedores terceros que cobran $0.04-$0.20 por 1.000 tweets hacen
  **exactamente lo mismo que Nitter**, solo que cobrando. Meterlos en Hermes es
  construir sobre algo que acaba de recibir un C&D público.

**Decisión: cero scrapers.** El ahorro (~$20/mes) no paga el riesgo de que la
integración se caiga sola en un mes ni el de asociar tu cuenta real a un
proveedor que scrapea.

---

## 2. El hallazgo: `GET /2/news/search`

X expone un endpoint de **noticias**, no de posts sueltos:

```
GET https://api.x.com/2/news/search
  ?query=...            (1-2048 chars, operadores de búsqueda)
  &max_results=100      (1-100, default 10)
  &max_age_hours=24     (1-720, default 168)
  &news.fields=contexts,cluster_posts_results
```

Devuelve objetos `News` ya procesados:

```jsonc
{
  "category": "News",
  "name": "Nebius Group Stock Plunges 30% Despite Q3 Revenue Surge and Meta Deal",
  "hook": "Nebius Group's shares cratered 30% after blockbuster Q3 earnings…",
  "summary": "Nebius Group announced third-quarter revenue of $214 million…",
  "contexts": { "entities": { "organizations": [...], "people": [...], "products": [...] },
                "topics": ["Stocks"], "finance": { "tickers": ["NBIS"] } },
  "cluster_posts_results": [ { "post_id": "1989409257394245835" }, … ],
  "updated_at": "…"
}
```

Por qué esto es el diseño correcto y no leer timelines:

- **Una llamada = 100 historias con resumen.** Leer lo mismo por timeline serían
  cientos de post reads a $0.005 c/u.
- Trae **el clúster de posts fuente**, así que el drill-down ("muéstrame qué
  dijeron") es una decisión posterior y cobrada solo cuando la tomas.
- Acepta **app-auth** (bearer token, sin conectar cuenta) y **user-auth**
  (OAuth 1.0a / OAuth 2.0 PKCE).
- **No figura en la tabla de recursos facturables.** Lo único "news" facturado
  es el webhook `news.new` ($0.005/evento). **Verificar empíricamente**: comprar
  $5 de créditos, hacer 10 llamadas, mirar el balance. Si cobra, seguirá siendo
  el camino más barato; si no cobra, es prácticamente gratis.

---

## 3. Arquitectura propuesta — 3 capas

### Capa 0 — Base gratis, sin X (verificada hoy: ambas responden 200)

| Fuente | Cómo | Qué aporta |
| --- | --- | --- |
| **Techmeme** | `https://www.techmeme.com/feed.xml` | La portada editada de la industria. Si algo importa, está acá en <1 h. |
| **Hacker News** | `https://hn.algolia.com/api/v1/search?tags=front_page` | JSON gratis, sin key, sin rate limit práctico. La lectura de ingenieros. |
| **Blogs oficiales (RSS)** | OpenAI, Anthropic, Google DeepMind, Meta AI, Mistral, Hugging Face, Vercel, Cursor | La fuente primaria. Un release aparece acá y en X al mismo tiempo. |
| **GitHub Trending** | scrape propio del HTML público o `gh api search/repositories` | Señal temprana de tooling, que es TU nicho. |
| **arXiv** | `export.arxiv.org/api/query?search_query=cat:cs.AI` | Papers antes de que lleguen a X. |
| **Changelogs** | releases de anthropics/claude-code, openai, cursor vía GitHub API | Cambios de las herramientas de las que hablas. |

Esto cubre honestamente el **~80% de "enterarse"** por **$0** y **cero riesgo**.
Lo que NO cubre: la reacción, el contexto y las cosas que solo se dicen en X.

### Capa 1 — X sin conectar tu cuenta (app-auth)

`GET /2/news/search` con bearer token de la app, corriendo en el job cada 30-60
min con `max_age_hours=6` y queries por tema:

```
"AI OR LLM OR agents", "Anthropic OR Claude", "OpenAI", "coding agents OR Cursor",
"startups funding", "semiconductors OR Nvidia"
```

Esto es **la vista de X sobre las noticias**, ya clusterizada. Es lo que resuelve
tu pedido literal ("enterarme lo más pronto posible").

### Capa 2 — Conectar @rulo_code (OAuth 2.0 PKCE, user-auth)

Lo que se desbloquea al conectar la cuenta de verdad:

| Endpoint | Qué da | Costo |
| --- | --- | --- |
| `GET /2/users/{id}/timelines/reverse_chronological` | Tu home timeline real | $0.005/post |
| `GET /2/lists/{id}/tweets` | Una **Lista curada** que tú controlas | $0.005/post |
| `GET /2/users/{id}/bookmarks` | **Tus bookmarks** | **$0.001** (owned read) |
| `GET /2/users/{id}/tweets` | Tus propios posts + métricas | **$0.001** (owned read) |

**El caso de uso más rentable no es leer noticias, son tus bookmarks.** Guardas
algo desde el celular → Hermes lo ingiere a la capa de conocimiento → se
convierte en referencia del **radar del Estudio** → sale una pieza. Eso es
$0.001 por bookmark: 200 bookmarks al mes cuestan **$0.20**.

Segundo: tus propios posts a $0.001 alimentan el bucle de resultados que ya
existe para YouTube (`content_metrics`), con X como otra red medida de verdad.

---

## 4. Números, no sensaciones

Escenario recomendado (mensual, 30 días):

| Concepto | Volumen | Costo/mes |
| --- | --- | --- |
| Capa 0 (Techmeme, HN, blogs, GitHub, arXiv) | ilimitado | **$0** |
| `news/search` × 6 queries × 24 corridas/día | 4.320 llamadas | **$0** (a verificar) |
| Lista curada, 1 lectura/día, `max_results=100` | ~3.000 posts únicos | **$15** |
| Bookmarks (owned read) | 200 | **$0.20** |
| Tus posts + métricas (owned read) | 300 | **$0.30** |
| Drill-down bajo demanda (~4 historias/día × 8 posts) | ~960 posts | **$4.80** |
| **Total** | | **≈ $20/mes** |

Modo austero (sin la lectura diaria de la Lista): **≈ $5/mes**.
Techo duro: comprar **$25 de créditos, auto-recarga APAGADA**. Si se acaban, la
integración degrada a Capa 0 sola y sigue funcionando — no se rompe nada.

Contraste: Basic era $200/mes y ya ni se puede contratar.

---

## 5. Lo que depende de ti (yo no lo puedo hacer)

1. Entrar a `developer.x.com` con @rulo_code y crear un **Project + App**.
2. Comprar **$25 en créditos** en `console.x.com`, **auto-recarga apagada**.
3. Copiar al `.env` de la raíz:
   ```
   X_BEARER_TOKEN=            # app-auth → news/search
   X_CLIENT_ID=               # OAuth2 PKCE → conectar tu cuenta
   X_CLIENT_SECRET=
   X_REDIRECT_URI=http://localhost:8650/x/callback
   X_LIST_ID=                 # la Lista curada (ver §7)
   NEWS_BUDGET_USD_MONTH=25   # tope duro del lado nuestro
   ```
4. Crear la **Lista curada** en X con las cuentas del mapa (§7) y pegar su id.
5. Vincular tu equipo de xAI en la consola para cobrar el 20% de vuelta.

El paso 1 y 2 son de tu cuenta y de tu tarjeta: no los toco.

---

## 6. Encaje en Hermes

Sigue el patrón `english/` y `content/`: módulo propio + store + job + rutas +
tools + capa de conocimiento.

```
apps/agent/src/news/
  sources.ts   # Capa 0: Techmeme RSS, HN Algolia, blogs, GitHub, arXiv
  x.ts         # Capa 1/2: news/search, lists, bookmarks, OAuth2 PKCE + refresh
  store.ts     # upsert + dedupe + embeddings + presupuesto gastado
  rank.ts      # scoring puro (testeable, sin red) — ver abajo
  digest.ts    # patrón english/report.ts: Agent SDK resume el día en español
```

**Migración 025** (`supabase/migrations/025_news.sql`):

- `news_items` — `id`, `source` (`techmeme|hn|blog|github|arxiv|x-news|x-list|x-bookmark`),
  `remote_id`, `url` (único), `title`, `summary`, `hook`, `author`, `entities` jsonb,
  `topics` text[], `published_at`, `score` real, `embedding vector(1536)`,
  `read_at`, `saved_at`, `dismissed_at`.
- `news_digests` — resumen diario en español (`day`, `md`, `item_ids`).
- `news_budget` — `month`, `spent_usd`, `reads` (el gasto de X medido por
  nosotros, no adivinado).
- **Extender `match_knowledge`**: agregar `'news'` a `KnowledgeSource`
  (`packages/shared/src/types.ts:25`) y a la UNION del RPC, para que una noticia
  guardada sea buscable junto a reuniones, vault y ejecuciones.

**Job** (`registerJob` en `index.ts`, junto a los otros seis):

```ts
registerJob("news-sync", 30 * 60_000, syncNews, (r) =>
  r.fetched ? `${r.fetched} nuevas · ${r.sources} fuentes · $${r.spent.toFixed(2)} mes` : null);
```

Degrada solo: si no hay `X_BEARER_TOKEN`, corre Capa 0 y devuelve `skipped` para
las de X. Si el presupuesto se agotó, salta X sin error. Un fallo de una fuente
no tumba a las demás (`Promise.allSettled`, como `/dashboard`).

**Rutas**: `GET /news/feed?topic=&since=` · `GET /news/digest?day=` ·
`POST /news/refresh` · `POST /news/items/:id/save|dismiss` ·
`POST /news/items/:id/idea` (→ pieza de contenido) · `GET /x/connect` +
`GET /x/callback` (OAuth2 PKCE) · `GET /news/budget`.

**Tools del Agent SDK** (`mcp__hermes__*`, para que la VOZ responda):

- `get_tech_news({ topic?, hours?, limit? })` — "¿qué pasó hoy en IA?"
- `search_tech_news({ query })` — semántica sobre `news_items`.
- `explain_story({ id })` — drill-down: trae el clúster de posts (acá y solo acá
  se gastan post reads).
- `save_as_content_idea({ id, hypothesis })` — reusa `create_content_idea`.

**Brief**: una sección más en `buildDailyBrief()` (`apps/agent/src/brief.ts`),
3 titulares del día. Sin datos, se omite — como las otras.

**Ranking** (`rank.ts`, lógica pura con tests, patrón `script-beats.ts`):
`score = frescura × relevancia_semántica_a_tus_proyectos × diversidad_de_fuente`.
La relevancia sale de comparar el embedding de la noticia contra el de tus
proyectos activos del vault. Traducción: **una noticia de coding agents te sube
sola por encima de una de stocks**, sin reglas escritas a mano.

**UI**: panel **RADAR TECH** en el riel derecho (patrón `ContextRail`: sin polls
nuevos, entra por el agregador `/dashboard`), con 5 titulares y "N sin leer".
Clic → vista completa. **El botón que importa es `◇ Idea de contenido`**, igual
que en `MeetingDetail`: cierra el bucle noticia → pieza del Estudio. No un tab
nuevo hasta que el feed demuestre que se usa.

---

## 7. La Lista curada — cuentas semilla

Análisis completo y razonado en el artifact "Mapa Tech en X". Handles para
armar la Lista (orden = prioridad si hay que recortar):

**Primarias — el anuncio nace acá**
`@OpenAI` `@AnthropicAI` `@GoogleDeepMind` `@xai` `@MistralAI` `@huggingface`
`@cursor_ai` `@vercel` `@github` `@nvidia`

**Traductores — te dicen qué significa (máxima señal/ruido)**
`@karpathy` `@simonw` `@swyx` `@natolambert` `@fchollet` `@emollick` `@rasbt`
`@hamelhusain` `@jeremyphoward` `@lateinteraction` `@eugeneyan`

**Voces de compañía — roadmap y contexto**
`@sama` `@gdb` `@demishassabis` `@jeffdean` `@AravSrinivas` `@miramurati`
`@soumithchintala` `@lilianweng` `@polynoamial` `@oriolvinyalsml` `@ylecun`

**Coding agents — tu nicho exacto**
`@bcherny` `@leerob` `@dexhorthy` `@jxnlco` `@yoheinakajima` `@sh_reya`

**Prensa y scoops**
`@Techmeme` `@steph_palazzolo` `@theinformation` `@TheRundownAI` `@alexeheath`

**Español**
`@midudev` (referencia obligada en español para devs + IA)

**Contrapeso — evita la cámara de eco**
`@timnitgebru` `@katecrawford` `@GaryMarcus`

> Nota honesta sobre roles: en 2026 hubo mucho movimiento (Karpathy → Anthropic,
> Lee Robinson → Cursor, Murati y Soumith → Thinking Machines). Los handles son
> estables; los cargos, no. La Lista se mantiene sola: revisar cada trimestre.

---

## 8. Fases

| Fase | Qué | Depende de | Costo |
| --- | --- | --- | --- |
| **0** | Módulo `news/` + migración 025 + Capa 0 + job + panel del riel + tools de voz | nada — **se puede construir hoy** | $0 |
| **1** | `news/search` con app-auth + medición real de créditos | que crees la app y compres $25 | ~$0-5/mes |
| **2** | OAuth2 PKCE: conectar @rulo_code → Lista + bookmarks + tus métricas | Fase 1 | ~$15-20/mes |
| **3** | Digest diario narrado por voz + noticia → pieza del Estudio + X en `content_metrics` | Fase 2 | incluido |

## 9. Lo que NO vamos a hacer

- **Scrapers de terceros** (twitterapi.io, socialdata, getxapi, Nitter
  self-hosted). Acaban de recibir un C&D público: es infraestructura condenada.
- **Automatizar la sesión de tu cuenta** con el Chrome CDP de `browse_web` para
  leer el timeline. Técnicamente funciona hoy, y es exactamente lo que X llama
  "acceder a cuentas y session tokens": pone en riesgo @rulo_code, que es tu
  activo de marca. Para una consulta puntual y manual, bien; como job
  automático, no.
- **Auto-recarga de créditos encendida.** Tope duro y degradación a Capa 0.
- **Métricas inventadas en el panel.** Regla de oro del dashboard: si la fuente
  no responde, el elemento se omite.

## Fuentes

- X API pricing — https://docs.x.com/x-api/getting-started/pricing
- News endpoint — https://docs.x.com/x-api/news/introduction
- Home timeline — https://docs.x.com/x-api/posts/timelines/quickstart/reverse-chron-quickstart.md
- Nitter/xcancel shutdown (Forbes, 2026-08-26) —
  https://www.forbes.com/sites/siladityaray/2026/08/26/cease-and-desist-from-x-shuts-down-nitter-and-xcancel-sites-that-scraped-and-mirrored-tweets/
