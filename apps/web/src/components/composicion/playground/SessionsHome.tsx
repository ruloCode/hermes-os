"use client";

/**
 * Playground · LISTA de sesiones: cada sesión grabada (video de la cámara o
 * memo del micrófono) con su estado real de procesamiento, y un riel con las
 * fuentes que el agente ve AHORA (cámaras montadas, disco de medios).
 *
 * Patrón Descript "Activity": el pipeline es no bloqueante — una sesión que se
 * procesa muestra su etapa en la fila y se puede seguir trabajando en otra.
 *
 * Las tomas de un tema viven en Temas; pero si el tema se BORRÓ, sus tomas
 * siguen en disco y no tenían dónde verse: aquí aparecen como sesiones con la
 * etiqueta "toma de un tema borrado" (`sessionsListed`).
 */
import { useCallback, useEffect, useState } from "react";
import { SESSION_STAGE_LABEL, type ComposeSession, type ComposeSessionSummary } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { PanelState } from "@/components/ui/PanelState";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useComposicion } from "../ComposicionContext";
import { usePlaygroundApi, useViewActive, type ComposeSources } from "./api";
import { usePlayground } from "./PlaygroundContext";
import { ImportSheet } from "./ImportSheet";
import { btnPrimary, plainKey } from "./ui";
import { fmtBytes, fmtDate, fmtDuration, pct } from "./format";
import { PrivacyPill } from "../temas/PrivacyPill";
import { useTemas } from "../temas/TemasProvider";

/**
 * Lo que lista Sesiones: las sesiones grabadas o importadas + las tomas HUÉRFANAS
 * (su tema ya no existe). Con la lista de temas sin cargar no se decide nada:
 * una toma solo es huérfana si la lista llegó y su tema no está.
 */
export function sessionsListed(
  all: ComposeSessionSummary[] | null,
  temas: { id: string }[] | null,
): { sessions: ComposeSessionSummary[] | null; orphans: Set<string>; takeCount: number } {
  if (!all) return { sessions: null, orphans: new Set(), takeCount: 0 };
  const ids = temas ? new Set(temas.map((t) => t.id)) : null;
  const orphans = new Set(all.filter((s) => s.take && ids && !ids.has(s.take.temaId)).map((s) => s.id));
  const sessions = all.filter((s) => !s.take || orphans.has(s.id));
  return { sessions, orphans, takeCount: all.length - sessions.length };
}

const SOURCE_LABEL: Record<ComposeSession["source"]["kind"], string> = {
  camara: "cámara",
  archivo: "archivo",
  microfono: "memo del micrófono",
};

export function SessionsHome() {
  const { sessions: all, sessionsError, reloadSessions, openSession } = usePlayground();
  // Las TOMAS de un tema también son sesiones (una por toma), pero viven en
  // Temas: aquí solo las sesiones grabadas o importadas, y las tomas cuyo tema se borró.
  const { temas } = useTemas();
  const { sessions, orphans, takeCount } = sessionsListed(all, temas);
  const { notation, songs } = useComposicion();
  const active = useViewActive();
  const [importing, setImporting] = useState(false);

  // "I" abre la hoja de importar (sin ⌘: ⌘I ya es del browser).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e) || e.key.toLowerCase() !== "i") return;
      e.preventDefault();
      setImporting(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const created = useCallback(
    (s: ComposeSession) => {
      setImporting(false);
      void reloadSessions();
      openSession(s.id);
    },
    [openSession, reloadSessions],
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-6 gap-y-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
      <section className="col-span-12 flex min-h-[360px] min-w-0 flex-col lg:col-span-8 lg:min-h-0">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <p className="text-xs text-text-faint">
            Sesiones grabadas: de ahí salen los pasajes cantados, su melodía y el molde para la letra.
          </p>
          <div className="flex items-center gap-2">
            <PrivacyPill />
            <button type="button" className={btnPrimary} onClick={() => setImporting(true)}>
              Importar <kbd className="text-2xs opacity-70">I</kbd>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-panel">
          {sessions === null && !sessionsError && (
            <div className="p-4">
              <PanelState kind="loading" />
            </div>
          )}
          {sessions === null && sessionsError && (
            <PanelState
              kind="offline"
              title="El agente no responde"
              hint="Las sesiones viven en el agente (análisis de audio, transcripción). Sin él no hay Playground."
              retry={() => void reloadSessions()}
            />
          )}
          {sessions && sessions.length === 0 && <EmptySessions onImport={() => setImporting(true)} />}
          {sessions && sessions.length > 0 && (
            <ScrollArea className="h-full" fade="y">
              <ul>
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    notation={notation}
                    songTitle={songs.find((x) => x.id === s.songId)?.title}
                    orphan={orphans.has(s.id)}
                    onOpen={() => openSession(s.id)}
                  />
                ))}
              </ul>
              {takeCount > 0 && (
                <p className="border-t border-line px-4 py-2 text-xs text-text-faint">
                  {takeCount} {takeCount === 1 ? "toma grabada" : "tomas grabadas"} sobre la pista de un tema no se
                  listan aquí: viven en Temas.
                </p>
              )}
            </ScrollArea>
          )}
        </div>
      </section>
      <aside aria-label="Contexto" className="col-span-12 min-h-0 border-line lg:col-span-4 lg:border-l lg:pl-6">
        <SourcesRail />
      </aside>
      {importing && <ImportSheet onClose={() => setImporting(false)} onCreated={created} />}
    </div>
  );
}

function EmptySessions({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-text">Todavía no hay sesiones</p>
      <p className="max-w-[46ch] text-xs text-text-dim">
        Importa el video de la cámara (o un audio) de una sesión de composición, o graba un memo aquí mismo. El
        agente encuentra los pasajes cantados y te deja la melodía lista para escribirle letra.
      </p>
      <button type="button" className={`${btnPrimary} mt-2`} onClick={onImport}>
        Importar sesión
      </button>
    </div>
  );
}

function SessionRow({
  s,
  notation,
  songTitle,
  orphan,
  onOpen,
}: {
  s: ComposeSessionSummary;
  notation: "en" | "latin";
  songTitle?: string;
  /** Toma de un tema que ya no existe. */
  orphan?: boolean;
  onOpen: () => void;
}) {
  const meta = [
    fmtDate(s.recordedAt ?? s.createdAt),
    fmtDuration(s.durationSec),
    orphan ? `toma ${s.take?.n ?? ""}`.trim() : SOURCE_LABEL[s.source.kind],
    s.mediaRoot === "local" ? "en local" : null,
  ].filter(Boolean);
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-panel-2/60"
      >
        <StatusDot status={s.status} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-text group-hover:text-accent">{s.title}</span>
            {orphan && (
              <span
                className="shrink-0 rounded-sm border border-line px-1.5 text-xs text-text-dim"
                title="El tema de esta toma se borró; la toma sigue en disco"
              >
                toma de un tema borrado
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-faint">{meta.join(" · ")}</span>
          <span className="mt-1 block text-xs text-text-dim">
            <StatusLine s={s} notation={notation} />
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
          {s.passages > 0 && (
            <span className="text-text-dim tabular-nums">
              {s.probable} {s.probable === 1 ? "pasaje" : "pasajes"}
              {s.passages > s.probable && <span className="text-text-faint"> · {s.passages - s.probable} dudosos o descartados</span>}
            </span>
          )}
          {songTitle && <span className="max-w-[22ch] truncate text-text-faint">♫ {songTitle}</span>}
        </span>
      </button>
    </li>
  );
}

const DOT: Record<ComposeSession["status"], string> = {
  procesando: "bg-accent animate-pulse",
  lista: "bg-green",
  error: "bg-red",
  detenida: "bg-text-faint",
};

function StatusDot({ status }: { status: ComposeSession["status"] }) {
  return <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />;
}

function StatusLine({ s, notation }: { s: ComposeSessionSummary; notation: "en" | "latin" }) {
  const st = s.stage;
  if (s.status === "procesando" && st) {
    return (
      <>
        {SESSION_STAGE_LABEL[st.stage]}
        {st.detail ? ` · ${st.detail}` : ""}
        {st.pct != null ? ` · ${pct(st.pct)}` : ""}
        <span className="text-text-faint"> — puedes seguir trabajando</span>
      </>
    );
  }
  if (s.status === "error")
    return <span className="text-red">Falló en «{st ? SESSION_STAGE_LABEL[st.stage] : "una etapa"}»{st?.error ? `: ${st.error}` : ""}</span>;
  if (s.status === "detenida")
    return <span className="text-text-faint">Detenida{st ? ` en «${SESSION_STAGE_LABEL[st.stage]}»` : ""} · se puede reanudar</span>;
  return (
    <>
      Lista
      {s.key && (
        <span className="text-text-faint">
          {" "}
          · tonalidad ≈ {keyLabel(s.key.key, notation)}
        </span>
      )}
    </>
  );
}

/** Riel: lo que el agente ve AHORA — cámaras montadas y el disco de medios. */
function SourcesRail() {
  const api = usePlaygroundApi();
  const [src, setSrc] = useState<ComposeSources | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .sources()
        .then((s) => {
          if (!cancelled) {
            setSrc(s);
            setErr(null);
          }
        })
        .catch((e: Error) => !cancelled && setErr(e.message));
    void load();
    // Meter la SD es justo lo que se hace con esta pantalla abierta.
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [api]);

  return (
    <div className="flex flex-col gap-6 lg:pt-1">
      <section className="flex flex-col gap-2">
        <span className="text-2xs text-text-faint">Cámaras conectadas</span>
        {err && <p className="text-xs text-text-faint">Sin respuesta del agente.</p>}
        {src && src.cameras.length === 0 && (
          <p className="text-xs text-text-dim">Ninguna. Mete la SD de la cámara y aparecerá aquí.</p>
        )}
        {src?.cameras.map((c) => {
          const bytes = c.files.reduce((a, f) => a + f.bytes, 0);
          return (
            <div key={c.dir} className="flex items-center gap-2.5 border-t border-line/50 py-2 first:border-t-0">
              <span className="h-5 w-0.5 shrink-0 rounded-xs bg-green" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{c.volume}</span>
                <span className="block truncate text-xs text-text-faint">
                  {c.files.length} {c.files.length === 1 ? "clip" : "clips"} · {fmtBytes(bytes)}
                </span>
              </span>
            </div>
          );
        })}
      </section>
      <section className="flex flex-col gap-2">
        <span className="text-2xs text-text-faint">Dónde se guardan</span>
        {src && (
          <p className="text-xs">
            <span className="block truncate font-mono text-text-dim" title={src.mediaRoot}>
              {src.mediaRoot}
            </span>
            <span className={src.connected ? "text-green" : "text-amber"}>
              {src.connected ? "disco conectado" : "disco no conectado · se guarda en local"}
            </span>
          </p>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <span className="text-2xs text-text-faint">Qué hace el agente con una sesión</span>
        <ol className="flex flex-col gap-1.5 text-xs text-text-dim">
          <li>1 · Copia el video al disco y verifica la copia antes de tocar nada.</li>
          <li>2 · Transcribe, separa las voces y resume lo que decidieron.</li>
          <li>3 · Encuentra los pasajes cantados (letra, melismas, «na na», rap) con su evidencia.</li>
          <li>4 · Aísla la voz y saca melodía, sílabas y tonalidad de cada pasaje.</li>
        </ol>
        <p className="text-xs text-text-faint">
          Todo lo medido es aproximado y se muestra con su confianza. La letra la decides tú.
        </p>
      </section>
    </div>
  );
}
