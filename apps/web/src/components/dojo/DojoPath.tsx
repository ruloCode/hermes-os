"use client";

// EL MAPA DEL DOJO: seis lugares, uno por idea, en zigzag como en Duolingo.
// Cada capítulo abre con su lugar y su historia; después vienen los nodos (las
// lecciones), un cofre a mitad de camino y el jefe al final. Lo que toca es lo
// único en acento; lo hecho va en verde; lo cerrado, en gris con candado.
//
// Todo estado sale de la vista del agente (dojoView): candados, cofre y jefe se
// calculan sobre los intentos guardados, no se marcan a mano. El jefe de un
// capítulo cerrado se puede intentar: vencerlo es saltar el capítulo.

import {
  DOJO_KIND_LABEL,
  DOJO_UNITS,
  type DojoItem,
  type DojoItemView,
  type DojoPayload,
  type DojoUnit,
} from "@hermes/shared";
import { DojoFigure } from "./figures/DojoFigure";

/** Desplazamiento horizontal de cada nodo (px): el zigzag. */
const ZIGZAG = [0, 64, 96, 64, 0, -64, -96, -64];

const ICON = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function NodeIcon({ item, view }: { item: DojoItem; view?: DojoItemView }) {
  if (view?.status === "done")
    return (
      <svg {...ICON} strokeWidth={2.4}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  if (view?.status === "locked")
    return (
      <svg {...ICON}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    );
  if (item.kind === "concepto")
    return (
      <svg {...ICON}>
        <path d="M12 6.5C10.2 5 7.6 4.5 4 4.8v13.4c3.6-.3 6.2.2 8 1.7 1.8-1.5 4.4-2 8-1.7V4.8c-3.6-.3-6.2.2-8 1.7zM12 6.5v13.4" />
      </svg>
    );
  if (item.kind === "prueba")
    return (
      <svg {...ICON}>
        <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
      </svg>
    );
  return (
    <svg {...ICON}>
      <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" />
    </svg>
  );
}

function Node({
  item,
  view,
  offset,
  selected,
  today,
  onOpen,
}: {
  item: DojoItem;
  view?: DojoItemView;
  offset: number;
  selected: boolean;
  today: string;
  onOpen: () => void;
}) {
  const status = view?.status ?? "locked";
  const boss = item.kind === "prueba";
  const size = boss ? "h-20 w-20" : "h-16 w-16";
  const tone =
    status === "current"
      ? "bg-accent-solid text-on-accent ring-[6px] ring-accent/20"
      : status === "done"
        ? "bg-green/15 text-green border-2 border-green/40"
        : status === "open"
          ? `bg-panel text-text border-2 ${boss ? "border-accent/50" : "border-line-2"} hover:border-accent`
          : "bg-hover text-text-faint border-2 border-transparent";
  const locked = status === "locked";
  const reviewDue = Boolean(view?.review && today && view.review.due <= today);
  return (
    <li className="relative flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
      {status === "current" && (
        <span className="mb-2 rounded-sm border border-line bg-panel px-2.5 py-1 text-xs font-semibold text-accent shadow-[var(--shadow-card)]">
          Empezar
        </span>
      )}
      <button
        type="button"
        data-dojo-row={item.id}
        onClick={onOpen}
        disabled={locked}
        title={locked ? "Se abre al terminar la lección anterior" : `${DOJO_KIND_LABEL[item.kind]}: ${item.title}`}
        className={`grid ${size} cursor-pointer place-items-center rounded-full transition-[box-shadow,border-color,transform] enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed ${tone} ${
          selected ? "outline-2 outline-offset-4 outline-accent" : ""
        }`}
      >
        <NodeIcon item={item} view={view} />
      </button>
      <span className={`mt-1.5 max-w-44 text-center text-sm leading-snug ${locked ? "text-text-faint" : "text-text"}`}>
        {item.title}
      </span>
      <span className="text-xs text-text-faint">
        {boss ? "Jefe" : DOJO_KIND_LABEL[item.kind]}
        {view?.clean && item.kind !== "concepto" ? " · sin pistas" : ""}
        {reviewDue ? " · repaso hoy" : ""}
      </span>
    </li>
  );
}

function Chest({ opened, offset }: { opened: boolean; offset: number }) {
  return (
    <li className="flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
      <span
        className={`grid h-14 w-16 place-items-center rounded-md border-2 ${
          opened ? "border-green/40 bg-green/10 text-green" : "border-line-2 bg-panel text-text-dim"
        }`}
        title={opened ? "Cofre abierto" : "Se abre al terminar las lecciones de arriba"}
      >
        <svg {...ICON}>
          {opened ? (
            <path d="M4 11h16v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 11 6 5h12l2 6M10 14h4" />
          ) : (
            <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10a4 4 0 0 1 4-5h8a4 4 0 0 1 4 5M10 13h4v2h-4z" />
          )}
        </svg>
      </span>
      <span className="mt-1 text-xs text-text-faint">{opened ? "Cofre abierto · +40 XP" : "Cofre"}</span>
    </li>
  );
}

function ChapterHeader({ unit, index, dojo }: { unit: DojoUnit; index: number; dojo: DojoPayload | null }) {
  const uv = dojo?.units.find((u) => u.key === unit.key);
  const prev = DOJO_UNITS[index - 1];
  return (
    <header
      className={`rounded-md border px-5 py-4 ${
        uv && !uv.open ? "border-line bg-hover" : uv?.mastered ? "border-green/30 bg-panel" : "border-line-2 bg-panel"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-text-faint">
            Capítulo {index + 1} · {unit.subtitle}
          </p>
          <h2 className="mt-0.5 text-2xl font-semibold text-text">{unit.title}</h2>
        </div>
        {uv && (
          <span className={`shrink-0 pt-1 text-sm tabular-nums ${uv.mastered ? "text-green" : "text-text-dim"}`}>
            {uv.mastered ? "Dominado" : `${uv.done}/${uv.total}`}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {unit.story.map((line, i) => (
          <p key={i} className="text-sm leading-relaxed text-text-dim">
            {line}
          </p>
        ))}
      </div>
      {uv && !uv.open && prev && (
        <p className="mt-2 text-sm text-text-faint">
          Se abre al vencer al jefe de «{prev.title}». ¿Ya lo sabes? Salta directo a su jefe.
        </p>
      )}
    </header>
  );
}

export function DojoPath({
  dojo,
  selected,
  onOpen,
}: {
  dojo: DojoPayload | null;
  selected: string | null;
  onOpen: (id: string) => void;
}) {
  const currentUnit = DOJO_UNITS.find((u) => u.items.some((i) => i.id === dojo?.current));
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-12 px-1 pt-1 pb-12">
      {DOJO_UNITS.map((unit, u) => {
        const uv = dojo?.units.find((x) => x.key === unit.key);
        const concept = unit.items.find((i) => i.kind === "concepto");
        let k = 0;
        return (
          <section key={unit.key} className="flex flex-col gap-6" aria-label={`Capítulo ${u + 1}: ${unit.title}`}>
            <ChapterHeader unit={unit} index={u} dojo={dojo} />
            {unit === currentUnit && concept && (
              <div className="mx-auto w-full max-w-lg">
                <DojoFigure itemId={concept.id} reveal />
              </div>
            )}
            <ol className="flex flex-col items-center gap-6">
              {unit.items.map((item, i) => {
                const nodes = [
                  <Node
                    key={item.id}
                    item={item}
                    view={dojo?.items[item.id]}
                    offset={ZIGZAG[k++ % ZIGZAG.length]}
                    selected={selected === item.id}
                    today={dojo?.today ?? ""}
                    onOpen={() => onOpen(item.id)}
                  />,
                ];
                if (i === unit.chestAfter - 1)
                  nodes.push(
                    <Chest key={`chest-${unit.key}`} opened={uv?.chest === "opened"} offset={ZIGZAG[k++ % ZIGZAG.length]} />,
                  );
                return nodes;
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
