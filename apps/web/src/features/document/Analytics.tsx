import type { DocumentDetail, DocumentStats, ViewItem } from "@vellum/shared";
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { useDocumentStats } from "../../api/hooks";
import { ErrorIcon } from "../../components/icons";
import { formatDuration, formatIsoDay, formatNumber, formatWhen, visitorLabel } from "../../lib/format";

/** Views, "How far people read" and recent views: the left column of the document page. */
export function Analytics({ doc }: { doc: DocumentDetail }) {
  const { data: stats, isError, error } = useDocumentStats(doc.id);

  if (isError) {
    return (
      <p className="error" role="alert">
        <ErrorIcon />
        {error.message}
      </p>
    );
  }
  if (!stats) return <div className="min-h-[420px]" aria-busy="true" />;

  if (stats.allViews === 0) {
    return (
      <section aria-labelledby="views-h">
        <SectionTitle id="views-h" title="Views" note="Last 14 days" />
        <div className="border-t border-line py-12">
          <p className="text-body">No views yet.</p>
          <p className="mt-1 text-text-muted">
            {doc.status === "draft"
              ? "Publish the document to get a link you can send."
              : doc.status === "unpublished"
                ? "The link is unpublished. Publish it again and opens show up here."
                : !doc.trackViews
                ? "Track views is off for this document. Turn it on in Edit settings to count opens."
                : "Send the link. Opens, reading time and how far people read show up here."}
          </p>
        </div>
      </section>
    );
  }

  const { days, totals } = stats;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-16">
      <section aria-labelledby="views-h">
        <SectionTitle
          id="views-h"
          title="Views"
          note={`Last 14 days · ${formatIsoDay(days[0]!.date)} – ${formatIsoDay(days.at(-1)!.date)}`}
        />
        <dl className="stats">
          <div className="stat hero">
            <dt>Total views</dt>
            <dd>{formatNumber(totals.views)}</dd>
          </div>
          <div className="stat">
            <dt>People</dt>
            <dd>{formatNumber(totals.people)}</dd>
          </div>
          {stats.tracksReading && (
            <>
              <div className="stat">
                <dt>Avg. reading time</dt>
                <dd>
                  {totals.avgSeconds === null ? "—" : formatDuration(totals.avgSeconds)}
                  {totals.avgSeconds !== null && <small>min</small>}
                </dd>
              </div>
              <div className="stat">
                <dt>Read to the end</dt>
                <dd>
                  {totals.readToEnd ?? "—"}
                  {totals.readToEnd !== null && <small>%</small>}
                </dd>
              </div>
            </>
          )}
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          People are counted once a day without cookies, so someone who reads on two days counts twice.
        </p>

        {totals.views > 0 ? (
          <Chart days={days} />
        ) : (
          <p className="mt-10 text-text-muted">No views in the last 14 days.</p>
        )}
      </section>

      <Reach stats={stats} />

      <section aria-labelledby="recent-h">
        <SectionTitle id="recent-h" title="Recent views">
          <Link className="btn btn-ghost" to={`/documents/${doc.id}/views`}>
            See all {formatNumber(stats.allViews)}
          </Link>
        </SectionTitle>
        <ViewsTable views={stats.recent} tracksReading={stats.tracksReading} />
      </section>
    </div>
  );
}

export function SectionTitle({ id, title, note, children }: { id: string; title: string; note?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex items-baseline justify-between gap-4 max-[1000px]:flex-wrap">
      <h2 id={id} className="text-body leading-[1.3] font-medium">
        {title}
      </h2>
      {note && <p className="text-sm text-text-muted">{note}</p>}
      {children}
    </div>
  );
}

/** Smallest even "round" number at or above `n`, so the half-way gridline is a whole number. */
function niceMax(n: number): number {
  for (let k = 1; ; k *= 10) {
    for (const m of [1, 2, 4, 5, 6, 8]) {
      const v = m * k;
      if (v % 2 === 0 && v >= n) return v;
    }
  }
}

function Chart({ days }: { days: DocumentStats["days"] }) {
  const peak = Math.max(...days.map((d) => d.views));
  const max = niceMax(peak);
  const ticks = [0, max / 2, max];
  const peakIndex = days.findLastIndex((d) => d.views === peak);
  const label = (i: number) => formatIsoDay(days[i]!.date);
  const pct = (v: number) => `${(v / max) * 100}%`;

  return (
    <div className="mt-10">
      <div
        className="chart"
        role="group"
        aria-label={`Views per day, ${label(0)} to ${label(days.length - 1)}. Peak of ${peak} on ${label(peakIndex)}.`}
      >
        <div className="y-axis" aria-hidden="true">
          {ticks.map((v) => (
            <span key={v} style={{ bottom: pct(v) }}>
              {v}
            </span>
          ))}
        </div>
        <div className="plot">
          {ticks.slice(1).map((v) => (
            <span key={v} className="grid-line" style={{ bottom: pct(v) }} />
          ))}
          {days.map((d, i) => (
            <button
              key={d.date}
              className={clsx("bar", d.views === peak && "peak", i < 2 && "edge-start", i >= days.length - 2 && "edge-end")}
              type="button"
              style={{ "--h": pct(d.views) } as CSSProperties}
              aria-label={`${label(i)}: ${d.views} ${d.views === 1 ? "view" : "views"}`}
            >
              <i style={{ height: pct(d.views) }} />
              {i === peakIndex && (
                <span className="label" aria-hidden="true">
                  {d.views}
                </span>
              )}
              <span className="tip" aria-hidden="true">
                {label(i)} · <b>{d.views}</b> {d.views === 1 ? "view" : "views"}
              </span>
            </button>
          ))}
        </div>
        <div className="x-axis" aria-hidden="true">
          <span>{label(0)}</span>
          <span>{label(Math.floor((days.length - 1) / 2))}</span>
          <span>{label(days.length - 1)}</span>
        </div>
      </div>
      <details className="mt-4 text-sm">
        <summary className="w-fit cursor-pointer text-text-secondary">Show as table</summary>
        <table className="data-table mt-3 max-w-[320px]">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="r">
                Views
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d.date}>
                <td>{label(i)}</td>
                <td className="r">{d.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Reach({ stats }: { stats: DocumentStats }) {
  const version = stats.sectionsVersion > 1 ? ` of v${stats.sectionsVersion}` : "";
  let body: ReactNode;
  if (!stats.tracksReading) {
    body = <Muted>HTML documents count opens only. Reading depth and time are measured for Markdown documents.</Muted>;
  } else if (stats.sections.length === 0) {
    body = <Muted>This version has no H2 headings to measure. “Read to the end” uses scroll depth instead.</Muted>;
  } else if (stats.sectionsBase === 0) {
    body = <Muted>Nobody has opened v{stats.sectionsVersion} in the last 14 days.</Muted>;
  } else {
    body = (
      <>
        <ol className="reach">
          {stats.sections.map((s) => (
            <li key={s.id}>
              <span>{s.text}</span>
              <span className="bar-h" style={{ width: `${s.pct}%` }} />
              <span className="v">{s.pct}%</span>
            </li>
          ))}
        </ol>
        {stats.skipAhead && (
          <p className="callout">
            Readers skip ahead to “{stats.skipAhead.section}”: {stats.skipAhead.pct}% reach it, more than reach “
            {stats.skipAhead.previous}” right before it.
          </p>
        )}
      </>
    );
  }
  return (
    <section aria-labelledby="sections-h">
      <SectionTitle
        id="sections-h"
        title="How far people read"
        note={stats.tracksReading ? `Share of readers who reached each section${version}` : undefined}
      />
      {body}
    </section>
  );
}

const Muted = ({ children }: { children: ReactNode }) => (
  <p className="border-t border-line pt-6 text-text-muted">{children}</p>
);

/** Recent views on the document page, and every view on the See all page. */
export function ViewsTable({ views, tracksReading }: { views: ViewItem[]; tracksReading: boolean }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Visitor</th>
            <th scope="col">Device</th>
            {tracksReading && (
              <>
                <th scope="col">Read</th>
                <th scope="col" className="r">
                  Time
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.id}>
              <td className="whitespace-nowrap">{formatWhen(v.at)}</td>
              <td className="whitespace-nowrap">{visitorLabel(v)}</td>
              <td className="secondary whitespace-nowrap">
                {v.device} · {v.browser}
              </td>
              {tracksReading && (
                <>
                  <td>
                    <div className="depth">
                      <span className="track">
                        <i style={{ width: `${v.depth ?? 0}%` }} />
                      </span>
                      {v.depth ?? 0}%
                    </div>
                  </td>
                  <td className="r">{formatDuration(v.seconds ?? 0)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
