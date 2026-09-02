"use client";

import { useEffect, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="h-9 w-28" />;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const date = now.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, "");

  return (
    <div className="text-right leading-none">
      <div className="font-mono text-md font-medium text-text tabular-nums">
        {hh}:{mm}
      </div>
      <div className="mt-1 text-2xs text-text-dim">{date}</div>
    </div>
  );
}
