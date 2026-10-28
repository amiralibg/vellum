import { afterEach, describe, expect, it, vi } from "vitest";
import { client, publishMarkdown, setCookie, signedIn, uploadMarkdown, useTestApp } from "./helpers.js";

const t = useTestApp();

const SOURCE = "# Wesend — Partnership brief\n\nTerms we discussed.\n\n## Revenue share\n\nTwenty percent.\n";
const DAY = 86_400_000;

/** Moves the server's clock (JS Date only; timers and the database are untouched). */
const travel = (ms: number) => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + ms });
};
afterEach(() => {
  vi.useRealTimers();
});

describe("link expiry", () => {
  it("closes the link after the preset, with copy naming the preset", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { expiryPreset: "30d" });
    await client(t.app).get(`/p/${doc.slug}`).expect(200);

    travel(30 * DAY + 60_000);
    const res = await client(t.app).get(`/p/${doc.slug}`);
    expect(res.status).toBe(410);
    expect(res.text).toContain("Link expired");
    expect(res.text).toMatch(/This link closed on [A-Z][a-z]+ \d{1,2}/);
    expect(res.text).toContain("to stop being shared after 30 days");
    expect(res.text).not.toContain("Twenty percent");
  });

  it("names the date for a date preset", async () => {
    const owner = await signedIn(t.app);
    const closes = new Date(Date.now() + 3 * DAY);
    const doc = await publishMarkdown(owner, SOURCE, { expiryPreset: "date", expiresAt: closes.toISOString() });

    travel(4 * DAY);
    const res = await client(t.app).get(`/p/${doc.slug}`).expect(410);
    const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(closes);
    expect(res.text).toContain(`to stop being shared on ${day}`);
  });

  it("offers to ask for a new link only when the document has a reply email", async () => {
    const owner = await signedIn(t.app);
    const quiet = await publishMarkdown(owner, SOURCE, { expiryPreset: "7d" });
    const replyable = await publishMarkdown(owner, SOURCE, { expiryPreset: "7d", replyEmail: "hello@example.com" });

    travel(8 * DAY);
    const a = await client(t.app).get(`/p/${quiet.slug}`).expect(410);
    expect(a.text).not.toContain("Ask for a new link");
    const b = await client(t.app).get(`/p/${replyable.slug}`).expect(410);
    expect(b.text).toContain("Ask for a new link");
    expect(b.text).toContain('href="mailto:hello@example.com?subject=');
  });

  it("closes the link for readers who already unlocked it", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: "brief-2026", expiryPreset: "7d" });
    const reader = client(t.app);
    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: "brief-2026" }).expect(303);
    await reader.get(`/p/${doc.slug}`).expect(200);

    travel(8 * DAY);
    const res = await reader.get(`/p/${doc.slug}`);
    expect(res.status).toBe(410);
    expect(res.text).not.toContain("Twenty percent");
    // And the gate doesn't hand out a new cookie for an expired link.
    const retry = await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: "brief-2026" });
    expect(retry.headers["set-cookie"]).toBeUndefined();
    await reader.get(`/p/${doc.slug}`).expect(410);
  });

  it("asks for the password again once the unlock cookie is 30 days old, even if replayed", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: "brief-2026" });
    const res = await client(t.app).post(`/p/${doc.slug}/unlock`).type("form").send({ password: "brief-2026" }).expect(303);
    const pair = setCookie(res, "vellum_unlock")!.split(";")[0]!;

    travel(29 * DAY);
    await client(t.app).get(`/p/${doc.slug}`).set("Cookie", pair).expect(200);
    travel(2 * DAY);
    await client(t.app).get(`/p/${doc.slug}`).set("Cookie", pair).expect(401);
  });

  it("closes downloads too", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { expiryPreset: "7d", allowDownload: true });
    await client(t.app).get(`/p/${doc.slug}/download`).expect(200);
    travel(8 * DAY);
    const res = await client(t.app).get(`/p/${doc.slug}/download`);
    expect(res.status).toBe(410);
    expect(res.text).not.toContain("Twenty percent");
  });

  it("starts a draft's preset when it is first published", async () => {
    const owner = await signedIn(t.app);
    const doc = await uploadMarkdown(owner, SOURCE);
    await owner.patch(`/api/documents/${doc.id}`).send({ expiryPreset: "7d" }).expect(200);

    travel(5 * DAY);
    const published = await owner.post(`/api/documents/${doc.id}/publish`).expect(200);
    const closes = new Date(published.body.expiresAt).getTime();
    expect(closes - Date.now()).toBeGreaterThan(7 * DAY - 60_000);

    travel(5 * DAY); // 10 days after the preset was chosen, 5 after publishing
    await client(t.app).get(`/p/${doc.slug}`).expect(200);
  });

  it("refuses a closing date in the past", async () => {
    const owner = await signedIn(t.app);
    const doc = await uploadMarkdown(owner, SOURCE);
    const res = await owner
      .patch(`/api/documents/${doc.id}`)
      .send({ expiryPreset: "date", expiresAt: new Date(Date.now() - DAY).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.expiresAt).toBeDefined();
  });

  it("reopens the link when the expiry is set back to never", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { expiryPreset: "7d" });
    travel(8 * DAY);
    await client(t.app).get(`/p/${doc.slug}`).expect(410);
    const saved = await owner.patch(`/api/documents/${doc.id}`).send({ expiryPreset: "never" }).expect(200);
    expect(saved.body.expiresAt).toBeNull();
    await client(t.app).get(`/p/${doc.slug}`).expect(200);
  });
});
