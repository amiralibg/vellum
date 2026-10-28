import request from "supertest";
import { describe, expect, it } from "vitest";
import { APP, client, ORIGIN, OWNER, signedIn, uploadMarkdown, useTestApp } from "./helpers.js";

const t = useTestApp();

describe("owner-only API", () => {
  const ownerRoutes: [method: "get" | "post" | "patch" | "delete", url: string][] = [
    ["get", "/api/auth/me"],
    ["get", "/api/documents"],
    ["post", "/api/documents"],
    ["get", "/api/documents/00000000-0000-0000-0000-000000000000"],
    ["patch", "/api/documents/00000000-0000-0000-0000-000000000000"],
    ["post", "/api/documents/00000000-0000-0000-0000-000000000000/publish"],
    ["get", "/api/documents/00000000-0000-0000-0000-000000000000/preview"],
    ["post", "/api/documents/00000000-0000-0000-0000-000000000000/unpublish"],
    ["delete", "/api/documents/00000000-0000-0000-0000-000000000000"],
    ["get", "/api/documents/00000000-0000-0000-0000-000000000000/versions"],
    ["post", "/api/documents/00000000-0000-0000-0000-000000000000/versions"],
    ["post", "/api/documents/00000000-0000-0000-0000-000000000000/versions/00000000-0000-0000-0000-000000000000/restore"],
    ["get", "/api/slugs/anything"],
    ["get", "/api/settings"],
    ["patch", "/api/settings"],
  ];

  it.each(ownerRoutes)("%s %s refuses a request without a session", async (method, url) => {
    const res = await client(t.app)[method](url);
    expect(res.status).toBe(401);
  });

  it.each(ownerRoutes)("%s %s refuses a forged session cookie", async (method, url) => {
    const res = await client(t.app)[method](url).set("Cookie", "vellum_session=forged-token");
    expect(res.status).toBe(401);
  });

  it("serves the owner's data once signed in", async () => {
    const c = await signedIn(t.app);
    const res = await c.get("/api/auth/me").expect(200);
    expect(res.body.owner).toMatchObject({ email: OWNER.email, displayName: "Amirali" });
  });

  it("stops accepting the session after sign-out, even if the cookie is replayed", async () => {
    const cookie = await sessionCookie(t.app);
    const asOwner = (r: request.Test) => r.set("Host", APP).set("Origin", ORIGIN).set("Cookie", cookie);
    await asOwner(request(t.app).get("/api/auth/me")).expect(200);
    await asOwner(request(t.app).post("/api/auth/logout")).expect(204);
    await asOwner(request(t.app).get("/api/auth/me")).expect(401);
  });

  it("refuses writes from another origin, even with a valid session", async () => {
    const cookie = await sessionCookie(t.app);
    for (const origin of ["http://uc.test", "https://evil.example", undefined]) {
      const req = request(t.app).post("/api/documents").set("Host", APP).set("Cookie", cookie);
      const res = await (origin ? req.set("Origin", origin) : req).attach("file", Buffer.from("# Hi"), "a.md");
      expect(res.status, `origin ${origin}`).toBe(403);
    }
    const list = await request(t.app).get("/api/documents").set("Host", APP).set("Cookie", cookie).expect(200);
    expect(list.body.documents).toHaveLength(0);
  });

  it("does not serve the API on the usercontent origin", async () => {
    const res = await request(t.app)
      .get("/api/documents")
      .set("Host", "uc.test")
      .set("Cookie", await sessionCookie(t.app));
    expect(res.status).toBe(404);
    expect(res.headers["content-security-policy"]).toContain("sandbox");
  });

  it("sets a host-only, httpOnly session cookie", async () => {
    const res = await client(t.app).post("/api/auth/login").send(OWNER).expect(200);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Domain=/i);
  });
});

describe("sign-in", () => {
  it("rejects a wrong password and a wrong email the same way", async () => {
    const a = await client(t.app).post("/api/auth/login").send({ ...OWNER, password: "nope" });
    const b = await client(t.app).post("/api/auth/login").send({ ...OWNER, email: "someone@example.com" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(a.headers["set-cookie"]).toBeUndefined();
  });

  it("locks out after 10 failed attempts, even with the right password", async () => {
    const c = client(t.app);
    for (let i = 0; i < 10; i++) await c.post("/api/auth/login").send({ ...OWNER, password: `wrong-${i}` }).expect(401);
    await c.post("/api/auth/login").send(OWNER).expect(429);
  });
});

describe("uploads", () => {
  it("rejects files over the size limit", async () => {
    const c = await signedIn(t.app);
    const big = Buffer.alloc(1024 * 1024 + 1, "a");
    await c.post("/api/documents").attach("file", big, "big.md").expect(413);
  });

  it("rejects file types other than Markdown", async () => {
    const c = await signedIn(t.app);
    await c.post("/api/documents").attach("file", Buffer.from("MZ"), "tool.exe").expect(415);
  });

  it("takes the title from the first H1 and derives a free slug from it", async () => {
    const c = await signedIn(t.app);
    const a = await uploadMarkdown(c, "# Acme Corp — Website redesign proposal\n\nHello");
    const b = await uploadMarkdown(c, "# Acme Corp — Website redesign proposal\n\nAgain");
    const res = await c.get(`/api/documents/${a.id}`).expect(200);
    expect(res.body.title).toBe("Acme Corp — Website redesign proposal");
    expect(a.slug).toBe("acme-corp-website-redesign-proposal");
    expect(b.slug).toBe("acme-corp-website-redesign-proposal-2");
  });

  it("reports whether a slug is available", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, "# Taken");
    expect((await c.get("/api/slugs/taken")).body).toEqual({ slug: "taken", available: false, reason: "taken" });
    expect((await c.get(`/api/slugs/taken?except=${doc.id}`)).body.available).toBe(true);
    expect((await c.get("/api/slugs/free-one")).body.available).toBe(true);
    expect((await c.get("/api/slugs/Bad--Slug-")).body.reason).toBe("invalid");
  });

  it("refuses to change a slug to one another document uses", async () => {
    const c = await signedIn(t.app);
    await uploadMarkdown(c, "# First");
    const second = await uploadMarkdown(c, "# Second");
    const res = await c.patch(`/api/documents/${second.id}`).send({ slug: "first" });
    expect(res.status).toBe(409);
    expect(res.body.error.fields.slug).toBeDefined();
  });
});

async function sessionCookie(app: typeof t.app): Promise<string> {
  const res = await client(app).post("/api/auth/login").send(OWNER).expect(200);
  return String(res.headers["set-cookie"]).split(";")[0]!;
}
