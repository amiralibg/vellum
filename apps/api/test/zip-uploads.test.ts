import { randomInt } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { MARKER, PITCH } from "./fixtures.js";
import { client, signedIn, useTestApp } from "./helpers.js";
import { makeZip, makeZipWithRawName, type ZipEntry } from "./zip.js";

const t = useTestApp();

const SITE: ZipEntry[] = [
  { name: "index.html", data: PITCH.replace("</head>", '<script type="module" src="js/app.mjs"></script></head>') },
  { name: "style.css", data: "body { background: #0f1115; }" },
  { name: "img/", data: "" },
  { name: "img/logo.svg", data: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  { name: "js/app.mjs", data: "export const ok = true;" },
  { name: "__MACOSX/._index.html", data: "junk" },
  { name: ".DS_Store", data: "junk" },
];

const upload = async (zip: Buffer, name = "pitch.zip") => {
  const owner = await signedIn(t.app);
  return { owner, res: await owner.post("/api/documents").attach("file", zip, name) };
};

async function publishedFrame(owner: Awaited<ReturnType<typeof signedIn>>, id: string, slug: string): Promise<string> {
  await owner.post(`/api/documents/${id}/publish`).expect(200);
  const page = await client(t.app).get(`/p/${slug}`).expect(200);
  const src = /<iframe[^>]*\ssrc="([^"]+)"/.exec(page.text)![1]!;
  return new URL(src).pathname.replace(/index\.html$/, "");
}

const uc = (path: string) => request(t.app).get(path).set("Host", "uc.test");

/** Text that deflates about 6:1, like real-world assets do, rather than 1000:1 like a bomb. */
const ordinary = (bytes: number) => Buffer.from(Array.from({ length: bytes }, () => (randomInt(2) ? "a" : "b")).join(""));

describe("zip uploads", () => {
  it("serve index.html and its assets at relative paths, with their own types", async () => {
    const { owner, res } = await upload(await makeZip(SITE));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "html", title: "Weft — Seed round" });
    expect(res.body.version.sourceType).toBe("zip");

    const base = await publishedFrame(owner, res.body.id, res.body.slug);
    expect((await uc(`${base}index.html`).expect(200)).text).toContain(MARKER);
    expect((await uc(`${base}style.css`).expect(200)).headers["content-type"]).toBe("text/css; charset=utf-8");
    expect((await uc(`${base}img/logo.svg`).expect(200)).headers["content-type"]).toBe("image/svg+xml");
    const mod = await uc(`${base}js/app.mjs`).expect(200);
    expect(mod.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    // The sandboxed page has an opaque origin; module scripts are CORS requests.
    expect(mod.headers["access-control-allow-origin"]).toBe("*");
    await uc(`${base}.DS_Store`).expect(404);
    await uc(`${base}__MACOSX/._index.html`).expect(404);
  });

  it("unwrap a zip of the folder rather than its contents", async () => {
    const wrapped = SITE.filter((e) => !e.name.startsWith("__") && e.name !== ".DS_Store").map((e) => ({ ...e, name: `pitch/${e.name}` }));
    const { owner, res } = await upload(await makeZip(wrapped));
    expect(res.status).toBe(201);
    const base = await publishedFrame(owner, res.body.id, res.body.slug);
    await uc(`${base}style.css`).expect(200);
  });

  it("never serve paths that climb out of the site, even into another document's", async () => {
    const { owner, res } = await upload(await makeZip(SITE));
    const base = await publishedFrame(owner, res.body.id, res.body.slug);
    // Another document's page is an allowed file type, so only the path checks stand in the way.
    const other = await owner.post("/api/documents").attach("file", Buffer.from(PITCH.replace(MARKER, "other-doc")), "o.html");
    const target = `${other.body.id}/v1/site/index.html`;
    for (const path of [
      `../../../${target}`,
      `..%2f..%2f..%2f${target.replaceAll("/", "%2f")}`,
      `img/../../../../${target}`,
      `%2e%2e/%2e%2e/%2e%2e/${target}`,
      `..%5c..%5c..%5c${target}`,
    ]) {
      const r = await uc(`${base}${path}`);
      expect(r.status, path).toBe(404);
      expect(r.text).not.toContain("other-doc");
    }
  });

  it("refuse a zip without index.html at the top", async () => {
    const { res } = await upload(await makeZip([{ name: "deck/home.html", data: PITCH }, { name: "readme.txt", data: "hi" }]));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("index.html");
  });

  it.each([
    ["a parent path", "zz/evil.html", "../evil.html"],
    ["an absolute path", "aevil.html", "/evil.html"],
    ["a backslash path", "zz_evil.html", "..\\evil.html"],
  ])("refuse a zip with %s (zip slip)", async (_label, placeholder, raw) => {
    const { res } = await upload(await makeZipWithRawName(placeholder, raw, [{ name: "index.html", data: PITCH }]));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/outside its own folder/);
  });

  it("refuse a zip with a symbolic link", async () => {
    const zip = await makeZip([{ name: "index.html", data: PITCH }, { name: "secrets.txt", data: "/etc/passwd", mode: 0o120777 }]);
    const { res } = await upload(zip);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/symbolic link/);
  });

  it("refuse a zip bomb: a file that inflates a thousandfold", async () => {
    const zip = await makeZip([{ name: "index.html", data: PITCH }, { name: "data.json", data: Buffer.alloc(2 * 1024 * 1024, 0x20) }]);
    expect(zip.length).toBeLessThan(50 * 1024);
    const { res } = await upload(zip);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/times its size/);
  });

  it("refuse a zip that unpacks past the size limit", async () => {
    const files = [0, 1, 2, 3].map((i) => ({ name: `data-${i}.txt`, data: ordinary(1024 * 1024) }));
    const zip = await makeZip([{ name: "index.html", data: PITCH }, ...files]);
    expect(zip.length).toBeLessThan(1024 * 1024);
    const { res } = await upload(zip);
    expect(res.status).toBe(413);
    expect(res.body.error.message).toMatch(/unpacks to more than 3 MB/);
  });

  it("refuse a zip with too many files", async () => {
    const files = Array.from({ length: 50 }, (_, i) => ({ name: `p/${i}.txt`, data: "x" }));
    const { res } = await upload(await makeZip([{ name: "index.html", data: PITCH }, ...files]));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/more than 50 files/);
  });

  it.each(["tool.exe", "shell.php", "run.sh", "page.html.bak", "noext"])("refuse a zip containing %s", async (name) => {
    const { res } = await upload(await makeZip([{ name: "index.html", data: PITCH }, { name, data: "x" }]));
    expect(res.status).toBe(415);
    expect(res.body.error.message).toContain(name);
  });

  it("refuse something that only claims to be a zip", async () => {
    const { res } = await upload(Buffer.from("not a zip at all"));
    expect(res.status).toBe(400);
  });

  it("leave nothing behind when a zip is refused", async () => {
    const { readdir } = await import("node:fs/promises");
    const folders = () => readdir(`${t.dataDir}/documents`).catch(() => [] as string[]);
    const before = await folders();
    const { owner, res } = await upload(await makeZip([{ name: "index.html", data: PITCH }, { name: "x.exe", data: "x" }]));
    expect(res.status).toBe(415);
    const list = await owner.get("/api/documents").expect(200);
    expect(list.body.documents).toHaveLength(0);
    expect(await folders()).toEqual(before);
  });

  it("offer the original zip as a download that never renders on the app origin", async () => {
    const { owner, res } = await upload(await makeZip(SITE));
    await owner.patch(`/api/documents/${res.body.id}`).send({ allowDownload: true }).expect(200);
    await owner.post(`/api/documents/${res.body.id}/publish`).expect(200);
    const dl = await client(t.app).get(`/p/${res.body.slug}/download`).expect(200);
    expect(dl.headers["content-type"]).toBe("application/octet-stream");
    expect(dl.headers["content-disposition"]).toContain('attachment; filename="pitch.zip"');
    expect(dl.headers["content-security-policy"]).toBe("sandbox");
  });

  it("keep Markdown and HTML documents apart when uploading a new version", async () => {
    const { owner, res } = await upload(await makeZip(SITE));
    const md = await owner.post(`/api/documents/${res.body.id}/versions`).attach("file", Buffer.from("# Hi"), "notes.md");
    expect(md.status).toBe(415);
    const html = await owner.post(`/api/documents/${res.body.id}/versions`).attach("file", Buffer.from(PITCH), "v2.html");
    expect(html.status).toBe(201);
    expect(html.body.version).toMatchObject({ number: 2, sourceType: "html" });
  });
});
