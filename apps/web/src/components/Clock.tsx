"use client";

import { useEffect, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="h-12 w-40" />;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const date = now
    .toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" })
    .toUpperCase();

  return (
    <div className="text-right leading-none">
      <div className="font-display text-3xl font-bold tracking-widest glow-violet">
        {hh}:{mm}
        <span className="text-base align-top" style={{ color: "var(--text-dim)" }}>
          :{ss}
        </span>
      </div>
      <div className="mt-1 text-[10px] tracking-[0.3em]" style={{ color: "var(--text-dim)" }}>
        {date}
      </div>
    </div>
  );
}
