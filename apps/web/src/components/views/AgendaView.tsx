"use client";

// Vista AGENDA: página completa del calendario (feed ICS de Google) con selector
// de vistas estilo Google Calendar — Mes (cuadrícula), Semana y Día (timeline) y
// Agenda (lista maestro-detalle). Solo lectura: es un espejo del calendario. La
// voz y el header viven en el AppShell; los mismos datos alimentan el strip.

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
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
          : "Agenda · próximos";

  const headerRight = calendar?.configured ? (
    <span className="flex items-center gap-2 text-2xs text-text-faint">
      {calendar.stale && <span className="text-amber">cache</span>}
      {calendar.fetchedAt && (
        <span className="tabular-nums">act. {FETCHED_FMT.format(new Date(calendar.fetchedAt))}</span>
      )}
      <button
        type="button"
        onClick={refresh}
        title="Refrescar"
        aria-label="Refrescar agenda"
        className="grid h-7 w-7 place-items-center rounded-sm border border-line text-text-dim transition-colors hover:border-line-2 hover:text-text"
      >
        ↻
      </button>
    </span>
  ) : undefined;

  // ── Contenido según estado global ───────────────────────────────────
  let content: React.ReactNode;
  if (calendar && !calendar.configured) {
    content = (
      <Panel className="min-h-0 flex-1">
        <PanelState
          kind="empty"
          title="Calendario sin configurar"
          hint="Falta GOOGLE_CALENDAR_ICS_URL en el .env de la raíz."
        />
      </Panel>
    );
  } else if (loading && !calendar) {
    content = (
      <Panel className="min-h-0 flex-1">
        <PanelState kind="loading" />
      </Panel>
    );
  } else if (offline && !calendar) {
    content = (
      <Panel className="min-h-0 flex-1">
        <PanelState kind="offline" retry={refresh} />
      </Panel>
    );
  } else if (mode === "agenda") {
    content = <AgendaSplit events={events} nowMs={nowMs} />;
  } else {
    content = (
      <Panel padding="none" className="min-h-0 flex-1 overflow-hidden">
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
      </Panel>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <CalendarToolbar
        mode={mode}
        onMode={changeMode}
        title={title}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={goToday}
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
    <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 overflow-hidden max-lg:auto-rows-min max-lg:overflow-y-auto">
      <Panel
        title={`Próximos · ${upcoming.length}`}
        delay={40}
        padding="sm"
        className="col-span-12 min-h-0 lg:col-span-5 max-lg:min-h-[420px]"
      >
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
      </Panel>
      <Panel
        title="Detalle del evento"
        delay={80}
        scroll
        className="col-span-12 min-h-0 lg:col-span-7 max-lg:min-h-[360px]"
      >
        <AgendaDetail event={selected} nowMs={nowMs} />
      </Panel>
    </div>
  );
}
