import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { client, signedIn, useTestApp } from "./helpers.js";
import { MARKER, PITCH } from "./fixtures.js";

const t = useTestApp();
const UC = "uc.test";

type Owner = Awaited<ReturnType<typeof signedIn>>;

async function publishHtml(owner: Owner, data: string | Buffer = PITCH, name = "pitch.html", settings = {}) {
  const res = await owner.post("/api/documents").attach("file", Buffer.from(data), name).expect(201);
  const doc = res.body as { id: string; slug: string };
  if (Object.keys(settings).length) await owner.patch(`/api/documents/${doc.id}`).send(settings).expect(200);
  await owner.post(`/api/documents/${doc.id}/publish`).expect(200);
  return doc;
}

/** The iframe's src on the /p/ page. */
async function frameUrl(slug: string): Promise<URL> {
  const page = await client(t.app).get(`/p/${slug}`).expect(200);
  const src = /<iframe[^>]*\ssrc="([^"]+)"/.exec(page.text)?.[1];
  if (!src) throw new Error("no iframe on the page");
  return new URL(src);
}

const onUsercontent = (url: URL | string) => request(t.app).get(typeof url === "string" ? url : url.pathname).set("Host", UC);

afterEach(() => {
  vi.useRealTimers();
});

describe("HTML documents at /p/:slug", () => {
  it("frame the document from the usercontent origin in a sandbox, without the content itself", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner);

    const page = await client(t.app).get(`/p/${doc.slug}`).expect(200);
    const iframe = /<iframe[^>]*>/.exec(page.text)![0];
    expect(iframe).toMatch(/\ssrc="http:\/\/uc\.test\/u\/[^/"]+\/index\.html"/);
    expect(iframe).toContain('sandbox="allow-scripts allow-popups"');
    expect(page.text).not.toContain(MARKER);
    expect(page.headers["content-security-policy"]).toContain("frame-src http://uc.test");
    expect(page.text).toContain("<title>Weft — Seed round</title>");
    expect(page.text).toContain("Shared by Amirali");
  });

  it("serve the file on the usercontent origin with a sandbox CSP", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner);

    const res = await onUsercontent(await frameUrl(doc.slug)).expect(200);
    expect(res.text).toContain(MARKER);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-security-policy"]).toMatch(/^sandbox allow-scripts allow-popups(;|$)/);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("usercontent tokens", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const travel = (ms: number) => vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + ms });

  it("refuse a forged or altered token", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner);
    const url = await frameUrl(doc.slug);
    const [, , token] = url.pathname.split("/");
    const [body, mac] = token!.split(".");

    const forgedBody = Buffer.from(JSON.stringify({ d: doc.id, v: "x", r: 0, e: Date.now() + HOUR, o: 1 })).toString("base64url");
    for (const bad of [`${forgedBody}.${mac}`, `${body}.${mac!.slice(0, -2)}AA`, body!, "nothing"]) {
      const res = await onUsercontent(`/u/${bad}/index.html`);
      expect(res.status, bad).toBe(404);
      expect(res.text).not.toContain(MARKER);
    }
  });

  it("refuse a token after an hour", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner);
    const url = await frameUrl(doc.slug);
    travel(HOUR - 60_000);
    await onUsercontent(url).expect(200);
    travel(2 * 60_000);
    await onUsercontent(url).expect(404);
  });

  it("refuse a token for a version that is no longer current", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner);
    const v1 = await frameUrl(doc.slug);
    await owner.post(`/api/documents/${doc.id}/versions`).attach("file", Buffer.from(PITCH.replace("Weft", "Weft 2")), "v2.html").expect(201);

    await onUsercontent(v1).expect(404);
    const v2 = await onUsercontent(await frameUrl(doc.slug)).expect(200);
    expect(v2.text).toContain("Weft 2");
  });

  it("stop working once the document is unpublished or the link expires", async () => {
    const owner = await signedIn(t.app);
    const a = await publishHtml(owner);
    const b = await publishHtml(owner, PITCH, "b.html", { expiryPreset: "7d" });
    const aUrl = await frameUrl(a.slug);
    const bUrl = await frameUrl(b.slug);

    await owner.post(`/api/documents/${a.id}/unpublish`).expect(200);
    await onUsercontent(aUrl).expect(404);

    // A token issued half an hour before the link closes stops with the link, not an hour later.
    await onUsercontent(bUrl).expect(200);
    travel(7 * DAY - 30 * 60_000);
    const fresh = await frameUrl(b.slug);
    await onUsercontent(fresh).expect(200);
    travel(31 * 60_000);
    await onUsercontent(fresh).expect(404);
    await client(t.app).get(`/p/${b.slug}`).expect(410);
  });

  it("stop working when the password changes", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner, PITCH, "pitch.html", { access: "password", password: "seed-2026" });
    const reader = client(t.app);
    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: "seed-2026" }).expect(303);
    const page = await reader.get(`/p/${doc.slug}`).expect(200);
    const url = new URL(/<iframe[^>]*\ssrc="([^"]+)"/.exec(page.text)![1]!);
    await onUsercontent(url).expect(200);

    await owner.patch(`/api/documents/${doc.id}`).send({ access: "password", password: "seed-2027" }).expect(200);
    await onUsercontent(url).expect(404);
  });

  it("are not handed out before the password", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner, PITCH, "pitch.html", { access: "password", password: "seed-2026" });
    const gate = await client(t.app).get(`/p/${doc.slug}`).expect(401);
    expect(gate.text).not.toContain("/u/");
    expect(gate.text).not.toContain("<iframe");
  });

  it("only work on the usercontent origin", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishHtml(owner);
    const url = await frameUrl(doc.slug);
    const onApp = await client(t.app).get(url.pathname);
    expect(onApp.status).toBe(404);
    expect(onApp.text).not.toContain(MARKER);
    const unknownHost = await request(t.app).get(url.pathname).set("Host", "evil.test");
    expect(unknownHost.status).toBe(404);
  });

  it("let the owner preview a draft, and nobody else", async () => {
    const owner = await signedIn(t.app);
    const res = await owner.post("/api/documents").attach("file", Buffer.from(PITCH), "pitch.html").expect(201);
    const preview = await owner.get(`/api/documents/${res.body.id}/preview`).expect(200);
    expect(preview.body.frameUrl).toMatch(/^http:\/\/uc\.test\/u\/[^/]+\/index\.html$/);
    const page = await onUsercontent(new URL(preview.body.frameUrl)).expect(200);
    expect(page.text).toContain(MARKER);
    await client(t.app).get(`/p/${res.body.slug}`).expect(404);
  });
});

