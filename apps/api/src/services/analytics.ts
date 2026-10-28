import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DocumentStats, Heading, SectionReach, ViewItem, ViewsPage } from "@vellum/shared";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { notFound } from "../errors.js";
import type { DocumentRow, VersionRow } from "./documents.js";
import { Signer } from "./secrets.js";
import { browserOf, deviceOf } from "./user-agent.js";

/** A reader page can send beacons for this long after it loaded. */
export const VIEW_TOKEN_TTL_MS = 24 * 3_600_000;
const PURPOSE = "view";
const STATS_DAYS = 14;
const RECENT = 5;
export const VIEWS_PAGE_SIZE = 50;
/** Scrolling this far counts as reading to the end, even if the last H2 never came into view. */
const END_SCROLL = 90;
const SALT_KEEP_DAYS = 2;

interface ViewClaims {
  d: string; // document id
  v: string; // version id the page showed
  r: number; // password_rev at render
  i: string; // view id
  t: number; // issued at, ms since epoch
}

/** What reader.js sends with navigator.sendBeacon. Everything but the token is optional. */
export const beaconSchema = z.object({
  t: z.string().min(1).max(1000),
  s: z.number().min(0).max(100).optional(),
  h: z.array(z.string().max(200)).max(200).optional(),
  a: z.number().min(0).max(86_400).optional(),
});
export type Beacon = z.infer<typeof beaconSchema>;

export interface Reader {
  ip: string;
  userAgent: string;
  country: string | null;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Views are counted from the reader page's beacons, never from rendering it, so link
 * unfurlers that fetch the page don't count. Nothing here stores an IP.
 */
export class Analytics {
  private readonly signer: Signer;
  private salt: { day: string; value: Buffer } | null = null;

  constructor(
    private readonly db: Db,
    config: Config,
  ) {
    this.signer = new Signer(config.signingSecret);
  }

  /** Embedded in the reader page; the first beacon carrying it creates the view. */
  issueToken(doc: Pick<DocumentRow, "id" | "password_rev">, version: Pick<VersionRow, "id">, now = Date.now()): string {
    const claims: ViewClaims = { d: doc.id, v: version.id, r: doc.password_rev, i: randomUUID(), t: now };
    return this.signer.sign(PURPOSE, claims);
  }

  /** The token's claims when it was issued for this document as it is now, and hasn't run out. */
  readToken(doc: Pick<DocumentRow, "id" | "password_rev">, token: string, now = Date.now()): ViewClaims | null {
    const c = this.signer.verify<ViewClaims>(PURPOSE, token);
    if (!c || c.d !== doc.id || c.r !== doc.password_rev) return null;
    if (!(c.t <= now && now < c.t + VIEW_TOKEN_TTL_MS)) return null;
    return c;
  }

  /** Creates the view on its first beacon; later beacons only move its numbers forward. */
  async record(claims: ViewClaims, doc: Pick<DocumentRow, "kind">, beacon: Beacon, reader: Reader, now = new Date()) {
    const { rows } = await this.db.query<{ headings: Heading[] }>(
      "SELECT headings FROM document_versions WHERE id = $1 AND document_id = $2",
      [claims.v, claims.d],
    );
    if (!rows[0]) return;
    // HTML documents count opens only: the page that could measure reading is sandboxed away from us.
    const reading = doc.kind === "markdown";
    const headings = rows[0].headings.map((h) => h.id);
    const sections = reading ? [...new Set((beacon.h ?? []).filter((id) => headings.includes(id)))] : [];
    const scroll = reading ? Math.round(beacon.s ?? 0) : 0;
    const last = headings.at(-1);
    const reachedEnd = reading && ((last !== undefined && sections.includes(last)) || scroll >= END_SCROLL);
    // Visible time can't be longer than the page has been open.
    const elapsed = Math.max(0, Math.floor((now.getTime() - claims.t) / 1000)) + 5;
    const seconds = reading ? Math.min(Math.round(beacon.a ?? 0), elapsed) : 0;

    const day = dayOf(now);
    const visitor = createHash("sha256")
      .update(await this.saltFor(day))
      .update(`\n${claims.d}\n${reader.ip}\n${reader.userAgent}`)
      .digest("hex");

    await this.db.query(
      `INSERT INTO views (id, document_id, version_id, day, visitor_hash, device, browser, country,
                          max_scroll, sections, reached_end, active_seconds, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       ON CONFLICT (id) DO UPDATE SET
         max_scroll = GREATEST(views.max_scroll, EXCLUDED.max_scroll),
         sections = ARRAY(SELECT DISTINCT unnest(views.sections || EXCLUDED.sections)),
         reached_end = views.reached_end OR EXCLUDED.reached_end,
         active_seconds = GREATEST(views.active_seconds, EXCLUDED.active_seconds),
         updated_at = EXCLUDED.updated_at
       WHERE views.document_id = EXCLUDED.document_id`,
      [
        claims.i,
        claims.d,
        claims.v,
        day,
        visitor,
        deviceOf(reader.userAgent),
        browserOf(reader.userAgent),
        reader.country,
        scroll,
        sections,
        reachedEnd,
        seconds,
        now,
      ],
    );
  }

  /** Today's salt (UTC), made on first use. Salts older than two days are deleted, so old hashes can't be recomputed. */
  private async saltFor(day: string): Promise<Buffer> {
    if (this.salt?.day === day) return this.salt.value;
    await this.db.query("INSERT INTO daily_salts (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING", [
      day,
      randomBytes(32),
    ]);
    await this.db.query("DELETE FROM daily_salts WHERE day < $1::date - $2::int", [day, SALT_KEEP_DAYS]);
    const { rows } = await this.db.query<{ salt: Buffer }>("SELECT salt FROM daily_salts WHERE day = $1", [day]);
    this.salt = { day, value: rows[0]!.salt };
    return this.salt.value;
  }

  async stats(documentId: string, { now = new Date(), tz = "UTC" }: { now?: Date; tz?: string } = {}): Promise<DocumentStats> {
    const zone = timeZone(tz);
    const doc = await this.db.query<{ kind: DocumentRow["kind"]; version_id: string; number: number; headings: Heading[] }>(
      `SELECT d.kind, v.id AS version_id, v.number, v.headings
       FROM documents d JOIN document_versions v ON v.id = d.current_version_id WHERE d.id = $1`,
      [documentId],
    );
    const d = doc.rows[0];
    if (!d) throw notFound("That document doesn’t exist.");
    const reading = d.kind === "markdown";

    // The window: the last 14 calendar days in the owner's zone, today included.
    const today = `($2::timestamptz AT TIME ZONE $3)::date`;
    const from = `((${today} - ${STATS_DAYS - 1})::timestamp AT TIME ZONE $3)`;
    const inWindow = `v.document_id = $1 AND v.created_at >= ${from} AND v.created_at <= $2`;
    const params = [documentId, now, zone];

    const [days, totals, reach, all, recent] = await Promise.all([
      this.db.query<{ date: string; views: number }>(
        `SELECT to_char(g.day, 'YYYY-MM-DD') AS date, count(v.id)::int AS views
         FROM generate_series((${today} - ${STATS_DAYS - 1})::timestamp, ${today}::timestamp, interval '1 day') AS g (day)
         LEFT JOIN views v ON ${inWindow} AND (v.created_at AT TIME ZONE $3)::date = g.day::date
         GROUP BY g.day ORDER BY g.day`,
        params,
      ),
      this.db.query<{ views: number; people: number; avg_seconds: number | null; read_to_end: number | null }>(
        `SELECT count(*)::int AS views,
                count(DISTINCT v.day::text || v.visitor_hash)::int AS people,
                round(avg(v.active_seconds))::int AS avg_seconds,
                round(100 * avg(v.reached_end::int))::int AS read_to_end
         FROM views v WHERE ${inWindow}`,
        params,
      ),
      this.db.query<{ id: string | null; n: number }>(
        `SELECT NULL AS id, count(*)::int AS n FROM views v WHERE ${inWindow} AND v.version_id = $4
         UNION ALL
         SELECT h AS id, count(*)::int AS n FROM views v, unnest(v.sections) AS h WHERE ${inWindow} AND v.version_id = $4
         GROUP BY h`,
        [...params, d.version_id],
      ),
      this.db.query<{ n: number }>("SELECT count(*)::int AS n FROM views WHERE document_id = $1", [documentId]),
      this.list(documentId, RECENT, 0),
    ]);

    const t = totals.rows[0]!;
    const base = reach.rows.find((r) => r.id === null)?.n ?? 0;
    const sections: SectionReach[] = reading
      ? d.headings.map((h) => {
          const n = reach.rows.find((r) => r.id === h.id)?.n ?? 0;
          return { id: h.id, text: h.text, pct: base ? Math.round((100 * n) / base) : 0 };
        })
      : [];

    return {
      days: days.rows,
      totals: {
        views: t.views,
        people: t.people,
        avgSeconds: reading && t.views ? t.avg_seconds : null,
        readToEnd: reading && t.views ? t.read_to_end : null,
      },
      tracksReading: reading,
      sections,
      sectionsVersion: d.number,
      sectionsBase: reading ? base : 0,
      skipAhead: base ? skipAhead(sections) : null,
      recent: recent.map((v) => toItem(v, reading)),
      allViews: all.rows[0]!.n,
    };
  }

  async page(documentId: string, page: number): Promise<ViewsPage> {
    const doc = await this.db.query<{ kind: DocumentRow["kind"] }>("SELECT kind FROM documents WHERE id = $1", [documentId]);
    if (!doc.rows[0]) throw notFound("That document doesn’t exist.");
    const reading = doc.rows[0].kind === "markdown";
    const [rows, total] = await Promise.all([
      this.list(documentId, VIEWS_PAGE_SIZE, (page - 1) * VIEWS_PAGE_SIZE),
      this.db.query<{ n: number }>("SELECT count(*)::int AS n FROM views WHERE document_id = $1", [documentId]),
    ]);
    return {
      views: rows.map((v) => toItem(v, reading)),
      page,
      pageSize: VIEWS_PAGE_SIZE,
      total: total.rows[0]!.n,
      tracksReading: reading,
    };
  }

  /** Newest first. Visitors are numbered per document and day in order of their first view. */
  private async list(documentId: string, limit: number, offset: number): Promise<ViewRow[]> {
    const { rows } = await this.db.query<ViewRow>(
      `WITH numbered AS (
         SELECT day, visitor_hash,
                row_number() OVER (PARTITION BY day ORDER BY min(created_at), visitor_hash)::int AS visitor
         FROM views WHERE document_id = $1 GROUP BY day, visitor_hash
       )
       SELECT v.id, v.created_at, n.visitor, v.country, v.device, v.browser, v.max_scroll, v.active_seconds
       FROM views v JOIN numbered n USING (day, visitor_hash)
       WHERE v.document_id = $1
       ORDER BY v.created_at DESC, v.id
       LIMIT $2 OFFSET $3`,
      [documentId, limit, offset],
    );
    return rows;
  }

  /** Views of every document since the start of this month in the owner's zone. */
  async viewsThisMonth({ now = new Date(), tz = "UTC" }: { now?: Date; tz?: string } = {}): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM views
       WHERE created_at >= (date_trunc('month', $1::timestamptz AT TIME ZONE $2) AT TIME ZONE $2) AND created_at <= $1`,
      [now, timeZone(tz)],
    );
    return rows[0]!.n;
  }
}

interface ViewRow {
  id: string;
  created_at: Date;
  visitor: number;
  country: string | null;
  device: string;
  browser: string;
  max_scroll: number;
  active_seconds: number;
}

function toItem(v: ViewRow, reading: boolean): ViewItem {
  return {
    id: v.id,
    at: v.created_at.toISOString(),
    visitor: v.visitor,
    country: v.country,
    device: v.device,
    browser: v.browser,
    depth: reading ? v.max_scroll : null,
    seconds: reading ? v.active_seconds : null,
  };
}

/** The biggest jump where more readers reach a section than the one right before it. */
function skipAhead(sections: SectionReach[]): DocumentStats["skipAhead"] {
  let best: DocumentStats["skipAhead"] = null;
  let jump = 0;
  for (let i = 1; i < sections.length; i++) {
    const [prev, cur] = [sections[i - 1]!, sections[i]!];
    if (cur.pct - prev.pct > jump) {
      jump = cur.pct - prev.pct;
      best = { section: cur.text, previous: prev.text, pct: cur.pct };
    }
  }
  return best;
}

/** An IANA zone name the browser sent, or UTC when it isn't one. */
export function timeZone(tz: string): string {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
