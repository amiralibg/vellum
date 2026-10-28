import type { DocumentStats } from "@vellum/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { client, publishMarkdown, signedIn, useTestApp } from "./helpers.js";

// Behind Traefik in production; here it lets each test pick the reader's IP.
const t = useTestApp({ TRUST_PROXY: "1" });

const SOURCE = `# Acme Corp — Website redesign proposal

A twelve-week redesign of the marketing site.

## Where things stand

Today.

## What we will do

Plan.

## Timeline & cost

Money.

## Next steps

Sign.
`;

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** A browser with its own IP and user agent. */
function reader(ip = "203.0.113.7", ua = CHROME_MAC) {
  const c = client(t.app);
  const set = <T extends ReturnType<typeof c.get>>(r: T) => r.set("User-Agent", ua).set("X-Forwarded-For", ip);
  return {
    open: (slug: string) => set(c.get(`/p/${slug}`)),
    beacon: (slug: string, body: object) =>
      set(c.post(`/p/${slug}/beacon`)).set("Content-Type", "text/plain;charset=UTF-8").send(JSON.stringify(body)),
  };
}

/** The view token reader.js sends back, from the page's data-view attribute. */
function viewToken(html: string): string {
  const m = /data-view="([^"]+)"/.exec(html);
  if (!m) throw new Error("no view token on the page");
  return m[1]!;
}

async function stats(owner: Awaited<ReturnType<typeof signedIn>>, id: string): Promise<DocumentStats> {
  return (await owner.get(`/api/documents/${id}/stats`).expect(200)).body as DocumentStats;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("view counting", () => {
  it("counts a view on the first beacon, never on render, and once per page load", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const r = reader();

    const page = await r.open(doc.slug).expect(200);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);

    const token = viewToken(page.text);
    await r.beacon(doc.slug, { t: token, s: 20, h: ["where-things-stand"], a: 2 }).expect(204);
    await r.beacon(doc.slug, { t: token, s: 60, h: ["where-things-stand", "what-we-will-do"], a: 30 }).expect(204);
    expect((await stats(owner, doc.id)).totals.views).toBe(1);

    await r.beacon(doc.slug, { t: viewToken((await r.open(doc.slug)).text) }).expect(204);
    expect((await stats(owner, doc.id)).totals.views).toBe(2);
  });
});

describe("views that don't count", () => {
  it("ignores bots, link unfurlers and headless browsers", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    for (const ua of [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "WhatsApp/2.23.20.0",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      "",
    ]) {
      const r = reader("198.51.100.1", ua);
      const page = await r.open(doc.slug).expect(200);
      await r.beacon(doc.slug, { t: viewToken(page.text), s: 100 }).expect(204);
    }
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
  });

  it("ignores the owner reading their own document", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const page = await owner.get(`/p/${doc.slug}`).set("User-Agent", CHROME_MAC).expect(200);
    await owner
      .post(`/p/${doc.slug}/beacon`)
      .set("User-Agent", CHROME_MAC)
      .set("Content-Type", "text/plain;charset=UTF-8")
      .send(JSON.stringify({ t: viewToken(page.text), s: 50 }))
      .expect(204);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
  });

  it("doesn't track documents with Track views off, even from a page loaded before it was turned off", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const r = reader();
    const token = viewToken((await r.open(doc.slug).expect(200)).text);

    await owner.patch(`/api/documents/${doc.id}`).send({ trackViews: false }).expect(200);
    const page = await r.open(doc.slug).expect(200);
    expect(page.text).not.toContain("data-view=");
    expect(page.text).not.toContain("data-beacon=");
    await r.beacon(doc.slug, { t: token }).expect(204);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
  });
});

describe("beacons for documents the reader can't open", () => {
  it("refuses a locked document without the unlock cookie, and after the password changes", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: "acme-q4" });
    const r = reader();
    await r.beacon(doc.slug, {}).expect(400);

    // A reader who unlocked it gets a token; a stranger replaying it has no cookie.
    const c = client(t.app);
    await c.post(`/p/${doc.slug}/unlock`).type("form").send({ password: "acme-q4" }).expect(303);
    const token = viewToken((await c.get(`/p/${doc.slug}`).set("User-Agent", CHROME_MAC).expect(200)).text);
    await r.beacon(doc.slug, { t: token }).expect(401);

    await owner.patch(`/api/documents/${doc.id}`).send({ password: "acme-q5" }).expect(200);
    await c
      .post(`/p/${doc.slug}/beacon`)
      .set("User-Agent", CHROME_MAC)
      .set("X-Forwarded-For", "203.0.113.9")
      .set("Content-Type", "text/plain;charset=UTF-8")
      .send(JSON.stringify({ t: token }))
      .expect(401);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
  });

  it("refuses a token from before a password change, even once the reader unlocks again", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: "acme-q4" });
    const c = client(t.app);
    const send = (token: string) =>
      c
        .post(`/p/${doc.slug}/beacon`)
        .set("User-Agent", CHROME_MAC)
        .set("Content-Type", "text/plain;charset=UTF-8")
        .send(JSON.stringify({ t: token }));
    await c.post(`/p/${doc.slug}/unlock`).type("form").send({ password: "acme-q4" }).expect(303);
    const old = viewToken((await c.get(`/p/${doc.slug}`).set("User-Agent", CHROME_MAC).expect(200)).text);

    await owner.patch(`/api/documents/${doc.id}`).send({ password: "acme-q5" }).expect(200);
    await c.post(`/p/${doc.slug}/unlock`).type("form").send({ password: "acme-q5" }).expect(303);
    await send(old).expect(403);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
    const fresh = viewToken((await c.get(`/p/${doc.slug}`).set("User-Agent", CHROME_MAC).expect(200)).text);
    await send(fresh).expect(204);
    expect((await stats(owner, doc.id)).totals.views).toBe(1);
  });

  it("refuses an expired document, even with a token from before it expired", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, {
      expiryPreset: "date",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const r = reader();
    const token = viewToken((await r.open(doc.slug).expect(200)).text);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 3_600_000 });
    await r.beacon(doc.slug, { t: token }).expect(410);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
  });

  it("refuses an unpublished document", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const r = reader();
    const token = viewToken((await r.open(doc.slug).expect(200)).text);

    await owner.post(`/api/documents/${doc.id}/unpublish`).expect(200);
    await r.beacon(doc.slug, { t: token }).expect(404);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
  });

  it("refuses tokens from another document, forged tokens and old tokens", async () => {
    const owner = await signedIn(t.app);
    const a = await publishMarkdown(owner, SOURCE);
    const b = await publishMarkdown(owner, SOURCE.replace("Acme", "Globex"));
    const r = reader();
    const token = viewToken((await r.open(a.slug).expect(200)).text);

    await r.beacon(b.slug, { t: token }).expect(403);
    await r.beacon(a.slug, { t: `${token.slice(0, -2)}xx` }).expect(403);
    await r.beacon(a.slug, { t: "not-a-token" }).expect(403);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 25 * 3_600_000 });
    await r.beacon(a.slug, { t: token }).expect(403);
    vi.useRealTimers();

    expect((await stats(owner, a.id)).totals.views).toBe(0);
    expect((await stats(owner, b.id)).totals.views).toBe(0);
  });

  it("refuses a beacon posted from another site", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const r = reader();
    const token = viewToken((await r.open(doc.slug).expect(200)).text);
    await r.beacon(doc.slug, { t: token }).set("Origin", "https://evil.example").expect(403);
    expect((await stats(owner, doc.id)).totals.views).toBe(0);
    // What a browser sends from the reader page, whose referrer policy is no-referrer.
    await r.beacon(doc.slug, { t: token }).set("Origin", "null").expect(204);
    expect((await stats(owner, doc.id)).totals.views).toBe(1);
  });
});

const DAY = 86_400_000;
const travel = (ms: number) => vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + ms });

/** Opens the page and sends one beacon: one view. */
async function view(r: ReturnType<typeof reader>, slug: string, beacon: object = {}) {
  const page = await r.open(slug).expect(200);
  await r.beacon(slug, { t: viewToken(page.text), ...beacon }).expect(204);
}

describe("visitors and people", () => {
  it("counts people as unique visitors per day, summed over the days", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const a = reader("203.0.113.7");
    const sameIpOtherBrowser = reader("203.0.113.7", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0");

    await view(a, doc.slug);
    await view(a, doc.slug);
    await view(sameIpOtherBrowser, doc.slug);
    expect((await stats(owner, doc.id)).totals).toMatchObject({ views: 3, people: 2 });

    travel(DAY);
    await view(a, doc.slug);
    expect((await stats(owner, doc.id)).totals).toMatchObject({ views: 4, people: 3 });
  });

  it("keeps a visitor's hash for the day only, and drops salts older than two days", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const a = reader();
    await view(a, doc.slug);
    await view(a, doc.slug);
    travel(DAY);
    await view(a, doc.slug);

    const { rows } = await t.db.query<{ visitor_hash: string }>("SELECT visitor_hash FROM views ORDER BY created_at");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.visitor_hash).toBe(rows[0]!.visitor_hash);
    expect(rows[2]!.visitor_hash).not.toBe(rows[0]!.visitor_hash);

    const firstDay = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    travel(3 * DAY);
    await view(a, doc.slug);
    const salts = await t.db.query<{ day: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM daily_salts");
    expect(salts.rows.map((r) => r.day)).not.toContain(firstDay);
    expect(salts.rows.length).toBeLessThanOrEqual(3);
  });

  it("never stores the reader's IP address", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    await view(reader("198.51.100.234"), doc.slug, { s: 40 });
    await view(reader("2001:db8::4711"), doc.slug, { s: 40 });
    expect((await stats(owner, doc.id)).totals.views).toBe(2);

    const tables = await t.db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const { tablename } of tables.rows) {
      const { rows } = await t.db.query<{ row: string }>(`SELECT t::text AS row FROM "${tablename}" t`);
      const dump = rows.map((r) => r.row).join("\n");
      expect(dump, tablename).not.toContain("198.51.100.234");
      expect(dump, tablename).not.toContain("2001:db8::4711");
    }
  });
});

describe("how far people read", () => {
  it("works out section reach, read to the end and reading time over the views", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const ids = (await stats(owner, doc.id)).sections.map((s) => s.id);
    expect(ids).toHaveLength(4);
    const [stand, plan, cost, next] = ids as [string, string, string, string];

    // Six readers. Pages load now; their beacons arrive ten minutes later.
    const beacons = [
      { h: [stand, "not-a-heading"], s: 10, a: 30 },
      { h: [stand, plan], s: 50, a: 60 },
      { h: [stand, cost], s: 40, a: 90 }, // jumped ahead from the table of contents
      { h: [stand, plan, cost, next], s: 85, a: 120 }, // reached the last H2
      { h: [stand], s: 92, a: 150 }, // scrolled to the end
      { h: [stand, cost], s: 60, a: 180 },
    ];
    const pages = [];
    for (const [i] of beacons.entries()) {
      const r = reader(`203.0.113.${i + 1}`);
      pages.push({ r, token: viewToken((await r.open(doc.slug).expect(200)).text) });
    }
    travel(10 * 60_000);
    for (const [i, b] of beacons.entries()) await pages[i]!.r.beacon(doc.slug, { t: pages[i]!.token, ...b }).expect(204);

    const s = await stats(owner, doc.id);
    expect(s.tracksReading).toBe(true);
    expect(s.totals).toEqual({ views: 6, people: 6, avgSeconds: 105, readToEnd: 33 });
    expect(s.sections.map((x) => [x.text, x.pct])).toEqual([
      ["Where things stand", 100],
      ["What we will do", 33],
      ["Timeline & cost", 50],
      ["Next steps", 17],
    ]);
    expect(s.skipAhead).toEqual({ section: "Timeline & cost", previous: "What we will do", pct: 50 });
  });

  it("keeps each view's furthest point when later beacons report less", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const [stand, , , next] = (await stats(owner, doc.id)).sections.map((s) => s.id) as [string, string, string, string];
    const r = reader();
    const token = viewToken((await r.open(doc.slug).expect(200)).text);
    travel(5 * 60_000);
    await r.beacon(doc.slug, { t: token, h: [stand, next], s: 70, a: 200 }).expect(204);
    await r.beacon(doc.slug, { t: token, h: [stand], s: 30, a: 100 }).expect(204);

    const s = await stats(owner, doc.id);
    expect(s.totals).toEqual({ views: 1, people: 1, avgSeconds: 200, readToEnd: 100 });
    expect(s.recent[0]).toMatchObject({ depth: 70, seconds: 200 });
  });

  it("doesn't believe more reading time than the page has been open", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const r = reader();
    const token = viewToken((await r.open(doc.slug).expect(200)).text);
    travel(60_000);
    await r.beacon(doc.slug, { t: token, a: 3 * 3600 }).expect(204);
    const seconds = (await stats(owner, doc.id)).recent[0]!.seconds!;
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThan(120);
  });

  it("shows sections for the current version only, and no callout when reach only falls", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const old = (await stats(owner, doc.id)).sections.map((s) => s.id);
    await view(reader("203.0.113.1"), doc.slug, { h: old, s: 100 });

    const v2 = "# Acme Corp — Website redesign proposal\n\nShorter.\n\n## Summary\n\nYes.\n\n## Price\n\nNo.\n";
    await owner.post(`/api/documents/${doc.id}/versions`).attach("file", Buffer.from(v2), "proposal-v2.md").expect(201);
    const [summary, price] = (await stats(owner, doc.id)).sections.map((s) => s.id) as [string, string];
    await view(reader("203.0.113.2"), doc.slug, { h: [summary, price], s: 100 });
    await view(reader("203.0.113.3"), doc.slug, { h: [summary], s: 20 });

    const s = await stats(owner, doc.id);
    expect(s.sectionsVersion).toBe(2);
    expect(s.sectionsBase).toBe(2);
    expect(s.sections.map((x) => [x.text, x.pct])).toEqual([
      ["Summary", 100],
      ["Price", 50],
    ]);
    expect(s.skipAhead).toBeNull();
    expect(s.totals).toMatchObject({ views: 3, readToEnd: 67 });
  });
});

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("recent views and See all", () => {
  it("lists views newest first with device, browser, depth, time and a per-day visitor number", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const desk = reader("203.0.113.1");
    const phone = reader("203.0.113.2", IPHONE);
    await view(desk, doc.slug, { s: 30 });
    travel(60_000);
    const page = await phone.open(doc.slug).expect(200);
    await phone.beacon(doc.slug, { t: viewToken(page.text), s: 64 }).set("CF-IPCountry", "de").expect(204);
    travel(2 * 60_000);
    await view(desk, doc.slug, { s: 100 });

    const s = await stats(owner, doc.id);
    expect(s.allViews).toBe(3);
    expect(s.recent.map((v) => [v.visitor, v.device, v.browser, v.depth, v.country])).toEqual([
      [1, "Desktop", "Chrome", 100, null],
      [2, "Mobile", "Safari", 64, "DE"],
      [1, "Desktop", "Chrome", 30, null],
    ]);
    expect(Date.parse(s.recent[0]!.at)).toBeGreaterThan(Date.parse(s.recent[1]!.at));
  });

  it("pages through every view, 50 at a time", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    for (let i = 0; i < 52; i++) await view(reader(`198.51.100.${i}`), doc.slug);

    const first = await owner.get(`/api/documents/${doc.id}/views`).expect(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 50, total: 52, tracksReading: true });
    expect(first.body.views).toHaveLength(50);
    const second = await owner.get(`/api/documents/${doc.id}/views?page=2`).expect(200);
    expect(second.body.views).toHaveLength(2);
    const ids = new Set([...first.body.views, ...second.body.views].map((v: { id: string }) => v.id));
    expect(ids.size).toBe(52);
    await owner.get(`/api/documents/${doc.id}/views?page=0`).expect(400);
  });
});

describe("HTML documents", () => {
  it("count opens only: no depth, sections or reading time", async () => {
    const owner = await signedIn(t.app);
    const up = await owner
      .post("/api/documents")
      .attach("file", Buffer.from("<!doctype html><title>Pitch</title><h1>Pitch</h1><h2 id=a>A</h2>"), "pitch.html")
      .expect(201);
    await owner.post(`/api/documents/${up.body.id}/publish`).expect(200);
    const r = reader();
    const token = viewToken((await r.open(up.body.slug).expect(200)).text);
    travel(60_000);
    await r.beacon(up.body.slug, { t: token, s: 95, h: ["a"], a: 50 }).expect(204);

    const s = await stats(owner, up.body.id);
    expect(s.tracksReading).toBe(false);
    expect(s.totals).toEqual({ views: 1, people: 1, avgSeconds: null, readToEnd: null });
    expect(s.sections).toEqual([]);
    expect(s.recent[0]).toMatchObject({ depth: null, seconds: null });
  });
});

describe("totals over time", () => {
  it("charts the last 14 days, today last, and keeps older views in the all-time count", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    travel(-20 * DAY);
    await view(reader(), doc.slug);
    vi.useRealTimers();
    travel(-3 * DAY);
    await view(reader(), doc.slug);
    vi.useRealTimers();
    await view(reader(), doc.slug);
    await view(reader("203.0.113.99"), doc.slug);

    const s = await stats(owner, doc.id);
    expect(s.days).toHaveLength(14);
    expect(s.days.at(-1)).toEqual({ date: new Date().toISOString().slice(0, 10), views: 2 });
    expect(s.days.at(-4)!.views).toBe(1);
    expect(s.days.reduce((n, d) => n + d.views, 0)).toBe(3);
    expect(s.totals.views).toBe(3);
    expect(s.allViews).toBe(4);
  });

  it("shows views and people per document, and this month's views, in the documents list", async () => {
    // Early on the 1st of next month (UTC), which is still last month in New York.
    const now = new Date();
    const firstOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 3);
    vi.useFakeTimers({ toFake: ["Date"], now: firstOfMonth - 2 * DAY });
    const owner = await signedIn(t.app);
    const a = await publishMarkdown(owner, SOURCE);
    const b = await publishMarkdown(owner, SOURCE.replace("Acme", "Globex"));
    await view(reader("203.0.113.1"), a.slug);
    vi.useFakeTimers({ toFake: ["Date"], now: firstOfMonth });
    await view(reader("203.0.113.1"), a.slug);
    await view(reader("203.0.113.2"), a.slug);
    await view(reader("203.0.113.3"), b.slug);

    const list = await owner.get("/api/documents").expect(200);
    const byId = Object.fromEntries(list.body.documents.map((d: { id: string }) => [d.id, d]));
    expect(byId[a.id]).toMatchObject({ views: 3, people: 3 });
    expect(byId[b.id]).toMatchObject({ views: 1, people: 1 });
    expect(list.body.viewsThisMonth).toBe(3);
    const ny = await owner.get("/api/documents?tz=America/New_York").expect(200);
    expect(ny.body.viewsThisMonth).toBe(4);
  });

  it("asks for a session on every analytics route", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const anon = client(t.app);
    await anon.get(`/api/documents/${doc.id}/stats`).expect(401);
    await anon.get(`/api/documents/${doc.id}/views`).expect(401);
    await anon.get(`/api/documents/${doc.id}/views?page=2`).expect(401);
  });
});
