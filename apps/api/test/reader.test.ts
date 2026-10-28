import { describe, expect, it } from "vitest";
import { client, signedIn, uploadMarkdown, useTestApp } from "./helpers.js";

const t = useTestApp();

const SOURCE = `---
eyebrow: Report · Q3 2026
---
# Q3 infrastructure report

We moved every service onto one VPS cluster.

## Summary

Hosting fell. <script>alert("x")</script><img src=x onerror="alert(1)"> [bad](javascript:alert(1))

## Uptime & incidents

\`\`\`json
{ "ok": true }
\`\`\`
`;

describe("Markdown reader at /p/:slug", () => {
  it("shows nothing for a draft", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, SOURCE);
    const res = await client(t.app).get(`/p/${doc.slug}`);
    expect(res.status).toBe(404);
    expect(res.text).toContain("Nothing is shared at this address");
  });

  it("renders a published document with title, dek, TOC and link-preview tags", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, SOURCE);
    await c.post(`/api/documents/${doc.id}/publish`).expect(200);

    const res = await client(t.app).get(`/p/${doc.slug}`).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("<title>Q3 infrastructure report</title>");
    expect(res.text).toContain('<meta property="og:title" content="Q3 infrastructure report" />');
    expect(res.text).toContain('<meta property="og:description" content="We moved every service onto one VPS cluster." />');
    expect(res.text).toContain('<p class="eyebrow">Report · Q3 2026</p>');
    expect(res.text).toContain('<a href="#summary" aria-current="true">Summary</a>');
    expect(res.text).toContain('<h2 id="uptime--incidents">');
    expect(res.text).toContain("Shared by <b>Amirali</b>");
  });

  it("never passes raw HTML or script URLs through", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, SOURCE);
    await c.post(`/api/documents/${doc.id}/publish`).expect(200);

    const res = await client(t.app).get(`/p/${doc.slug}`).expect(200);
    const article = res.text.slice(res.text.indexOf("<article"), res.text.indexOf("</article>"));
    expect(article).not.toMatch(/<script/i);
    expect(article).not.toMatch(/onerror/i);
    expect(article).not.toMatch(/javascript:/i);
    expect(res.headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
  });

  it("hides from search engines by default", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, SOURCE);
    await c.post(`/api/documents/${doc.id}/publish`).expect(200);
    const res = await client(t.app).get(`/p/${doc.slug}`).expect(200);
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");

    await c.patch(`/api/documents/${doc.id}`).send({ noindex: false }).expect(200);
    const indexed = await client(t.app).get(`/p/${doc.slug}`).expect(200);
    expect(indexed.headers["x-robots-tag"]).toBeUndefined();
    expect(indexed.text).not.toContain('name="robots"');
  });

  it("offers the original file only when downloads are allowed", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, SOURCE);
    await c.post(`/api/documents/${doc.id}/publish`).expect(200);
    await client(t.app).get(`/p/${doc.slug}/download`).expect(404);

    await c.patch(`/api/documents/${doc.id}`).send({ allowDownload: true }).expect(200);
    const res = await client(t.app).get(`/p/${doc.slug}/download`).expect(200);
    expect(res.headers["content-disposition"]).toContain('filename="proposal.md"');
    expect(res.text).toBe(SOURCE);
  });

  it("does not serve reader pages on the usercontent origin", async () => {
    const c = await signedIn(t.app);
    const doc = await uploadMarkdown(c, SOURCE);
    await c.post(`/api/documents/${doc.id}/publish`).expect(200);
    const { default: request } = await import("supertest");
    await request(t.app).get(`/p/${doc.slug}`).set("Host", "uc.test").expect(404);
  });
});
