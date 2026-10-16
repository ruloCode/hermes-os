"use client";

// Vista AGENDA: página completa del calendario (feed ICS de Google) con selector
// de vistas estilo Google Calendar — Mes (cuadrícula), Semana y Día (timeline) y
// Agenda (lista maestro-detalle). Solo lectura: es un espejo del calendario. La
// voz y el header viven en el AppShell; los mismos datos alimentan el strip.

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { PanelState } from "@/components/ui/PanelState";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useAgenda } from "@/hooks/useAgenda";
import {
  addDays,
  addMonths,
  dayTitle,
  eventState,
  groupByDay,
  monthTitle,
  startOfDay,
  upcomingOnly,
  weekDaysOf,
  weekTitle,
} from "@/lib/agenda";
import type { CalendarEvent } from "@hermes/shared";
import { AgendaList } from "@/components/agenda/AgendaList";
import { AgendaDetail } from "@/components/agenda/AgendaDetail";
import { CalendarToolbar, type AgendaMode } from "@/components/agenda/CalendarToolbar";
import { MonthGrid } from "@/components/agenda/MonthGrid";
import { WeekTimeline } from "@/components/agenda/WeekTimeline";
import { EventModal } from "@/components/agenda/EventModal";

const FETCHED_FMT = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function AgendaView() {
  const { calendar, loading, offline, refresh } = useAgenda();

  // Reloj que refresca etiquetas relativas y la línea de "ahora" sin esperar
  // al poll de 60s.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [mode, setMode] = useState<AgendaMode>("mes");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [modalEvent, setModalEvent] = useState<CalendarEvent | null>(null);

  const events = useMemo(() => calendar?.events ?? [], [calendar]);
  const weekDays = useMemo(() => weekDaysOf(cursor), [cursor]);

  // ── Navegación ‹ Hoy › según la vista activa ─────────────────────────
  const step = (dir: -1 | 1) => {
    if (mode === "mes") setCursor((c) => addMonths(c, dir));
    else if (mode === "semana") setCursor((c) => addDays(c, dir * 7));
    else setCursor((c) => addDays(c, dir));
  };
  const goToday = () => setCursor(startOfDay(new Date()));
  const changeMode = (m: AgendaMode) => {
    setModalEvent(null);
    setMode(m);
  };
  const openDay = (day: Date) => {
    setCursor(startOfDay(day));
    setMode("dia");
  };

  const title =
    mode === "mes"
      ? monthTitle(cursor)
      : mode === "semana"
        ? weekTitle(weekDays)
        : mode === "dia"
          ? dayTitle(cursor)
          : "Próximos eventos";

  // Junto al título: cuándo se leyó el feed (dato real) y si es caché vieja.
  const headerMeta = calendar?.configured ? (
    <span className="flex items-center gap-2 tabular-nums">
      {calendar.fetchedAt && <>actualizado {FETCHED_FMT.format(new Date(calendar.fetchedAt))}</>}
      {calendar.stale && <Badge tone="amber" size="sm">caché</Badge>}
    </span>
  ) : undefined;

  const headerRight = calendar?.configured ? (
    <button
      type="button"
      onClick={refresh}
      title="Refrescar"
      aria-label="Refrescar agenda"
      className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-xs text-text-dim transition-colors hover:bg-hover hover:text-text"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  ) : undefined;

  // La caja del calendario: se opera (clic en días y eventos), así que lleva
  // marco. Sin <Panel>: su cuerpo es un div BLOCK y la cuadrícula necesita un
  // padre flex para llenar el alto (antes quedaba una franja vacía abajo).
  const frame = "flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line bg-panel";

  // ── Contenido según estado global ───────────────────────────────────
  let content: React.ReactNode;
  if (calendar && !calendar.configured) {
    content = (
      <section className={`${frame} justify-center`}>
        <PanelState
          kind="empty"
          title="Calendario sin configurar"
          hint="Falta GOOGLE_CALENDAR_ICS_URL en el .env de la raíz."
        />
      </section>
    );
  } else if (loading && !calendar) {
    content = (
      <section className={`${frame} p-4`}>
        <PanelState kind="loading" />
      </section>
    );
  } else if (offline && !calendar) {
    content = (
      <section className={`${frame} justify-center`}>
        <PanelState kind="offline" retry={refresh} />
      </section>
    );
  } else if (mode === "agenda") {
    content = <AgendaSplit events={events} nowMs={nowMs} />;
  } else {
    content = (
      <section className={frame}>
        {mode === "mes" ? (
          <MonthGrid
            cursor={cursor}
            events={events}
            nowMs={nowMs}
            onSelectEvent={setModalEvent}
            onSelectDay={openDay}
          />
        ) : (
          <WeekTimeline
            days={mode === "dia" ? [cursor] : weekDays}
            events={events}
            nowMs={nowMs}
            onSelectEvent={setModalEvent}
          />
        )}
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CalendarToolbar
        mode={mode}
        onMode={changeMode}
        title={title}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={goToday}
        meta={headerMeta}
        right={headerRight}
      />
      {content}
      <EventModal event={modalEvent} nowMs={nowMs} onClose={() => setModalEvent(null)} />
    </div>
  );
}

/** Vista Agenda: lista maestro (próximos, agrupados por día) + detalle. */
function AgendaSplit({ events, nowMs }: { events: CalendarEvent[]; nowMs: number }) {
  const upcoming = useMemo(() => upcomingOnly(events, nowMs), [events, nowMs]);
  const groups = useMemo(() => groupByDay(upcoming, nowMs), [upcoming, nowMs]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = upcoming.find((e) => e.id === selectedId) ?? null;
  useEffect(() => {
    if (upcoming.length === 0) return;
    if (selectedId && upcoming.some((e) => e.id === selectedId)) return;
    const live = upcoming.find((e) => eventState(e, Date.now()) === "en-curso");
    setSelectedId((live ?? upcoming[0]).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-8 gap-y-6 overflow-hidden max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-rows-[minmax(0,1fr)]">
      {/* LISTA: caja, porque aquí se elige. */}
      <section className="col-span-12 flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel max-lg:min-h-[420px] lg:col-span-5">
        <h2 className="flex shrink-0 items-baseline justify-between border-b border-line px-4 py-2.5 text-sm font-medium text-text">
          Próximos
          <span className="text-xs font-normal text-text-faint tabular-nums">
            {upcoming.length} evento{upcoming.length === 1 ? "" : "s"}
          </span>
        </h2>
        <div className="min-h-0 flex-1 p-2">
          {upcoming.length === 0 ? (
            <PanelState kind="empty" title="Sin eventos próximos" hint="Nada en el calendario." />
          ) : (
            <ScrollArea className="h-full pr-1">
              <AgendaList
                groups={groups}
                selectedId={selectedId}
                nowMs={nowMs}
                onSelect={setSelectedId}
              />
            </ScrollArea>
          )}
        </div>
      </section>

      {/* PIEZA: sin marco, se lee. */}
      <div className="col-span-12 flex min-h-0 flex-col border-line max-lg:min-h-[360px] lg:col-span-7 lg:border-l lg:pl-6">
        <ScrollArea rail fade="y" className="min-h-0 flex-1 pt-1 pr-1">
          <AgendaDetail event={selected} nowMs={nowMs} />
        </ScrollArea>
      </div>
    </div>
  );
}
