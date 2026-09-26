"use client";

/**
 * Columna de contexto de una sesión: el video (o el audio) arriba — es el reloj
 * maestro de toda la pantalla — y abajo, una cosa a la vez: la conversación
 * alrededor del pasaje elegido (patrón Fireflies: lo que dijeron antes de
 * cantarlo ES la intención de la canción), el resumen con SUS líneas (▶ salta
 * al momento) y las voces (renombrar / unir, patrón Descript).
 *
 * Lo que se lee va sin marco; solo el video lleva caja porque se opera.
 */
import { useEffect, useMemo, useState } from "react";
import type { ComposeSession, Passage } from "@hermes/shared";
import { TabBar } from "@/components/ui/TabBar";
import type { ComposeTranscriptLine } from "./api";
import type { MediaClock } from "./useMediaClock";
import { resolveSpeaker, visibleSpeakers } from "./VoiceStrip";
import { VOICE_BG, btnGhost, field } from "./ui";
import { fmtDuration, fmtTime } from "./format";

type AsideTab = "contexto" | "resumen" | "voces";

/** ¿Este navegador reproduce el códec del video? HEVC (cámaras) muchas veces no. */
function canPlayVideo(codec: string | undefined): boolean {
  if (typeof document === "undefined") return true;
  if (!codec || !/hevc|h265|hvc|hev/i.test(codec)) return true;
  const v = document.createElement("video");
  return (
    v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "" ||
    v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== ""
  );
}

export function SessionMedia({
  session,
  clock,
  fileUrl,
}: {
  session: ComposeSession;
  clock: MediaClock;
  fileUrl: (rel: string) => string;
}) {
  const [videoFailed, setVideoFailed] = useState(false);
  const videoOk = useMemo(() => canPlayVideo(session.video?.codec), [session.video?.codec]);
  const useVideo = !!session.files.original && !!session.video && videoOk && !videoFailed;
  const audioRel = session.files.audio ?? (!session.video ? session.files.original : undefined);

  if (useVideo) {
    const portrait = (session.video?.height ?? 0) > (session.video?.width ?? 1);
    return (
      <div className="flex shrink-0 flex-col items-center gap-1">
        <video
          {...clock.bind}
          src={fileUrl(session.files.original!)}
          controls
          preload="metadata"
          playsInline
          onError={() => setVideoFailed(true)}
          onLoadedMetadata={(e) => {
            // Chrome sin decodificador HEVC carga el audio y deja el cuadro en negro.
            if (e.currentTarget.videoWidth === 0) setVideoFailed(true);
          }}
          className={`rounded-sm border border-line bg-black ${portrait ? "max-h-[300px] w-auto" : "w-full"}`}
        />
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      {session.files.original && session.video && (
        <p className="text-xs text-amber">
          Este navegador no reproduce el video de la cámara ({session.video.codec}). Aquí va solo el audio; el
          video sigue intacto en la carpeta de la sesión.
        </p>
      )}
      {audioRel ? (
        <audio {...clock.bind} src={fileUrl(audioRel)} controls preload="metadata" className="h-9 w-full" />
      ) : (
        <p className="text-xs text-text-faint">El audio aparece cuando termine «Extraer audio».</p>
      )}
    </div>
  );
}

export function SessionAside({
  session,
  transcript,
  clock,
  selected,
  onRenameSpeaker,
  onMergeSpeaker,
}: {
  session: ComposeSession;
  transcript: ComposeTranscriptLine[] | null;
  clock: MediaClock;
  selected: Passage | null;
  onRenameSpeaker: (id: string, name: string) => void;
  onMergeSpeaker: (id: string, into: string | null) => void;
}) {
  const [tab, setTab] = useState<AsideTab>("contexto");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <TabBar
        tabs={[
          { id: "contexto", label: "Contexto" },
          { id: "resumen", label: "Resumen" },
          { id: "voces", label: "Voces", badge: visibleSpeakers(session).length || undefined },
        ]}
        active={tab}
        onChange={(id) => setTab(id as AsideTab)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {tab === "contexto" && (
          <Context session={session} transcript={transcript} clock={clock} selected={selected} />
        )}
        {tab === "resumen" && <Summary session={session} clock={clock} />}
        {tab === "voces" && (
          <Voices session={session} onRename={onRenameSpeaker} onMerge={onMergeSpeaker} />
        )}
      </div>
    </div>
  );
}

/** La conversación alrededor del pasaje (±40 s) o del playhead si no hay pasaje elegido. */
function Context({
  session,
  transcript,
  clock,
  selected,
}: {
  session: ComposeSession;
  transcript: ComposeTranscriptLine[] | null;
  clock: MediaClock;
  selected: Passage | null;
}) {
  const voices = visibleSpeakers(session);
  const center = selected ? { a: selected.start, b: selected.end } : { a: clock.time, b: clock.time };
  const lines = (transcript ?? []).filter((l) => l.end >= center.a - 40 && l.start <= center.b + 40);

  useEffect(() => {
    document.querySelector("[data-ctx-now]")?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  if (!transcript)
    return <p className="py-3 text-xs text-text-faint">La transcripción aparece cuando termine «Transcribir».</p>;
  if (lines.length === 0)
    return <p className="py-3 text-xs text-text-faint">Nadie habló cerca de este momento.</p>;
  return (
    <ol className="flex flex-col gap-2 py-1">
      <li className="text-xs text-text-faint">
        {selected ? `Alrededor de ${selected.label} (±40 s)` : `Alrededor de ${fmtTime(clock.time)} (±40 s)`}
      </li>
      {lines.map((l, i) => {
        const who = resolveSpeaker(session, l.speaker);
        const v = voices.find((x) => x.id === who);
        const inside = selected ? l.end > selected.start && l.start < selected.end : false;
        return (
          <li key={`${l.start}-${i}`} data-ctx-now={inside || undefined} className="flex gap-2">
            <button
              type="button"
              onClick={() => clock.playRange(l.start)}
              className="shrink-0 cursor-pointer font-mono text-2xs text-text-faint tabular-nums hover:text-accent"
              title="Ir a este momento"
            >
              {fmtTime(l.start)}
            </button>
            <p className={`min-w-0 text-xs leading-relaxed ${inside ? "text-text" : "text-text-dim"}`}>
              <span className="mr-1 inline-flex items-center gap-1 align-baseline text-text-faint">
                {v && <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${VOICE_BG[v.color]}`} />}
                {v?.name ?? l.speaker}
                {l.sung && <span title="cantado">♪</span>}:
              </span>
              <span className={l.sung ? "italic" : ""}>{l.text}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Summary({ session, clock }: { session: ComposeSession; clock: MediaClock }) {
  const s = session.summary;
  if (!s)
    return (
      <p className="py-3 text-xs text-text-faint">
        {session.status === "procesando"
          ? "El resumen aparece cuando termine «Resumen de la sesión»."
          : "Esta sesión no tiene resumen."}
      </p>
    );
  const at = (t?: number) =>
    t != null ? (
      <button
        type="button"
        onClick={() => clock.playRange(t)}
        className="shrink-0 cursor-pointer font-mono text-2xs text-text-faint tabular-nums hover:text-accent"
        title="Ir a este momento"
      >
        ▶ {fmtTime(t)}
      </button>
    ) : null;
  return (
    <div className="flex flex-col gap-5 py-1">
      <section className="flex flex-col gap-1">
        {s.workingTitle && <p className="text-sm font-medium text-text">«{s.workingTitle}»</p>}
        <p className="text-xs leading-relaxed text-text-dim">{s.theme}</p>
      </section>
      {s.lines.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className="text-2xs text-text-faint">Sus líneas · literales, como las cantaron o dictaron</span>
          <ol className="flex flex-col gap-1">
            {s.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-2">
                {at(l.at)}
                <span className="min-w-0 text-xs text-text">
                  {l.text}
                  {l.section && <span className="text-text-faint"> · {l.section}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {s.structure.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className="text-2xs text-text-faint">Estructura</span>
          <ul className="flex flex-col gap-1">
            {s.structure.map((x, i) => (
              <li key={i} className="flex items-baseline gap-2 text-xs">
                {at(x.at)}
                <span className="shrink-0 text-text">{x.section}</span>
                <span className="min-w-0 text-text-dim">{x.idea}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.decisions.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className="text-2xs text-text-faint">Decisiones</span>
          <ul className="flex flex-col gap-1">
            {s.decisions.map((x, i) => (
              <li key={i} className="flex items-baseline gap-2 text-xs text-text-dim">
                {at(x.at)}
                <span className="min-w-0">{x.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.pending.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className="text-2xs text-text-faint">Pendiente</span>
          <ul className="flex flex-col gap-1">
            {s.pending.map((x, i) => (
              <li key={i} className="flex items-baseline gap-2 text-xs text-text-dim">
                {at(x.at)}
                <span className="min-w-0">{x.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Renombrar y unir voces: la diarización parte a una persona en dos al pasar de hablar a cantar. */
function Voices({
  session,
  onRename,
  onMerge,
}: {
  session: ComposeSession;
  onRename: (id: string, name: string) => void;
  onMerge: (id: string, into: string | null) => void;
}) {
  const voices = visibleSpeakers(session);
  if (session.speakers.length === 0)
    return <p className="py-3 text-xs text-text-faint">Las voces aparecen cuando termina la transcripción.</p>;
  return (
    <div className="flex flex-col gap-1 py-1">
      <p className="mb-1 text-xs text-text-faint">
        Si una misma persona quedó partida en dos voces, únelas: sus pasajes y su tiempo se suman.
      </p>
      {session.speakers.map((sp) => {
        const color = voices.find((v) => v.id === sp.id)?.color;
        const target = sp.mergedInto ? session.speakers.find((x) => x.id === sp.mergedInto) : null;
        return (
          <div key={sp.id} className="flex items-center gap-2 border-t border-line/50 py-1.5 first:border-t-0">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${color != null ? VOICE_BG[color] : "bg-line-2"}`}
            />
            <NameField
              value={sp.name}
              disabled={!!sp.mergedInto}
              onCommit={(n) => n !== sp.name && onRename(sp.id, n)}
            />
            <span className="shrink-0 text-2xs text-text-faint tabular-nums">
              {fmtDuration(sp.seconds)}
              {sp.singingSeconds > 0 && ` · ♪ ${fmtDuration(sp.singingSeconds)}`}
            </span>
            {sp.mergedInto ? (
              <button type="button" className={btnGhost} onClick={() => onMerge(sp.id, null)}>
                unida a {target?.name ?? sp.mergedInto} · separar
              </button>
            ) : (
              voices.length > 1 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && onMerge(sp.id, e.target.value)}
                  className={`${field} w-28`}
                  aria-label={`Unir ${sp.name} con otra voz`}
                >
                  <option value="">Unir con…</option>
                  {voices
                    .filter((v) => v.id !== sp.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </select>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function NameField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && onCommit(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`${field} min-w-0 flex-1 disabled:opacity-50`}
      aria-label="Nombre de la voz"
    />
  );
}
