"use client";

// Repaso de hoy (/ingles): 2 minutos con TUS errores reales, con repetición
// espaciada (cajas de 1, 3, 7, 16 y 35 días; la lógica vive en
// @hermes/shared/english-review y corrige el agente, sin modelo).
//
// Dos piezas:
//  - DailyReviewEntry: una línea en la entrada de /ingles («Repaso · 8 tarjetas»
//    + la acción). Sin caja de más: es un aviso con un botón, no un panel.
//  - DailyReview: el repaso abierto a todo el lienzo, una tarjeta a la vez,
//    como la lección del plan. Teclado primero: Enter responde y avanza,
//    1-3 eligen, Esc sale.
//
// La correcta NO se muestra hasta responder: en las de escribir el agente ni
// la manda en claro (va en `reveal`, que esta vista no decodifica: el
// veredicto llega del servidor).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewCardView, ReviewPayload } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { PanelState } from "@/components/ui/PanelState";
import { SpeakerIcon, speak } from "@/components/gym/GymFeedback";
import { answerReviewCard, getTodayReview, type ReviewVerdict } from "@/lib/english-review-api";
import { uuid } from "@/lib/hermes";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const shortDay = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[(m ?? 1) - 1]}`;
};

/** El estado del repaso de hoy (un GET al montar; cada respuesta trae el siguiente). */
export function useDailyReview() {
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const r = await getTodayReview();
    if (r.ok) {
      setReview(r.review);
      setError(null);
    } else setError(r.error);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { review, error, refresh, setReview };
}

function ReviewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="14" height="14" rx="2" />
      <path d="M7 3h12a2 2 0 0 1 2 2v12" />
    </svg>
  );
}

export function DailyReviewEntry({ review, onStart }: { review: ReviewPayload | null; onStart: () => void }) {
  // Sin datos (cargando o el agente no responde) no se pinta nada: la línea no
  // debe parpadear ni inventar un estado.
  if (!review) return null;
  const left = review.total - review.done;
  let title: string;
  let detail: string;
  let action: string | null = null;
  if (review.totalCards === 0) {
    title = "Repaso diario";
    detail =
      "Aún no hay tarjetas. Salen de los errores que anotan la compañera en tus clases y la tutora en tus prácticas.";
  } else if (review.total === 0) {
    title = "Repaso al día";
    detail = review.nextDue
      ? `Nada vence hoy · la próxima vuelve el ${shortDay(review.nextDue)} · ${plural(review.mastered, "dominada", "dominadas")}`
      : `${plural(review.mastered, "tarjeta dominada", "tarjetas dominadas")} de ${review.totalCards}`;
  } else if (review.complete) {
    title = "Repaso de hoy hecho";
    detail = `${review.correct} de ${review.total} bien${review.streak > 1 ? ` · racha de ${review.streak} días` : ""}${review.dueTomorrow ? ` · ${review.dueTomorrow} vuelven mañana` : ""}`;
  } else {
    title = `Repaso · ${plural(left, "tarjeta", "tarjetas")}`;
    detail = `De tus errores reales · unos 2 minutos${review.streak ? ` · racha de ${review.streak} ${review.streak === 1 ? "día" : "días"}` : ""}`;
    // "repaso" en el texto: el plan, justo debajo, tiene su propio "Empezar".
    action = review.done ? "Seguir repaso" : "Empezar repaso";
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${action ? "bg-accent/10 text-accent" : "bg-hover text-text-dim"}`}
      >
        <ReviewIcon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-xs text-text-dim">{detail}</p>
      </div>
      {action && (
        <Button variant="primary" size="md" onClick={onStart}>
          {action}
        </Button>
      )}
    </div>
  );
}

function Progress({ cards }: { cards: ReviewCardView[] }) {
  return (
    <div className="flex gap-1" role="progressbar" aria-valuenow={cards.filter((c) => c.answered).length} aria-valuemax={cards.length}>
      {cards.map((c) => (
        <span
          key={c.id}
          className={`h-1.5 flex-1 rounded-full ${!c.answered ? "bg-hover" : c.answered.correct ? "bg-green" : "bg-red"}`}
        />
      ))}
    </div>
  );
}

type Phase = { kind: "ask" } | { kind: "sending" } | { kind: "verdict"; v: ReviewVerdict; picked?: string };

export function DailyReview({
  review,
  setReview,
  active,
  onExit,
}: {
  review: ReviewPayload | null;
  setReview: (r: ReviewPayload) => void;
  active: boolean;
  onExit: () => void;
}) {
  // La tarjeta en pantalla: la primera sin responder al abrir, y se queda
  // mientras se lee su veredicto (aunque `review` ya la marque respondida).
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Un id por respuesta: reintentar tras un fallo de red reusa el mismo.
  const clientId = useRef<string>(uuid());
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const cards = review?.cards ?? [];
  useEffect(() => {
    if (currentId || !review) return;
    setCurrentId(review.cards.find((c) => !c.answered)?.id ?? null);
  }, [review, currentId]);
  const card = cards.find((c) => c.id === currentId) ?? null;
  const index = card ? cards.indexOf(card) : -1;

  useEffect(() => {
    if (phase.kind === "ask" && card?.kind === "type") inputRef.current?.focus();
    if (phase.kind === "verdict") nextRef.current?.focus();
  }, [phase.kind, card?.id, card?.kind]);

  const submit = useCallback(
    async (answer: string) => {
      if (!card || phase.kind !== "ask" || !answer.trim()) return;
      setPhase({ kind: "sending" });
      setError(null);
      const r = await answerReviewCard({ cardId: card.id, kind: card.kind, answer, clientId: clientId.current });
      if (!r.ok) {
        setError(r.error);
        setPhase({ kind: "ask" });
        return;
      }
      setReview(r.next);
      setPhase({ kind: "verdict", v: r, picked: card.kind === "choose" ? answer : undefined });
      if (r.correct) speak(r.better, "en");
    },
    [card, phase.kind, setReview],
  );

  const advance = useCallback(() => {
    if (phase.kind !== "verdict" || !review) return;
    const after = review.cards.slice(index + 1).find((c) => !c.answered) ?? review.cards.find((c) => !c.answered);
    clientId.current = uuid();
    setTyped("");
    setError(null);
    setPhase({ kind: "ask" });
    setCurrentId(after?.id ?? "__done");
  }, [phase.kind, review, index]);

  const keys = useRef({ submit, advance, phase, card });
  keys.current = { submit, advance, phase, card };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keys.current;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
        return;
      }
      // Un botón con foco ya recibe su Enter del navegador: dispararlo aquí también avanzaba dos tarjetas.
      if (typing || (t?.tagName === "BUTTON" && e.key === "Enter")) return;
      if (k.phase.kind === "ask" && k.card?.kind === "choose" && /^[1-3]$/.test(e.key)) {
        const opt = k.card.options?.[Number(e.key) - 1];
        if (opt) {
          e.preventDefault();
          void k.submit(opt);
        }
      } else if (e.key === "Enter" && k.phase.kind === "verdict") {
        e.preventDefault();
        k.advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onExit]);

  if (!review) return <PanelState kind="loading" title="Cargando el repaso…" />;

  const finished = currentId === "__done" || (!card && review.complete);
  return (
    <ScrollArea fade="y" className="min-h-0 flex-1">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-1 pt-2 pb-12">
        <header className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-md font-medium text-text">Repaso de hoy</h2>
            <p className="text-xs text-text-faint">
              {finished ? "Terminado" : card ? `${index + 1} de ${cards.length}` : ""}
              <span className="max-sm:hidden"> · Esc para salir</span>
            </p>
          </div>
          {cards.length > 0 && <Progress cards={cards} />}
        </header>

        {finished ? (
          <Summary review={review} onExit={onExit} />
        ) : !card ? (
          <PanelState kind="empty" title="No hay tarjetas para hoy" action={<Button onClick={onExit}>Volver</Button>} />
        ) : (
          <CardBody
            card={card}
            phase={phase}
            typed={typed}
            setTyped={setTyped}
            submit={submit}
            advance={advance}
            inputRef={inputRef}
            nextRef={nextRef}
            last={!review.cards.some((c) => !c.answered)}
          />
        )}
        {error && (
          <p className="flex items-center gap-2 text-sm text-text-dim" role="alert">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
            No se guardó: {error}. Vuelve a intentarlo (no cuenta doble).
          </p>
        )}
      </article>
    </ScrollArea>
  );
}

function CardBody({
  card,
  phase,
  typed,
  setTyped,
  submit,
  advance,
  inputRef,
  nextRef,
  last,
}: {
  card: ReviewCardView;
  phase: Phase;
  typed: string;
  setTyped: (s: string) => void;
  submit: (answer: string) => void;
  advance: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  nextRef: React.RefObject<HTMLButtonElement | null>;
  last: boolean;
}) {
  const verdict = phase.kind === "verdict" ? phase.v : null;
  const sending = phase.kind === "sending";
  return (
    <div className="flex flex-col gap-6">
      {card.kind === "type" ? (
        <>
          <div>
            <p className="text-xs text-text-faint">Dijiste</p>
            <p className="mt-1.5 text-xl leading-snug text-text">{card.said}</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (verdict) advance();
              else submit(typed);
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="review-typed" className="text-sm text-text-dim">
              Escríbela bien
            </label>
            <input
              id="review-typed"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={!!verdict || sending}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              lang="en"
              className={`h-11 w-full min-w-0 rounded-sm border bg-panel px-3 text-md text-text outline-none transition-colors placeholder:text-text-faint focus:border-accent disabled:opacity-100 ${
                verdict ? (verdict.correct ? "border-green" : "border-red") : "border-line"
              }`}
              placeholder="En inglés…"
            />
            {!verdict && (
              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary" size="md" disabled={!typed.trim() || sending}>
                  {sending ? "Revisando…" : "Responder"}
                </Button>
                <span className="text-xs text-text-faint max-sm:hidden">
                  <Kbd>↵</Kbd> responde · mayúsculas, puntuación y contracciones no cuentan
                </span>
              </div>
            )}
          </form>
        </>
      ) : (
        <>
          <p className="text-sm text-text-dim">¿Cuál es la correcta?</p>
          <div className="flex flex-col gap-2.5">
            {(card.options ?? []).map((opt, i) => {
              const isBetter = verdict && opt === verdict.better;
              const isPicked = phase.kind === "verdict" && phase.picked === opt;
              const isSaid = verdict && opt === verdict.said;
              const tone = !verdict
                ? "border-line hover:border-line-2 hover:bg-hover"
                : isBetter
                  ? "border-green bg-green/10"
                  : isPicked
                    ? "border-red bg-red/10"
                    : "border-line opacity-60";
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={!!verdict || sending}
                  onClick={() => submit(opt)}
                  className={`flex w-full cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 text-left transition-colors disabled:cursor-default ${tone}`}
                >
                  <Kbd className="mt-0.5">{String(i + 1)}</Kbd>
                  <span className="min-w-0 flex-1 text-md leading-snug break-words text-text">{opt}</span>
                  {isSaid && <span className="mt-0.5 shrink-0 text-xs text-text-faint">dijiste</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {verdict && (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <p className={`text-sm font-medium ${verdict.correct ? "text-green" : "text-red"}`}>
              {verdict.correct ? "Bien" : "Así no"}
              {verdict.already ? " · ya la habías respondido hoy" : ""}
            </p>
            <div className="mt-2 flex items-start gap-2">
              <p className="min-w-0 flex-1 text-md leading-snug break-words text-text">{verdict.better}</p>
              <button
                type="button"
                onClick={() => speak(verdict.better, "en")}
                className="mt-0.5 shrink-0 cursor-pointer rounded-xs p-1 text-text-faint transition-colors hover:bg-hover hover:text-text"
                aria-label="Escuchar la frase"
              >
                <SpeakerIcon />
              </button>
            </div>
            {verdict.accept.length > 0 && (
              <p className="mt-1 text-sm text-text-dim">También vale: {verdict.accept.join(" · ")}</p>
            )}
            {verdict.rule && <p className="mt-2 text-sm leading-relaxed text-text-dim">{verdict.rule}</p>}
            <p className="mt-2 text-xs text-text-faint">
              {card.kind === "type" ? "" : `Dijiste «${verdict.said}» · `}
              {verdict.source.label}
              {card.patternTitle ? ` · ${card.patternTitle}` : ""}
              {card.seen > 1 ? ` · salió ${card.seen} veces` : ""}
            </p>
          </div>
          <div>
            <Button ref={nextRef} variant="primary" size="md" onClick={advance}>
              {last ? "Ver resumen" : "Seguir"}
              <Kbd className="ml-2 border-transparent bg-transparent text-on-accent/80">↵</Kbd>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ review, onExit }: { review: ReviewPayload; onExit: () => void }) {
  return (
    <div className="flex flex-col items-start gap-5 py-4">
      <div>
        <p className="text-2xl font-medium text-text">
          {review.correct} de {review.total} bien
        </p>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-text-dim">
          <li>
            Racha: {plural(review.streak, "día", "días")} con el repaso completo
          </li>
          <li>
            {review.dueTomorrow
              ? `${plural(review.dueTomorrow, "tarjeta vuelve", "tarjetas vuelven")} mañana`
              : "Mañana no vuelve ninguna de las de hoy"}
          </li>
          <li>
            {plural(review.mastered, "dominada", "dominadas")} de {review.totalCards}
          </li>
        </ul>
      </div>
      <Button variant="primary" size="md" onClick={onExit}>
        Volver
      </Button>
    </div>
  );
}
