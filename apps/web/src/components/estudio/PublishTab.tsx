"use client";

/**
 * Tab PUBLICACIÓN: de "el video está listo" a "el video está en YouTube",
 * como un proceso de TRES pasos numerados que se leen de arriba a abajo:
 *
 *   ① EL VIDEO   — ¿hay master? (dato del disco, no checkbox)
 *   ② CUÁNDO     — fecha + hora + zona (SchedulePanel)
 *   ③ POR RED    — una variante por plataforma con su estado REAL
 *   ▸ PROGRAMAR PUBLICACIÓN — el único botón grande; abre el modal de revisión
 *
 * Publicar es IRREVERSIBLE y sale de la casa, así que nunca está a un clic:
 * el CTA abre un modal de revisión (Kajabi "Everything look good?" · beehiiv
 * "Review and publish" con la fecha EN el botón) que muestra qué archivo, a
 * qué redes y cuándo — y solo ahí se confirma. Un clic fantasma ya subió un
 * video de prueba al canal real (TFYDBmye6nI, 2026-08-10): esa es la razón.
 *
 * Dos estados por variante, nunca colapsados: el editorial (`status`, lo marca
 * el dueño) y el REAL (`publish_state`, verificado contra la API).
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  PLATFORM_PROVIDER,
  effectiveTitle,
  isInherited,
  newPublication,
  publicationRows,
} from "@hermes/shared";
import type { ContentPiece, ContentPublication, PieceMetrics } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Badge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/ui/Sparkline";
import { ConfirmModal } from "./ConfirmModal";
import { PUBLISH_STATES, fmtPublish, isoToLocal } from "./labels";
import { ALL_PLATFORMS, PLATFORM_INFO, PlatformCard, type Platform } from "./PlatformCards";
import { SchedulePanel } from "./SchedulePanel";
import { btnCls, inputCls, selectCls } from "./styles";

type PatchFn = ReturnType<typeof useEstudioContext>["patchPiece"];

const PUB_STATUSES: ContentPublication["status"][] = ["borrador", "programada", "publicada"];
const baseName = (p: string) => p.split("/").pop() ?? p;

const isAuto = (p: ContentPublication) => PLATFORM_PROVIDER[p.platform] !== "manual";

export function PublicacionTab({ piece, onPatch }: { piece: ContentPiece; onPatch: PatchFn }) {
  const save = (pubs: ContentPublication[]) => void onPatch(piece.id, { publications: pubs });
  /** null = cerrado · "all" = CTA grande · id = el ▶ de una fila. */
  const [confirming, setConfirming] = useState<null | "all" | string>(null);
  // Las filas salen de las plataformas de la pieza: elegir la red basta.
  const rows = publicationRows(piece);

  return (
    <div className="flex flex-col gap-3">
      <ScheduledBanner piece={piece} />
      <ResultsSection piece={piece} />

      <Section n={1} label="El video">
        <MasterCard piece={piece} />
      </Section>

      <Section n={2} label="Cuándo sale">
        <SchedulePanel piece={piece} />
      </Section>

      <Section n={3} label="A qué redes">
        <PlatformGrid piece={piece} onPatch={onPatch} />
        <PublishRunBanner piece={piece} />
        {rows.map((pub) => (
          <VariantRow
            key={pub.id}
            piece={piece}
            pub={pub}
            onUpdate={(patch) => {
              // Fila virtual (derivada de las plataformas): al editarla se
              // materializa; si ya existía, se parchea en su sitio.
              const exists = piece.publications.some((p) => p.id === pub.id);
              save(
                exists
                  ? piece.publications.map((p) => (p.id === pub.id ? { ...p, ...patch } : p))
                  : [...piece.publications, { ...pub, ...patch }],
              );
            }}
            onPublish={() => setConfirming(pub.id)}
          />
        ))}
        {!rows.length && (
          <p className="text-xs text-text-faint">
            Enciende arriba las redes a las que va este video.
          </p>
        )}
      </Section>

      <PublishCTA piece={piece} onOpen={() => setConfirming("all")} />

      {confirming && (
        <PublishConfirmModal
          piece={piece}
          only={confirming === "all" ? undefined : confirming}
          onPatch={onPatch}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

/**
 * Cuando la pieza YA está programada, lo primero que se lee es eso — no los
 * pasos para programarla. Antes había que deducirlo del stepper y abrir el
 * panel de fecha; con el video ya comprometido, "¿cuándo sale y cómo va cada
 * red?" es la única pregunta viva.
 */
function ScheduledBanner({ piece }: { piece: ContentPiece }) {
  if (piece.status !== "programado" && piece.status !== "publicado") return null;
  const rows = publicationRows(piece);
  const live = piece.status === "publicado";
  const when = piece.publish_at;
  const past = when ? new Date(when).getTime() < Date.now() : false;

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-sm border px-3 py-2 ${
        live ? "border-line bg-panel-2/40" : "border-cyan/40 bg-cyan/6"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`text-2xs tracking-label uppercase ${live ? "text-text-dim" : "text-cyan"}`}
        >
          {live ? "● Publicado" : "● Programado"}
        </span>
        {when ? (
          <span className="text-sm text-text tabular-nums">
            {live || past ? "salió" : "sale"} {fmtPublish(when)}
          </span>
        ) : (
          <span className="text-sm text-amber">sin fecha puesta</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {rows.map((r) => {
          const st = PUBLISH_STATES[r.publish_state];
          return (
            <span
              key={r.id}
              className="inline-flex items-center gap-1 rounded-xs border border-line px-1.5 py-0.5 text-2xs"
            >
              <span className="text-text-faint">{PLATFORM_INFO[r.platform].icon}</span>
              <span className="text-text-dim">{PLATFORM_INFO[r.platform].label}</span>
              <span className={TONE_TEXT[st.tone]}>{st.label}</span>
              {r.remote_url && (
                <a href={r.remote_url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                  ↗
                </a>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Resultados (bucle de la migración 022) ─────────────────────────────

const fmtNum = (n: number): string =>
  new Intl.NumberFormat("es-CO", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);

/**
 * Cómo le fue al video, con DATO REAL de la API — la sección solo existe si la
 * pieza tiene publicaciones remotas, y cada número dice su fuente. Sin filas,
 * se muestra el porqué accionable (sync pendiente / falta scope), nunca un
 * panel de ceros decorativos.
 */
function ResultsSection({ piece }: { piece: ContentPiece }) {
  const { pieceMetrics, syncMetrics } = useEstudioContext();
  const [metrics, setMetrics] = useState<PieceMetrics | null>(null);
  const [syncing, setSyncing] = useState(false);
  const hasRemote = piece.publications.some((p) => p.remote_id);

  useEffect(() => {
    if (hasRemote) void pieceMetrics(piece.id).then(setMetrics);
    else setMetrics(null);
  }, [piece.id, hasRemote, pieceMetrics]);

  if (!hasRemote || !metrics) return null;

  const analytics = metrics.rows.filter((r) => r.source === "youtube-analytics");
  const cumulative = metrics.rows.filter((r) => r.source === "youtube-data").at(-1) ?? null;
  const sum = (pick: (r: (typeof analytics)[number]) => number | null): number | null =>
    analytics.some((r) => pick(r) != null)
      ? analytics.reduce((acc, r) => acc + (pick(r) ?? 0), 0)
      : null;
  const lastPct = [...analytics].reverse().find((r) => r.avg_view_pct != null)?.avg_view_pct ?? null;
  const updated = metrics.rows.at(-1)?.fetched_at ?? null;

  const stats: { label: string; value: string }[] = [];
  if (analytics.length) {
    const views = sum((r) => r.views);
    const engaged = sum((r) => r.engaged_views);
    const subs = sum((r) => r.subs_gained);
    const likes = sum((r) => r.likes);
    if (views != null) stats.push({ label: "views", value: fmtNum(views) });
    if (engaged != null) stats.push({ label: "con intención", value: fmtNum(engaged) });
    if (lastPct != null) stats.push({ label: "retención media", value: `${Math.round(lastPct)}%` });
    if (subs != null) stats.push({ label: "subs ganados", value: fmtNum(subs) });
    if (likes != null) stats.push({ label: "likes", value: fmtNum(likes) });
  } else if (cumulative) {
    if (cumulative.views != null)
      stats.push({ label: "views (acum.)", value: fmtNum(cumulative.views) });
    if (cumulative.likes != null)
      stats.push({ label: "likes (acum.)", value: fmtNum(cumulative.likes) });
    if (cumulative.comments != null)
      stats.push({ label: "comentarios", value: fmtNum(cumulative.comments) });
  }

  const curve = metrics.retention
    .filter((p) => p.watch_ratio != null)
    .map((p) => p.watch_ratio as number);

  const resync = async () => {
    setSyncing(true);
    await syncMetrics();
    setMetrics(await pieceMetrics(piece.id));
    setSyncing(false);
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel-2/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-2xs tracking-label text-text-dim uppercase">Resultados</span>
        <span className="flex-1" />
        {updated && (
          <span className="text-2xs text-text-faint tabular-nums">
            {new Date(updated).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
          </span>
        )}
        <button onClick={() => void resync()} disabled={syncing} className={btnCls}>
          {syncing ? "◌ trayendo…" : "↻ Sincronizar"}
        </button>
      </div>

      {stats.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-sm bg-panel-2 px-2 py-1">
              <div className="font-display text-sm text-text tabular-nums">{s.value}</div>
              <div className="text-2xs tracking-label text-text-faint uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-2xs text-text-faint">{metrics.hint ?? "sin datos todavía"}</p>
      )}

      {curve.length > 1 && (
        <div>
          <Sparkline data={curve} tone="cyan" fill height={30} className="w-full" />
          <p className="text-2xs text-text-faint">
            curva de retención — en qué punto del video se van (YouTube Analytics)
          </p>
        </div>
      )}

      {stats.length > 0 && (
        <p className="text-2xs text-text-faint">
          fuente: {analytics.length ? "YouTube Analytics (suma diaria)" : "YouTube Data API (acumulado)"}
        </p>
      )}
    </div>
  );
}

/** Clases ESTÁTICAS por tono (Tailwind purga las interpoladas). */
const TONE_TEXT: Record<string, string> = {
  violet: "text-violet",
  cyan: "text-cyan",
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  neutral: "text-text-faint",
};

/** Cabecera numerada de paso: el proceso se lee ①②③ de arriba a abajo. */
function Section({
  n,
  label,
  right,
  children,
}: {
  n: number;
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-2 text-[9px] text-text-dim tabular-nums"
        >
          {n}
        </span>
        <span className="text-2xs tracking-label text-text-dim uppercase">{label}</span>
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * Encender/apagar redes: es la ÚNICA forma de elegir a dónde va el video.
 * Encender = añadir la plataforma a la pieza (y su fila aparece sola);
 * apagar = quitarla, salvo que ya se haya subido (eso no se deshace aquí).
 */
function PlatformGrid({ piece, onPatch }: { piece: ContentPiece; onPatch: PatchFn }) {
  const active = new Set(piece.platforms);

  const toggle = (platform: Platform) => {
    const pub = piece.publications.find((p) => p.platform === platform);
    if (pub?.remote_id) return; // ya subida: la red se queda
    const platforms = active.has(platform)
      ? piece.platforms.filter((p) => p !== platform)
      : [...piece.platforms, platform];
    onPatch(piece.id, {
      platforms,
      // Apagar una red se lleva su texto: no dejamos filas huérfanas.
      publications: active.has(platform)
        ? piece.publications.filter((p) => p.platform !== platform)
        : piece.publications,
    });
  };

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
      {ALL_PLATFORMS.map((platform) => {
        const pub = piece.publications.find((p) => p.platform === platform);
        return (
          <PlatformCard
            key={platform}
            platform={platform}
            active={active.has(platform)}
            state={pub?.publish_state ?? null}
            onToggle={() => toggle(platform)}
          />
        );
      })}
    </div>
  );
}

// ── ① El master ────────────────────────────────────────────────────────

function MasterCard({ piece }: { piece: ContentPiece }) {
  const { sealMaster, openEditOutput, providers } = useEstudioContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const master = piece.master_path;

  const rescan = async () => {
    setBusy(true);
    setError(null);
    const r = await sealMaster(piece.id);
    if (r && !r.master) setError("no encontré ningún video en exports/ ni en el run de edición");
    setBusy(false);
  };

  const open = async (reveal: boolean) => {
    const r = await openEditOutput(piece.id, reveal);
    if (!r.ok) setError(r.error ?? "no se pudo abrir");
  };

  const youtube = providers.find((p) => p.provider === "youtube");

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-sm border px-2 py-2 ${
        master ? "border-green/40 bg-green/5" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs ${master ? "text-green" : "text-text-dim"}`}>
          {master ? "✓ Master listo" : "Sin master"}
        </span>
        {master ? (
          <span className="min-w-0 truncate text-2xs text-text-dim" title={master}>
            {baseName(master)}
          </span>
        ) : (
          <span className="min-w-0 text-2xs text-text-faint">
            exporta el corte a la carpeta de la pieza (exports/) o córrelo con OpenMontage
          </span>
        )}
        <span className="flex-1" />
        {master && (
          <>
            <button onClick={() => void open(false)} className={btnCls}>
              ▶ Ver
            </button>
            <button onClick={() => void open(true)} className={btnCls}>
              ⊙ Finder
            </button>
          </>
        )}
        <button onClick={() => void rescan()} disabled={busy} className={btnCls}>
          {busy ? "◌ buscando…" : "↻ Buscar master"}
        </button>
      </div>

      {youtube && (
        <p className="text-2xs text-text-faint">
          {youtube.configured ? (
            <>
              <span className="text-green">●</span> {youtube.label} conectado — las variantes de
              YouTube/Shorts se suben solas.
            </>
          ) : (
            <>
              <span className="text-amber">●</span> {youtube.label} sin conectar: {youtube.hint}
            </>
          )}
        </p>
      )}
      {error && <p className="text-2xs text-red">{error}</p>}
    </div>
  );
}

// ── Run en curso (mismo lenguaje que la edición automática) ────────────

function PublishRunBanner({ piece }: { piece: ContentPiece }) {
  const job = piece.publish_job;
  if (!job || job.status !== "running") return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(job.started_at).getTime()) / 60000));
  return (
    <div className="flex items-center gap-2 rounded-sm border border-violet/40 bg-violet/5 px-2 py-2">
      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
      <span className="flex-1 text-xs text-text">{job.detail ?? "publicando…"}</span>
      <span className="text-2xs text-text-faint tabular-nums">
        {min < 1 ? "recién" : `${min} min`}
      </span>
    </div>
  );
}

// ── ③ El texto de una red ──────────────────────────────────────────────

/**
 * Una red encendida. La plataforma ya no se elige aquí (eso es la tarjeta de
 * arriba): esta fila es SOLO el texto, y viene plegada porque el título se
 * hereda del hook — abrirla es opcional, no un trámite obligatorio.
 */
function VariantRow({
  piece,
  pub,
  onUpdate,
  onPublish,
}: {
  piece: ContentPiece;
  pub: ContentPublication;
  onUpdate: (patch: Partial<ContentPublication>) => void;
  onPublish: () => void;
}) {
  const [open, setOpen] = useState(false);
  const info = PLATFORM_INFO[pub.platform];
  const auto = isAuto(pub);
  const locked = Boolean(pub.remote_id);
  const state = PUBLISH_STATES[pub.publish_state];
  const title = effectiveTitle(piece, pub);
  const inherited = isInherited(pub);

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-sm border px-2 py-1.5 ${
        pub.publish_state === "error" ? "border-red/40" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-text-dim">{info.icon}</span>
        <span className="shrink-0 text-2xs tracking-label text-text-dim uppercase">
          {info.label}
        </span>

        {/* El título que se va a mandar, tal cual. Heredado se dice. */}
        <span className="min-w-0 flex-1 truncate text-xs text-text" title={title}>
          {title}
          {inherited && <span className="ml-1.5 text-2xs text-text-faint">· del hook</span>}
        </span>

        <Badge tone={state.tone} variant="solid" size="sm">
          {state.label}
        </Badge>

        {pub.remote_url && (
          <a
            href={pub.remote_url}
            target="_blank"
            rel="noreferrer"
            className="text-2xs text-cyan hover:underline"
          >
            Ver ↗
          </a>
        )}
        {auto && !locked && (
          <button
            onClick={onPublish}
            disabled={!piece.master_path}
            title={
              piece.master_path
                ? "Revisar y subir solo esta red"
                : "Sin master no hay nada que subir (paso ①)"
            }
            className={`${btnCls} ${
              piece.master_path ? "border-violet text-violet" : "opacity-40"
            }`}
          >
            {pub.publish_state === "error" ? "↻ Reintentar…" : "▶ Subir…"}
          </button>
        )}
        {!locked && (
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="text-2xs text-text-faint uppercase hover:text-text-dim"
          >
            {open ? "▴ cerrar" : "✎ texto"}
          </button>
        )}
      </div>

      {open && !locked && (
        <>
          <input
            value={pub.title ?? ""}
            onChange={(e) => onUpdate({ title: e.target.value || null })}
            placeholder={`Título propio para ${info.label} (vacío = el hook de la pieza)`}
            className={inputCls}
          />
          <textarea
            value={pub.copy ?? ""}
            onChange={(e) => onUpdate({ copy: e.target.value || null })}
            placeholder="Descripción + hashtags (opcional)…"
            className={`${inputCls} min-h-[52px] resize-y`}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="datetime-local"
              value={isoToLocal(pub.scheduled_at)}
              onChange={(e) =>
                onUpdate({
                  scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
              className={`${inputCls} tabular-nums`}
              aria-label={`Hora propia para ${info.label}`}
            />
            <select
              value={pub.status}
              onChange={(e) => onUpdate({ status: e.target.value as ContentPublication["status"] })}
              className={selectCls}
              aria-label="Estado editorial"
            >
              {PUB_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            {pub.attempts > 0 && (
              <span className="text-2xs text-text-faint tabular-nums">
                {pub.attempts} intento{pub.attempts === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </>
      )}

      {/* El error va en su propia línea y con el texto literal del agente. */}
      {pub.last_error && (
        <p className={`text-2xs ${pub.publish_state === "error" ? "text-red" : "text-amber"}`}>
          {pub.publish_state === "error" ? "✕" : "!"} {pub.last_error}
        </p>
      )}
      {locked && (
        <p className="text-2xs text-text-faint">
          Ya subida — el texto vive en la plataforma; edítalo allá si hace falta.
        </p>
      )}
    </div>
  );
}

// ── El botón grande ────────────────────────────────────────────────────

/**
 * Un solo CTA prominente al final del proceso (Ghost: "Continue, final
 * review →"). Deshabilitado dice EXACTAMENTE qué falta — nunca un botón
 * muerto sin explicación.
 */
function PublishCTA({ piece, onOpen }: { piece: ContentPiece; onOpen: () => void }) {
  const targets = publicationRows(piece).filter(
    (p) => isAuto(p) && !p.remote_id && Boolean(effectiveTitle(piece, p)),
  );

  const missing: string[] = [];
  if (!piece.master_path) missing.push("el video (paso ①)");
  if (!piece.publish_at) missing.push("la fecha y hora (paso ②)");
  if (!targets.length) missing.push("encender una red automática (paso ③)");

  const ready = missing.length === 0;

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onOpen}
        disabled={!ready}
        className={`w-full rounded-sm border px-4 py-2.5 text-xs tracking-label uppercase ${
          ready
            ? "border-violet bg-violet/15 text-violet hover:bg-violet/25"
            : "cursor-not-allowed border-line-2 bg-panel-2 text-text-faint"
        }`}
      >
        {ready
          ? `▶ Programar publicación · ${fmtPublish(piece.publish_at)}`
          : "▶ Programar publicación"}
      </button>
      {!ready && (
        <p className="text-center text-2xs text-text-faint">
          Falta: {missing.join(" · ")} — pasos ①②③ de arriba.
        </p>
      )}
    </div>
  );
}

// ── El modal de revisión ───────────────────────────────────────────────

/**
 * Última mirada antes de que algo salga de la casa (Kajabi/beehiiv): qué
 * archivo, a qué redes, cuándo, y la nota de irreversibilidad. El botón de
 * confirmar lleva la fecha — nunca un "OK".
 */
function PublishConfirmModal({
  piece,
  only,
  onPatch,
  onClose,
}: {
  piece: ContentPiece;
  /** id de UNA variante (el ▶ de la fila) · undefined = todas las listas. */
  only?: string;
  onPatch: PatchFn;
  onClose: () => void;
}) {
  const { publishPiece } = useEstudioContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = publicationRows(piece);
  const targets = rows.filter(
    (p) => isAuto(p) && !p.remote_id && Boolean(effectiveTitle(piece, p)) && (!only || p.id === only),
  );
  const manual = rows.filter((p) => !isAuto(p) && (!only || p.id === only));
  const scheduled = Boolean(piece.publish_at && new Date(piece.publish_at).getTime() > Date.now());

  const confirm = async () => {
    setBusy(true);
    setError(null);
    // 1) MATERIALIZAR: las filas de red son virtuales hasta aquí (se derivan de
    //    piece.platforms). Sin persistirlas, el agente ve `publications: []` y
    //    no publica nada aunque la UI diga que todo está listo.
    // 2) Mover a "programado" es parte del mismo gesto confirmado.
    await onPatch(piece.id, {
      publications: rows,
      ...(piece.status !== "programado" && piece.status !== "publicado"
        ? { status: "programado" as const }
        : {}),
    });
    const r = await publishPiece(piece.id, only);
    setBusy(false);
    if (r.error) setError(r.error);
    else onClose();
  };

  return (
    <ConfirmModal
      title="Revisar y programar"
      confirmLabel={
        scheduled ? `Subir ya · sale ${fmtPublish(piece.publish_at)}` : "Subir ya (queda privado)"
      }
      tone={scheduled ? "violet" : "amber"}
      disabled={targets.length === 0}
      busy={busy}
      onConfirm={() => void confirm()}
      onClose={onClose}
    >
      <Row k="Video">
        {piece.master_path ? baseName(piece.master_path) : <span className="text-red">falta</span>}
      </Row>
      <Row k="Cuándo">
        {piece.publish_at ? (
          <>
            {fmtPublish(piece.publish_at)}
            {!scheduled && <span className="text-amber"> · ya pasó</span>}
          </>
        ) : (
          <span className="text-amber">sin fecha</span>
        )}
      </Row>
      <Row k="Se sube">
        {targets.length ? (
          targets.map((t) => (
            <span key={t.id} className="mr-2 inline-flex items-center gap-1">
              <span className="text-violet">{PLATFORM_INFO[t.platform].icon}</span>
              <span className="text-violet">{PLATFORM_INFO[t.platform].label}</span>
              <span className="text-text-faint">— {effectiveTitle(piece, t).slice(0, 48)}</span>
            </span>
          ))
        ) : (
          <span className="text-red">ninguna red lista</span>
        )}
      </Row>
      {manual.length > 0 && (
        <Row k="Las subes tú">{manual.map((m) => PLATFORM_INFO[m.platform].label).join(" · ")}</Row>
      )}

      <p className="rounded-xs border border-line px-2 py-1.5 text-2xs leading-snug text-text-faint">
        {scheduled
          ? "El video se sube AHORA en privado y YouTube lo hace público a la hora programada — el Mac puede estar apagado a esa hora."
          : "Sin fecha futura, el video queda PRIVADO en tu canal hasta que tú lo publiques en Studio."}{" "}
        Subir no se puede deshacer desde Hermes: borrar un video es manual, en YouTube Studio.
      </p>

      {error && <p className="text-2xs text-red">✕ {error}</p>}
    </ConfirmModal>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-20 shrink-0 text-2xs tracking-label text-text-faint uppercase">{k}</span>
      <span className="min-w-0 text-text-dim">{children}</span>
    </div>
  );
}
