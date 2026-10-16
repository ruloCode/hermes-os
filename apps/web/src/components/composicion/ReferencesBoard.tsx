"use client";

/**
 * Tablero de referencias (patrón Mobbin: grid de tarjetas de Savee/mymind +
 * el alta pegando un link de Pinterest). Una referencia sin "qué tomo de
 * aquí" es ruido, así que el campo es obligatorio. Se agrega pegando un
 * link o buscando en internet (mock: en producción va por `browse_web` /
 * oEmbed como el radar del Estudio). Filtro por tipo y por plan
 * observar → probar → aplicado.
 */
import { useMemo, useState, type ReactNode } from "react";
import { keyLabel } from "@/lib/music-theory";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { useComposicion } from "./ComposicionContext";
import { PLAN_LABEL, REF_KINDS, fieldCls, fmtRelative, ghostBtnCls } from "./labels";
import type { RefKind, Reference } from "./types";

const SOURCE_LABEL: Record<Reference["source"], string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  genius: "Genius",
  web: "web",
  nota: "nota propia",
  archivo: "archivo",
};

/** Resultados de búsqueda de prueba: en producción los trae el agente. */
const MOCK_SEARCH = (q: string): Omit<Reference, "id" | "savedAt" | "takeaway" | "plan" | "tags">[] => [
  { kind: "cancion", title: `"${q}" — resultado 1 (canción)`, by: "artista", source: "youtube", url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) },
  { kind: "letra", title: `Letra de "${q}"`, by: "Genius", source: "genius", url: "https://genius.com/search?q=" + encodeURIComponent(q) },
  { kind: "poema", title: `Poemas sobre ${q}`, by: "antología", source: "web" },
];

/** "probar" → "Probar" para los controles (el dato sigue en minúscula). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ReferencesBoard() {
  const { refs, songs, addRef, patchRef, removeRef, notation } = useComposicion();
  const [kind, setKind] = useState<RefKind | "todas">("todas");
  const [plan, setPlan] = useState<Reference["plan"] | "todos">("todos");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ReturnType<typeof MOCK_SEARCH>>([]);
  const [draft, setDraft] = useState<{ title: string; takeaway: string; kind: RefKind; url?: string; by?: string; source: Reference["source"] } | null>(null);

  const list = useMemo(
    () => refs.filter((r) => (kind === "todas" || r.kind === kind) && (plan === "todos" || r.plan === plan)),
    [refs, kind, plan],
  );

  const isUrl = /^https?:\/\//i.test(q.trim());
  const submit = () => {
    const t = q.trim();
    if (!t) return;
    if (isUrl) {
      const source: Reference["source"] = /youtu/.test(t) ? "youtube" : /spotify/.test(t) ? "spotify" : /genius/.test(t) ? "genius" : "web";
      setDraft({ title: t.replace(/^https?:\/\//, "").slice(0, 60), takeaway: "", kind: source === "genius" ? "letra" : "cancion", url: t, source });
      setResults([]);
    } else {
      setResults(MOCK_SEARCH(t));
    }
  };

  const save = () => {
    if (!draft || !draft.takeaway.trim()) return;
    addRef({ ...draft, tags: [], plan: "observar" });
    setDraft(null);
    setQ("");
    setResults([]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Alta: pega un link o busca. Sin caja alrededor: es la primera fila. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex shrink-0 flex-col gap-2"
      >
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pega un link (YouTube, Spotify, Genius…) o busca: 'baladas en La menor sobre la lluvia'"
            aria-label="Link o búsqueda"
            className={`${fieldCls} min-w-0 flex-1`}
          />
          <Button type="submit" size="md" disabled={!q.trim()}>
            {isUrl ? "Guardar link" : "Buscar en internet"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setDraft({ title: "", takeaway: "", kind: "nota", source: "nota" })}
          >
            Nota
          </Button>
        </div>
        {results.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-faint">
              Resultados de prueba (en producción los trae Hermes navegando de verdad):
            </span>
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setDraft({ ...r, takeaway: "" })}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-hover"
              >
                <span className="min-w-0 truncate text-sm text-text">{r.title}</span>
                <span className="shrink-0 text-xs text-text-faint">
                  {REF_KINDS[r.kind].label} · {r.by} · {SOURCE_LABEL[r.source]}
                </span>
              </button>
            ))}
          </div>
        )}
        {draft && (
          // El borrador SÍ se opera (tipo, título, qué tomo): lleva marco.
          <div className="flex flex-col gap-2 rounded-md border border-line bg-panel p-3">
            <div className="flex flex-wrap gap-2">
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as RefKind })}
                aria-label="Tipo de referencia"
                className="h-8 rounded-sm border border-line bg-panel px-2 text-xs text-text-dim focus:border-accent focus:outline-none"
              >
                {(Object.keys(REF_KINDS) as RefKind[]).map((k) => (
                  <option key={k} value={k}>{REF_KINDS[k].label}</option>
                ))}
              </select>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Título"
                aria-label="Título"
                className={`${fieldCls} min-w-0 flex-1`}
              />
              <input
                value={draft.by ?? ""}
                onChange={(e) => setDraft({ ...draft, by: e.target.value })}
                placeholder="Autor / fuente"
                aria-label="Autor o fuente"
                className={`${fieldCls} w-44`}
              />
            </div>
            {/* Obligatorio: sin "qué tomo" la referencia es ruido. Vacío = ámbar
                (atención), porque es lo único que falta para guardar. */}
            <input
              value={draft.takeaway}
              onChange={(e) => setDraft({ ...draft, takeaway: e.target.value })}
              placeholder="Qué tomo de aquí (obligatorio): sin esto es ruido"
              aria-label="Qué tomo de aquí"
              className={`${fieldCls} ${!draft.takeaway.trim() ? "border-amber/60" : ""}`}
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={save}
                disabled={!draft.title.trim() || !draft.takeaway.trim()}
              >
                Guardar referencia
              </Button>
            </div>
          </div>
        )}
      </form>

      {/* Filtros: tipo y plan, como píldoras calmadas (sin glifos de adorno). */}
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Pill on={kind === "todas"} onClick={() => setKind("todas")}>
          Todas <span className="text-text-faint tabular-nums">{refs.length}</span>
        </Pill>
        {(Object.keys(REF_KINDS) as RefKind[]).map((k) => (
          <Pill key={k} on={kind === k} onClick={() => setKind(k)}>
            {REF_KINDS[k].label}
          </Pill>
        ))}
        <span aria-hidden className="mx-1.5 h-4 w-px bg-line-2" />
        {(["todos", "observar", "probar", "aplicado"] as const).map((p) => (
          <Pill key={p} on={plan === p} onClick={() => setPlan(p)}>
            {p === "todos" ? "Todo plan" : cap(PLAN_LABEL[p])}
          </Pill>
        ))}
      </div>

      {/* Grid de tarjetas; clic expande la ficha */}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => {
          const k = REF_KINDS[r.kind];
          const expanded = open === r.id;
          const usedBy = songs.filter((s) => s.refIds.includes(r.id));
          return (
            <article
              key={r.id}
              className={`flex flex-col gap-2 rounded-md border bg-panel p-4 shadow-[var(--shadow-card)] transition-colors ${
                expanded ? "border-line-2 sm:col-span-2" : "border-line hover:border-line-2"
              }`}
            >
              <button
                onClick={() => setOpen(expanded ? null : r.id)}
                aria-expanded={expanded}
                className="flex cursor-pointer flex-col gap-1.5 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge size="sm">{k.label}</Badge>
                  {/* El plan es estado: probar = en curso, aplicado = hecho. */}
                  {r.plan === "observar" ? (
                    <span className="text-xs text-text-faint">{PLAN_LABEL[r.plan]}</span>
                  ) : (
                    <Badge size="sm" tone={r.plan === "aplicado" ? "green" : "cyan"}>
                      {PLAN_LABEL[r.plan]}
                    </Badge>
                  )}
                </div>
                <h3 className="text-sm leading-snug font-medium text-text">{r.title}</h3>
                {r.by && (
                  <p className="text-xs text-text-faint">
                    de {r.by} · {SOURCE_LABEL[r.source]}
                  </p>
                )}
                <p className={`text-sm leading-relaxed text-text-dim ${expanded ? "" : "line-clamp-3"}`}>
                  <span className="font-medium text-text">Tomo:</span> {r.takeaway}
                </p>
                <div className="flex flex-wrap items-center gap-1 text-xs text-text-faint">
                  {r.key && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-text-dim">
                      {keyLabel(r.key, notation)}
                    </span>
                  )}
                  {r.tempo && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-text-dim tabular-nums">
                      {r.tempo} bpm
                    </span>
                  )}
                  {/* Acordes: el único dato de la tarjeta que va en mono. */}
                  {r.progression && (
                    <span className="rounded-full border border-line px-2 py-0.5 font-mono text-text-dim">
                      {r.progression.join(" ")}
                    </span>
                  )}
                  {r.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                  <span className="ml-auto">{fmtRelative(r.savedAt)}</span>
                </div>
              </button>
              {expanded && (
                <div className="flex flex-col gap-2.5 border-t border-line pt-3">
                  {r.excerpt && <p className="text-sm text-text-dim italic">{r.excerpt}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-text-faint">Plan</span>
                    <Segmented
                      size="sm"
                      ariaLabel="Plan de la referencia"
                      value={r.plan}
                      onChange={(p) => patchRef(r.id, { plan: p })}
                      options={(["observar", "probar", "aplicado"] as const).map((p) => ({
                        value: p,
                        label: cap(PLAN_LABEL[p]),
                      }))}
                    />
                    <span className="flex-1" />
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" className={ghostBtnCls}>
                        Abrir <span aria-hidden>↗</span>
                      </a>
                    )}
                    <Button variant="ghost" className="hover:text-red" onClick={() => removeRef(r.id)}>
                      Borrar
                    </Button>
                  </div>
                  <p className="text-xs text-text-faint">
                    {usedBy.length > 0 ? <>Enlazada en: {usedBy.map((s) => s.title).join(" · ")}</> : "No está enlazada a ninguna canción todavía."}
                  </p>
                </div>
              )}
            </article>
          );
        })}
        {list.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-text-faint">Nada con ese filtro.</p>
        )}
      </div>
    </div>
  );
}

/** Píldora de filtro: seleccionada = gris (no acento). */
function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors ${
        on ? "bg-selected font-medium text-text" : "text-text-dim hover:bg-hover hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
