import request from "supertest";
import { describe, expect, it } from "vitest";
import { PITCH } from "./fixtures.js";
import { APP, ORIGIN, OWNER, invitedUser, signedIn, uploadMarkdown, useTestApp } from "./helpers.js";
import { makeZip } from "./zip.js";

const t = useTestApp();

/** Requests the way the CLI sends them: an API token, and no Origin or cookies. */
function cli(token: string) {
  const auth = <T extends request.Test>(r: T) => r.set("Host", APP).set("Authorization", `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(t.app).get(url)),
    post: (url: string) => auth(request(t.app).post(url)),
    patch: (url: string) => auth(request(t.app).patch(url)),
    put: (url: string) => auth(request(t.app).put(url)),
    delete: (url: string) => auth(request(t.app).delete(url)),
    push: (source: string, filename: string, fields: Record<string, string> = {}) => {
      let r = auth(request(t.app).post("/api/push"));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach("file", Buffer.from(source), filename);
    },
  };
}

async function newToken(c: Awaited<ReturnType<typeof signedIn>>, name = "claude-laptop") {
  const res = await c.post("/api/settings/tokens").send({ name }).expect(201);
  return res.body as { id: string; name: string; token: string };
}

describe("API tokens in Settings", () => {
  it("shows a new token once, then lists it without the secret", async () => {
    const c = await signedIn(t.app);
    const created = await newToken(c);
    expect(created.token).toMatch(/^vlm_[A-Za-z0-9_-]{40,}$/);
    expect(created).toMatchObject({ name: "claude-laptop", lastUsedAt: null });

    const list = await c.get("/api/settings/tokens").expect(200);
    expect(list.body.tokens).toEqual([
      { id: created.id, name: "claude-laptop", createdAt: expect.any(String), lastUsedAt: null },
    ]);
    expect(JSON.stringify(list.body)).not.toContain(created.token);
  });

  it("needs a name", async () => {
    const c = await signedIn(t.app);
    const res = await c.post("/api/settings/tokens").send({ name: "  " }).expect(400);
    expect(res.body.error.fields.name).toBeTruthy();
  });

  it("records when a token was last used", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    await cli(token).get("/api/whoami").expect(200);
    const list = await c.get("/api/settings/tokens").expect(200);
    expect(list.body.tokens[0].lastUsedAt).not.toBeNull();
  });

  it("stops a revoked token working", async () => {
    const c = await signedIn(t.app);
    const { id, token } = await newToken(c);
    await cli(token).get("/api/whoami").expect(200);
    await c.delete(`/api/settings/tokens/${id}`).expect(204);
    const res = await cli(token).get("/api/whoami").expect(401);
    expect(res.body.error.message).toMatch(/API token/);
    expect((await c.get("/api/settings/tokens")).body.tokens).toEqual([]);
  });

  it("keeps each account's tokens to itself", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const mine = await newToken(admin);
    expect((await sara.get("/api/settings/tokens")).body.tokens).toEqual([]);
    await sara.delete(`/api/settings/tokens/${mine.id}`).expect(404);
    const saras = await newToken(sara, "sara-ci");
    const who = await cli(saras.token).get("/api/whoami").expect(200);
    expect(who.body).toEqual({ account: { email: "sara@example.com", displayName: "Sara" }, token: { name: "sara-ci" } });
  });

  it("stops working while the account is disabled, and works again once it's enabled", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const { token } = await newToken(sara);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ disabled: true }).expect(200);
    await cli(token).get("/api/whoami").expect(401);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ disabled: false }).expect(200);
    await cli(token).get("/api/whoami").expect(200);
  });

  it("survives a password change", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    await c
      .put("/api/settings/password")
      .send({ currentPassword: OWNER.password, newPassword: "a brand new password" })
      .expect(204);
    await cli(token).get("/api/whoami").expect(200);
  });
});

describe("what an API token may do", () => {
  it("refuses an unknown or malformed token", async () => {
    for (const header of ["Bearer vlm_nope", "Bearer ", "Basic abc"]) {
      const res = await request(t.app).get("/api/documents").set("Host", APP).set("Authorization", header);
      expect(res.status, header).toBe(401);
    }
  });

  const refused: [method: "get" | "post" | "patch" | "put" | "delete", url: string][] = [
    ["get", "/api/auth/me"],
    ["get", "/api/settings"],
    ["patch", "/api/settings"],
    ["put", "/api/settings/password"],
    ["get", "/api/settings/tokens"],
    ["post", "/api/settings/tokens"],
    ["delete", "/api/settings/tokens/00000000-0000-0000-0000-000000000000"],
    ["get", "/api/admin/users"],
    ["post", "/api/admin/invites"],
    ["delete", "/api/documents/DOC"],
    ["post", "/api/documents/DOC/unpublish"],
    ["get", "/api/documents/DOC/stats"],
  ];

  it.each(refused)("refuses %s %s, even for an admin", async (method, url) => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const doc = await uploadMarkdown(c, "# Keep me");
    const res = await cli(token)[method](url.replace("DOC", doc.id)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/API tokens can’t do that/);
    // Nothing happened to the document.
    await c.get(`/api/documents/${doc.id}`).expect(200);
  });

  it("leaves other Authorization schemes, like a proxy's Basic auth, to the session", async () => {
    const c = await signedIn(t.app);
    await c.get("/api/settings").set("Authorization", "Basic dXNlcjpwYXNz").expect(200);
    await c.patch("/api/settings").set("Authorization", "Basic dXNlcjpwYXNz").send({ displayName: "A", theme: "system", replyNote: "" }).expect(200);
    // …and keeps the Origin check for those writes.
    const forged = await c.patch("/api/settings").set("Authorization", "Basic dXNlcjpwYXNz").set("Origin", "https://evil.example").send({});
    expect(forged.status).toBe(403);
  });

  it("is judged alone when a session cookie comes with it", async () => {
    const c = await signedIn(t.app);
    const res = await c.get("/api/documents").set("Authorization", "Bearer vlm_nope");
    expect(res.status).toBe(401);
  });

  it("lists, reads, edits and publishes the account's own documents without an Origin header", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const doc = await uploadMarkdown(c, "# Mine");
    const api = cli(token);
    const list = await api.get("/api/documents").expect(200);
    expect(list.body.documents.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    await api.get(`/api/documents/${doc.id}`).expect(200);
    await api.patch(`/api/documents/${doc.id}`).send({ title: "Renamed" }).expect(200);
    const published = await api.post(`/api/documents/${doc.id}/publish`).expect(200);
    expect(published.body).toMatchObject({ title: "Renamed", status: "live" });
    await api.get("/api/slugs/free-one").expect(200);
  });

  it("can't see another account's documents", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const doc = await uploadMarkdown(sara, "# Sara's");
    const { token } = await newToken(admin);
    await cli(token).get(`/api/documents/${doc.id}`).expect(404);
    expect((await cli(token).get("/api/documents")).body.documents).toEqual([]);
  });
});

describe("POST /api/push", () => {
  it("publishes a new document and answers with its link and dashboard page", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const res = await cli(token).push("# Acme proposal\n\nHello.", "draft-v3.md").expect(201);
    expect(res.body).toMatchObject({
      created: true,
      document: { slug: "acme-proposal", status: "live", url: `${ORIGIN}/p/acme-proposal`, title: "Acme proposal" },
    });
    expect(res.body.dashboardUrl).toBe(`${ORIGIN}/documents/${res.body.document.id}`);
    expect(res.body.document.version).toMatchObject({ number: 1, uploadedVia: "claude-laptop" });
    const page = await request(t.app).get("/p/acme-proposal").set("Host", APP).expect(200);
    expect(page.text).toContain("Hello.");
  });

  it("names the document, and so its link, after --title", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const res = await cli(token).push("no heading here", "notes.md", { title: "Q3 plan" }).expect(201);
    expect(res.body.document).toMatchObject({ title: "Q3 plan", slug: "q3-plan" });
  });

  it("creates the document at a free slug, then adds versions to it under the same link", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c, "agent");
    const first = await cli(token).push("# One", "a.md", { slug: "weekly-report" }).expect(201);
    expect(first.body.document).toMatchObject({ slug: "weekly-report", status: "live" });

    const second = await cli(token).push("# Two\n\nSecond body.", "b.md", { slug: "weekly-report" }).expect(200);
    expect(second.body).toMatchObject({ created: false, document: { id: first.body.document.id, slug: "weekly-report" } });
    expect(second.body.document.version).toMatchObject({ number: 2, originalName: "b.md", uploadedVia: "agent" });
    const page = await request(t.app).get("/p/weekly-report").set("Host", APP).expect(200);
    expect(page.text).toContain("Second body.");
  });

  it("refuses a slug another account uses, and leaves nothing behind", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const theirs = await uploadMarkdown(sara, "# Taken", "taken.md");
    const { token } = await newToken(admin);
    const res = await cli(token).push("# Mine", "mine.md", { slug: theirs.slug }).expect(409);
    expect(res.body.error.message).toMatch(/someone else/);
    expect((await admin.get("/api/documents")).body.documents).toEqual([]);
    expect((await sara.get(`/api/documents/${theirs.id}/versions`)).body).toHaveLength(1);
  });

  it("refuses a reserved or malformed slug", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    await cli(token).push("# x", "x.md", { slug: "api" }).expect(400);
    const res = await cli(token).push("# x", "x.md", { slug: "Not A Slug!" }).expect(400);
    expect(res.body.error.fields.slug).toBeTruthy();
    expect((await c.get("/api/documents")).body.documents).toEqual([]);
  });

  it("keeps a new upload a draft with draft=true", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const res = await cli(token).push("# Later", "later.md", { draft: "true" }).expect(201);
    expect(res.body.document.status).toBe("draft");
  });

  it("makes an unpublished document live again, unless draft=true", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const doc = (await cli(token).push("# v1", "a.md", { slug: "came-back" }).expect(201)).body.document;
    await c.post(`/api/documents/${doc.id}/unpublish`).expect(200);

    const quiet = await cli(token).push("# v2", "a.md", { slug: "came-back", draft: "true" }).expect(200);
    expect(quiet.body.document.status).toBe("unpublished");
    const back = await cli(token).push("# v3", "a.md", { slug: "came-back" }).expect(200);
    expect(back.body.document.status).toBe("live");
  });

  it("sets a password and an expiry preset", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const res = await cli(token)
      .push("# Secret", "s.md", { password: "hunter22", expiryPreset: "7d" })
      .expect(201);
    expect(res.body.document).toMatchObject({ access: "password", password: "hunter22", expiryPreset: "7d" });
    const days = (Date.parse(res.body.document.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    await request(t.app).get(`/p/${res.body.document.slug}`).set("Host", APP).expect(401);
  });

  it("sets an expiry date, and refuses one in the past before uploading anything", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const ok = await cli(token).push("# Dated", "d.md", { expiryPreset: "date", expiresAt: at }).expect(201);
    expect(ok.body.document).toMatchObject({ expiryPreset: "date", expiresAt: at });

    const past = new Date(Date.now() - 1000).toISOString();
    const res = await cli(token).push("# Old", "o.md", { expiryPreset: "date", expiresAt: past }).expect(400);
    expect(res.body.error.fields.expiresAt).toBeTruthy();
    await cli(token).push("# Old", "o.md", { expiryPreset: "date" }).expect(400);
    expect((await c.get("/api/documents")).body.documents).toHaveLength(1);
  });

  it("changes an existing document's settings only when they're given", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    await cli(token).push("# v1", "a.md", { slug: "keeps", password: "hunter22", title: "Kept title" }).expect(201);
    const res = await cli(token).push("# v2 heading", "a.md", { slug: "keeps" }).expect(200);
    expect(res.body.document).toMatchObject({ title: "Kept title", access: "password", password: "hunter22" });
    const renamed = await cli(token).push("# v3", "a.md", { slug: "keeps", title: "New title" }).expect(200);
    expect(renamed.body.document.title).toBe("New title");
  });

  it("refuses a short password", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const res = await cli(token).push("# x", "x.md", { password: "abc" }).expect(400);
    expect(res.body.error.fields.password).toMatch(/at least 4/);
  });

  it("publishes HTML and zip uploads", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    const html = await cli(token).push(PITCH, "pitch.html").expect(201);
    expect(html.body.document).toMatchObject({ kind: "html", status: "live" });
    const zip = await makeZip([
      { name: "index.html", data: PITCH },
      { name: "style.css", data: "h1{}" },
    ]);
    const res = await cli(token)
      .post("/api/push")
      .field("slug", "site")
      .attach("file", zip, "site.zip")
      .expect(201);
    expect(res.body.document).toMatchObject({ slug: "site", kind: "html", status: "live" });
    expect(res.body.document.version.sourceType).toBe("zip");
  });

  it("refuses a Markdown version of an HTML document", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    await cli(token).push(PITCH, "pitch.html", { slug: "pitch" }).expect(201);
    await cli(token).push("# md", "x.md", { slug: "pitch" }).expect(415);
  });

  it("needs a file", async () => {
    const c = await signedIn(t.app);
    const { token } = await newToken(c);
    await cli(token).post("/api/push").field("slug", "nothing").expect(400);
  });

  it("works from the dashboard too, and records no token there", async () => {
    const c = await signedIn(t.app);
    const res = await c.post("/api/push").attach("file", Buffer.from("# Mine"), "m.md").expect(201);
    expect(res.body.document.version.uploadedVia).toBeNull();
    const versions = await c.get(`/api/documents/${res.body.document.id}/versions`).expect(200);
    expect(versions.body[0].uploadedVia).toBeNull();
  });

  it("counts against the account's limits", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ maxDocuments: 1 }).expect(200);
    const { token } = await newToken(sara);
    await cli(token).push("# One", "1.md").expect(201);
    const res = await cli(token).push("# Two", "2.md");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await sara.get("/api/documents")).body.documents).toHaveLength(1);
  });
});

describe("dashboard uploads", () => {
  it("record no token on their versions", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, "# Mine");
    const versions = await c.get(`/api/documents/${doc.id}/versions`).expect(200);
    expect(versions.body[0].uploadedVia).toBeNull();
  });
});
