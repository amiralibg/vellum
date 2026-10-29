import type { Account, UserItem, UserListResponse } from "@vellum/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDb, migrate } from "../src/db/index.js";
import { migrations } from "../src/db/migrations.js";
import { resetAdmin } from "../src/services/auth.js";
import { PITCH } from "./fixtures.js";
import { client, invitedUser, OWNER, publishMarkdown, signedIn, uploadMarkdown, useTestApp } from "./helpers.js";

const t = useTestApp();
const SARA = { email: "sara@example.com", password: "another long password" };

const tokenOf = (url: string) => new URL(url).pathname.split("/").pop()!;

async function createInvite(admin: Awaited<ReturnType<typeof signedIn>>, note = "") {
  const res = await admin.post("/api/admin/invites").send({ note }).expect(201);
  return res.body as { url: string; invite: { id: string } };
}

async function users(admin: Awaited<ReturnType<typeof signedIn>>): Promise<UserItem[]> {
  return ((await admin.get("/api/admin/users").expect(200)).body as UserListResponse).users;
}

describe("invites", () => {
  it("create an account that starts signed in, as a regular user, and work once", async () => {
    const admin = await signedIn(t.app);
    const { url, invite } = await createInvite(admin, "For Sara");
    expect(url).toMatch(/^http:\/\/app\.test\/invite\/[\w-]{43}$/);
    const pending = await admin.get("/api/admin/invites").expect(200);
    expect(pending.body).toEqual([expect.objectContaining({ id: invite.id, note: "For Sara", createdBy: "Amirali" })]);

    const sara = client(t.app);
    const info = await sara.get(`/api/auth/invites/${tokenOf(url)}`).expect(200);
    expect(info.body).toMatchObject({ name: "For Sara", invitedBy: "Amirali" });
    const res = await sara
      .post(`/api/auth/invites/${tokenOf(url)}`)
      .send({ email: "Sara@Example.com", displayName: "Sara", password: SARA.password })
      .expect(200);
    expect(res.body.account).toMatchObject({ email: "sara@example.com", displayName: "Sara", isAdmin: false });
    expect((await sara.get("/api/auth/me").expect(200)).body.account.email).toBe("sara@example.com");

    // Used up: gone from the list, and the link no longer opens.
    expect((await admin.get("/api/admin/invites")).body).toEqual([]);
    await client(t.app).get(`/api/auth/invites/${tokenOf(url)}`).expect(404);
    await client(t.app)
      .post(`/api/auth/invites/${tokenOf(url)}`)
      .send({ email: "other@example.com", displayName: "Other", password: SARA.password })
      .expect(404);
    await client(t.app).post("/api/auth/login").send(SARA).expect(200);
  });

  it("stores only a hash of the link's token", async () => {
    const admin = await signedIn(t.app);
    const { url } = await createInvite(admin);
    const { rows } = await t.db.query<{ token_hash: string }>("SELECT token_hash FROM invites");
    expect(rows[0]!.token_hash).not.toContain(tokenOf(url));
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuse an email that already has an account, and keep the invite usable", async () => {
    const admin = await signedIn(t.app);
    const { url } = await createInvite(admin);
    const res = await client(t.app)
      .post(`/api/auth/invites/${tokenOf(url)}`)
      .send({ email: OWNER.email, displayName: "Me again", password: SARA.password })
      .expect(409);
    expect(res.body.error.fields.email).toBeDefined();
    await client(t.app).get(`/api/auth/invites/${tokenOf(url)}`).expect(200);
  });

  it("check the new account's fields", async () => {
    const admin = await signedIn(t.app);
    const { url } = await createInvite(admin);
    const res = await client(t.app)
      .post(`/api/auth/invites/${tokenOf(url)}`)
      .send({ email: "not-an-email", displayName: " ", password: "short" })
      .expect(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["displayName", "email", "password"]);
  });

  it("stop working once revoked or expired", async () => {
    const admin = await signedIn(t.app);
    const revoked = await createInvite(admin);
    await admin.delete(`/api/admin/invites/${revoked.invite.id}`).expect(204);
    await client(t.app).get(`/api/auth/invites/${tokenOf(revoked.url)}`).expect(404);
    await admin.delete(`/api/admin/invites/${revoked.invite.id}`).expect(404);

    const expired = await createInvite(admin);
    await t.db.query("UPDATE invites SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.invite.id]);
    await client(t.app).get(`/api/auth/invites/${tokenOf(expired.url)}`).expect(404);
    await client(t.app)
      .post(`/api/auth/invites/${tokenOf(expired.url)}`)
      .send({ ...SARA, displayName: "Sara" })
      .expect(404);
    expect((await admin.get("/api/admin/invites")).body).toEqual([]);
  });
});

describe("admin API", () => {
  const adminRoutes: [method: "get" | "post" | "patch" | "delete", url: string][] = [
    ["get", "/api/admin/users"],
    ["patch", "/api/admin/users/00000000-0000-0000-0000-000000000000"],
    ["post", "/api/admin/users/00000000-0000-0000-0000-000000000000/reset-link"],
    ["get", "/api/admin/invites"],
    ["post", "/api/admin/invites"],
    ["delete", "/api/admin/invites/00000000-0000-0000-0000-000000000000"],
  ];

  it.each(adminRoutes)("%s %s asks for a session, then for an admin", async (method, url) => {
    expect((await client(t.app)[method](url)).status).toBe(401);
    const sara = await invitedUser(t.app, await signedIn(t.app));
    expect((await sara[method](url).send({})).status).toBe(403);
  });

  it("lists accounts with their usage, and the default limits", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    await uploadMarkdown(sara, "# Notes\n\nHello");
    const res = (await admin.get("/api/admin/users").expect(200)).body as UserListResponse;
    expect(res.defaults).toEqual({ maxDocuments: 50, maxStorageMb: 500 });
    const [owner, s] = res.users;
    expect(owner).toMatchObject({ email: OWNER.email, isAdmin: true, usage: { maxDocuments: null, maxStorageBytes: null } });
    expect(s).toMatchObject({
      email: "sara@example.com",
      isAdmin: false,
      disabled: false,
      usage: { documents: 1, maxDocuments: 50, maxStorageBytes: 500 * 1024 * 1024 },
      limits: { maxDocuments: null, maxStorageMb: null },
    });
    expect(s!.usage.storageBytes).toBeGreaterThan(0);
    expect(s!.lastSeenAt).not.toBeNull();
  });

  it("can make another user an admin, who can then step down the first", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    await sara.get("/api/admin/users").expect(403);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ isAdmin: true }).expect(200);
    await sara.get("/api/admin/users").expect(200);

    const ownerId = (await users(admin))[0]!.id;
    await sara.patch(`/api/admin/users/${ownerId}`).send({ isAdmin: false }).expect(200);
    await admin.get("/api/admin/users").expect(403);
  });

  it("always keeps one enabled admin", async () => {
    const admin = await signedIn(t.app);
    const ownerId = (await users(admin))[0]!.id;
    const res = await admin.patch(`/api/admin/users/${ownerId}`).send({ isAdmin: false }).expect(409);
    expect(res.body.error.message).toMatch(/at least one admin/);

    // A disabled admin doesn't count.
    const sara = await invitedUser(t.app, admin);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ isAdmin: true }).expect(200);
    await sara.patch(`/api/admin/users/${ownerId}`).send({ disabled: true }).expect(200);
    await sara.patch(`/api/admin/users/${sara.id}`).send({ isAdmin: false }).expect(409);
  });

  it("won't let an admin disable their own account", async () => {
    const admin = await signedIn(t.app);
    await invitedUser(t.app, admin);
    const ownerId = (await users(admin))[0]!.id;
    await admin.patch(`/api/admin/users/${ownerId}`).send({ disabled: true }).expect(400);
  });
});

describe("documents are private to their author", () => {
  it("answers 404 for another user's document on every route, admins included", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const doc = await publishMarkdown(sara, "# Sara's plan\n\nSecret");

    expect((await admin.get("/api/documents").expect(200)).body).toMatchObject({ documents: [], counts: { all: 0 } });
    const base = `/api/documents/${doc.id}`;
    await admin.get(base).expect(404);
    await admin.patch(base).send({ title: "Mine now" }).expect(404);
    await admin.post(`${base}/publish`).expect(404);
    await admin.post(`${base}/unpublish`).expect(404);
    await admin.get(`${base}/versions`).expect(404);
    await admin.post(`${base}/versions`).attach("file", Buffer.from("# Replaced"), "x.md").expect(404);
    await admin.get(`${base}/preview`).expect(404);
    await admin.get(`${base}/stats`).expect(404);
    await admin.get(`${base}/views`).expect(404);
    await admin.delete(base).expect(404);
    const versions = (await sara.get(`/api/documents/${doc.id}/versions`).expect(200)).body as { id: string }[];
    await admin.post(`/api/documents/${doc.id}/versions/${versions[0]!.id}/restore`).expect(404);
    expect((await sara.get(`/api/documents/${doc.id}`).expect(200)).body.title).toBe("Sara's plan");
  });

  it("shares one namespace of links: first come, first served", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const mine = await uploadMarkdown(admin, "# Proposal");
    expect((await sara.get(`/api/slugs/${mine.slug}`)).body.reason).toBe("taken");
    const hers = await uploadMarkdown(sara, "# Proposal");
    expect(hers.slug).toBe("proposal-2");
    await sara.patch(`/api/documents/${hers.id}`).send({ slug: "proposal" }).expect(409);
  });

  it("shows the author's name and reply note to readers", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    await sara.patch("/api/settings").send({ displayName: "Sara K.", theme: "system", replyNote: "Back by Friday." });
    const doc = await publishMarkdown(sara, "# Plan\n\nBody", { replyEmail: "sara@example.com" });
    const page = await client(t.app).get(`/p/${doc.slug}`).expect(200);
    expect(page.text).toContain("Sara K.");
    expect(page.text).toContain("Back by Friday.");
    expect(page.text).not.toContain("Amirali");
  });
});

describe("views by signed-in users", () => {
  const beacon = async (c: ReturnType<typeof client>, slug: string) => {
    const page = await c.get(`/p/${slug}`).set("User-Agent", "Mozilla/5.0 (Macintosh) Chrome/130.0.0.0").expect(200);
    const token = /data-view="([^"]+)"/.exec(page.text)![1]!;
    await c
      .post(`/p/${slug}/beacon`)
      .set("User-Agent", "Mozilla/5.0 (Macintosh) Chrome/130.0.0.0")
      .set("Content-Type", "text/plain;charset=UTF-8")
      .send(JSON.stringify({ t: token }))
      .expect(204);
  };

  it("don't count the author, but count everyone else who's signed in", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const doc = await publishMarkdown(sara, "# Plan\n\n## One\n\nBody");
    await beacon(sara, doc.slug);
    expect((await sara.get(`/api/documents/${doc.id}/stats`)).body.totals.views).toBe(0);
    await beacon(admin, doc.slug);
    expect((await sara.get(`/api/documents/${doc.id}/stats`)).body.totals.views).toBe(1);
  });

  it("count this month's views of the user's own documents only", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const doc = await publishMarkdown(sara, "# Plan\n\nBody");
    await beacon(client(t.app), doc.slug);
    expect((await sara.get("/api/documents")).body.viewsThisMonth).toBe(1);
    expect((await admin.get("/api/documents")).body.viewsThisMonth).toBe(0);
  });
});

describe("disabling an account", () => {
  it("signs the user out, refuses their sign-in and takes every document offline until enabled", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const md = await publishMarkdown(sara, "# Plan\n\nBody");
    const html = (await sara.post("/api/documents").attach("file", Buffer.from(PITCH), "pitch.html").expect(201)).body;
    await sara.post(`/api/documents/${html.id}/publish`).expect(200);
    const page = await client(t.app).get(`/p/${html.slug}`).expect(200);
    const frame = new URL(/<iframe[^>]*\ssrc="([^"]+)"/.exec(page.text)![1]!);
    const preview = new URL((await sara.get(`/api/documents/${html.id}/preview`).expect(200)).body.frameUrl);

    await admin.patch(`/api/admin/users/${sara.id}`).send({ disabled: true }).expect(200);

    await sara.get("/api/auth/me").expect(401);
    const login = await client(t.app).post("/api/auth/login").send(SARA).expect(403);
    expect(login.body.error.message).toMatch(/disabled/);
    await client(t.app).get(`/p/${md.slug}`).expect(404);
    await client(t.app).get(`/p/${html.slug}`).expect(404);
    await request(t.app).get(frame.pathname).set("Host", "uc.test").expect(404);
    await request(t.app).get(preview.pathname).set("Host", "uc.test").expect(404);
    await client(t.app)
      .post(`/p/${md.slug}/beacon`)
      .set("Content-Type", "text/plain")
      .send(JSON.stringify({ t: "x" }))
      .expect(404);

    await admin.patch(`/api/admin/users/${sara.id}`).send({ disabled: false }).expect(200);
    await client(t.app).get(`/p/${md.slug}`).expect(200);
    await client(t.app).post("/api/auth/login").send(SARA).expect(200);
  });
});

describe("password links", () => {
  it("set a new password once, and sign out every session of the account", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const link = (await admin.post(`/api/admin/users/${sara.id}/reset-link`).expect(201)).body as { url: string };
    expect(link.url).toMatch(/^http:\/\/app\.test\/reset\//);

    const c = client(t.app);
    expect((await c.get(`/api/auth/resets/${tokenOf(link.url)}`).expect(200)).body.email).toBe(SARA.email);
    await c.post(`/api/auth/resets/${tokenOf(link.url)}`).send({ password: "brand new password" }).expect(200);
    await c.get("/api/auth/me").expect(200);

    await sara.get("/api/auth/me").expect(401);
    await client(t.app).post("/api/auth/login").send(SARA).expect(401);
    await client(t.app).post("/api/auth/login").send({ ...SARA, password: "brand new password" }).expect(200);
    await client(t.app).post(`/api/auth/resets/${tokenOf(link.url)}`).send({ password: "third password!" }).expect(404);
  });

  it("stop working when a newer link is made, or the account is disabled", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const first = (await admin.post(`/api/admin/users/${sara.id}/reset-link`).expect(201)).body.url as string;
    const second = (await admin.post(`/api/admin/users/${sara.id}/reset-link`).expect(201)).body.url as string;
    await client(t.app).get(`/api/auth/resets/${tokenOf(first)}`).expect(404);
    await client(t.app).get(`/api/auth/resets/${tokenOf(second)}`).expect(200);

    await admin.patch(`/api/admin/users/${sara.id}`).send({ disabled: true }).expect(200);
    await client(t.app).get(`/api/auth/resets/${tokenOf(second)}`).expect(404);
    await admin.post(`/api/admin/users/${sara.id}/reset-link`).expect(400);
  });
});

describe("changing your password", () => {
  it("asks for the current one, and signs out the account's other sessions", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    const other = client(t.app);
    await other.post("/api/auth/login").send(SARA).expect(200);

    const wrong = await sara
      .put("/api/settings/password")
      .send({ currentPassword: "nope", newPassword: "brand new password" })
      .expect(400);
    expect(wrong.body.error.fields.currentPassword).toBeDefined();

    await sara
      .put("/api/settings/password")
      .send({ currentPassword: SARA.password, newPassword: "brand new password" })
      .expect(204);
    await sara.get("/api/auth/me").expect(200);
    await other.get("/api/auth/me").expect(401);
    await client(t.app).post("/api/auth/login").send({ ...SARA, password: "brand new password" }).expect(200);
  });
});

describe("limits", () => {
  it("cap an invited user's documents, from the default or the admin's own number", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ maxDocuments: 1 }).expect(200);
    await uploadMarkdown(sara, "# One");
    const res = await sara.post("/api/documents").attach("file", Buffer.from("# Two"), "two.md").expect(403);
    expect(res.body.error.message).toMatch(/limit of 1 documents/);
    expect((await sara.get("/api/auth/me")).body.account.usage).toMatchObject({ documents: 1, maxDocuments: 1 });

    await admin.patch(`/api/admin/users/${sara.id}`).send({ maxDocuments: null }).expect(200);
    await uploadMarkdown(sara, "# Two");
  });

  it("cap storage, counting every version", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ maxStorageMb: 1 }).expect(200);
    const big = `# Big\n\n${"word ".repeat(120_000)}`; // ~600 KB
    const doc = await uploadMarkdown(sara, big);
    const res = await sara.post(`/api/documents/${doc.id}/versions`).attach("file", Buffer.from(big), "big.md").expect(403);
    expect(res.body.error.message).toMatch(/left of your 1\.0 MB/);
    await sara.post("/api/documents").attach("file", Buffer.from(big), "again.md").expect(403);
    expect((await sara.get(`/api/documents/${doc.id}/versions`)).body).toHaveLength(1);
  });

  it("don't apply to admins", async () => {
    const admin = await signedIn(t.app);
    const me = (await admin.get("/api/auth/me").expect(200)).body.account as Account;
    expect(me.usage).toMatchObject({ maxDocuments: null, maxStorageBytes: null });
  });
});

describe("owner:reset", () => {
  it("turns the account with OWNER_EMAIL back into an enabled admin, or creates it", async () => {
    const admin = await signedIn(t.app);
    const sara = await invitedUser(t.app, admin);
    await admin.patch(`/api/admin/users/${sara.id}`).send({ disabled: true }).expect(200);

    expect(await resetAdmin(t.db, SARA.email, "rescue password", "ignored")).toBe("reset");
    const login = await client(t.app).post("/api/auth/login").send({ ...SARA, password: "rescue password" }).expect(200);
    expect(login.body.account).toMatchObject({ isAdmin: true, displayName: "Sara" });

    expect(await resetAdmin(t.db, "new@example.com", "rescue password", "New")).toBe("created");
    await client(t.app).post("/api/auth/login").send({ email: "new@example.com", password: "rescue password" }).expect(200);
  });
});

describe("migration 004_users", () => {
  it("turns the single owner into the first admin, keeping their sessions and documents", async () => {
    const schema = `mig_${process.pid}`;
    await t.db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const old = createDb(url.toString());
    try {
      await migrate(old, migrations.slice(0, 3));
      await old.query(
        "INSERT INTO owner (email, password_hash, display_name, reply_note) VALUES ('Me@Example.com', 'hash', 'Me', 'note')",
      );
      await old.query("INSERT INTO sessions (id, expires_at) VALUES ('s1', now() + interval '1 day')");
      await old.query(
        `INSERT INTO documents (id, slug, kind, title) VALUES ('00000000-0000-0000-0000-000000000001', 'plan', 'markdown', 'Plan')`,
      );

      await migrate(old);

      const u = await old.query("SELECT id, email, display_name, reply_note, is_admin FROM users");
      expect(u.rows).toEqual([expect.objectContaining({ email: "me@example.com", display_name: "Me", reply_note: "note", is_admin: true })]);
      const id = u.rows[0].id as string;
      expect((await old.query("SELECT user_id FROM sessions")).rows).toEqual([{ user_id: id }]);
      expect((await old.query("SELECT user_id FROM documents")).rows).toEqual([{ user_id: id }]);
      expect((await old.query("SELECT to_regclass('owner') AS t")).rows[0].t).toBeNull();
    } finally {
      await old.end();
      await t.db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  });
});
