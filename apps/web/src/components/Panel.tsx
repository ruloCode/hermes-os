"use client";

export function Panel({
  title,
  right,
  children,
  className = "",
  delay = 0,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={`hud-panel hud-in flex flex-col ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="hud-title">{title}</h2>
        {right}
      </header>
      <div className="min-h-0 flex-1 px-3 pb-3">{children}</div>
    </section>
  );
}
