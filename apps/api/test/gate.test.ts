import { describe, expect, it } from "vitest";
import { client, publishMarkdown, setCookie, signedIn, useTestApp } from "./helpers.js";

const t = useTestApp();

const SOURCE = `# Acme Corp — Website redesign proposal

A twelve-week redesign of the marketing site.

## Where things stand

The secret pricing is 48,000 EUR.
`;

const PASSWORD = "acme-q4";

describe("password gate at /p/:slug", () => {
  it("shows the gate with the title, and none of the document", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });

    const res = await client(t.app).get(`/p/${doc.slug}`);
    expect(res.status).toBe(401);
    expect(res.text).toContain("Protected document");
    expect(res.text).toContain("<title>Acme Corp — Website redesign proposal</title>");
    expect(res.text).toContain('<meta property="og:title" content="Acme Corp — Website redesign proposal" />');
    expect(res.text).toContain(`action="/p/${doc.slug}/unlock"`);
    expect(res.text).not.toContain("48,000");
    expect(res.text).not.toContain("twelve-week");
    expect(res.text).not.toContain('name="description"');
  });

  it("re-renders the gate with an error for a wrong password, and sets no cookie", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });

    const res = await client(t.app).post(`/p/${doc.slug}/unlock`).type("form").send({ password: "acme-q3" });
    expect(res.status).toBe(401);
    expect(res.text).toContain("That password doesn’t match.");
    expect(res.text).toContain('aria-invalid="true"');
    expect(res.text).not.toContain("48,000");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("opens the document after the right password, with a cookie scoped to the document", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const reader = client(t.app);

    const res = await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/p/${doc.slug}`);
    const cookie = setCookie(res, "vellum_unlock")!;
    expect(cookie).toMatch(new RegExp(`Path=/p/${doc.slug}(;|$)`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Domain=/i);

    const page = await reader.get(`/p/${doc.slug}`).expect(200);
    expect(page.text).toContain("48,000");
  });

  it("does not accept an unlock cookie from another document", async () => {
    const owner = await signedIn(t.app);
    const a = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const b = await publishMarkdown(owner, SOURCE.replace("Acme", "Globex"), { access: "password", password: PASSWORD });

    const res = await client(t.app).post(`/p/${a.slug}/unlock`).type("form").send({ password: PASSWORD }).expect(303);
    const pair = setCookie(res, "vellum_unlock")!.split(";")[0]!;
    await client(t.app).get(`/p/${b.slug}`).set("Cookie", pair).expect(401);
    await client(t.app).get(`/p/${a.slug}`).set("Cookie", pair).expect(200);
    await client(t.app).get(`/p/${a.slug}`).set("Cookie", `${pair.slice(0, -2)}xx`).expect(401);
  });

  it("locks readers out again when the owner changes the password", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const reader = client(t.app);
    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: PASSWORD }).expect(303);
    await reader.get(`/p/${doc.slug}`).expect(200);

    await owner.patch(`/api/documents/${doc.id}`).send({ access: "password", password: "acme-q5" }).expect(200);
    await reader.get(`/p/${doc.slug}`).expect(401);

    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: PASSWORD }).expect(401);
    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: "acme-q5" }).expect(303);
    await reader.get(`/p/${doc.slug}`).expect(200);
  });

  it("keeps the password when other settings are saved", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const reader = client(t.app);
    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: PASSWORD }).expect(303);

    const saved = await owner.patch(`/api/documents/${doc.id}`).send({ access: "password", password: PASSWORD, title: "Renamed" });
    expect(saved.body).toMatchObject({ access: "password", password: PASSWORD, title: "Renamed" });
    await reader.get(`/p/${doc.slug}`).expect(200);
  });

  it("refuses to protect a document without a password", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE);
    const res = await owner.patch(`/api/documents/${doc.id}`).send({ access: "password", password: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.password).toBeDefined();
    await client(t.app).get(`/p/${doc.slug}`).expect(200);
  });

  it("opens to anyone again when access goes back to the link", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const saved = await owner.patch(`/api/documents/${doc.id}`).send({ access: "link" }).expect(200);
    expect(saved.body.password).toBeNull();
    const page = await client(t.app).get(`/p/${doc.slug}`).expect(200);
    expect(page.text).toContain("48,000");
  });

  it("stops checking passwords after 10 wrong attempts from one address, even the right one", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const other = await publishMarkdown(owner, SOURCE.replace("Acme", "Globex"), { access: "password", password: PASSWORD });
    const reader = client(t.app);

    for (let i = 0; i < 10; i++) {
      await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: `guess-${i}` }).expect(401);
    }
    const blocked = await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain("Too many attempts");
    expect(blocked.headers["set-cookie"]).toBeUndefined();

    // The limit is per document.
    await reader.post(`/p/${other.slug}/unlock`).type("form").send({ password: PASSWORD }).expect(303);
  });

  it("keeps the description out of a password document's link preview", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const reader = client(t.app);
    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: PASSWORD }).expect(303);
    const page = await reader.get(`/p/${doc.slug}`).expect(200);
    expect(page.text).not.toContain('property="og:description"');
    expect(page.text).toContain('<p class="dek">A twelve-week redesign of the marketing site.</p>');
  });

  it("shows the password to the owner", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD });
    const res = await owner.get(`/api/documents/${doc.id}`).expect(200);
    expect(res.body).toMatchObject({ access: "password", password: PASSWORD });
  });
});

describe("downloads behind the gate", () => {
  it("serves the original only after the password", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, SOURCE, { access: "password", password: PASSWORD, allowDownload: true });
    const reader = client(t.app);

    const locked = await reader.get(`/p/${doc.slug}/download`);
    expect(locked.status).toBe(401);
    expect(locked.text).not.toContain("48,000");
    expect(locked.headers["content-disposition"]).toBeUndefined();

    await reader.post(`/p/${doc.slug}/unlock`).type("form").send({ password: PASSWORD }).expect(303);
    const res = await reader.get(`/p/${doc.slug}/download`).expect(200);
    expect(res.text).toBe(SOURCE);
  });
});
