"use client";

/**
 * Hoja de IMPORTAR una sesión. Referencias Mobbin: ElevenLabs "Transcribe
 * files" (pestañas por origen, idioma como única opción que importa, la línea
 * de costo honesta) y Cosmos "We found 2 boards" (lo encontrado con checks y
 * la cuenta dentro del botón).
 *
 * Tres orígenes, todos REALES:
 *  - Cámara: solo aparece si el agente ve una cámara montada (volumen con
 *    DCIM). Nunca una SD ficticia. Preselecciona el clip más reciente.
 *  - Archivo: explorador del disco del agente (el video de la cámara pesa GB:
 *    se elige por ruta, jamás se sube por el browser).
 *  - Grabar memo: el micrófono de este equipo → multipart.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComposeSession, MediaBrowse, MediaFileInfo } from "@hermes/shared";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { LiveWaveform } from "@/components/estudio/audio/Waveform";
import { useComposicion } from "../ComposicionContext";
import { usePlaygroundApi, type ComposeSources } from "./api";
import { Sheet } from "./Sheet";
import { btn, btnPrimary, chip, field } from "./ui";
import { fmtBytes, fmtDate, fmtDuration, fmtTime } from "./format";

type Origin = "camara" | "archivo" | "memo";
type Lang = ComposeSession["language"];

const LANGS: { id: Lang; label: string; hint: string }[] = [
  { id: "es", label: "Español", hint: "" },
  { id: "en", label: "Inglés", hint: "" },
  { id: "auto", label: "Detectar", hint: "si cambian de idioma entre canciones" },
];

/** Título por defecto: el nombre del archivo sin extensión (el humano lo cambia). */
const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

export function ImportSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (s: ComposeSession) => void;
}) {
  const api = usePlaygroundApi();
  const { songs } = useComposicion();
  const [sources, setSources] = useState<ComposeSources | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin>("archivo");
  const [picked, setPicked] = useState<MediaFileInfo | null>(null);
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState<Lang>("es");
  const [songId, setSongId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memo, setMemo] = useState<{ blob: Blob; seconds: number; peak: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .sources()
      .then((s) => {
        if (cancelled) return;
        setSources(s);
        // Con cámara montada arranca ahí y con el clip más reciente elegido.
        const files = s.cameras.flatMap((c) => c.files);
        if (files.length) {
          setOrigin("camara");
          const latest = [...files].sort((a, b) => b.mtime.localeCompare(a.mtime))[0];
          setPicked(latest);
        }
      })
      .catch((e: Error) => !cancelled && setSourcesError(e.message));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const cameraFiles = useMemo(() => sources?.cameras.flatMap((c) => c.files) ?? [], [sources]);

  const canImport = origin === "memo" ? !!memo : !!picked;
  const submit = useCallback(async () => {
    if (!canImport || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s =
        origin === "memo" && memo
          ? await api.recordSession({ blob: memo.blob, title: title.trim() || undefined, language: lang })
          : await api.createSession({
              path: picked!.path,
              title: title.trim() || undefined,
              language: lang,
              songId: songId || undefined,
            });
      onCreated(s);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [api, busy, canImport, lang, memo, onCreated, origin, picked, songId, title]);

  const label =
    origin === "memo" ? "Importar memo" : picked?.kind === "audio" ? "Importar 1 audio" : "Importar 1 video";

  return (
    <Sheet
      title="Importar sesión"
      onClose={onClose}
      onConfirm={canImport ? submit : undefined}
      footer={
        <>
          {error && <span className="mr-auto text-xs text-red">{error}</span>}
          <button type="button" onClick={onClose} className={btn}>
            Cancelar
          </button>
          <button type="button" onClick={submit} disabled={!canImport || busy} className={btnPrimary}>
            {busy ? "Importando…" : label}
            <kbd className="text-2xs opacity-70">⌘⏎</kbd>
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-1" role="tablist">
          {cameraFiles.length > 0 && (
            <button type="button" className={chip(origin === "camara")} onClick={() => setOrigin("camara")}>
              Cámara <span className="text-text-faint">{cameraFiles.length}</span>
            </button>
          )}
          <button type="button" className={chip(origin === "archivo")} onClick={() => setOrigin("archivo")}>
            Archivo
          </button>
          <button type="button" className={chip(origin === "memo")} onClick={() => setOrigin("memo")}>
            Grabar memo
          </button>
        </div>

        {sourcesError && (
          <p className="text-xs text-amber">No pude preguntar por las cámaras: {sourcesError}</p>
        )}

        {origin === "camara" && sources && (
          <div className="flex flex-col gap-3">
            {sources.cameras.map((c) => (
              <div key={c.dir} className="flex flex-col gap-1">
                <p className="text-xs text-text-dim">
                  {c.volume} · <span className="font-mono text-text-faint">{c.dir}</span> — encontré{" "}
                  {c.files.length} {c.files.length === 1 ? "clip" : "clips"}
                </p>
                <FileRows files={c.files} picked={picked} onPick={(f) => setPicked(f)} />
              </div>
            ))}
          </div>
        )}
        {origin === "camara" && !sources && !sourcesError && (
          <p className="text-xs text-text-faint">Buscando cámaras…</p>
        )}

        {origin === "archivo" && <Browser picked={picked} onPick={setPicked} />}

        {origin === "memo" && <MemoRecorder memo={memo} onMemo={setMemo} />}

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 border-t border-line pt-3">
          <label className="text-xs text-text-dim" htmlFor="imp-title">
            Título
          </label>
          <input
            id="imp-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={picked && origin !== "memo" ? baseName(picked.name) : "Sesión sin título"}
            className={field}
          />
          <span className="text-xs text-text-dim">Idioma</span>
          <div className="flex flex-wrap items-center gap-1">
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                title={l.hint || undefined}
                className={chip(lang === l.id)}
                onClick={() => setLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          {origin !== "memo" && songs.length > 0 && (
            <>
              <label className="text-xs text-text-dim" htmlFor="imp-song">
                Canción
              </label>
              <select id="imp-song" value={songId} onChange={(e) => setSongId(e.target.value)} className={field}>
                <option value="">Ninguna (se decide después)</option>
                {songs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </>
          )}
          {sources && (
            <>
              <span className="text-xs text-text-dim">Guardar en</span>
              <p className="min-w-0 text-xs">
                <span className="block truncate font-mono text-text-dim" title={sources.mediaRoot}>
                  {sources.mediaRoot}
                </span>
                <span className="text-text-faint">
                  {sources.connected
                    ? "se copia y se verifica antes de analizar; el original no se toca"
                    : "el disco no está conectado: la sesión se guarda en local y se puede mover después"}
                </span>
              </p>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function FileRows({
  files,
  picked,
  onPick,
}: {
  files: MediaFileInfo[];
  picked: MediaFileInfo | null;
  onPick: (f: MediaFileInfo) => void;
}) {
  const sorted = [...files].sort((a, b) => b.mtime.localeCompare(a.mtime));
  return (
    <ul className="flex flex-col overflow-hidden rounded-sm border border-line">
      {sorted.map((f) => {
        const on = picked?.path === f.path;
        const meta = [fmtDuration(f.durationSec), fmtBytes(f.bytes), fmtDate(f.mtime)].filter(Boolean);
        return (
          <li key={f.path} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => onPick(f)}
              className={`flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-left ${
                on ? "bg-accent/10" : "hover:bg-panel-2"
              }`}
            >
              <span
                aria-hidden
                className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
                  on ? "border-accent" : "border-line-2"
                }`}
              >
                {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </span>
              <span className="text-2xs text-text-faint">{f.kind === "video" ? "▶" : "♪"}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">{f.name}</span>
              <span className="shrink-0 text-xs text-text-faint tabular-nums">{meta.join(" · ")}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Explorador del disco del agente: carpetas + videos/audios, con subir de nivel. */
function Browser({ picked, onPick }: { picked: MediaFileInfo | null; onPick: (f: MediaFileInfo) => void }) {
  const api = usePlaygroundApi();
  const [data, setData] = useState<MediaBrowse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const go = useCallback(
    async (dir?: string) => {
      setLoading(true);
      setError(null);
      try {
        const b = await api.browse(dir);
        setData(b);
        try {
          localStorage.setItem("composicion.browse.dir", b.dir);
        } catch {
          /* sin storage */
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    let last: string | undefined;
    try {
      last = localStorage.getItem("composicion.browse.dir") ?? undefined;
    } catch {
      /* sin storage */
    }
    void go(last);
  }, [go]);

  const files = data?.entries.filter((e) => e.kind !== "dir") as MediaFileInfo[] | undefined;
  const dirs = data?.entries.filter((e) => e.kind === "dir") ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className={btn}
          disabled={!data?.parent || loading}
          onClick={() => data?.parent && void go(data.parent)}
          title="Subir un nivel"
        >
          ↑
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-dim" title={data?.dir}>
          {data?.dir ?? "…"}
        </span>
        {loading && <span className="text-xs text-text-faint">leyendo…</span>}
      </div>
      {error && <p className="text-xs text-red">{error}</p>}
      <div className="max-h-64 overflow-y-auto rounded-sm border border-line">
        {dirs.map((d) => (
          <button
            key={d.path}
            type="button"
            onClick={() => void go(d.path)}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-line px-2.5 py-1.5 text-left text-xs text-text-dim first:border-t-0 hover:bg-panel-2 hover:text-text"
          >
            <span aria-hidden>▸</span>
            <span className="truncate">{d.name}</span>
          </button>
        ))}
        {files && files.length > 0 && (
          <div className="border-t border-line first:border-t-0">
            <FileRows files={files} picked={picked} onPick={onPick} />
          </div>
        )}
        {data && dirs.length === 0 && (!files || files.length === 0) && (
          <p className="px-2.5 py-3 text-xs text-text-faint">Esta carpeta no tiene videos ni audios.</p>
        )}
      </div>
    </div>
  );
}

/** Grabar un memo con el micrófono de este equipo (onda en vivo + aviso de silencio). */
function MemoRecorder({
  memo,
  onMemo,
}: {
  memo: { blob: Blob; seconds: number; peak: number } | null;
  onMemo: (m: { blob: Blob; seconds: number; peak: number } | null) => void;
}) {
  const rec = useMediaRecorder({ meter: true, raw: true });
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!memo) return;
    const u = URL.createObjectURL(memo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [memo]);

  const toggle = async () => {
    if (rec.recording) {
      const r = await rec.stop();
      if (r.blob) onMemo({ blob: r.blob, seconds: r.durationSec, peak: r.peak });
    } else {
      onMemo(null);
      await rec.start();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={!rec.supported}
          className={rec.recording ? btn : btnPrimary}
        >
          {rec.recording ? "■ Detener" : memo ? "● Grabar otra vez" : "● Grabar"}
        </button>
        <span className="font-mono text-xs text-text-dim tabular-nums">
          {rec.recording ? fmtTime(rec.elapsed) : memo ? `${fmtTime(memo.seconds)} grabado` : "0:00"}
        </span>
        {memo && !rec.recording && (
          <button type="button" className={btn} onClick={() => onMemo(null)}>
            ↺ Descartar
          </button>
        )}
      </div>
      <div className="h-12 rounded-sm border border-line px-2">
        <LiveWaveform meterRef={rec.meterRef} active={rec.recording} />
      </div>
      {url && !rec.recording && <audio src={url} controls className="h-8 w-full" />}
      {memo && memo.peak < 0.02 && (
        <p className="text-xs text-amber">
          Casi no se escuchó nada (pico {Math.round(memo.peak * 100)} %). Revisa el micrófono antes de importar.
        </p>
      )}
      {rec.error && <p className="text-xs text-red">{rec.error}</p>}
      {!rec.supported && <p className="text-xs text-text-faint">Este navegador no puede grabar audio.</p>}
    </div>
  );
}
