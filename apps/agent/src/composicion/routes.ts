/**
 * Rutas de COMPOSICIÓN (contrato: COMPOSICION_ROUTES_DOC en
 * packages/shared/src/composicion.ts). Viven en su módulo y index.ts solo las
 * monta: así se prueban con `app.request()` sin levantar el agente entero (que
 * arranca jobs periódicos, presencia, publicación…).
 *
 * Convenciones del repo: literales antes que paramétricas, errores `{error}`
 * con status, acciones `{ok, error?}`. `HERMES_COMPOSICION=off` → 404.
 */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { join } from "node:path";
import {
  ComposicionValidationError,
  SESSION_STAGES,
  TemaValidationError,
  type LyricRequest,
  type Passage,
  type SessionStage,
} from "@hermes/shared";
import { env } from "../env.js";
import {
  FileAccessError,
  MAX_TRANSPOSE,
  browseMedia,
  detectCameras,
  fileResponse,
  mediaRoot,
  renderTransposed,
  resolveMediaFile,
  revealFolder,
  sessionPeaks,
} from "./media.js";
import {
  ImportError,
  addManualPassage,
  createSessionFromPath,
  createSessionFromRecording,
  patchPassage,
  processSession,
  queuePassageAnalysis,
  stopSession,
} from "./pipeline.js";
import {
  LyricsError,
  MAX_LYRIC_VERSIONS,
  createSongFromSession,
  generateLyrics,
  readLyricsAligned,
  updateLyricBoard,
  validateOverride,
} from "./lyrics.js";
import {
  BoardConflictError,
  ComposicionNotFoundError,
  deleteTema,
  listSessions,
  listTemas,
  patchAnalysis,
  patchSession,
  readAnalysis,
  readBoard,
  readSession,
  readTranscript,
  writeBoard,
} from "./store.js";
import { transcriptLines } from "./transcribe.js";
import { PRIVATE_ERROR, privacyInfo, viaTunnel } from "./privacy.js";
import { TemaError, createTake, createTema, patchTake, temaDetail, updateTema } from "./temas.js";
import { GuideError, renderGuide } from "./guide.js";
import { TtsError, listVoices } from "./tts.js";

type Status = 400 | 402 | 403 | 404 | 409 | 413 | 500 | 502 | 503;

/** Traduce los errores tipados de los módulos a `{error}` con su status. */
function fail(c: Context, err: unknown) {
  const msg = (err as Error)?.message ?? String(err);
  let status: Status = 500;
  if (err instanceof ComposicionNotFoundError) status = 404;
  else if (err instanceof ComposicionValidationError || err instanceof TemaValidationError) status = 400;
  else if (
    err instanceof ImportError ||
    err instanceof LyricsError ||
    err instanceof FileAccessError ||
    err instanceof TemaError ||
    err instanceof GuideError ||
    err instanceof TtsError
  )
    status = err.status as Status;
  else if (err instanceof SyntaxError) status = 400;
  if (status === 500) console.error("[composicion] error:", err);
  return c.json({ error: msg.slice(0, 500) }, status);
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ImportError("cuerpo JSON inválido");
  return body as Record<string, unknown>;
}

async function mustSession(id: string) {
  const s = await readSession(id);
  if (!s) throw new ComposicionNotFoundError("sesión no encontrada");
  return s;
}

const num = (v: unknown, what: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ImportError(`${what} debe ser un número`);
  return n;
};

export function mountComposicionRoutes(app: Hono): void {
  app.use("/composicion/*", async (c, next) => {
    if (!env.COMPOSICION_ENABLED)
      return c.json({ error: "composición desactivada (HERMES_COMPOSICION=off)" }, 404);
    if (env.COMPOSICION_LAN_ONLY && viaTunnel((h) => c.req.header(h))) return c.json({ error: PRIVATE_ERROR }, 403);
    await next();
  });

  app.get("/composicion/privacy", (c) => c.json(privacyInfo()));

  // Voces genéricas para la guía cantada (caché de 1 h). Sin key → 503 con el motivo.
  app.get("/composicion/guide/voices", async (c) => {
    try {
      return c.json({ voices: await listVoices(c.req.raw.signal) });
    } catch (err) {
      return fail(c, err);
    }
  });

  // ── Tablero ──
  app.get("/composicion/board", async (c) => {
    try {
      const board = await readBoard();
      if (!board) return c.json({ error: "sin tablero" }, 404);
      return c.json(board);
    } catch (err) {
      if (err instanceof ComposicionValidationError || err instanceof SyntaxError)
        return c.json({ error: `board.json inválido: ${(err as Error).message}` }, 500);
      return fail(c, err);
    }
  });

  // Concurrencia optimista: con `baseUpdatedAt` viejo → 409 con el tablero vigente (contrato en composicion.ts).
  app.put("/composicion/board", bodyLimit({ maxSize: 20 * 1024 * 1024 }), async (c) => {
    try {
      const body = (await c.req.json()) as unknown;
      const base =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).baseUpdatedAt
          : undefined;
      if (base !== undefined && base !== null && typeof base !== "string")
        throw new ImportError("baseUpdatedAt debe ser texto (el updatedAt del tablero que viste)");
      return c.json(await writeBoard(body, typeof base === "string" ? { baseUpdatedAt: base } : {}));
    } catch (err) {
      if (err instanceof BoardConflictError) return c.json({ error: err.message, board: err.board }, 409);
      return fail(c, err);
    }
  });

  // ── Fuentes ──
  app.get("/composicion/sources", async (c) => {
    try {
      const root = mediaRoot();
      return c.json({ cameras: await detectCameras(), mediaRoot: root.root, connected: root.connected });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/composicion/browse", async (c) => {
    try {
      return c.json(await browseMedia(c.req.query("dir")));
    } catch (err) {
      return fail(c, err);
    }
  });

  // ── Sesiones (literales primero) ──
  app.get("/composicion/sessions", async (c) => c.json(await listSessions()));

  app.post("/composicion/sessions", async (c) => {
    try {
      const body = await jsonBody(c);
      if (typeof body.path !== "string" || !body.path.trim()) throw new ImportError("falta `path`");
      const language = body.language;
      if (language !== undefined && language !== "es" && language !== "en" && language !== "auto")
        throw new ImportError("language: es | en | auto");
      const session = await createSessionFromPath({
        path: body.path,
        title: typeof body.title === "string" ? body.title : undefined,
        language: language as "es" | "en" | "auto" | undefined,
        songId: typeof body.songId === "string" ? body.songId : undefined,
      });
      return c.json(session);
    } catch (err) {
      return fail(c, err);
    }
  });

  // Memo del micrófono del dashboard. 300 MB: una hora en WAV del browser cabe.
  app.post("/composicion/sessions/record", bodyLimit({ maxSize: 300 * 1024 * 1024 }), async (c) => {
    try {
      const body = await c.req.parseBody();
      const audio = body.audio;
      if (!audio || typeof audio === "string") throw new ImportError("falta `audio`");
      const fromName = /\.([a-z0-9]{2,5})$/i.exec(audio.name ?? "")?.[1];
      const fromType = /audio\/([a-z0-9]+)/i.exec(audio.type ?? "")?.[1];
      const ext = (fromName ?? fromType ?? "webm").toLowerCase().replace("mpeg", "mp3").replace("x-wav", "wav");
      const language = body.language;
      if (language !== undefined && language !== "es" && language !== "en" && language !== "auto")
        throw new ImportError("language: es | en | auto");
      const session = await createSessionFromRecording({
        bytes: new Uint8Array(await audio.arrayBuffer()),
        ext,
        title: typeof body.title === "string" ? body.title : undefined,
        language: language as "es" | "en" | "auto" | undefined,
      });
      return c.json(session);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/composicion/sessions/:id", async (c) => {
    try {
      return c.json(await mustSession(c.req.param("id")));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch("/composicion/sessions/:id", async (c) => {
    try {
      const body = await jsonBody(c);
      const id = c.req.param("id");
      await mustSession(id);
      if (body.songId !== undefined && body.songId !== null && typeof body.songId === "string") {
        const board = await readBoard();
        if (!board?.songs.some((s) => s.id === body.songId)) throw new ImportError("la canción no existe en el tablero", 404);
      }
      const updated = await patchSession(id, (s) => {
        if (body.title !== undefined) {
          const t = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
          if (!t) throw new ImportError("el título no puede quedar vacío");
          s.title = t;
        }
        if (body.songId !== undefined) {
          if (body.songId === null || body.songId === "") delete s.songId;
          else if (typeof body.songId === "string") s.songId = body.songId;
          else throw new ImportError("songId debe ser texto o null");
        }
        if (body.speakers !== undefined) {
          if (!Array.isArray(body.speakers)) throw new ImportError("speakers debe ser una lista");
          for (const raw of body.speakers as Record<string, unknown>[]) {
            const sp = s.speakers.find((x) => x.id === raw?.id);
            if (!sp) throw new ImportError(`voz desconocida: ${String(raw?.id)}`);
            if (raw.name !== undefined) {
              const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 40) : "";
              if (!name) throw new ImportError("el nombre de la voz no puede quedar vacío");
              sp.name = name;
            }
            if (raw.mergedInto !== undefined) {
              if (raw.mergedInto === null || raw.mergedInto === "") delete sp.mergedInto;
              else if (typeof raw.mergedInto === "string" && raw.mergedInto !== sp.id && s.speakers.some((x) => x.id === raw.mergedInto))
                sp.mergedInto = raw.mergedInto;
              else throw new ImportError("mergedInto debe ser otra voz de la sesión");
            }
          }
        }
      });
      return c.json(updated);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/composicion/sessions/:id/process", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { from?: unknown };
    const from = typeof body.from === "string" ? body.from : undefined;
    if (from !== undefined && !SESSION_STAGES.includes(from as SessionStage))
      return c.json({ ok: false, error: `etapa inválida (${SESSION_STAGES.join(", ")})` }, 400);
    const r = await processSession(c.req.param("id"), from as SessionStage | undefined);
    return c.json({ ok: r.ok, ...(r.error ? { error: r.error } : {}) }, r.ok ? 200 : (r.status ?? 400));
  });

  app.post("/composicion/sessions/:id/stop", async (c) => {
    const r = await stopSession(c.req.param("id"));
    return c.json(r, r.ok ? 200 : 409);
  });

  app.post("/composicion/sessions/:id/reveal", async (c) => {
    const s = await readSession(c.req.param("id"));
    if (!s) return c.json({ ok: false, error: "sesión no encontrada" }, 404);
    const r = await revealFolder(s.mediaDir);
    return c.json(r, r.ok ? 200 : 400);
  });

  app.get("/composicion/sessions/:id/transcript", async (c) => {
    try {
      const s = await mustSession(c.req.param("id"));
      const words = await readTranscript(s.id);
      if (!words) return c.json({ error: "sin transcripción" }, 404);
      const sungRanges = s.passages.filter((p) => p.group !== "descartado");
      const lines = transcriptLines(words).map((l) => {
        const len = Math.max(0.01, l.end - l.start);
        const covered = sungRanges.reduce(
          (a, p) => a + Math.max(0, Math.min(p.end, l.end) - Math.max(p.start, l.start)),
          0,
        );
        // Cantada = cae en un pasaje (≥ la mitad) o trae un evento de canto.
        const sung = covered / len >= 0.5 || /\[[^\]]*(cant|sing|tarare|humm)/i.test(l.text);
        return { speaker: l.speaker, start: l.start, end: l.end, text: l.text, sung };
      });
      return c.json({ lines });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/composicion/sessions/:id/peaks", async (c) => {
    try {
      const s = await mustSession(c.req.param("id"));
      const peaks = await sessionPeaks(s);
      if (!peaks) return c.json({ error: "la sesión todavía no tiene audio extraído" }, 404);
      return c.json(peaks);
    } catch (err) {
      return fail(c, err);
    }
  });

  // El <video>/<audio> del dashboard pide tramos (Range): `?key=` vale en GET.
  app.get("/composicion/sessions/:id/file", async (c) => {
    try {
      const s = await mustSession(c.req.param("id"));
      const abs = await resolveMediaFile(s.mediaDir, c.req.query("path") ?? "");
      return fileResponse(abs, c.req.header("Range"));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/composicion/sessions/:id/song", async (c) => {
    try {
      return c.json(await createSongFromSession(c.req.param("id")));
    } catch (err) {
      return fail(c, err);
    }
  });

  // ── Pasajes ──
  app.post("/composicion/sessions/:id/passages", async (c) => {
    try {
      const body = await jsonBody(c);
      await mustSession(c.req.param("id"));
      const passage = await addManualPassage(c.req.param("id"), {
        start: num(body.start, "start"),
        end: num(body.end, "end"),
        speaker: typeof body.speaker === "string" ? body.speaker : undefined,
      });
      return c.json(passage);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch("/composicion/sessions/:id/passages/:pid", async (c) => {
    try {
      const body = await jsonBody(c);
      const passage = await patchPassage(c.req.param("id"), c.req.param("pid"), {
        ...(body.start !== undefined ? { start: num(body.start, "start") } : {}),
        ...(body.end !== undefined ? { end: num(body.end, "end") } : {}),
        ...(typeof body.label === "string" ? { label: body.label } : {}),
        ...(typeof body.group === "string" ? { group: body.group as Passage["group"] } : {}),
        ...(body.speaker !== undefined ? { speaker: typeof body.speaker === "string" ? body.speaker : "" } : {}),
      });
      return c.json(passage);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/composicion/sessions/:id/passages/:pid/analyze", async (c) => {
    const s = await readSession(c.req.param("id"));
    if (!s) return c.json({ ok: false, error: "sesión no encontrada" }, 404);
    if (!s.passages.some((p) => p.id === c.req.param("pid")))
      return c.json({ ok: false, error: "pasaje no encontrado" }, 404);
    if (!s.files.audio) return c.json({ ok: false, error: "la sesión todavía no tiene audio extraído" }, 409);
    queuePassageAnalysis(s.id, c.req.param("pid"));
    return c.json({ ok: true });
  });

  app.get("/composicion/sessions/:id/passages/:pid", async (c) => {
    try {
      const s = await mustSession(c.req.param("id"));
      const a = await readAnalysis(s.id, c.req.param("pid"));
      if (!a) return c.json({ error: "el pasaje todavía no tiene análisis" }, 404);
      return c.json(a);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch("/composicion/sessions/:id/passages/:pid/mold", async (c) => {
    try {
      const body = await jsonBody(c);
      if (!Number.isInteger(body.phrase)) throw new ImportError("phrase debe ser el índice de la frase");
      const override = validateOverride(body.override ?? null);
      const a = await patchAnalysis(c.req.param("id"), c.req.param("pid"), (x) => {
        const ph = x.phrases.find((p) => p.idx === body.phrase);
        if (!ph) throw new ImportError("frase no encontrada", 404);
        if (override) ph.override = override;
        else delete ph.override;
      });
      return c.json(a);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/composicion/sessions/:id/passages/:pid/transpose", async (c) => {
    try {
      const body = await jsonBody(c);
      const semitones = num(body.semitones, "semitones");
      if (!Number.isInteger(semitones) || Math.abs(semitones) > MAX_TRANSPOSE)
        throw new ImportError(`semitones: entero entre −${MAX_TRANSPOSE} y ${MAX_TRANSPOSE}`);
      const source = body.source === "mezcla" ? "mezcla" : body.source === "voz" ? "voz" : null;
      if (!source) throw new ImportError('source: "voz" | "mezcla"');
      const s = await mustSession(c.req.param("id"));
      const pid = c.req.param("pid");
      if (!s.passages.some((p) => p.id === pid)) throw new ComposicionNotFoundError("pasaje no encontrado");
      const dir = join("analisis", pid);
      if (semitones === 0) {
        const rel = join(dir, `${source}.wav`);
        await resolveMediaFile(s.mediaDir, rel);
        return c.json({ path: rel });
      }
      try {
        return c.json({ path: await renderTransposed(s.mediaDir, dir, source, semitones) });
      } catch (err) {
        if (/no existe/.test((err as Error).message)) throw new ImportError((err as Error).message, 404);
        throw err;
      }
    } catch (err) {
      return fail(c, err);
    }
  });

  // ── Letras ──
  app.get("/composicion/sessions/:id/passages/:pid/lyrics", async (c) => {
    try {
      const s = await mustSession(c.req.param("id"));
      if (!s.passages.some((p) => p.id === c.req.param("pid"))) throw new ComposicionNotFoundError("pasaje no encontrado");
      return c.json(await readLyricsAligned(s.id, c.req.param("pid")));
    } catch (err) {
      return fail(c, err);
    }
  });

  // Síncrono (~30-90 s). Si el browser cancela el fetch, se aborta el turno del SDK.
  app.post("/composicion/sessions/:id/passages/:pid/lyrics", async (c) => {
    try {
      const body = (await jsonBody(c)) as unknown as LyricRequest;
      // El conteo se valida en la puerta: 1..8 (más de 5 van en dos tandas con ángulos distintos).
      const count = body.count ?? 3;
      if (!Number.isInteger(count) || count < 1 || count > MAX_LYRIC_VERSIONS)
        throw new LyricsError(`count debe ser un entero de 1 a ${MAX_LYRIC_VERSIONS}`);
      if (body.temaId !== undefined && body.temaId !== null && typeof body.temaId !== "string")
        throw new LyricsError("temaId debe ser texto");
      return c.json(await generateLyrics(c.req.param("id"), c.req.param("pid"), body, c.req.raw.signal));
    } catch (err) {
      return fail(c, err);
    }
  });

  // ── Guía cantada (TTS con timestamps + PSOLA local) ──
  // Síncrono y abortable: si el browser cancela, se corta el TTS en vuelo.
  app.post("/composicion/sessions/:id/passages/:pid/guide", async (c) => {
    try {
      const body = await jsonBody(c);
      return c.json(await renderGuide(c.req.param("id"), c.req.param("pid"), body, c.req.raw.signal));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.put("/composicion/sessions/:id/passages/:pid/lyrics", async (c) => {
    try {
      return c.json(await updateLyricBoard(c.req.param("id"), c.req.param("pid"), await jsonBody(c)));
    } catch (err) {
      return fail(c, err);
    }
  });

  // ── Temas (la máquina de temas; contrato en tema.ts) — literales primero ──
  app.get("/composicion/temas", async (c) => {
    try {
      return c.json(await listTemas());
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/composicion/temas", async (c) => {
    try {
      // Cuerpo vacío = tema en blanco.
      const raw = await c.req.text();
      const body = raw.trim() ? (JSON.parse(raw) as unknown) : {};
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new TemaError("cuerpo JSON inválido");
      const { title, fromPassage } = body as Record<string, unknown>;
      return c.json(await createTema({ title, fromPassage }));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/composicion/temas/:id", async (c) => {
    try {
      return c.json(await temaDetail(c.req.param("id")));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch("/composicion/temas/:id", async (c) => {
    try {
      return c.json(await updateTema(c.req.param("id"), await jsonBody(c)));
    } catch (err) {
      return fail(c, err);
    }
  });

  // Borra el tema; sus tomas quedan en disco (y en Sesiones): el audio no se tira.
  app.delete("/composicion/temas/:id", async (c) => {
    try {
      const ok = await deleteTema(c.req.param("id"));
      if (!ok) return c.json({ ok: false, error: "tema no encontrado" }, 404);
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  // Una toma: WAV (el browser graba PCM en el mismo AudioContext que toca la
  // pista) + meta JSON con la rejilla. 64 MB en la puerta; createTake exige ≤60.
  app.post(
    "/composicion/temas/:id/takes",
    bodyLimit({
      maxSize: 64 * 1024 * 1024,
      onError: (c) => c.json({ error: "la toma pasa de 64 MB" }, 413),
    }),
    async (c) => {
      try {
        const body = await c.req.parseBody();
        const audio = body.audio;
        if (!audio || typeof audio === "string") throw new TemaError("falta `audio` (WAV)");
        const metaField = body.meta;
        // La meta puede llegar como campo de texto o como Blob application/json.
        const metaText = typeof metaField === "string" ? metaField : metaField ? await metaField.text() : "";
        if (!metaText) throw new TemaError("falta `meta` (JSON con la rejilla de la toma)");
        let meta: unknown;
        try {
          meta = JSON.parse(metaText);
        } catch {
          throw new TemaError("meta no es JSON válido");
        }
        return c.json(await createTake(c.req.param("id"), new Uint8Array(await audio.arrayBuffer()), meta));
      } catch (err) {
        return fail(c, err);
      }
    },
  );

  app.patch("/composicion/temas/:id/takes/:sid", async (c) => {
    try {
      return c.json(await patchTake(c.req.param("id"), c.req.param("sid"), await jsonBody(c)));
    } catch (err) {
      return fail(c, err);
    }
  });
}
