"use client";

/**
 * Radar del ESTUDIO — swipe file NAVEGABLE (rediseño 2026-08-10, patrones
 * Mobbin: YouTube "Your clips" para el grid de miniaturas con "de <canal>",
 * Pinterest/Patreon para el alta pegando un link con preview, Arcade Library
 * para chips de filtro + estado sobre la tarjeta):
 *
 *  - Pegar un link de YouTube BASTA: el agente trae título y canal reales por
 *    oEmbed, y la tarjeta muestra la miniatura del video — clic en la imagen
 *    abre YouTube; clic en la tarjeta abre la ficha.
 *  - Las referencias sin link siguen siendo tarjetas de texto (dato grande).
 *  - La ficha conserva todo: contexto, estado en el plan (observar → probar →
 *    aplicado), pilar, trazabilidad (piezas con ref_id) y edición en sitio.
 */
import { useEffect, useState } from "react";
import { youtubeThumbnail } from "@hermes/shared";
import type { ContentPiece, ContentPillar, ContentRef, HookPerformanceRow } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Badge } from "@/components/ui/Badge";
import { PILLARS, STATUSES } from "./labels";

const APPLY_TONE = { aplicado: "green", probar: "amber", observar: "neutral" } as const;
const APPLY_STATES: NonNullable<ContentRef["apply_status"]>[] = ["observar", "probar", "aplicado"];
// Clases completas: Tailwind no ve las interpoladas (`bg-${tone}/16`).
const APPLY_ACTIVE: Record<NonNullable<ContentRef["apply_status"]>, string> = {
  observar: "bg-panel-2 text-text",
  probar: "bg-amber/16 text-amber",
  aplicado: "bg-green/16 text-green",
};

const KINDS: { id: ContentRef["kind"]; label: string; hint: string }[] = [
  { id: "tendencia", label: "Tendencias", hint: "Dato comprobado que cambia cómo se produce" },
  { id: "referente", label: "Referentes", hint: "Qué copiar y qué evitar de otros" },
  { id: "guardada", label: "Guardadas", hint: "Hooks, estructuras e ideas vistas por ahí" },
];

const inputCls =
  "rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-violet focus:outline-none";
const btnCls =
  "rounded-sm border border-line-2 bg-panel-2 px-2 py-0.5 text-2xs tracking-label text-text-dim uppercase hover:border-violet hover:text-text";

/** "23 jul" en hora de Bogotá — cuándo entró la referencia al radar. */
function fmtCaptured(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "short",
  });
}

const isHttpUrl = (s: string): boolean => /^https?:\/\//i.test(s.trim());

export function EstudioRadar() {
  const { board, saveRef, patchRef, removeRef, createPiece, setSelectedId } = useEstudioContext();
  const [kind, setKind] = useState<ContentRef["kind"]>("tendencia");
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState("");
  const [saving, setSaving] = useState(false);

  const list = board.refs.filter((r) => r.kind === kind);
  const active = KINDS.find((k) => k.id === kind)!;
  const draftIsUrl = isHttpUrl(draft);
  const draftThumb = draftIsUrl ? youtubeThumbnail(draft.trim()) : null;

  const submit = async () => {
    const value = draft.trim();
    if (!value || saving) return;
    setSaving(true);
    await saveRef({
      kind,
      ...(draftIsUrl ? { url: value } : { title: value }),
      body: context.trim() || undefined,
    });
    setDraft("");
    setContext("");
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Un solo carril por tipo: el radar se lee de a una cosa a la vez. */}
      <div className="flex gap-0.5 rounded-sm border border-line p-0.5">
        {KINDS.map((k) => {
          const n = board.refs.filter((r) => r.kind === k.id).length;
          return (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              title={k.hint}
              className={`flex-1 rounded-xs px-2 py-1 text-2xs tracking-label uppercase ${
                kind === k.id ? "bg-violet/16 text-violet" : "text-text-faint hover:text-text-dim"
              }`}
            >
              {k.label} <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Alta pegando el link (Pinterest/Patreon): la URL basta — YouTube pone
          título, canal y miniatura. Texto suelto sigue funcionando igual. */}
      <div className="flex flex-col gap-1.5 rounded-sm border border-line px-2 py-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder={`Pega un link de YouTube o escribe una ${kind} (Enter)`}
          className={inputCls}
        />
        {draftThumb && (
          <div className="flex items-center gap-2 rounded-sm bg-panel-2 p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draftThumb}
              alt="Miniatura del video"
              className="aspect-video h-12 shrink-0 rounded-xs object-cover"
            />
            <p className="text-2xs leading-snug text-text-dim">
              Video detectado — el título y el canal los trae YouTube al guardar.
            </p>
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="por qué la guardas / qué copiar (opcional)"
            className={`min-w-0 flex-1 ${inputCls}`}
          />
          <button
            onClick={() => void submit()}
            disabled={!draft.trim() || saving}
            className={`${btnCls} border-violet text-violet disabled:opacity-40`}
          >
            {saving ? "guardando…" : "＋ Guardar"}
          </button>
        </div>
      </div>

      {/* Grid de tarjetas: miniatura navegable cuando hay link; la abierta se
          expande a lo ancho con su ficha completa. */}
      {list.length ? (
        <div className="grid grid-cols-2 gap-1.5">
          {list.map((r) => (
            <RefCard
              key={r.id}
              refItem={r}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              derived={board.pieces.filter((p) => p.ref_id === r.id)}
              onPatch={patchRef}
              onRemove={removeRef}
              onCreatePiece={createPiece}
              onSelectPiece={setSelectedId}
            />
          ))}
        </div>
      ) : (
        <p className="px-1 py-3 text-xs text-text-faint">
          Sin {active.label.toLowerCase()} todavía — {active.hint.toLowerCase()}. Pega un link
          arriba y listo.
        </p>
      )}

      <HooksConDatos onSelectPiece={setSelectedId} />
    </div>
  );
}

/** Tarjeta del radar: visual con miniatura (si hay link) o de texto; clic =
 *  ficha en sitio (la tarjeta se expande a lo ancho del grid). */
function RefCard({
  refItem: r,
  open,
  onToggle,
  derived,
  onPatch,
  onRemove,
  onCreatePiece,
  onSelectPiece,
}: {
  refItem: ContentRef;
  open: boolean;
  onToggle: () => void;
  derived: ContentPiece[];
  onPatch: ReturnType<typeof useEstudioContext>["patchRef"];
  onRemove: ReturnType<typeof useEstudioContext>["removeRef"];
  onCreatePiece: ReturnType<typeof useEstudioContext>["createPiece"];
  onSelectPiece: (id: number) => void;
}) {
  const thumb = youtubeThumbnail(r.url);

  return (
    <div
      className={`min-w-0 rounded-sm border transition-colors ${
        open ? "col-span-2 border-violet/40 bg-panel-2/40" : "border-line hover:border-line-2"
      }`}
    >
      <button onClick={onToggle} className="block w-full text-left" aria-expanded={open}>
        {thumb ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt={r.title}
              loading="lazy"
              className={`w-full rounded-t-sm object-cover ${open ? "max-h-40" : "aspect-video"}`}
            />
            {/* Clic en la imagen = ver el video (el detalle es el clic en el resto). */}
            <a
              href={r.url as string}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Ver en YouTube"
              className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity hover:opacity-100"
            >
              <span className="rounded-sm bg-black/70 px-2 py-1 text-xs text-white">▶ Ver ↗</span>
            </a>
            {r.apply_status && (
              <span className="absolute top-1 right-1">
                <Badge tone={APPLY_TONE[r.apply_status]} variant="solid" size="sm">
                  {r.apply_status}
                </Badge>
              </span>
            )}
            {r.metric && (
              <span className="absolute bottom-1 left-1 rounded-xs bg-black/70 px-1.5 py-0.5 font-display text-2xs text-cyan tabular-nums">
                {r.metric}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-baseline gap-2 px-2 pt-2">
            {r.metric && (
              <span className="shrink-0 font-display text-sm text-cyan tabular-nums">
                {r.metric}
              </span>
            )}
            <span className="flex-1" />
            {r.apply_status && (
              <Badge tone={APPLY_TONE[r.apply_status]} variant="solid" size="sm">
                {r.apply_status}
              </Badge>
            )}
          </div>
        )}

        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <p className={`text-xs leading-snug text-text ${open ? "" : "line-clamp-2"}`}>
            {r.title}
          </p>
          <div className="flex items-center gap-1.5 text-2xs text-text-faint">
            {r.source && <span className="min-w-0 truncate">de {r.source}</span>}
            <span className="shrink-0">· {fmtCaptured(r.created_at)}</span>
            <span className="flex-1" />
            {derived.length > 0 && (
              <span className="shrink-0 text-violet tabular-nums" title="Piezas creadas desde aquí">
                ✦{derived.length}
              </span>
            )}
            {r.pillar && (
              <Badge tone={PILLARS[r.pillar].tone} variant="solid" size="sm">
                {PILLARS[r.pillar].short}
              </Badge>
            )}
          </div>
        </div>
      </button>

      {open && (
        <RefDetail
          refItem={r}
          derived={derived}
          onPatch={onPatch}
          onRemove={onRemove}
          onCreatePiece={onCreatePiece}
          onSelectPiece={onSelectPiece}
        />
      )}
    </div>
  );
}

/** Ficha completa: contexto, plan, pilar, trazabilidad y edición en sitio. */
function RefDetail({
  refItem: r,
  derived,
  onPatch,
  onRemove,
  onCreatePiece,
  onSelectPiece,
}: {
  refItem: ContentRef;
  derived: ContentPiece[];
  onPatch: ReturnType<typeof useEstudioContext>["patchRef"];
  onRemove: ReturnType<typeof useEstudioContext>["removeRef"];
  onCreatePiece: ReturnType<typeof useEstudioContext>["createPiece"];
  onSelectPiece: (id: number) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(r.body ?? "");
  const [draftSource, setDraftSource] = useState(r.source ?? "");
  const [draftMetric, setDraftMetric] = useState(r.metric ?? "");
  const [draftUrl, setDraftUrl] = useState(r.url ?? "");

  const createFromRef = async () => {
    if (creating) return;
    setCreating(true);
    await onCreatePiece({
      title: r.title,
      pillar: r.pillar ?? "p2",
      ref_id: r.id,
      notes: [
        `Pieza creada desde el radar (${r.kind}).`,
        r.metric ? `Dato: ${r.metric}` : null,
        r.body ? `Contexto: ${r.body}` : null,
        r.url ? `Video: ${r.url}` : null,
        r.source ? `Fuente: ${r.source}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    setCreating(false);
  };

  const saveEdit = async () => {
    await onPatch(r.id, {
      body: draftBody.trim() || null,
      source: draftSource.trim() || null,
      metric: draftMetric.trim() || null,
      url: draftUrl.trim() || null,
    });
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line px-2 py-2">
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Contexto: qué dice, por qué importa, cómo se aplica…"
            className={`${inputCls} min-h-[64px] resize-y`}
          />
          <input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="link del video (YouTube = miniatura)"
            className={inputCls}
          />
          <div className="flex gap-1.5">
            <input
              value={draftMetric}
              onChange={(e) => setDraftMetric(e.target.value)}
              placeholder="dato (+53%)"
              className={`${inputCls} w-28`}
            />
            <input
              value={draftSource}
              onChange={(e) => setDraftSource(e.target.value)}
              placeholder="fuente / canal"
              className={`${inputCls} min-w-0 flex-1`}
            />
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => void saveEdit()} className={`${btnCls} border-violet text-violet`}>
              Guardar
            </button>
            <button onClick={() => setEditing(false)} className={btnCls}>
              Cancelar
            </button>
          </div>
        </div>
      ) : r.body ? (
        <p className="text-2xs leading-relaxed text-text-dim">{r.body}</p>
      ) : (
        <p className="text-2xs text-text-faint italic">Sin contexto escrito.</p>
      )}

      {/* Estado en el plan y pilar: la referencia es accionable, no decorativa */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs tracking-label text-text-faint uppercase">En el plan:</span>
        {APPLY_STATES.map((s) => (
          <button
            key={s}
            onClick={() => void onPatch(r.id, { apply_status: r.apply_status === s ? null : s })}
            className={`rounded-xs px-1.5 py-0.5 text-2xs tracking-label uppercase ${
              r.apply_status === s ? APPLY_ACTIVE[s] : "text-text-faint hover:text-text-dim"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-2 text-2xs tracking-label text-text-faint uppercase">Pilar:</span>
        <select
          value={r.pillar ?? ""}
          onChange={(e) =>
            void onPatch(r.id, { pillar: (e.target.value || null) as ContentPillar | null })
          }
          className="rounded-sm border border-line bg-panel-2 px-1 py-0.5 text-2xs text-text-dim focus:outline-none"
          aria-label="Pilar de la referencia"
        >
          <option value="">—</option>
          {(Object.keys(PILLARS) as ContentPillar[]).map((p) => (
            <option key={p} value={p}>
              {PILLARS[p].short} · {PILLARS[p].label}
            </option>
          ))}
        </select>
      </div>

      {/* Trazabilidad: qué salió de esta referencia */}
      {derived.length > 0 && (
        <div className="rounded-sm border border-line bg-panel-2/40 px-2 py-1.5">
          <p className="text-2xs tracking-label text-text-faint uppercase">
            Piezas desde esta referencia · {derived.length}
          </p>
          <div className="mt-1 flex flex-col">
            {derived.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectPiece(p.id)}
                className="flex items-baseline gap-2 rounded-xs px-0.5 py-0.5 text-left hover:bg-panel-2"
              >
                <span className="w-20 shrink-0 text-2xs text-text-faint uppercase">
                  {STATUSES[p.status].label}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-text-dim">{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void createFromRef()}
          disabled={creating}
          className={`${btnCls} border-violet text-violet`}
        >
          {creating ? "creando…" : "✦ Crear pieza"}
        </button>
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer" className={btnCls}>
            ▶ Ver en YouTube ↗
          </a>
        )}
        {!editing && (
          <button onClick={() => setEditing(true)} className={btnCls}>
            ✎ Editar
          </button>
        )}
        <button
          onClick={() => void onRemove(r.id)}
          className="rounded-sm px-2 py-0.5 text-2xs tracking-label text-text-faint uppercase hover:text-red"
        >
          ✕ Borrar
        </button>
        <span className="flex-1" />
        <span className="text-2xs text-text-faint">Capturada {fmtCaptured(r.created_at)}</span>
      </div>
    </div>
  );
}

/**
 * Biblioteca de hooks con DATO: qué aperturas ya salieron y cómo les fue
 * (bucle de resultados, migración 022). Solo existe si hay métricas reales —
 * con n=0 publicaciones medidas no se pinta nada, jamás un ranking inventado.
 */
function HooksConDatos({ onSelectPiece }: { onSelectPiece: (id: number) => void }) {
  const { hookPerformance } = useEstudioContext();
  const [rows, setRows] = useState<HookPerformanceRow[]>([]);
  useEffect(() => {
    void hookPerformance().then(setRows);
  }, [hookPerformance]);
  if (!rows.length) return null;

  const fmtN = (n: number) => new Intl.NumberFormat("es-CO", { notation: "compact" }).format(n);
  return (
    <div className="border-t border-line pt-2">
      <p className="text-2xs tracking-label text-text-dim uppercase">
        Hooks con datos · {rows.length}
      </p>
      <div className="mt-1 flex flex-col">
        {rows.slice(0, 6).map((h) => (
          <button
            key={`${h.piece_id}-${h.platform}`}
            onClick={() => onSelectPiece(h.piece_id)}
            className="flex items-baseline gap-2 rounded-xs px-0.5 py-1 text-left hover:bg-panel-2"
            title={h.title}
          >
            <span className="min-w-0 flex-1 truncate text-xs text-text-dim">«{h.hook}»</span>
            {h.hook_kind && (
              <Badge tone="violet" variant="solid" size="sm">
                {h.hook_kind}
              </Badge>
            )}
            <span className="shrink-0 text-2xs text-text tabular-nums">
              {fmtN(h.engaged_views ?? h.views ?? 0)} views
            </span>
            {h.avg_view_pct != null && (
              <span className="shrink-0 text-2xs text-cyan tabular-nums">
                {Math.round(h.avg_view_pct)}%
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export type { ContentRef };
