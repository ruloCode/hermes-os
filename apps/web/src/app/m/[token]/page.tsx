"use client";

// LA CONVERSACIÓN EN EL BOLSILLO. El viajero escaneó el QR del tótem y aquí
// sigue lo mismo: los dos anfitriones, la ruta que se armó en la pantalla, y
// la charla que retoma donde iba (el pase trae el resumen y se lo damos a la
// sala como contexto, sin que el viajero repita nada).
//
// Tres diferencias con el tótem, y todas por el bolsillo: tema claro para el
// sol, una sola columna angosta, y el micrófono CERRADO salvo mientras se
// mantiene el botón — en la calle todo lo que suene sería un turno.

import { use, useCallback, useEffect, useRef, useState } from "react";
import type { SalaAgentPublic, SalaCastPublic } from "@hermes/shared";
import { hermesFetch } from "@/lib/hermes";
import { CastCall, type CastEvent } from "@/lib/sala/cast";
import { salaClientTools } from "@/lib/sala/client-tools";
import { onUiEvent, type UiPlace, type UiRoutePlan } from "@/lib/sala/ui-bus";
import type { SalaCallStatus } from "@/lib/sala/calls";
import { EST, estVars, hostColor, LANGUAGES, t, type EstLanguage } from "@/lib/estacion/theme";

declare global {
  interface Window {
    /** QA: hablar sin micrófono desde el celular. */
    __hermesMovilSay?: (text: string) => boolean;
    __hermesMovilDebug?: () => unknown;
  }
}

interface Pass {
  summary: string;
  language: string;
  route?: UiRoutePlan;
  station?: string;
  expiresAt: number;
}

type Load = { kind: "loading" } | { kind: "expired" } | { kind: "error"; error: string } | { kind: "ready"; pass: Pass };

/**
 * El micrófono del navegador SOLO existe en contexto seguro (https, o
 * localhost). Un celular que abre http://192.168.x.x no tiene
 * navigator.mediaDevices y la llamada muere con un error críptico. Aquí se
 * detecta antes de conectar: la ruta se muestra igual y la pantalla dice por
 * qué no se puede hablar, en vez de quedarse muda.
 */
function micAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

const NO_MIC: Record<EstLanguage, string> = {
  es: "Aquí puedes ver tu ruta, pero para hablar el navegador exige una conexión segura (https). Pídele a quien montó la pantalla la dirección https.",
  en: "You can see your route here, but talking needs a secure (https) connection in the browser. Ask for the https address.",
  pt: "Aqui você vê sua rota, mas para falar o navegador exige conexão segura (https). Peça o endereço https.",
};

const HOLD: Record<EstLanguage, { hold: string; talking: string; expired: string; back: string; title: string }> = {
  es: {
    hold: "Mantén para hablar",
    talking: "Te escucho…",
    expired: "Ese código ya venció. Vuelve a la pantalla de la estación y pide uno nuevo.",
    back: "La ruta que armaste",
    title: "Sigue con nosotros",
  },
  en: {
    hold: "Hold to talk",
    talking: "Listening…",
    expired: "That code expired. Go back to the station screen for a new one.",
    back: "The route you got",
    title: "Keep going with us",
  },
  pt: {
    hold: "Segure para falar",
    talking: "Ouvindo…",
    expired: "Esse código expirou. Volte à tela da estação e peça outro.",
    back: "A rota que você montou",
    title: "Continue com a gente",
  },
};

export default function MovilPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [cast, setCast] = useState<SalaCastPublic | null>(null);
  const [agents, setAgents] = useState<SalaAgentPublic[]>([]);
  const [status, setStatus] = useState<SalaCallStatus>("idle");
  const [lang, setLang] = useState<EstLanguage>("es");
  const [lines, setLines] = useState<{ key: string | null; name: string; text: string }[]>([]);
  const [talking, setTalking] = useState(false);
  const [places, setPlaces] = useState<{ station: string; places: UiPlace[] } | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const callRef = useRef<CastCall | null>(null);

  // ── El pase + quiénes son los anfitriones ─────────────────────────────
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [passRes, salaRes] = await Promise.all([
          hermesFetch(`/sala/handoff/${encodeURIComponent(token)}`),
          hermesFetch("/sala/agents"),
        ]);
        const pass = (await passRes.json()) as { ok: boolean; expired?: boolean } & Pass;
        const sala = (await salaRes.json()) as { agents?: SalaAgentPublic[]; cast?: SalaCastPublic | null };
        if (!alive) return;
        setAgents(sala.agents ?? []);
        setCast(sala.cast?.ready ? sala.cast : null);
        if (!pass.ok) return setLoad({ kind: pass.expired ? "expired" : "error", error: "" } as Load);
        const l = (pass.language || "es").slice(0, 2) as EstLanguage;
        if (l === "es" || l === "en" || l === "pt") setLang(l);
        setLoad({ kind: "ready", pass });
      } catch (err) {
        if (alive) setLoad({ kind: "error", error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const pass = load.kind === "ready" ? load.pass : null;
  const hosts = (cast?.members ?? []).map((key, i) => ({
    key,
    name: agents.find((a) => a.key === key)?.name ?? key,
    color: hostColor(i),
  }));
  const nameOf = useCallback(
    (key: string | null) => (key ? (hosts.find((h) => h.key === key)?.name ?? key) : "Tú"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cast, agents],
  );

  // Lo que descubren las tools desde el celular también se pinta.
  useEffect(
    () =>
      onUiEvent((ev) => {
        if (ev.kind === "places") setPlaces({ station: ev.station, places: ev.places });
        else if (ev.kind === "language") {
          const l = ev.language.slice(0, 2) as EstLanguage;
          if (l === "es" || l === "en" || l === "pt") setLang(l);
        }
      }),
    [],
  );

  const [noMic] = useState(() => !micAvailable());

  // ── La sesión: arranca sola con el contexto del pase, el mic cerrado ──
  useEffect(() => {
    if (!cast || !pass || noMic) return;
    const call = new CastCall({
      fetchToken: async () => {
        const res = await fetch("/api/elevenlabs/token?agent=cast");
        return (await res.json()) as { conversationToken?: string; signedUrl?: string; error?: string };
      },
      clientTools: salaClientTools(),
      labels: cast.labels,
      defaultKey: cast.default,
      owner: "",
      onEvent: (ev: CastEvent) => {
        if (ev.kind === "status") {
          setStatus(ev.status ?? "idle");
          // El mic arranca y se queda cerrado: solo lo abre el botón.
          if (ev.status === "connected") call.setMicMuted(true);
        } else if (ev.kind === "line") {
          setLines((prev) => [...prev.slice(-8), { key: ev.key ?? null, name: nameOf(ev.key ?? null), text: ev.text ?? "" }]);
        } else if (ev.kind === "error") {
          setCallError(ev.text ?? "error");
        }
      },
    });
    callRef.current = call;
    window.__hermesMovilSay = (text) => call.say(text);
    const framing = [
      pass.station ? `El viajero venía de la pantalla de la estación ${pass.station} y siguió en su celular.` : "",
      `Contexto de lo que ya pasó: ${pass.summary}`,
      "Salúdenlo en UNA frase corta, sin repetir la ruta completa, y quédense disponibles para lo que pregunte en el camino.",
    ]
      .filter(Boolean)
      .join(" ");
    void call.connect(framing);
    return () => {
      delete window.__hermesMovilSay;
      void call.hangup();
      callRef.current = null;
    };
  }, [cast, pass, nameOf, noMic]);

  // Quién habla, para encender su punto.
  useEffect(() => {
    let raf = 0;
    let last: string | null = null;
    const step = () => {
      raf = requestAnimationFrame(step);
      const k = callRef.current?.speakingKey() ?? null;
      if (k !== last) {
        last = k;
        setSpeaking(k);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hold = useCallback((on: boolean) => {
    setTalking(on);
    callRef.current?.setMicMuted(!on);
  }, []);

  const pickLanguage = useCallback((code: EstLanguage) => {
    setLang(code);
    const idioma = code === "es" ? "español" : code === "en" ? "inglés" : "portugués";
    callRef.current?.context(`El viajero eligió ${idioma}: sigan en ${idioma}.`);
  }, []);

  useEffect(() => {
    window.__hermesMovilDebug = () => ({
      load: load.kind,
      status,
      lang,
      talking,
      noMic,
      error: callError,
      route: pass?.route ? { from: pass.route.from, to: pass.route.to, legs: pass.route.legs.map((l) => l.line) } : null,
      places: places?.places.map((p) => p.name) ?? null,
      lines: lines.slice(-6),
    });
    return () => {
      delete window.__hermesMovilDebug;
    };
  }, [load.kind, status, lang, talking, pass, places, lines, callError, noMic]);

  const L = HOLD[lang];

  if (load.kind !== "ready") {
    return (
      <main style={estVars} className="grid min-h-screen place-items-center bg-[var(--est-butter)] p-8 text-center">
        <p className="max-w-[420px] text-[19px] text-[var(--est-ink)]">
          {load.kind === "loading" ? "…" : load.kind === "expired" ? L.expired : "No pude abrir este pase."}
        </p>
      </main>
    );
  }

  const route = pass?.route;

  return (
    <main
      style={estVars}
      className="flex min-h-screen flex-col bg-[var(--est-butter)] text-[var(--est-ink)]"
    >
      <header className="flex items-center gap-3 bg-[var(--est-mountain)] px-5 py-4">
        <div className="flex gap-2">
          {hosts.map((h) => (
            <span
              key={h.key}
              className="grid h-10 w-10 place-items-center rounded-full transition-transform"
              style={{ backgroundColor: h.color, transform: speaking === h.key ? "scale(1.12)" : "scale(1)" }}
            >
              <span className="flex gap-1.5">
                <span className="block h-1.5 w-1.5 rounded-full bg-white/90" />
                <span className="block h-1.5 w-1.5 rounded-full bg-white/90" />
              </span>
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--font-baloo)] text-[19px] leading-tight font-semibold text-[var(--est-butter)]">
            {L.title}
          </p>
          <p className="truncate text-[13px] text-[var(--est-butter)]/70">
            {hosts.map((h) => h.name).join(" · ")}
            {pass?.station ? ` · ${pass.station}` : ""}
          </p>
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-5">
        {route && (
          <section className="rounded-2xl border border-[var(--est-ink)]/10 bg-white/60 p-4">
            <p className="text-[13px] tracking-wide opacity-60">{L.back}</p>
            <p className="mt-1 font-[family-name:var(--font-baloo)] text-[21px] leading-tight font-semibold">
              {route.from} → {route.to}
            </p>
            <p className="mt-0.5 text-[15px] opacity-70">
              {route.minutes} {t(lang, "minutes")} ·{" "}
              {route.transfers === 0
                ? t(lang, "noTransfers")
                : `${route.transfers} ${route.transfers === 1 ? t(lang, "transfer") : t(lang, "transfers")}`}
            </p>
            <ol className="mt-3 flex flex-col gap-2">
              {route.legs.map((leg, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white"
                    style={{ backgroundColor: leg.color }}
                  >
                    {leg.line}
                  </span>
                  <span className="min-w-0 text-[15px]">
                    <span className="font-medium">{leg.to}</span>
                    <span className="opacity-65">
                      {" · "}
                      {leg.stops} {leg.stops === 1 ? t(lang, "stop") : t(lang, "stops")} · {leg.minutes} {t(lang, "minutes")}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {places && places.places.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-[13px] opacity-60">
              {t(lang, "places")} · {places.station}
            </p>
            {places.places.slice(0, 3).map((p) => (
              <article key={p.name} className="rounded-2xl border border-[var(--est-ink)]/10 bg-white/60 p-3">
                <p className="font-[family-name:var(--font-baloo)] text-[17px] font-semibold">{p.name}</p>
                <p className="text-[14px] opacity-70">
                  {p.walkMinutes === 0 ? t(lang, "here") : `${p.walkMinutes} ${t(lang, "minutes")} ${t(lang, "walk")}`} ·{" "}
                  {p.hours ?? t(lang, "noHours")}
                </p>
              </article>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-2" aria-live="polite">
          {lines.slice(-4).map((l, i) => (
            <p key={i} className="text-[16px] leading-snug wrap-break-word">
              <span
                className="font-[family-name:var(--font-baloo)] font-semibold"
                style={{ color: l.key ? hostColor(hosts.findIndex((h) => h.key === l.key)) : EST.ink }}
              >
                {l.name}:{" "}
              </span>
              {l.text}
            </p>
          ))}
        </section>
      </div>

      <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-[var(--est-ink)]/10 bg-[var(--est-butter)] px-5 pt-3 pb-6">
        <div className="flex justify-center gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => pickLanguage(l.code)}
              className="cursor-pointer rounded-full px-3 py-1 text-[13px]"
              style={
                l.code === lang
                  ? { backgroundColor: EST.mountain, color: EST.butter }
                  : { border: `1px solid ${EST.ink}22`, color: EST.ink }
              }
            >
              {l.label}
            </button>
          ))}
        </div>
        {noMic && <p className="px-1 text-center text-[13px] leading-snug opacity-70">{NO_MIC[lang]}</p>}
        <button
          type="button"
          // Mantener presionado: el micrófono solo se abre mientras el dedo está.
          onPointerDown={() => hold(true)}
          onPointerUp={() => hold(false)}
          onPointerCancel={() => hold(false)}
          onPointerLeave={() => talking && hold(false)}
          disabled={noMic || status !== "connected"}
          className="w-full rounded-full py-4 text-[19px] font-semibold text-white transition-transform disabled:opacity-50"
          style={{ backgroundColor: talking ? EST.guava : EST.mountain, transform: talking ? "scale(0.99)" : "scale(1)" }}
        >
          {status !== "connected" ? t(lang, "connecting") : talking ? L.talking : L.hold}
        </button>
      </footer>
    </main>
  );
}
