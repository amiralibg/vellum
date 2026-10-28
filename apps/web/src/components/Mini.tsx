import clsx from "clsx";

/** Typographic page miniature: the only imagery Vellum uses (Don't 3). */
export function Mini({ title, kind, dim, className }: { title: string; kind: "markdown" | "html"; dim?: boolean; className?: string }) {
  // A stable, title-derived line pattern so rows don't all look identical.
  const seed = [...title].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pattern = ["", "m", "", "s", "m", "", "s"].map((_, i) => ["", "m", "s"][(seed >> (i * 2)) % 3]!);
  return (
    <div className={clsx("mini", className)} aria-hidden="true" style={dim ? { opacity: 0.6 } : undefined}>
      <div className="t">{title.split(/\s+[—–-]\s+/).pop()}</div>
      {pattern.slice(0, 4).map((w, i) => (
        <div key={i} className={clsx("l", w)} />
      ))}
      {kind === "html" ? <div className="blk" style={{ height: 20 }} /> : <div className="blk" />}
      {pattern.slice(4).map((w, i) => (
        <div key={i} className={clsx("l", w)} />
      ))}
    </div>
  );
}
