import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { configPath, normalizeUrl } from "../src/config.js";
import { parseExpires } from "../src/expires.js";
import { pack } from "../src/pack.js";
import { fakeIo, pushResult, signedInEnv } from "./helpers.js";

async function tmpFile(name: string, content: string | Buffer = "# Hello") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vellum-file-"));
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

describe("vellum upload", () => {
  it("sends the file with the token, prints the link, and opens it", async () => {
    const f = await fakeIo(() => ({ status: 201, body: pushResult() }), { env: signedInEnv });
    const file = await tmpFile("proposal.md");
    expect(await run(["upload", file], f.io)).toBe(0);

    const [req] = f.requests;
    expect(req).toMatchObject({ method: "POST", url: "https://docs.example.com/api/push" });
    expect(req!.headers.get("authorization")).toBe("Bearer vlm_test");
    const sent = req!.form!.get("file") as File;
    expect(sent.name).toBe("proposal.md");
    expect(await sent.text()).toBe("# Hello");
    expect([...req!.form!.keys()]).toEqual(["file"]);

    expect(f.out).toEqual(["https://docs.example.com/p/acme-proposal"]);
    expect(f.err).toEqual(["“acme-proposal” is live."]);
    expect(f.opened).toEqual(["https://docs.example.com/p/acme-proposal"]);
  });

  it("passes the slug, title, password, expiry and draft flags as form fields", async () => {
    const f = await fakeIo(() => ({ body: pushResult({ status: "draft" }) }), { env: signedInEnv });
    const file = await tmpFile("a.md");
    const code = await run(
      ["upload", file, "--slug", "Weekly-Report", "--title", "Weekly", "--password", "hunter22", "--expires", "7d", "--draft"],
      f.io,
    );
    expect(code).toBe(0);
    expect(Object.fromEntries([...f.requests[0]!.form!.entries()].filter(([k]) => k !== "file"))).toEqual({
      slug: "weekly-report",
      title: "Weekly",
      password: "hunter22",
      draft: "true",
      expiryPreset: "7d",
    });
  });

  it("prints and opens the dashboard page for a draft, and with --dashboard", async () => {
    const draft = await fakeIo(() => ({ body: pushResult({ status: "draft" }) }), { env: signedInEnv });
    await run(["upload", await tmpFile("a.md"), "--draft"], draft.io);
    expect(draft.out).toEqual(["https://docs.example.com/documents/d1"]);
    expect(draft.opened).toEqual(["https://docs.example.com/documents/d1"]);
    expect(draft.err[0]).toMatch(/is a draft/);

    const live = await fakeIo(() => ({ body: pushResult() }), { env: signedInEnv });
    await run(["upload", await tmpFile("a.md"), "--dashboard"], live.io);
    expect(live.out).toEqual(["https://docs.example.com/documents/d1"]);
  });

  it("says when the file became a new version", async () => {
    const f = await fakeIo(() => ({ body: pushResult({ created: false, number: 3, slug: "weekly" }) }), { env: signedInEnv });
    await run(["upload", await tmpFile("a.md"), "--slug", "weekly"], f.io);
    expect(f.err).toEqual(["Version 3 of “weekly” is live."]);
  });

  it("doesn't open a browser with --no-open", async () => {
    const f = await fakeIo(() => ({ body: pushResult() }), { env: signedInEnv });
    await run(["upload", await tmpFile("a.md"), "--no-open"], f.io);
    expect(f.opened).toEqual([]);
    expect(f.out).toEqual(["https://docs.example.com/p/acme-proposal"]);
  });

  it("still prints the link when the browser can't open", async () => {
    const f = await fakeIo(() => ({ body: pushResult() }), {
      env: signedInEnv,
      open: async () => {
        throw new Error("spawn xdg-open ENOENT");
      },
    });
    expect(await run(["upload", await tmpFile("a.md")], f.io)).toBe(0);
    expect(f.out).toEqual(["https://docs.example.com/p/acme-proposal"]);
    expect(f.err[0]).toMatch(/couldn’t open a browser/);
  });

  it("prints JSON with --json", async () => {
    const f = await fakeIo(() => ({ body: pushResult() }), { env: signedInEnv });
    await run(["upload", await tmpFile("a.md"), "--json", "--no-open"], f.io);
    expect(JSON.parse(f.out[0]!)).toEqual({
      url: "https://docs.example.com/p/acme-proposal",
      link: "https://docs.example.com/p/acme-proposal",
      dashboardUrl: "https://docs.example.com/documents/d1",
      slug: "acme-proposal",
      title: "Acme proposal",
      status: "live",
      created: true,
      version: 1,
      opened: false,
    });
    expect(f.err).toEqual([]);
  });

  it("zips a folder that has an index.html", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vellum-site-"));
    await writeFile(path.join(dir, "index.html"), "<h1>Hi</h1>");
    const f = await fakeIo(() => ({ body: pushResult() }), { env: signedInEnv });
    await run(["upload", dir, "--no-open"], f.io);
    const sent = f.requests[0]!.form!.get("file") as File;
    expect(sent.name).toBe(`${path.basename(dir)}.zip`);
    expect(Object.keys(unzipSync(new Uint8Array(await sent.arrayBuffer())))).toEqual(["index.html"]);
    expect(f.err[0]).toMatch(/^Zipped the folder\./);
  });

  it("refuses a file type Vellum doesn't take, before calling the server", async () => {
    const f = await fakeIo(undefined, { env: signedInEnv });
    expect(await run(["upload", await tmpFile("photo.png", "x")], f.io)).toBe(1);
    expect(f.err[0]).toMatch(/Vellum takes Markdown \(\.md\), HTML/);
    expect(f.requests).toEqual([]);
  });

  it("explains the server's refusal, naming the flag", async () => {
    const f = await fakeIo(
      () => ({
        status: 409,
        body: { error: { message: "That link is taken by someone else’s document. Choose another slug.", fields: { slug: "Another account already uses this link." } } },
      }),
      { env: signedInEnv },
    );
    expect(await run(["upload", await tmpFile("a.md"), "--slug", "taken"], f.io)).toBe(1);
    expect(f.err[0]).toBe(
      "vellum: That link is taken by someone else’s document. Choose another slug.\n  --slug: Another account already uses this link.",
    );
    expect(f.out).toEqual([]);
    expect(f.opened).toEqual([]);
  });

  it("points to `vellum login` when the token is refused", async () => {
    const f = await fakeIo(() => ({ status: 401, body: { error: { message: "That API token isn’t valid." } } }), {
      env: signedInEnv,
    });
    expect(await run(["upload", await tmpFile("a.md")], f.io)).toBe(1);
    expect(f.err[0]).toMatch(/vellum login/);
  });

  it("explains an unreachable server", async () => {
    const f = await fakeIo(undefined, {
      env: signedInEnv,
      fetch: (async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: new Error("getaddrinfo ENOTFOUND docs.example.com") });
      }) as typeof fetch,
    });
    expect(await run(["upload", await tmpFile("a.md")], f.io)).toBe(1);
    expect(f.err[0]).toBe("vellum: Can’t reach Vellum at https://docs.example.com: getaddrinfo ENOTFOUND docs.example.com");
  });

  it("asks for login when there are no credentials", async () => {
    const f = await fakeIo();
    expect(await run(["upload", await tmpFile("a.md")], f.io)).toBe(1);
    expect(f.err[0]).toMatch(/Not signed in\. Run `vellum login`/);
  });

  it("treats wrong usage as exit code 2", async () => {
    const f = await fakeIo(undefined, { env: signedInEnv });
    expect(await run(["upload"], f.io)).toBe(2);
    expect(await run(["upload", "a.md", "--colour", "red"], f.io)).toBe(2);
    expect(await run(["upload", "a.md", "--expires", "tomorrow"], f.io)).toBe(2);
    expect(await run(["frobnicate"], f.io)).toBe(2);
    expect(f.requests).toEqual([]);
  });

  it("shows help", async () => {
    const f = await fakeIo();
    expect(await run(["upload", "--help"], f.io)).toBe(0);
    expect(f.out[0]).toMatch(/--slug <slug>/);
    expect(await run([], f.io)).toBe(0);
    expect(f.out[1]).toMatch(/vellum upload <file-or-folder>/);
  });
});

describe("vellum login", () => {
  it("checks the token, then saves the address and token for this user only", async () => {
    const f = await fakeIo((req) =>
      req.url.endsWith("/api/whoami")
        ? { body: { account: { email: "me@example.com", displayName: "Me" }, token: { name: "laptop" } } }
        : { status: 404 },
    );
    f.answers.push("docs.example.com/", " vlm_abc ");
    expect(await run(["login"], f.io)).toBe(0);
    expect(f.requests[0]!.url).toBe("https://docs.example.com/api/whoami");
    expect(f.requests[0]!.headers.get("authorization")).toBe("Bearer vlm_abc");
    expect(f.out).toEqual(["Signed in as Me <me@example.com> with the token “laptop”."]);

    const file = configPath(f.io);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ url: "https://docs.example.com", token: "vlm_abc" });
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    // Later commands use what was saved.
    await run(["whoami"], f.io);
    expect(f.requests[1]!.headers.get("authorization")).toBe("Bearer vlm_abc");
  });

  it("saves nothing when the token is refused", async () => {
    const f = await fakeIo(() => ({ status: 401, body: { error: { message: "That API token isn’t valid." } } }));
    expect(await run(["login", "--url", "https://docs.example.com", "--token", "vlm_bad"], f.io)).toBe(1);
    await expect(stat(configPath(f.io))).rejects.toThrow();
  });

  it("lets VELLUM_URL and VELLUM_TOKEN override the saved login", async () => {
    const f = await fakeIo(() => ({
      body: { account: { email: "me@example.com", displayName: "Me" }, token: { name: "ci" } },
    }));
    await run(["login", "--url", "https://saved.example.com", "--token", "vlm_saved"], f.io);
    f.io.env = { VELLUM_TOKEN: "vlm_env" };
    await run(["whoami"], f.io);
    expect(f.requests[1]!.url).toBe("https://saved.example.com/api/whoami");
    expect(f.requests[1]!.headers.get("authorization")).toBe("Bearer vlm_env");
  });
});

describe("vellum list and whoami", () => {
  const listBody = {
    documents: [
      { id: "d1", slug: "weekly-report", title: "Weekly", status: "live", kind: "markdown", updatedAt: "2026-11-01T10:00:00.000Z" },
      { id: "d2", slug: "pitch", title: "Pitch", status: "draft", kind: "html", updatedAt: "2026-10-01T10:00:00.000Z" },
    ],
  };

  it("lists documents with their status and slug", async () => {
    const f = await fakeIo(() => ({ body: listBody }), { env: signedInEnv });
    expect(await run(["list"], f.io)).toBe(0);
    expect(f.out).toEqual(["live        weekly-report  Weekly", "draft       pitch          Pitch"]);
  });

  it("lists links as JSON", async () => {
    const f = await fakeIo(() => ({ body: listBody }), { env: signedInEnv });
    await run(["list", "--json"], f.io);
    expect(JSON.parse(f.out[0]!)[0]).toEqual({
      slug: "weekly-report",
      title: "Weekly",
      status: "live",
      kind: "markdown",
      link: "https://docs.example.com/p/weekly-report",
      dashboardUrl: "https://docs.example.com/documents/d1",
      updatedAt: "2026-11-01T10:00:00.000Z",
    });
  });

  it("says who the token acts as", async () => {
    const f = await fakeIo(
      () => ({ body: { account: { email: "me@example.com", displayName: "Me" }, token: { name: "laptop" } } }),
      { env: signedInEnv },
    );
    await run(["whoami"], f.io);
    expect(f.out).toEqual(["Me <me@example.com> on https://docs.example.com, with the token “laptop”"]);
  });
});

describe("vellum install-skill", () => {
  it("copies the skill into $CLAUDE_CONFIG_DIR/skills", async () => {
    const f = await fakeIo();
    const claude = path.join(f.home, "claude-config");
    f.io.env = { CLAUDE_CONFIG_DIR: claude };
    expect(await run(["install-skill"], f.io)).toBe(0);
    const installed = await readFile(path.join(claude, "skills", "vellum", "SKILL.md"), "utf8");
    expect(installed).toMatch(/^---\nname: vellum\n/);
  });

  it("defaults to ~/.claude/skills, or --dir", async () => {
    const f = await fakeIo();
    await run(["install-skill"], f.io);
    await stat(path.join(f.home, ".claude", "skills", "vellum", "SKILL.md"));
    await run(["install-skill", "--dir", path.join(f.home, "elsewhere")], f.io);
    await stat(path.join(f.home, "elsewhere", "vellum", "SKILL.md"));
  });
});

describe("parseExpires", () => {
  const now = new Date(2026, 10, 1, 12, 0, 0);

  it("takes the presets", () => {
    expect(parseExpires("7d", now)).toEqual({ expiryPreset: "7d" });
    expect(parseExpires("30D", now)).toEqual({ expiryPreset: "30d" });
    expect(parseExpires("never", now)).toEqual({ expiryPreset: "never" });
  });

  it("closes a day at its end, local time", () => {
    expect(parseExpires("2026-12-01", now)).toEqual({
      expiryPreset: "date",
      expiresAt: new Date(2026, 11, 1, 23, 59, 59).toISOString(),
    });
  });

  it("takes a full timestamp", () => {
    expect(parseExpires("2026-12-01T09:30:00Z", now)).toEqual({ expiryPreset: "date", expiresAt: "2026-12-01T09:30:00.000Z" });
  });

  it("refuses the past, impossible days and anything else", () => {
    expect(() => parseExpires("2026-10-31", now)).toThrow(/in the past/);
    expect(() => parseExpires("2026-02-30", now)).toThrow(/takes 7d/);
    expect(() => parseExpires("next week", now)).toThrow(/takes 7d/);
  });
});

describe("pack", () => {
  it("zips a site folder with paths relative to it, leaving out junk and symlinks", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vellum-site-"));
    await mkdir(path.join(dir, "assets", "img"), { recursive: true });
    await mkdir(path.join(dir, ".git"));
    await mkdir(path.join(dir, "node_modules"));
    await writeFile(path.join(dir, "index.html"), "<h1>Hi</h1>");
    await writeFile(path.join(dir, "assets", "style.css"), "h1{}");
    await writeFile(path.join(dir, "assets", "img", "a.svg"), "<svg/>");
    await writeFile(path.join(dir, ".DS_Store"), "x");
    await writeFile(path.join(dir, ".git", "HEAD"), "x");
    await writeFile(path.join(dir, "node_modules", "x.js"), "x");
    await symlink("/etc/hosts", path.join(dir, "hosts"));

    const packed = await pack(dir);
    expect(packed.zipped).toBe(true);
    const entries = unzipSync(packed.data);
    expect(Object.keys(entries).sort()).toEqual(["assets/img/a.svg", "assets/style.css", "index.html"]);
    expect(new TextDecoder().decode(entries["index.html"])).toBe("<h1>Hi</h1>");
  });

  it("refuses a folder without an index.html at its top", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vellum-site-"));
    await mkdir(path.join(dir, "public"));
    await writeFile(path.join(dir, "public", "index.html"), "x");
    await expect(pack(dir)).rejects.toThrow(/no index.html at its top level/);
  });

  it("sends Markdown, HTML and zip files as they are", async () => {
    for (const name of ["a.md", "a.markdown", "a.html", "a.HTM", "a.zip"]) {
      const packed = await pack(await tmpFile(name, "content"));
      expect(packed).toMatchObject({ filename: name, zipped: false });
    }
  });

  it("says when the path doesn't exist", async () => {
    await expect(pack("/no/such/file.md")).rejects.toThrow(/no file or folder/);
  });
});

describe("normalizeUrl", () => {
  it("adds https and drops trailing slashes", () => {
    expect(normalizeUrl("docs.example.com/")).toBe("https://docs.example.com");
    expect(normalizeUrl("http://localhost:5180")).toBe("http://localhost:5180");
    expect(normalizeUrl("localhost:5180")).toBe("http://localhost:5180");
    expect(normalizeUrl("127.0.0.1:8000/")).toBe("http://127.0.0.1:8000");
    expect(normalizeUrl("localhost.example.com")).toBe("https://localhost.example.com");
    expect(normalizeUrl("https://example.com/vellum/")).toBe("https://example.com/vellum");
  });

  it("refuses other schemes", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow(/http or https/);
  });
});
