import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { client, publishMarkdown, signedIn, useTestApp } from "./helpers.js";

const t = useTestApp();

const V1 = "---\neyebrow: Draft one\n---\n# Acme proposal\n\nFirst take.\n\n## Scope\n\nTwelve weeks.\n";
const V2 = "# Acme proposal, revised\n\nSecond take.\n\n## Scope\n\nTen weeks.\n";

const uploadVersion = (c: Awaited<ReturnType<typeof signedIn>>, id: string, source: string, name = "acme-v2.md") =>
  c.post(`/api/documents/${id}/versions`).attach("file", Buffer.from(source), name);

describe("versions", () => {
  it("serves a new upload at the same link and keeps the settings", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, V1, { slug: "acme", title: "Acme — proposal", allowDownload: true });

    const res = await uploadVersion(owner, doc.id, V2).expect(201);
    expect(res.body).toMatchObject({ slug: "acme", title: "Acme — proposal", allowDownload: true, status: "live" });
    expect(res.body.version).toMatchObject({ number: 2, originalName: "acme-v2.md" });

    const page = await client(t.app).get("/p/acme").expect(200);
    expect(page.text).toContain("Ten weeks.");
    expect(page.text).not.toContain("Twelve weeks.");
    expect(page.text).not.toContain("Draft one");
    const file = await client(t.app).get("/p/acme/download").expect(200);
    expect(file.text).toBe(V2);
    expect(file.headers["content-disposition"]).toContain('filename="acme-v2.md"');
  });

  it("lists versions newest first and marks the current one", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, V1);
    await uploadVersion(owner, doc.id, V2).expect(201);

    const res = await owner.get(`/api/documents/${doc.id}/versions`).expect(200);
    expect(res.body.map((v: { number: number; current: boolean }) => [v.number, v.current])).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it("restores an earlier version, with its own eyebrow and dek", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, V1, { slug: "acme" });
    await uploadVersion(owner, doc.id, V2).expect(201);
    const versions = (await owner.get(`/api/documents/${doc.id}/versions`)).body as { id: string; number: number }[];
    const v1 = versions.find((v) => v.number === 1)!;

    const res = await owner.post(`/api/documents/${doc.id}/versions/${v1.id}/restore`).expect(200);
    expect(res.body.version.number).toBe(1);

    const page = await client(t.app).get("/p/acme").expect(200);
    expect(page.text).toContain("Twelve weeks.");
    expect(page.text).toContain("Draft one");
    expect(page.text).toContain('<p class="dek">First take.</p>');
    const file = await client(t.app).get(`/p/acme/download`);
    expect(file.status).toBe(404); // downloads were never allowed
  });

  it("won't restore a version that belongs to another document", async () => {
    const owner = await signedIn(t.app);
    const a = await publishMarkdown(owner, V1);
    const b = await publishMarkdown(owner, V2);
    const [bv1] = (await owner.get(`/api/documents/${b.id}/versions`)).body as { id: string }[];
    await owner.post(`/api/documents/${a.id}/versions/${bv1!.id}/restore`).expect(404);
  });

  it("rejects a new version that isn't Markdown", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, V1);
    await uploadVersion(owner, doc.id, "MZ", "tool.exe").expect(415);
    const res = await owner.get(`/api/documents/${doc.id}/versions`).expect(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("unpublish", () => {
  it("takes the link down, keeps the document, and can publish it again", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, V1, { allowDownload: true });

    const res = await owner.post(`/api/documents/${doc.id}/unpublish`).expect(200);
    expect(res.body.status).toBe("unpublished");
    const gone = await client(t.app).get(`/p/${doc.slug}`);
    expect(gone.status).toBe(404);
    expect(gone.text).toContain("Nothing is shared at this address");
    await client(t.app).get(`/p/${doc.slug}/download`).expect(404);

    const drafts = await owner.get("/api/documents?status=drafts").expect(200);
    expect(drafts.body.documents.map((d: { id: string }) => d.id)).toEqual([doc.id]);

    await owner.post(`/api/documents/${doc.id}/publish`).expect(200);
    await client(t.app).get(`/p/${doc.slug}`).expect(200);
  });
});

describe("delete", () => {
  it("removes the document, its versions and its files", async () => {
    const owner = await signedIn(t.app);
    const doc = await publishMarkdown(owner, V1);
    await uploadVersion(owner, doc.id, V2).expect(201);
    const dir = path.join(t.dataDir, "documents", doc.id);
    expect(existsSync(dir)).toBe(true);

    await owner.delete(`/api/documents/${doc.id}`).expect(204);
    await owner.get(`/api/documents/${doc.id}`).expect(404);
    await client(t.app).get(`/p/${doc.slug}`).expect(404);
    expect(existsSync(dir)).toBe(false);
    const { rowCount } = await t.db.query("SELECT 1 FROM document_versions");
    expect(rowCount).toBe(0);

    // The link is free for a new document.
    const again = await publishMarkdown(owner, V1);
    expect(again.slug).toBe(doc.slug);
  });

  it("answers 404 for a document that doesn't exist", async () => {
    const owner = await signedIn(t.app);
    await owner.delete("/api/documents/00000000-0000-0000-0000-000000000000").expect(404);
  });
});
