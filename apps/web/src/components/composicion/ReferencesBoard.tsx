"use client";

/**
 * Tablero de referencias (patrón Mobbin: grid de tarjetas de Savee/mymind +
 * el alta pegando un link de Pinterest). Una referencia sin "qué tomo de
 * aquí" es ruido, así que el campo es obligatorio. Se agrega pegando un
 * link o buscando en internet (mock: en producción va por `browse_web` /
 * oEmbed como el radar del Estudio). Filtro por tipo y por plan
 * observar → probar → aplicado.
 */
import { useMemo, useState } from "react";
import { keyLabel } from "@/lib/music-theory";
import { Badge } from "@/components/ui/Badge";
import { useComposicion } from "./ComposicionContext";
import { PLAN_LABEL, REF_KINDS, btnCls, fmtRelative, ghostBtnCls, inputCls } from "./labels";
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
      {/* Alta: pega un link o busca */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel-2 p-2"
      >
        <div className="flex gap-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pega un link (YouTube, Spotify, Genius…) o busca: 'baladas en La menor sobre la lluvia'" className={`${inputCls} flex-1`} />
          <button type="submit" className={btnCls} disabled={!q.trim()}>{isUrl ? "Guardar link" : "Buscar en internet"}</button>
          <button type="button" onClick={() => setDraft({ title: "", takeaway: "", kind: "nota", source: "nota" })} className={ghostBtnCls}>+ Nota</button>
        </div>
        {results.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-2xs text-text-faint">Resultados de prueba (en producción los trae Hermes navegando de verdad):</span>
            {results.map((r, i) => (
              <button key={i} type="button" onClick={() => setDraft({ ...r, takeaway: "" })} className="flex items-center gap-2 rounded-sm border border-line px-2 py-1 text-left hover:border-accent">
                <span className="text-xs text-text">{REF_KINDS[r.kind].glyph}</span>
                <span className="text-xs text-text">{r.title}</span>
                <span className="text-2xs text-text-faint">· {r.by} · {SOURCE_LABEL[r.source]}</span>
              </button>
            ))}
          </div>
        )}
        {draft && (
          <div className="flex flex-col gap-1.5 rounded-sm border border-line-2 p-2">
            <div className="flex gap-1.5">
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RefKind })} className="rounded-sm border border-line bg-panel-2 px-1 text-2xs text-text-dim uppercase focus:outline-none">
                {(Object.keys(REF_KINDS) as RefKind[]).map((k) => (
                  <option key={k} value={k}>{REF_KINDS[k].label}</option>
                ))}
              </select>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Título" className={`${inputCls} flex-1`} />
              <input value={draft.by ?? ""} onChange={(e) => setDraft({ ...draft, by: e.target.value })} placeholder="Autor / fuente" className={`${inputCls} w-40`} />
            </div>
            <input value={draft.takeaway} onChange={(e) => setDraft({ ...draft, takeaway: e.target.value })} placeholder="QUÉ tomo de aquí (obligatorio): sin esto es ruido" className={`${inputCls} ${!draft.takeaway.trim() ? "border-amber/60" : ""}`} autoFocus />
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => setDraft(null)} className={ghostBtnCls}>Cancelar</button>
              <button type="button" onClick={save} className={btnCls} disabled={!draft.title.trim() || !draft.takeaway.trim()}>Guardar referencia</button>
            </div>
          </div>
        )}
      </form>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-1">
        <button onClick={() => setKind("todas")} className={`rounded-sm px-2 py-0.5 text-2xs tracking-label uppercase ${kind === "todas" ? "bg-accent/16 text-accent" : "text-text-dim"}`}>todas · {refs.length}</button>
        {(Object.keys(REF_KINDS) as RefKind[]).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-sm px-2 py-0.5 text-2xs tracking-label uppercase ${kind === k ? "bg-accent/16 text-accent" : "text-text-dim hover:text-text"}`}>
            {REF_KINDS[k].glyph} {REF_KINDS[k].label}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-line" />
        {(["todos", "observar", "probar", "aplicado"] as const).map((p) => (
          <button key={p} onClick={() => setPlan(p)} className={`rounded-sm px-2 py-0.5 text-2xs tracking-label uppercase ${plan === p ? "bg-cyan/12 text-cyan" : "text-text-dim hover:text-text"}`}>{p}</button>
        ))}
      </div>

      {/* Grid de tarjetas; clic expande la ficha */}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => {
          const k = REF_KINDS[r.kind];
          const expanded = open === r.id;
          const usedBy = songs.filter((s) => s.refIds.includes(r.id));
          return (
            <article key={r.id} className={`hud-panel flex flex-col gap-2 p-3 ${expanded ? "sm:col-span-2" : ""}`}>
              <button onClick={() => setOpen(expanded ? null : r.id)} className="flex flex-col gap-1.5 text-left">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={k.tone} size="sm">{k.glyph} {k.label}</Badge>
                  <span className={`text-2xs tracking-label uppercase ${r.plan === "aplicado" ? "text-green" : r.plan === "probar" ? "text-cyan" : "text-text-faint"}`}>{PLAN_LABEL[r.plan]}</span>
                </div>
                <h3 className="text-sm leading-snug text-text">{r.title}</h3>
                {r.by && <p className="text-2xs text-text-faint">de {r.by} · {SOURCE_LABEL[r.source]}</p>}
                <p className={`text-2xs leading-relaxed text-text-dim ${expanded ? "" : "line-clamp-3"}`}>
                  <span className="text-accent">tomo:</span> {r.takeaway}
                </p>
                <div className="flex flex-wrap items-center gap-1 font-mono text-2xs text-text-dim">
                  {r.key && <span className="rounded-xs bg-panel-2 px-1.5 py-0.5">{keyLabel(r.key, notation)}</span>}
                  {r.tempo && <span className="rounded-xs bg-panel-2 px-1.5 py-0.5">{r.tempo} bpm</span>}
                  {r.progression && <span className="rounded-xs bg-panel-2 px-1.5 py-0.5 text-accent">{r.progression.join(" ")}</span>}
                  {r.tags.map((t) => (
                    <span key={t} className="text-text-faint">#{t}</span>
                  ))}
                  <span className="ml-auto text-text-faint">{fmtRelative(r.savedAt)}</span>
                </div>
              </button>
              {expanded && (
                <div className="flex flex-col gap-2 border-t border-line pt-2">
                  {r.excerpt && <p className="text-xs text-text-dim italic">{r.excerpt}</p>}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-2xs tracking-label text-text-dim uppercase">plan</span>
                    {(["observar", "probar", "aplicado"] as const).map((p) => (
                      <button key={p} onClick={() => patchRef(r.id, { plan: p })} className={`rounded-sm border px-2 py-0.5 text-2xs uppercase ${r.plan === p ? "border-cyan text-cyan" : "border-line text-text-dim"}`}>{p}</button>
                    ))}
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" className={`${ghostBtnCls} ml-auto`}>abrir ↗</a>
                    )}
                    <button onClick={() => removeRef(r.id)} className={`${ghostBtnCls} text-red`}>borrar</button>
                  </div>
                  <p className="text-2xs text-text-faint">
                    {usedBy.length > 0 ? <>Enlazada en: {usedBy.map((s) => s.title).join(" · ")}</> : "No está enlazada a ninguna canción todavía."}
                  </p>
                </div>
              )}
            </article>
          );
        })}
        {list.length === 0 && <p className="col-span-full py-6 text-center text-xs text-text-dim">Nada con ese filtro.</p>}
      </div>
    </div>
  );
}
