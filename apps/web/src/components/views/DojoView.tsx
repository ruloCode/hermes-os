"use client";

// DOJO DE ALGORITMOS (/dojo): de no saber nada a resolver problemas, en Python,
// escribiendo cada línea uno mismo. Inspirado en LeetCode, pensado para
// APRENDER: la ruta va por unidades (concepto → guiados → sin ayuda → prueba)
// y cada problema obliga al método (entender → planear → escribir → probar →
// reflexionar). Python corre en el navegador (Pyodide en un worker): nada sale
// de la máquina para correr tu código.
//
// Gramática v5: la LISTA es la ruta con el riel al lado; elegir una lección es
// la PIEZA (ViewHeader con ← Ruta). Todo dato visible es real: el estado de
// cada lección, la racha y los repasos salen de los intentos guardados.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DOJO_ITEMS,
  DOJO_XP,
  DOJO_KIND_LABEL,
  DOJO_UNITS,
  REVIEW_DAYS,
  dojoItem,
  dojoUnit,
  type DojoItem,
  type DojoItemView,
  type DojoPayload,
} from "@hermes/shared";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Rail, RailRow, RailSection } from "@/components/ui/Rail";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Button } from "@/components/ui/Button";
import { ConceptLesson } from "@/components/dojo/ConceptLesson";
import { DojoPath } from "@/components/dojo/DojoPath";
import { ProblemWorkspace, type DojoPrefs } from "@/components/dojo/ProblemWorkspace";
import { GameHud } from "@/components/dojo/GameHud";
import { useDojo } from "@/hooks/useDojo";
import { ensurePython } from "@/lib/dojo/python";
import { gameState, initGameSound, resetCombo, setGameSound, subscribeGame } from "@/lib/dojo/game";

const PREFS_KEY = "hermes-dojo-prefs";
const DEFAULT_PREFS: DojoPrefs = { vim: false, fontSize: 15 };

function readPrefs(): DojoPrefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<DojoPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function DojoRail({ dojo, onOpen }: { dojo: DojoPayload; onOpen: (id: string, review?: boolean) => void }) {
  const current = dojo.current ? dojoItem(dojo.current) : null;
  return (
    <Rail>
      <RailSection label="Hoy">
        <div className="flex flex-col gap-0.5 px-2">
          <p className="text-2xl font-semibold text-text tabular-nums">
            {dojo.streak} <span className="text-sm font-normal text-text-dim">{dojo.streak === 1 ? "día" : "días"} de racha</span>
          </p>
          <p className="text-sm text-text-dim">
            {dojo.doneToday === 0
              ? "Hoy todavía nada."
              : `${dojo.doneToday} ${dojo.doneToday === 1 ? "lección hecha" : "lecciones hechas"} hoy.`}
          </p>
        </div>
        {current && (
          <div className="mt-2">
            <RailRow
              title={current.title}
              sub={`Toca ahora · ${DOJO_KIND_LABEL[current.kind]}`}
              tone="accent"
              onClick={() => onOpen(current.id)}
            />
          </div>
        )}
      </RailSection>

      <RailSection label="Tecleo">
        <div className="flex flex-col gap-2 px-2">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-text">
                {dojo.typing.today.toLocaleString("es-CO")}{" "}
                <span className="text-text-faint">/ {DOJO_XP.metaDiaria} caracteres hoy</span>
              </span>
              {dojo.typing.today >= DOJO_XP.metaDiaria && <span className="text-xs text-green">meta ✓</span>}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-selected">
              <div
                className={`h-full rounded-full ${dojo.typing.today >= DOJO_XP.metaDiaria ? "bg-green" : "bg-accent"}`}
                style={{ width: `${Math.min(100, (dojo.typing.today / DOJO_XP.metaDiaria) * 100)}%` }}
              />
            </div>
          </div>
          {dojo.typing.wpm != null ? (
            <p className="text-sm text-text-dim tabular-nums">
              {dojo.typing.wpm} ppm · {dojo.typing.accuracy} % precisión
              {dojo.typing.bestCombo > 0 && ` · mejor combo ×${dojo.typing.bestCombo}`}
            </p>
          ) : (
            <p className="text-sm text-text-faint">Teclea tu primer ejemplo y aquí sale tu ritmo.</p>
          )}
        </div>
      </RailSection>

      <RailSection
        label="Repaso"
        right={dojo.upcoming > 0 ? <span className="text-2xs text-text-faint">{dojo.upcoming} más adelante</span> : undefined}
      >
        {dojo.reviews.length ? (
          <div className="flex flex-col">
            {dojo.reviews.map((r) => {
              const item = dojoItem(r.itemId);
              if (!item) return null;
              return (
                <RailRow
                  key={r.itemId}
                  title={item.title}
                  sub={`Desde cero · vuelta ${r.step + 1} de ${REVIEW_DAYS.length}`}
                  tone="amber"
                  value={r.due < dojo.today ? "atrasado" : "hoy"}
                  onClick={() => onOpen(r.itemId, true)}
                />
              );
            })}
          </div>
        ) : (
          <p className="px-2 text-sm text-text-faint">
            Nada para hoy. Lo que resuelvas con pistas o te rindas vuelve aquí para reescribirlo desde cero.
          </p>
        )}
      </RailSection>

      <RailSection label="Por capítulo">
        <div className="flex flex-col">
          {DOJO_UNITS.map((u) => {
            const uv = dojo.units.find((x) => x.key === u.key);
            if (!uv) return null;
            return (
              <RailRow
                key={u.key}
                title={u.title}
                sub={`${uv.solved} de ${uv.problems} problemas · ${uv.clean} sin pistas`}
                tone={uv.mastered ? "green" : "line"}
                value={`${uv.done}/${uv.total}`}
              />
            );
          })}
        </div>
      </RailSection>

      <RailSection label="La regla">
        <p className="px-2 text-sm leading-relaxed text-text-dim">
          Hermes no escribe tu solución. Pistas por escalones, cada una queda en tu registro; la solución de referencia
          solo después de pasar los tests o de rendirte.
        </p>
      </RailSection>
    </Rail>
  );
}

function LevelBar({ dojo }: { dojo: DojoPayload }) {
  const { level, into, need, today } = dojo.xp;
  return (
    <span className="flex items-center gap-2.5" title={`${dojo.xp.total} XP en total · ${today} hoy`}>
      <span className="grid h-7 min-w-7 place-items-center rounded-full bg-accent-solid px-1.5 text-xs font-semibold text-on-accent tabular-nums">
        {level}
      </span>
      <span className="flex flex-col gap-1">
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-selected">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${(into / need) * 100}%` }} />
        </span>
        <span className="text-2xs text-text-faint tabular-nums">
          {into}/{need} XP{today > 0 ? ` · +${today} hoy` : ""}
        </span>
      </span>
    </span>
  );
}

function SoundToggle() {
  const { sound } = useSyncExternalStore(subscribeGame, gameState, gameState);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={sound}
      onClick={() => setGameSound(!sound)}
      title="Sonido de teclas, combos y XP"
      className={sound ? "bg-selected text-text" : ""}
    >
      {sound ? "Sonido sí" : "Sonido no"}
    </Button>
  );
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.closest(".cm-editor") != null || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);

export function DojoView({ active }: { active: boolean }) {
  const { dojo, error, saveAttempt, saveTyping, askCoach } = useDojo(active);
  useEffect(() => initGameSound(), []);
  const [open, setOpen] = useState<{ id: string; review: boolean } | null>(null);
  const [prefs, setPrefsState] = useState<DojoPrefs>(DEFAULT_PREFS);
  useEffect(() => setPrefsState(readPrefs()), []);
  const setPrefs = useCallback((p: DojoPrefs) => {
    setPrefsState(p);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* sin storage: la preferencia dura la sesión */
    }
  }, []);

  // Precalentar Python al entrar: la primera carga baja ~10 MB y tarda unos
  // segundos; mejor que pase mientras lees el enunciado.
  useEffect(() => {
    if (active) void ensurePython().catch(() => null);
  }, [active]);

  const item = open ? dojoItem(open.id) : null;
  const next = useMemo(() => {
    if (!item) return null;
    const i = DOJO_ITEMS.findIndex((x) => x.id === item.id);
    return DOJO_ITEMS[i + 1] ?? null;
  }, [item]);
  const openItem = useCallback((id: string, review = false) => {
    resetCombo();
    setOpen({ id, review });
  }, []);
  const back = useCallback(() => {
    resetCombo();
    setOpen(null);
  }, []);

  // Teclado de la ruta: ↑↓ (o j/k) eligen, Enter abre. En una lección, Esc
  // vuelve a la ruta (salvo escribiendo: en el editor Esc es de Vim).
  const [sel, setSel] = useState<string | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (open) {
        if (e.key === "Escape" && !isTyping(e.target)) back();
        return;
      }
      if (isTyping(e.target)) return;
      const ids = DOJO_ITEMS.map((i) => i.id).filter((id) => dojo?.items[id]?.status !== "locked");
      const cur = selRef.current ?? dojo?.current ?? ids[0];
      const idx = Math.max(0, ids.indexOf(cur));
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSel(ids[Math.min(ids.length - 1, selRef.current ? idx + 1 : idx)]);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSel(ids[Math.max(0, idx - 1)]);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        openItem(cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, open, back, openItem, dojo]);
  useEffect(() => {
    if (sel) document.querySelector(`[data-dojo-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onTyping = useCallback((input: Parameters<typeof saveTyping>[0]) => void saveTyping(input), [saveTyping]);

  const onSave = useCallback(
    async (input: Parameters<typeof saveAttempt>[0]) => {
      const r = await saveAttempt(input);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    [saveAttempt],
  );

  if (item && open) {
    const unit = dojoUnit(item.unit);
    return (
      <>
        <GameHud />
        <ViewHeader
          title={item.title}
          meta={`${unit?.title ?? ""} · ${DOJO_KIND_LABEL[item.kind]}${open.review ? " · repaso" : ""}`}
          onBack={back}
          backLabel="Ruta"
          actions={
            dojo ? (
              <>
                <SoundToggle />
                <LevelBar dojo={dojo} />
              </>
            ) : undefined
          }
        />
        {item.kind === "concepto" ? (
          <ConceptLesson
            key={item.id}
            item={item}
            done={Boolean(dojo?.items[item.id]?.solved)}
            fontSize={prefs.fontSize}
            onSave={onSave}
            onTyping={onTyping}
            next={next}
            onNext={() => next && openItem(next.id)}
          />
        ) : (
          <ProblemWorkspace
            key={`${item.id}:${open.review}`}
            item={item}
            view={dojo?.items[item.id]}
            review={open.review}
            prefs={prefs}
            setPrefs={setPrefs}
            onSave={onSave}
            onTyping={onTyping}
            askCoach={askCoach}
            next={next}
            onNext={() => next && openItem(next.id)}
          />
        )}
      </>
    );
  }

  const current = dojo?.current ? dojoItem(dojo.current) : null;
  return (
    <>
      <ViewHeader
        title="Dojo"
        meta={dojo ? `${dojo.totals.solved} de ${dojo.totals.problems} problemas · Python` : undefined}
        actions={
          <>
            {dojo && <LevelBar dojo={dojo} />}
            <SoundToggle />
            {current && (
              <Button variant="primary" size="md" onClick={() => openItem(current.id)}>
                Seguir: {current.title} <span className="ml-1 text-2xs text-on-accent/75">↵</span>
              </Button>
            )}
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
        <ScrollArea fade="y" className="col-span-12 min-h-0 lg:col-span-8">
          {error && !dojo && (
            <p className="mx-auto mb-4 flex max-w-3xl items-center gap-2 text-sm text-text-dim">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red" />
              No pude cargar tu progreso: {error}. La ruta funciona igual, pero no se guardará nada.
            </p>
          )}
          <DojoPath dojo={dojo} selected={sel} onOpen={(id) => openItem(id)} />
          <p className="mx-auto mt-2 max-w-3xl pb-8 text-center text-xs text-text-faint">
            ↑ ↓ o j k para moverte · Enter abre · Esc vuelve a la ruta
          </p>
        </ScrollArea>
        <aside className="col-span-12 min-h-0 lg:col-span-4 lg:border-l lg:border-line">
          {dojo && <DojoRail dojo={dojo} onOpen={openItem} />}
        </aside>
      </div>
    </>
  );
}
