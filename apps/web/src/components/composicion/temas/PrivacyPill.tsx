"use client";

/**
 * Pastilla PRIVADO de Composición (patrón Mobbin: el candado de "Private" de
 * Grok + el explicador de una sola vez del chat temporal de ChatGPT). Dice la
 * verdad con los datos del agente (`GET /composicion/privacy`): si solo
 * responde en la red local, qué sale del equipo, a quién y cuándo, y qué se
 * queda aquí. Sin datos, lo dice — nunca promete lo que no sabe.
 *
 * La primera vez se abre sola con las tres promesas; después, solo con clic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrivacyInfo } from "@hermes/shared";
import { useTemasApi } from "./api";

const SEEN_KEY = "hermes-composicion-privacy-seen";

function Lock({ open = false }: { open?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d={open ? "M8 11V7a4 4 0 0 1 7.5-2" : "M8 11V7a4 4 0 0 1 8 0v4"} strokeLinecap="round" />
    </svg>
  );
}

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Sin almacenamiento no se puede recordar: no se abre sola (mejor que abrirse siempre).
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* sin almacenamiento */
  }
}

export function PrivacyPill({ align = "right" }: { align?: "left" | "right" }) {
  const api = useTemasApi();
  const [info, setInfo] = useState<PrivacyInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .privacy()
      .then((p) => {
        if (cancelled) return;
        setInfo(p);
        setErr(null);
        // El explicador de una vez: solo cuando hay datos reales que explicar.
        if (!seen()) {
          setIntro(true);
          setOpen(true);
        }
      })
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const close = useCallback(() => {
    setOpen(false);
    if (intro) {
      markSeen();
      setIntro(false);
    }
  }, [intro]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  const lan = info?.lanOnly ?? null;
  const label = info ? (lan ? "Privado" : "Privado · sin guardia") : err ? "Privacidad sin datos" : "Privado";
  const tone = info && !lan ? "text-amber" : err ? "text-text-faint" : "text-text-dim";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        title="Qué sale de este equipo y qué no"
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs transition-colors hover:border-line-2 hover:text-text ${tone}`}
      >
        <Lock open={!!info && !lan} />
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Privacidad de Composición"
          className={`absolute top-full z-30 mt-1.5 w-[min(360px,calc(100vw-32px))] rounded-md border border-line bg-panel p-3 shadow-[var(--shadow-pop)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {!info ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm text-text">El agente no informa su política todavía</p>
              <p className="text-xs text-text-dim">
                {err ? `No respondió: ${err}.` : "Cargando…"} Mientras tanto, no se puede afirmar qué sale del equipo.
              </p>
            </div>
          ) : (
            <PrivacyBody info={info} intro={intro} onDone={close} />
          )}
        </div>
      )}
    </div>
  );
}

function PrivacyBody({ info, intro, onDone }: { info: PrivacyInfo; intro: boolean; onDone: () => void }) {
  // Las tres promesas salen de los datos: red local, qué sale, qué se queda.
  const promises = [
    info.lanOnly
      ? { ok: true, text: "Solo se abre desde tu red local: por el túnel, Composición responde que es privada." }
      : { ok: false, text: "La guardia de red local está apagada: Composición también responde por el túnel." },
    info.external.length
      ? {
          ok: true,
          text: `Sale del equipo solo lo que se lista abajo (${info.external.length} ${
            info.external.length === 1 ? "caso" : "casos"
          }), y solo cuando lo pides.`,
        }
      : { ok: true, text: "Nada sale del equipo." },
    info.local.length
      ? {
          ok: true,
          text: `Se queda aquí: ${info.local.slice(0, 2).join(" · ").toLowerCase()}${info.local.length > 2 ? "…" : "."}`,
        }
      : null,
  ].filter((p): p is { ok: boolean; text: string } => p !== null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-text">{intro ? "Composición es interna" : "Qué sale de este equipo"}</p>
        {intro && (
          <p className="mt-0.5 text-xs text-text-dim">Esto se explica una vez; la pastilla lo recuerda siempre.</p>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {promises.map((p) => (
          <li key={p.text} className="flex gap-2 text-xs">
            <span aria-hidden className={p.ok ? "text-green" : "text-amber"}>
              {p.ok ? "✓" : "!"}
            </span>
            <span className="text-text">{p.text}</span>
          </li>
        ))}
      </ul>
      {info.external.length > 0 && (
        <section className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Sale del equipo</span>
          <ul className="flex flex-col divide-y divide-line/60 rounded-sm border border-line">
            {info.external.map((x) => (
              <li key={`${x.what}-${x.to}`} className="px-2 py-1.5 text-xs">
                <span className="text-text">{x.what}</span>
                <span className="text-text-dim"> → {x.to}</span>
                <span className="block text-text-faint">{x.when}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {info.local.length > 0 && (
        <section className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Se queda en este equipo</span>
          <ul className="flex flex-col gap-0.5 text-xs text-text-dim">
            {info.local.map((l) => (
              <li key={l}>· {l}</li>
            ))}
          </ul>
        </section>
      )}
      {intro && (
        <button
          type="button"
          onClick={onDone}
          className="self-end rounded-sm border border-accent bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        >
          Entendido
        </button>
      )}
    </div>
  );
}
