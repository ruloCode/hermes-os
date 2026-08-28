/**
 * Consentimiento OAuth de Google — SE CORRE UNA SOLA VEZ (o al agregar scopes).
 *
 *   pnpm --filter @hermes/agent google:auth
 *
 * Levanta un servidor loopback, abre el navegador para que autorices, recibe el
 * code y lo canjea por un refresh token que imprime para pegar en el .env
 * (GOOGLE_OAUTH_REFRESH_TOKEN). A partir de ahí el agente mintea access tokens
 * solo, sin volver a pedir consentimiento.
 *
 * Requisitos previos (Google Cloud Console):
 *  1. Proyecto + habilitar "Google Calendar API" y "YouTube Data API v3".
 *  2. Pantalla de consentimiento OAuth (External) con publishing status
 *     "In production" — NO "Testing". Con user type External y estado Testing,
 *     Google emite refresh tokens que CADUCAN A LOS 7 DÍAS y la escritura se
 *     cae sola cada semana con `invalid_grant`. Publicar la app quita ese
 *     vencimiento aunque siga sin verificar (la pantalla de "app no verificada"
 *     se salta con Advanced → Go to app).
 *     https://developers.google.com/identity/protocols/oauth2
 *  3. Credencial "ID de cliente de OAuth" tipo "Aplicación web" con este redirect
 *     URI autorizado:  http://localhost:8788/oauth2callback
 *  4. En el .env: GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { env } from "../src/env.js";

// Un solo consentimiento cubre calendario (escritura de eventos por voz) y la
// subida de videos del Estudio. Si agregas scopes, el token viejo NO los hereda:
// hay que volver a correr este script y pegar el refresh token nuevo.
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/youtube.upload",
  // upload es SOLO de escritura: no deja leer nada del canal. Para verificar
  // que el video quedó realmente público a su hora (regla del repo: todo dato
  // visible es real) hace falta lectura. Sin esto solo se puede confiar en la
  // respuesta del insert, que no dice qué pasó después.
  "https://www.googleapis.com/auth/youtube.readonly",
  // Bucle de resultados (migración 022): métricas por día y curva de retención
  // vía YouTube Analytics API. Sin este scope el sync degrada al acumulado de
  // la Data API y lo avisa en el job.
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");
const PORT = env.GOOGLE_OAUTH_PORT;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
  fail(
    "Faltan GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET en el .env.\n" +
      "  Créalos en Google Cloud Console (ID de cliente OAuth, tipo Aplicación web)\n" +
      `  y agrega el redirect URI: ${REDIRECT_URI}`,
  );
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // fuerza a que devuelva refresh_token siempre
  }).toString();

async function exchangeCode(code: string): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.refresh_token) {
    fail(
      `El canje falló: ${json.error ?? res.status} ${json.error_description ?? ""}\n` +
        "  Si no vino refresh_token, revoca el acceso previo en\n" +
        "  https://myaccount.google.com/permissions y corre esto de nuevo.",
    );
  }
  console.log("\n✅ Autorizado. Pega esta línea en el .env de la raíz:\n");
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${json.refresh_token}\n`);
  console.log("Luego reinicia el agente:  launchctl kickstart -k gui/$UID/com.hermes-os.agent\n");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT_URI);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<html><body style="font-family:system-ui;background:#05060f;color:#e2e7ff;padding:3rem">` +
      `<h2>${err ? "Autorización rechazada" : "Listo ✓"}</h2>` +
      `<p>${err ? err : "Ya puedes cerrar esta pestaña y volver a la terminal."}</p></body></html>`,
  );
  server.close();
  if (err) fail(`Autorización rechazada: ${err}`);
  if (code) {
    await exchangeCode(code);
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log(`\n🔑 Abriendo el navegador para autorizar Google Calendar…`);
  console.log(`   Si no abre solo, entra manualmente a:\n\n   ${authUrl}\n`);
  // macOS: abre el navegador por defecto.
  spawn("open", [authUrl], { stdio: "ignore", detached: true }).on("error", () => {
    /* sin `open` (no-macOS): el usuario abre la URL a mano */
  });
});
