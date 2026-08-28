"use client";

/**
 * Tab VOZ — la grabadora de voz en off de la pieza.
 *
 * Referencias (Mobbin, verificadas para este caso): **Pitch** (voz en off por
 * diapositiva: guion a un lado, tomas por bloque, "Create new take"),
 * **Workable** (una tarjeta por TOMA de cada pregunta), **ElevenLabs Voice
 * Changer** y **OpenPhone** (onda de barras + botón circular + `0:07 / ~0:03`),
 * **Apple Notes / Journal** (onda ya grabada con playhead y transporte),
 * **Epidemic Sound** (filas de versiones con su onda, duración y play),
 * **Suno** (anillo de progreso en el botón, ↺ rehacer y 🗑 a los lados),
 * **Descript** ("Record into script" + selector de fuente de audio).
 *
 * Anatomía:
 *
 *   VOZ EN OFF · 2/6 bloques · 0:18            [mic ▾] [3-2-1] [⊙ Assets]
 *   ┌───────────────┬──────────────────────────────────────────────┐
 *   │ ● 01-hook  0:06│  [0-3s] · ~3s · vertical                    │
 *   │ ○ 02-0-3s      │  «Este setup se ve de lo más normal…»       │
 *   │ ○ 03-3-9s  0:09│  ▸ DEMO: plano corto del escritorio         │
 *   │                │  ▁▂▅█▅▂▁ onda en vivo ▁▂▃                   │
 *   │                │       0:07 / ~0:03                          │
 *   │                │     ↺      ( ● )      🗑                     │
 *   │                │  TOMAS · 2   01-hook-vo-2.wav ▁▂▅ 0:06 ▶ ✕  │
 *   └───────────────┴──────────────────────────────────────────────┘
 *
 * Reglas que NO se negocian (son del repo): el archivo en disco es la verdad
 * (nada de estados inventados), re-grabar nunca pisa una toma buena, y una
 * grabación detenida SIEMPRE se guarda.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentPiece, PieceMediaFile } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { useAudioInputs } from "@/hooks/useMediaRecorder";
import { usePieceMedia } from "@/hooks/usePieceMedia";
import { pieceMediaFileUrl } from "@/lib/hermes";
import { beatSeconds, captureFormat, fmtSeconds, takeStem, voTakesFor } from "@/lib/capture";
import { pieceBeats } from "@/lib/script-beats";
import { LiveWaveform, TakeWaveform, useTakePlayer } from "./audio/Waveform";
import { useVoiceMic, useVoiceOverTake } from "./VoiceOver";
import { btnCls, inputCls, selectCls } from "./styles";

/** Fila del riel: un bloque del guion o una toma libre ya grabada. */
interface VoiceRow {
  stem: string;
  label: string;
  say: string | null;
  cues: string[];
  seconds: number | null;
  free: boolean;
}

const COUNT_KEY = "hermes.estudio.vo.countdown";
const NEXT_KEY = "hermes.estudio.vo.autonext";

/** "0:07" con décimas cuando la toma es corta (patrón Apple Notes). */
function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtBytes(b: number): string {
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
}

/** Preferencia booleana persistente (cuenta regresiva, auto-avanzar). */
function useFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const saved = window.localStorage.getItem(key);
    if (saved != null) setValue(saved === "1");
  }, [key]);
  const set = (v: boolean) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* modo privado */
    }
  };
  return [value, set];
}

export function VoiceTab({ piece }: { piece: ContentPiece }) {
  const { revealMediaFolder, removeVoiceover, promoteVoiceover } = useEstudioContext();
  const { media, refresh } = usePieceMedia(piece.id);
  const beats = useMemo(() => pieceBeats(piece), [piece]);
  const take = useVoiceOverTake(piece.id);
  const devices = useAudioInputs();
  const [deviceId, setDeviceId] = useVoiceMic();
  const [countdownOn, setCountdownOn] = useFlag(COUNT_KEY, true);
  const [autoNext, setAutoNext] = useFlag(NEXT_KEY, true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [freeName, setFreeName] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  /** Evita que un doble clic durante la cuenta regresiva dispare dos tomas. */
  const startingRef = useRef(false);

  const assets = media?.assets ?? [];

  // Filas: los bloques del guion + las tomas libres que ya existen en disco.
  const rows: VoiceRow[] = useMemo(() => {
    const planned = beats.map((beat, i) => ({
      stem: takeStem(i, beat.label),
      label: beat.heading ?? beat.label,
      say: beat.say[0] ?? null,
      cues: beat.cues,
      seconds: beatSeconds(beat),
      free: false,
    }));
    const known = new Set(planned.map((r) => r.stem.toLowerCase()));
    const free: VoiceRow[] = [];
    for (const f of assets) {
      const base = f.stem.toLowerCase().replace(/-vo(-\d+)?$/, "");
      if (base === f.stem.toLowerCase()) continue; // no es voz en off
      if (known.has(base) || free.some((r) => r.stem === base)) continue;
      free.push({ stem: base, label: base, say: null, cues: [], seconds: null, free: true });
    }
    return [...planned, ...free];
  }, [beats, assets]);

  const current = rows.find((r) => r.stem === selected) ?? rows[0] ?? null;
  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0].stem);
  }, [rows, selected]);

  const takesOf = (stem: string) => voTakesFor(assets, stem);
  const doneCount = rows.filter((r) => takesOf(r.stem).length > 0).length;
  const totalSec = rows.reduce((acc, r) => {
    const list = takesOf(r.stem);
    return acc + (list[list.length - 1]?.duration_sec ?? 0);
  }, 0);

  const goTo = useCallback(
    (offset: number) => {
      if (!current) return;
      const i = rows.findIndex((r) => r.stem === current.stem);
      const next = rows[Math.min(Math.max(i + offset, 0), rows.length - 1)];
      if (next) setSelected(next.stem);
    },
    [current, rows],
  );

  /** Arranca (con cuenta regresiva opcional) o cierra guardando. */
  const toggleRecord = useCallback(
    async (stem?: string) => {
      const target = stem ?? current?.stem;
      if (!target) return;
      if (take.target) {
        const saved = await take.finish();
        await refresh();
        // Aviso honesto: si el pico fue ~0, el mic no captó nada.
        setWarning(take.lastPeak != null && take.lastPeak < 0.02 ? "silencio" : null);
        if (saved && autoNext) goTo(1);
        return;
      }
      if (startingRef.current) return;
      startingRef.current = true;
      if (countdownOn) {
        for (let n = 3; n > 0; n--) {
          setCountdown(n);
          await new Promise((r) => setTimeout(r, 700));
        }
        setCountdown(null);
      }
      setWarning(null);
      await take.start(target);
      startingRef.current = false;
    },
    [current, take, refresh, autoNext, goTo, countdownOn],
  );

  // Teclado de grabadora (patrón transport): espacio graba/para, ↑↓ cambian de
  // bloque, Esc descarta lo que se está grabando.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Un BUTTON enfocado ya recibe Space del browser (dispara su click):
      // atenderlo aquí también arrancaría y pararía la toma en el mismo golpe.
      if (el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        void toggleRecord();
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        goTo(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        goTo(-1);
      } else if (e.key === "Escape" && take.target) {
        e.preventDefault();
        take.cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRecord, goTo, take]);

  const addFree = async () => {
    const name = freeName.trim();
    if (!name) return;
    setFreeName("");
    setAdding(false);
    await toggleRecord(name);
  };

  const liveOnCurrent = Boolean(current && take.target === current.stem);
  const targetSec = current?.seconds ?? null;
  const overTarget = targetSec != null && take.elapsed > targetSec + 2;

  return (
    <div className="flex flex-col gap-2">
      {/* Cabecera: estado real + fuentes y preferencias de la sesión. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-2xs tracking-label text-text-dim uppercase">
          Voz en off · {doneCount}/{rows.length} bloques
          {totalSec > 0 && (
            <span className="ml-1.5 text-text-faint normal-case tabular-nums">
              {mmss(totalSec)} grabados
            </span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {devices.length > 1 && (
            <select
              value={deviceId ?? ""}
              onChange={(e) => setDeviceId(e.target.value || null)}
              className={selectCls}
              title="Micrófono de entrada"
            >
              <option value="">Mic del sistema</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setCountdownOn(!countdownOn)}
            title="Cuenta regresiva de 3 antes de grabar"
            className={`${btnCls} ${countdownOn ? "border-violet text-violet" : ""}`}
          >
            3·2·1
          </button>
          <button
            onClick={() => setAutoNext(!autoNext)}
            title="Al guardar, saltar al siguiente bloque"
            className={`${btnCls} ${autoNext ? "border-violet text-violet" : ""}`}
          >
            ↓ Auto
          </button>
          <button
            onClick={() => void revealMediaFolder(piece.id, "assets")}
            className={btnCls}
            title="Abrir assets/ en Finder"
          >
            ⊙ Assets
          </button>
        </div>
      </div>

      {media?.root === "local" && (
        <p className="rounded-sm border border-amber/40 bg-amber/5 px-2 py-1 text-2xs text-amber">
          Disco del estudio no conectado — la voz se guarda en la carpeta local
          ({media.dir}); archívala cuando lo conectes.
        </p>
      )}

      {!rows.length ? (
        <p className="text-2xs text-text-faint">
          Esta pieza no tiene bloques todavía. Escribe el guion (o genéralo con Hermes) y aquí
          aparece una fila por bloque para narrarlo.
        </p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Riel de bloques: el estado sale del DISCO, no de un checkbox. */}
          <div className="flex max-h-[30vh] flex-col gap-1 overflow-y-auto overscroll-contain lg:max-h-none">
            {rows.map((row) => {
              const list = takesOf(row.stem);
              const last = list[list.length - 1] ?? null;
              const active = current?.stem === row.stem;
              const rec = take.target === row.stem;
              return (
                <button
                  key={row.stem}
                  onClick={() => setSelected(row.stem)}
                  className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 text-left ${
                    active ? "border-violet bg-violet/5" : "border-line hover:border-line-2"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`text-2xs ${rec ? "animate-pulse text-red" : last ? "text-green" : "text-text-faint"}`}
                  >
                    {rec ? "●" : last ? "✓" : "○"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-2xs text-text-dim">
                    {row.stem}
                  </span>
                  {list.length > 1 && (
                    <span className="shrink-0 text-2xs text-text-faint">{list.length}</span>
                  )}
                  <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                    {last ? fmtSeconds(last.duration_sec) : row.seconds ? `~${row.seconds}s` : ""}
                  </span>
                </button>
              );
            })}
            {adding ? (
              <div className="flex flex-col gap-1 rounded-sm border border-violet/40 p-1.5">
                <input
                  autoFocus
                  value={freeName}
                  onChange={(e) => setFreeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addFree();
                    if (e.key === "Escape") setAdding(false);
                  }}
                  placeholder="nombre de la toma"
                  className={inputCls}
                />
                <button onClick={() => void addFree()} className={`${btnCls} border-red text-red`}>
                  ● Grabar
                </button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className={`${btnCls} justify-start`}>
                ＋ Toma libre
              </button>
            )}
          </div>

          {/* Escena: lo que hay que decir + la grabadora + las tomas. */}
          {current && (
            <div className="flex min-w-0 flex-col gap-3 rounded-sm border border-line px-3 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-2xs text-violet">{current.stem}</span>
                {current.seconds != null && (
                  <span className="text-2xs text-text-faint tabular-nums">
                    ~{current.seconds}s
                  </span>
                )}
                {captureFormat(piece) && (
                  <span className="text-2xs text-text-faint">{captureFormat(piece)}</span>
                )}
              </div>

              {/* Lo que se lee: es el héroe de la pantalla (patrón Meta AI). */}
              <p className="font-display text-lg leading-snug text-text">
                {current.say ?? (
                  <span className="text-sm text-text-faint">
                    Bloque sin frase escrita — narra lo que corresponda o escríbelo en el guion.
                  </span>
                )}
              </p>
              {current.cues.map((c) => (
                <p key={c} className="text-2xs leading-snug text-cyan">
                  ▸ {c}
                </p>
              ))}

              {/* Transporte: onda en vivo + cronómetro + botón circular. */}
              <div className="flex flex-col items-center gap-2 rounded-sm border border-line bg-panel-2/40 px-3 py-3">
                <div className="h-14 w-full">
                  <LiveWaveform meterRef={take.meterRef} active={liveOnCurrent} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-display text-2xl tabular-nums ${
                      liveOnCurrent ? (overTarget ? "text-amber" : "text-text") : "text-text-faint"
                    }`}
                  >
                    {mmss(liveOnCurrent ? take.elapsed : 0)}
                  </span>
                  {current.seconds != null && (
                    <span className="text-xs text-text-faint tabular-nums">
                      / ~{mmss(current.seconds)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-5">
                  <button
                    onClick={take.cancel}
                    disabled={!liveOnCurrent}
                    title="Descartar esta grabación (Esc)"
                    className="text-sm text-text-faint hover:text-text disabled:opacity-25"
                  >
                    ↺
                  </button>
                  <RecordButton
                    recording={liveOnCurrent}
                    saving={take.saving}
                    countdown={countdown}
                    progress={
                      current.seconds ? Math.min(1, take.elapsed / current.seconds) : 0
                    }
                    disabled={!take.supported || (Boolean(take.target) && !liveOnCurrent)}
                    onClick={() => void toggleRecord()}
                  />
                  <button
                    onClick={() => {
                      const list = takesOf(current.stem);
                      const last = list[list.length - 1];
                      if (last) void removeVoiceover(piece.id, last.name).then(refresh);
                    }}
                    disabled={liveOnCurrent || !takesOf(current.stem).length}
                    title="Borrar la última toma de este bloque"
                    className="text-sm text-text-faint hover:text-red disabled:opacity-25"
                  >
                    🗑
                  </button>
                </div>

                <p className="text-2xs text-text-faint">
                  {liveOnCurrent
                    ? "Espacio para cerrar y guardar · Esc descarta"
                    : "Espacio graba · ↑↓ cambia de bloque"}
                </p>
              </div>

              {warning === "silencio" && (
                <p className="rounded-sm border border-amber/40 bg-amber/5 px-2 py-1 text-2xs text-amber">
                  La última toma quedó prácticamente en silencio — revisa el micrófono seleccionado
                  y vuelve a grabarla (la anterior no se pierde).
                </p>
              )}
              {take.error && <p className="text-2xs text-red">{take.error}</p>}
              {!take.supported && (
                <p className="text-2xs text-text-faint">
                  Este navegador no puede grabar audio (o falta el permiso del micrófono).
                </p>
              )}

              <TakeList
                pieceId={piece.id}
                takes={takesOf(current.stem)}
                onRemove={async (name) => {
                  await removeVoiceover(piece.id, name);
                  await refresh();
                }}
                onPromote={async (name) => {
                  await promoteVoiceover(piece.id, name);
                  await refresh();
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Botón circular de grabación: punto rojo → cuadrado al grabar, con anillo de
 * progreso contra la duración estimada del bloque (patrón Suno) y la cuenta
 * regresiva dentro (patrón Descript/Pitch).
 */
function RecordButton({
  recording,
  saving,
  countdown,
  progress,
  disabled,
  onClick,
}: {
  recording: boolean;
  saving: boolean;
  countdown: number | null;
  progress: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <button
      onClick={onClick}
      disabled={disabled || saving}
      aria-label={recording ? "Detener y guardar" : "Grabar voz en off"}
      className="relative flex h-16 w-16 items-center justify-center rounded-full border border-line-2 bg-panel-2 transition-colors hover:border-red disabled:opacity-40"
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64" aria-hidden>
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-line"
        />
        {recording && progress > 0 && (
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - Math.min(1, progress))}
            className="text-red"
          />
        )}
      </svg>
      {countdown != null ? (
        <span className="font-display text-2xl text-red tabular-nums">{countdown}</span>
      ) : saving ? (
        <span className="text-xs text-text-faint">◌</span>
      ) : (
        <span
          aria-hidden
          className={`bg-red transition-all ${recording ? "h-5 w-5 rounded-xs" : "h-7 w-7 rounded-full"}`}
        />
      )}
    </button>
  );
}

/** Tomas del bloque: la última MANDA (patrón "Active Version"). */
function TakeList({
  pieceId,
  takes,
  onRemove,
  onPromote,
}: {
  pieceId: number;
  takes: PieceMediaFile[];
  onRemove: (name: string) => Promise<void>;
  onPromote: (name: string) => Promise<void>;
}) {
  if (!takes.length)
    return (
      <p className="text-2xs text-text-faint">
        Sin tomas de este bloque todavía — el archivo aparecerá en assets/ apenas grabes.
      </p>
    );
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs tracking-label text-text-faint uppercase">
        Tomas · {takes.length}
      </span>
      {takes.map((f, i) => (
        <TakeRow
          key={f.path}
          pieceId={pieceId}
          file={f}
          active={i === takes.length - 1}
          onRemove={() => onRemove(f.name)}
          onPromote={() => onPromote(f.name)}
        />
      ))}
    </div>
  );
}

/** Una toma: onda real, play/pausa con playhead y clic para buscar. */
function TakeRow({
  pieceId,
  file,
  active,
  onRemove,
  onPromote,
}: {
  pieceId: number;
  file: PieceMediaFile;
  active: boolean;
  onRemove: () => void;
  onPromote: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const player = useTakePlayer(url);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    urlRef.current = url;
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [url]);

  // El archivo se baja al primer play (va con Bearer: no sirve un src directo).
  const load = async () => {
    if (url) return url;
    setLoading(true);
    try {
      const u = await pieceMediaFileUrl(pieceId, file.name, "assets");
      setUrl(u);
      return u;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  };

  const play = async () => {
    if (!url) {
      await load();
      // El <audio> monta con el src nuevo; el autoPlay lo arranca.
      return;
    }
    player.toggle();
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 ${
        active ? "border-violet/40 bg-violet/5" : "border-line"
      }`}
    >
      <button
        onClick={() => void play()}
        className="shrink-0 text-sm text-violet hover:text-violet-hot"
        aria-label={`Reproducir ${file.name}`}
      >
        {loading ? "◌" : player.playing ? "❚❚" : "▶"}
      </button>
      <div className="h-6 min-w-0 flex-1">
        <TakeWaveform
          peaks={player.peaks}
          progress={player.progress}
          onSeek={url ? player.seek : undefined}
        />
      </div>
      <span className="shrink-0 text-2xs text-text-faint tabular-nums" title={file.path}>
        {fmtSeconds(file.duration_sec)} · {fmtBytes(file.size_bytes)}
      </span>
      {active ? (
        <span className="shrink-0 text-2xs tracking-label text-violet uppercase">manda</span>
      ) : (
        <button
          onClick={onPromote}
          className="shrink-0 text-2xs text-text-faint hover:text-violet"
          title="Usar esta toma (pasa a ser la última)"
        >
          ▲ usar
        </button>
      )}
      <button
        onClick={onRemove}
        className="shrink-0 text-2xs text-text-faint hover:text-red"
        aria-label={`Borrar ${file.name}`}
      >
        ✕
      </button>
      {url && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={player.audioRef}
          src={url}
          autoPlay
          onPlay={player.handlePlay}
          onPause={() => player.setPlaying(false)}
          onEnded={player.onEnded}
          className="hidden"
        />
      )}
    </div>
  );
}

