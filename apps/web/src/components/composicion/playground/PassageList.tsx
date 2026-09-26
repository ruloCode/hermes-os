"use client";

/**
 * Lista de PASAJES de una sesión. Referencias Mobbin: Pillow (chips por
 * categoría con conteo, la fila elegida se expande con su onda y acciones),
 * Fireflies "Magic Soundbite" (sugerencias con duración y el contexto hablado
 * al lado), Hotjar "Highlight" (Start/End con ▶ para ajustar bordes) y Revolut
 * (el estado va en texto dentro de la fila, no como spinner encima).
 *
 * La detección NO es confiable por sí sola: por eso cada fila muestra su
 * EVIDENCIA ("evento [canta] · se repite 3×") y los dudosos van en su propio
 * grupo, nunca mezclados con los probables. Mover de grupo, descartar y
 * ajustar bordes es decisión humana y se guarda en el agente.
 *
 * Una TOMA de un tema (`session.take`) tiene un solo pasaje: la toma entera,
 * alineada a su rejilla. El agente rechaza crear, mover, recortar o reasignar
 * sus pasajes (409), así que aquí esas acciones no aparecen — se escucha, se
 * analiza y se abre el memo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComposeSession, Passage, PassageKind } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { visibleSpeakers, resolveSpeaker } from "./VoiceStrip";
import type { MediaClock } from "./useMediaClock";
import type { PassagePatch } from "./api";
import { VOICE_BG, btn, btnGhost, btnPrimary, chip, field } from "./ui";
import { fmtTime } from "./format";
import { ToTemaButton } from "../temas/ToTemaButton";

export const KIND_LABEL: Record<PassageKind, string> = {
  letra: "Con letra",
  melisma: "Melisma",
  silabas: "Sílabas",
  rap: "Rap",
  mixto: "Mixto",
};

const KIND_HINT: Record<PassageKind, string> = {
  letra: "palabras cantadas",
  melisma: "varias notas sobre una sílaba",
  silabas: "rellenos tipo na na / dun dun / uh uh",
  rap: "texto rítmico, casi sin melodía",
  mixto: "un poco de todo",
};

const STATUS_TEXT: Record<Passage["status"], string> = {
  pendiente: "sin analizar",
  analizando: "analizando melodía…",
  listo: "listo",
  error: "sin melodía clara",
};

type Filter = "todos" | PassageKind;

export function PassageList({
  session,
  clock,
  selected,
  onSelect,
  onOpen,
  onPatch,
  onAnalyze,
  onAddManual,
  notation,
}: {
  session: ComposeSession;
  clock: MediaClock;
  selected: string | null;
  onSelect: (pid: string | null) => void;
  onOpen: (pid: string) => void;
  onPatch: (pid: string, patch: PassagePatch) => void;
  onAnalyze: (pid: string) => void;
  onAddManual: (start: number, end: number, speaker?: string) => Promise<void>;
  notation: "en" | "latin";
}) {
  const [filter, setFilter] = useState<Filter>("todos");
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [manual, setManual] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const isTake = !!session.take;

  const kinds = useMemo(() => {
    const live = session.passages.filter((p) => p.group !== "descartado");
    const c = new Map<PassageKind, number>();
    live.forEach((p) => c.set(p.kind, (c.get(p.kind) ?? 0) + 1));
    return c;
  }, [session.passages]);

  const pass = (p: Passage) => filter === "todos" || p.kind === filter;
  const probable = session.passages.filter((p) => p.group === "probable" && pass(p));
  const dudoso = session.passages.filter((p) => p.group === "dudoso" && pass(p));
  const discarded = session.passages.filter((p) => p.group === "descartado" && pass(p));

  // La fila elegida siempre a la vista (↑↓ desde el teclado).
  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-pid="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const row = (p: Passage) => (
    <PassageRow
      key={p.id}
      p={p}
      session={session}
      on={p.id === selected}
      clock={clock}
      notation={notation}
      onSelect={() => onSelect(p.id === selected ? null : p.id)}
      onOpen={() => onOpen(p.id)}
      onPatch={(patch) => onPatch(p.id, patch)}
      onAnalyze={() => onAnalyze(p.id)}
    />
  );

  const total = session.passages.length;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-2">
        <button type="button" className={chip(filter === "todos")} onClick={() => setFilter("todos")}>
          Todos
        </button>
        {(Object.keys(KIND_LABEL) as PassageKind[])
          .filter((k) => k !== "mixto" || (kinds.get(k) ?? 0) > 0)
          .map((k) => (
            <button
              key={k}
              type="button"
              title={KIND_HINT[k]}
              className={chip(filter === k)}
              onClick={() => setFilter(filter === k ? "todos" : k)}
            >
              {KIND_LABEL[k]} <span className="text-text-faint tabular-nums">{kinds.get(k) ?? 0}</span>
            </button>
          ))}
        {!isTake && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" className={btnGhost} onClick={() => setManual((v) => !v)}>
              + Pasaje a mano
            </button>
          </span>
        )}
      </div>
      {manual && !isTake && (
        <ManualForm
          session={session}
          start={clock.time}
          onCancel={() => setManual(false)}
          onCreate={async (a, b, sp) => {
            await onAddManual(a, b, sp);
            setManual(false);
          }}
        />
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {total === 0 && (
          <p className="px-4 py-6 text-center text-xs text-text-faint">
            {session.status === "procesando"
              ? "Los pasajes aparecen aquí a medida que se detectan."
              : "No se detectó canto. Revisa la franja de voces y marca un pasaje a mano."}
          </p>
        )}
        {total > 0 && probable.length + dudoso.length + discarded.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-text-faint">
            Ningún pasaje de tipo «{KIND_LABEL[filter as PassageKind]}».{" "}
            <button type="button" className="cursor-pointer text-accent" onClick={() => setFilter("todos")}>
              Ver todos
            </button>
          </p>
        )}
        {probable.length > 0 && (
          <Group label="Probables" count={probable.length}>
            {probable.map(row)}
          </Group>
        )}
        {dudoso.length > 0 && (
          <Group label="Dudosos" count={dudoso.length} hint="la detección no está segura: escúchalos">
            {dudoso.map(row)}
          </Group>
        )}
        {discarded.length > 0 && (
          <div className="border-t border-line px-3 py-2">
            <button type="button" className={btnGhost} onClick={() => setShowDiscarded((v) => !v)}>
              {showDiscarded ? "▾" : "▸"} Descartados · {discarded.length}
            </button>
          </div>
        )}
        {showDiscarded && discarded.length > 0 && <div className="opacity-70">{discarded.map(row)}</div>}
      </div>
    </section>
  );
}

function Group({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="sticky top-0 z-1 flex items-baseline gap-2 border-b border-line bg-panel px-3 py-1.5">
        <span className="text-xs font-medium text-text-dim">{label}</span>
        <span className="text-xs text-text-faint tabular-nums">{count}</span>
        {hint && <span className="text-xs text-text-faint">· {hint}</span>}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function PassageRow({
  p,
  session,
  on,
  clock,
  notation,
  onSelect,
  onOpen,
  onPatch,
  onAnalyze,
}: {
  p: Passage;
  session: ComposeSession;
  on: boolean;
  clock: MediaClock;
  notation: "en" | "latin";
  onSelect: () => void;
  onOpen: () => void;
  onPatch: (patch: PassagePatch) => void;
  onAnalyze: () => void;
}) {
  const voices = visibleSpeakers(session);
  const who = resolveSpeaker(session, p.speaker);
  const voice = voices.find((v) => v.id === who);
  const previewing = clock.playing && clock.range?.from === p.start && clock.range?.to === p.end;
  const dur = p.end - p.start;

  const facts = [
    KIND_LABEL[p.kind].toLowerCase(),
    p.key ? `≈ ${keyLabel(p.key.key, notation)}` : null,
    p.melismas ? `${p.melismas} ${p.melismas === 1 ? "melisma" : "melismas"}` : null,
    p.syllables ? `${p.syllables} sílabas` : null,
    // Lo tocó un humano (bordes, grupo o voz): la detección ya no manda sobre este pasaje.
    p.edited ? "ajustado a mano" : null,
  ].filter(Boolean);

  return (
    <li data-pid={p.id} className={`border-t border-line/60 first:border-t-0 ${on ? "bg-accent/6" : ""}`}>
      <div className="flex items-start gap-2 px-3 py-2">
        <button
          type="button"
          aria-label={previewing ? "Pausar" : "Escuchar el pasaje"}
          onClick={() => (previewing ? clock.pause() : clock.playRange(p.start, p.end))}
          className={`mt-0.5 grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full border text-2xs ${
            previewing ? "border-accent text-accent" : "border-line text-text-dim hover:border-line-2 hover:text-text"
          }`}
        >
          {previewing ? "❚❚" : "▶"}
        </button>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 cursor-pointer text-left">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={`shrink-0 font-mono text-xs ${on ? "text-accent" : "text-text-dim"}`}>{p.label}</span>
            <span className="shrink-0 font-mono text-xs text-text-faint tabular-nums">
              {fmtTime(p.start)}–{fmtTime(p.end)} · {Math.round(dur)} s
            </span>
            {voice && (
              <span className="flex min-w-0 shrink items-center gap-1 text-xs text-text-dim">
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${VOICE_BG[voice.color]}`} />
                <span className="truncate">{voice.name}</span>
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-text">«{p.text || "…"}»</span>
          <span className="mt-0.5 block truncate text-xs text-text-faint">
            {facts.join(" · ")}
            {" · "}
            <span className={p.status === "error" ? "text-amber" : p.status === "analizando" ? "text-accent" : ""}>
              {p.status === "error" && p.error ? p.error : STATUS_TEXT[p.status]}
            </span>
          </span>
          {p.evidence.length > 0 && (
            <span className="mt-0.5 block truncate text-xs text-text-faint" title={p.evidence.join(" · ")}>
              evidencia: {p.evidence.join(" · ")} · {Math.round(p.confidence * 100)} %
            </span>
          )}
        </button>
        {p.status === "listo" && (
          <button type="button" className={on ? btnPrimary : btn} onClick={onOpen} title="Abrir el memo (⏎)">
            Abrir memo
          </button>
        )}
      </div>
      {on && <RowActions p={p} session={session} clock={clock} onPatch={onPatch} onAnalyze={onAnalyze} />}
    </li>
  );
}

function RowActions({
  p,
  session,
  clock,
  onPatch,
  onAnalyze,
}: {
  p: Passage;
  session: ComposeSession;
  clock: MediaClock;
  onPatch: (patch: PassagePatch) => void;
  onAnalyze: () => void;
}) {
  const [a, setA] = useState(p.start);
  const [b, setB] = useState(p.end);
  useEffect(() => {
    setA(p.start);
    setB(p.end);
  }, [p.start, p.end]);
  const changed = Math.abs(a - p.start) > 0.01 || Math.abs(b - p.end) > 0.01;
  const nudge = (which: "a" | "b", d: number) => {
    if (which === "a") setA((v) => Math.max(0, Math.min(b - 0.5, +(v + d).toFixed(2))));
    else setB((v) => Math.max(a + 0.5, +(v + d).toFixed(2)));
  };
  const voices = visibleSpeakers(session);

  // Una toma de un tema: un solo pasaje (la toma entera). Nada de bordes, grupos ni voz.
  if (session.take)
    return (
      <div className="flex flex-col gap-2 border-t border-line/60 px-3 py-2 pl-11">
        <p className="text-xs text-text-faint">
          Es una toma grabada sobre la pista de un tema: su único pasaje es la toma entera, alineada a su rejilla. No
          se recorta, no se mueve de grupo ni se crean pasajes a mano.
        </p>
        {(p.status === "pendiente" || p.status === "error") && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={btn} onClick={onAnalyze}>
              {p.status === "error" ? "↻ Reintentar análisis" : "Analizar melodía"}
            </button>
          </div>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-2 border-t border-line/60 px-3 py-2 pl-11">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-dim">
        <span className="flex items-center gap-1">
          Inicio
          <button type="button" className={btnGhost} onClick={() => nudge("a", -0.25)} aria-label="Adelantar el inicio">
            −
          </button>
          <span className="w-14 text-center font-mono tabular-nums text-text">{fmtTime(a, true)}</span>
          <button type="button" className={btnGhost} onClick={() => nudge("a", 0.25)} aria-label="Atrasar el inicio">
            +
          </button>
          <button type="button" className={btnGhost} onClick={() => clock.playRange(a, a + 3)} title="Oír los primeros 3 s">
            ▶
          </button>
        </span>
        <span className="flex items-center gap-1">
          Fin
          <button type="button" className={btnGhost} onClick={() => nudge("b", -0.25)} aria-label="Adelantar el fin">
            −
          </button>
          <span className="w-14 text-center font-mono tabular-nums text-text">{fmtTime(b, true)}</span>
          <button type="button" className={btnGhost} onClick={() => nudge("b", 0.25)} aria-label="Atrasar el fin">
            +
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() => clock.playRange(Math.max(a, b - 3), b)}
            title="Oír los últimos 3 s"
          >
            ▶|
          </button>
        </span>
        {changed && (
          <span className="flex items-center gap-1">
            <button type="button" className={btnPrimary} onClick={() => onPatch({ start: a, end: b })}>
              Guardar bordes
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setA(p.start);
                setB(p.end);
              }}
            >
              deshacer
            </button>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {p.group !== "probable" && (
          <button type="button" className={btn} onClick={() => onPatch({ group: "probable" })}>
            → Probables
          </button>
        )}
        {p.group !== "dudoso" && (
          <button type="button" className={btn} onClick={() => onPatch({ group: "dudoso" })}>
            → Dudosos
          </button>
        )}
        {p.group !== "descartado" ? (
          <button type="button" className={btn} onClick={() => onPatch({ group: "descartado" })} title="Descartar (⌫)">
            Descartar
          </button>
        ) : null}
        {voices.length > 1 && (
          <select
            value={resolveSpeaker(session, p.speaker) ?? ""}
            onChange={(e) => onPatch({ speaker: e.target.value || undefined })}
            className={field}
            aria-label="Voz del pasaje"
          >
            <option value="">Voz sin asignar</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {(p.status === "pendiente" || p.status === "error") && (
          <button type="button" className={btn} onClick={onAnalyze}>
            {p.status === "error" ? "↻ Reintentar análisis" : "Analizar melodía"}
          </button>
        )}
        {p.group !== "descartado" && (
          <ToTemaButton
            memo={{ sessionId: session.id, passageId: p.id }}
            title={p.text ? `«${p.text.slice(0, 40)}»` : undefined}
            onLeave={() => clock.pause()}
          />
        )}
      </div>
    </div>
  );
}

function ManualForm({
  session,
  start,
  onCancel,
  onCreate,
}: {
  session: ComposeSession;
  start: number;
  onCancel: () => void;
  onCreate: (a: number, b: number, speaker?: string) => Promise<void>;
}) {
  const [a, setA] = useState(fmtTime(start));
  const [b, setB] = useState(fmtTime(start + 15));
  const [speaker, setSpeaker] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parse = (s: string) => {
    const m = s.trim().match(/^(\d+):(\d{1,2}(?:[.,]\d+)?)$/);
    if (m) return Number(m[1]) * 60 + Number(m[2].replace(",", "."));
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };
  const voices = visibleSpeakers(session);
  const submit = async () => {
    const x = parse(a);
    const y = parse(b);
    if (!(y > x + 0.5)) {
      setErr("el fin tiene que ir después del inicio");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onCreate(x, y, speaker || undefined);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel-2/40 px-3 py-2 text-xs text-text-dim">
      Desde
      <input value={a} onChange={(e) => setA(e.target.value)} className={`${field} w-16 font-mono`} aria-label="Inicio" />
      hasta
      <input value={b} onChange={(e) => setB(e.target.value)} className={`${field} w-16 font-mono`} aria-label="Fin" />
      {voices.length > 0 && (
        <select value={speaker} onChange={(e) => setSpeaker(e.target.value)} className={field} aria-label="Voz">
          <option value="">Voz sin asignar</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
        {busy ? "Creando…" : "Crear y analizar"}
      </button>
      <button type="button" className={btnGhost} onClick={onCancel}>
        cancelar
      </button>
      <span className="text-text-faint">el inicio sale del punto donde está la reproducción</span>
      {err && <span className="text-red">{err}</span>}
    </div>
  );
}
