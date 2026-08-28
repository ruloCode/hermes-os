# Borrador — YouTube API Services · Audit and Quota Extension Form

> Formulario: https://support.google.com/youtube/contact/yt_api_form
> Guía oficial: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
>
> **Estado: borrador para que Rulo revise, complete lo personal y envíe.**
> Preparado 2026-08-10. Los campos marcados 🔴 solo los puedes llenar tú.
>
> ⚠️ **Lee primero la sección "Antes de enviar" al final** — hay una decisión
> de fondo que conviene tomar antes de invertir tiempo en esto.

---

## Datos duros de tu proyecto (verificados)

| Dato | Valor |
|---|---|
| Google Cloud project number | `495604530384` |
| API client name | Hermes OS |
| ¿Contiene "YouTube" en el nombre? | No |
| API usada | YouTube Data API v3 |
| Endpoint que se va a usar | `videos.insert` (y `videos.list` para verificar el estado tras subir) |
| Scope OAuth | `https://www.googleapis.com/auth/youtube.upload` |
| ¿Requiere OAuth 2.0? | Sí |
| Usuarios | 1 (el propio desarrollador) |
| Volumen esperado | 3–5 subidas por semana (~20/mes) |
| Cuota solicitada | **Ninguna adicional** — la default de 100 `videos.insert`/día sobra |

---

## Sección 1 · Tipo de solicitud

**Reason for request** →
`Complete a compliance audit (no additional quota needed)`

> ⚠️ Importante: **no pidas ampliación de cuota.** Solo necesitas levantar la
> restricción de "video bloqueado en privado". Pedir cuota extra que no
> necesitas alarga la revisión y te obliga a justificar volúmenes que no tienes.

---

## Sección 2 · Organización y contacto

| Campo | Respuesta |
|---|---|
| Application type | **Individual** (no organización) |
| Your full legal name | 🔴 tu nombre legal completo |
| Organization's legal name | *(dejar vacío / "N/A — individual developer")* |
| Parent company | N/A |
| Primary website | 🔴 ver nota sobre sitio público abajo |
| Country | Colombia |
| Street address / City / State / Postal code | 🔴 tu dirección |
| Business category | Software / Developer tools |
| Organization size | Individual / 1 |
| Primary contact name + email | 🔴 tú · <email del canal> |
| Technical contact | *(el mismo)* |

---

## Sección 3 · Modelo de negocio

**Description of your work as it relates to YouTube** (mín. 100 caracteres):

> I am an independent software developer. I built Hermes OS, a private
> single-user automation system that runs locally on my own computer and
> manages my personal content production pipeline: writing scripts, tracking
> recording sessions, editing video, and publishing the finished videos to my
> own YouTube channel.
>
> My use of the YouTube Data API is limited to a single endpoint,
> `videos.insert`, used exclusively to upload videos that I create myself to
> the YouTube channel that I own and operate. The application is not
> distributed, not publicly accessible, and has exactly one user: me. It does
> not read, display, aggregate, or store data about other users' videos,
> channels, or viewers, and it does not compute or expose any derived metrics
> from YouTube data.
>
> The purpose is to remove manual work from my own publishing workflow: the
> video file, title, and description are already produced inside my system, so
> uploading them by hand through the web interface is redundant. Each upload is
> explicitly triggered by me for a specific video of my own authorship.

**Target audience** → *Individual creators* / *Internal use*
**Monetization model** → 🔴 responde con la verdad de tu canal (probablemente
*Not monetized* para el cliente API; el canal en sí es otra cosa — la pregunta
es sobre el **cliente API**, que no genera ingresos)
**Advertising on/within YouTube content** → No
**Prior written approval for ads** → N/A
**Google partner manager** → No
**How you learned about the API** → Official documentation at developers.google.com
**Content Owner ID / Google Ads Customer ID** → N/A

---

## Sección 4 · Descripción del cliente API

| Campo | Respuesta |
|---|---|
| API client name | Hermes OS |
| Contains "YouTube" in name | No |
| Primary access URL | 🔴 **ver "Antes de enviar" — este es el campo problemático** |
| Privacy policy URL | 🔴 **ídem** |
| Terms of service URL | N/A (no distribuido) |
| Publicly accessible? | **No** |
| Demo account username/password | **No aplica** — ofrece un screencast en su lugar |

**Special access instructions** (aquí explicas por qué no hay demo):

> This application is not publicly accessible and cannot be demonstrated with
> credentials. It is a private system that runs only on my personal computer
> and authenticates solely against my own Google account via OAuth 2.0. There
> is no hosted instance, no sign-up, and no other users.
>
> I am happy to provide a screen recording that shows the complete flow — the
> internal interface, the point at which an upload is triggered, the exact
> `videos.insert` request that is sent, and the resulting video on my channel —
> at whatever level of detail the review team requires.

---

## Sección 5 · Caso de uso y cuota

| Campo | Respuesta |
|---|---|
| Google Cloud project number | `495604530384` |
| Use case category | *Uploading my own content* / *Internal or personal use* |
| OAuth 2.0 required? | Yes |
| Derived metrics agreement | No derived metrics are created, stored, or displayed |
| Expected API usage volume | ~20 `videos.insert` calls per month (3–5 per week) |
| API endpoints selected | `videos.insert`, `videos.list` |
| Total quota request | **Default (no increase requested)** |
| Peak per-minute quota | Default |
| Separate quota for `search.list` | Not used |
| Separate quota for `videos.insert` | Default (100/day) — no increase needed |

**Detailed justification:**

> I am not requesting any quota increase. My project uses well under the
> default allocation: roughly 20 uploads per month against a default of 100 per
> day.
>
> The only reason for this request is the restriction described in the
> `videos.insert` documentation, whereby videos uploaded from an unverified API
> project are locked to private viewing mode. Every video I upload is my own
> original content, uploaded to my own channel, by me. The audit is the
> documented path to having those uploads publish normally.

**Almacenamiento de datos** (por si lo preguntan): el sistema guarda únicamente
el `videoId` y la URL pública del video propio recién subido, en una base de
datos privada, para saber que la pieza ya se publicó. No se almacena ningún
otro dato de la API de YouTube.

---

## Antes de enviar — dos cosas que tienes que decidir 🔴

### 1. El formulario asume un producto público, y Hermes no lo es

Pide **Primary access URL**, **Privacy policy URL**, capturas de la homepage y
de la política de privacidad, y credenciales de una cuenta demo. Hermes OS no
tiene nada de eso: es una herramienta privada de un solo usuario, sin URL
pública ni registro.

Eso **no descalifica** tu caso — el uso personal es legítimo y los revisores lo
ven seguido — pero sí significa que tendrás que:

- Publicar una **política de privacidad mínima** en alguna URL tuya (puede ser
  una página estática; con el dominio de RuloCode alcanza), y
- Sustituir la cuenta demo por un **screencast**, con el texto que ya está
  redactado arriba.

Cuenta con 1–2 h de trabajo extra y varias semanas de ida y vuelta.

### 2. ¿De verdad te compensa?

El costo real de **no** hacer la auditoría es: el video se sube solo con título,
descripción y fecha puestos, y tú entras a [Studio](https://studio.youtube.com)
y le das público. **Un clic, 3–5 veces por semana.**

El costo de hacerla: nombre legal y dirección en un formulario, una política de
privacidad publicada, un screencast, y una revisión que examina un producto que
públicamente no existe — con riesgo real de rechazo por ese mismo motivo.

> **Mi recomendación: no la envíes todavía.** Construimos la fase 1, la usas dos
> o tres semanas, y ahí decides con dato real si ese clic te molesta lo
> suficiente. Si te molesta, el borrador ya está escrito y solo hay que rellenar
> lo tuyo. Si no te molesta, te ahorraste el trámite entero.

Si aun así prefieres mandarla ya, adelante — el borrador está completo y la
espera corre en paralelo mientras construimos.

---

## Si decides enviarla, el orden

1. Publicar la política de privacidad en una URL tuya (te la puedo escribir).
2. Grabar el screencast (2–3 min: la UI, el disparo de la subida, el video en tu canal).
3. Abrir https://support.google.com/youtube/contact/yt_api_form con tu cuenta.
4. Copiar las respuestas de este documento, rellenar los 🔴.
5. Guardar copia de lo enviado aquí mismo, para el re-audit periódico.
