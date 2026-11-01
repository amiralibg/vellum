// End to end: the `vellum` CLI against the real API over HTTP, signed in with an API token.
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run, type Io } from "../../cli/src/cli.js";
import { OWNER, useTestApp } from "./helpers.js";

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const port = await freePort();
const ORIGIN = `http://127.0.0.1:${port}`;
const t = useTestApp({ APP_URL: ORIGIN, USERCONTENT_URL: `http://localhost:${port}` });

let server: Server;
beforeAll(async () => {
  server = createServer((req, res) => t.app(req, res));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

let token: string;
let session: request.Agent;
beforeEach(async () => {
  session = request.agent(ORIGIN);
  await session.post("/api/auth/login").set("Origin", ORIGIN).send(OWNER).expect(200);
  const res = await session.post("/api/settings/tokens").set("Origin", ORIGIN).send({ name: "e2e-agent" }).expect(201);
  token = res.body.token as string;
});

async function cli(args: string[]) {
  const home = await mkdtemp(path.join(os.tmpdir(), "vellum-e2e-"));
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const io: Io = {
    env: { VELLUM_URL: ORIGIN, VELLUM_TOKEN: token },
    home,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    prompt: async () => "",
    open: async (url) => {
      opened.push(url);
    },
    fetch,
    skillFile: "",
  };
  const code = await run(args, io);
  return { code, out, err, opened };
}

async function file(name: string, content: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vellum-e2e-file-"));
  await writeFile(path.join(dir, name), content);
  return path.join(dir, name);
}

describe("vellum CLI against the API", () => {
  it("publishes a Markdown file, prints its link and opens it, and the link serves it", async () => {
    const r = await cli(["upload", await file("notes.md", "# Launch notes\n\nShip it on Friday.")]);
    expect(r).toMatchObject({ code: 0, out: [`${ORIGIN}/p/launch-notes`], opened: [`${ORIGIN}/p/launch-notes`] });
    const page = await request(ORIGIN).get("/p/launch-notes").expect(200);
    expect(page.text).toContain("Ship it on Friday.");
  });

  it("updates the same link with --slug, and the dashboard shows which token uploaded it", async () => {
    const first = await cli(["upload", await file("a.md", "# Weekly\n\nWeek one."), "--slug", "weekly", "--no-open"]);
    expect(first.out).toEqual([`${ORIGIN}/p/weekly`]);
    const second = await cli(["upload", await file("b.md", "# Weekly\n\nWeek two."), "--slug", "weekly", "--no-open"]);
    expect(second.code).toBe(0);
    expect(second.err).toEqual(["Version 2 of “weekly” is live."]);
    expect((await request(ORIGIN).get("/p/weekly").expect(200)).text).toContain("Week two.");

    const list = await session.get("/api/documents").expect(200);
    const versions = await session.get(`/api/documents/${list.body.documents[0].id}/versions`).expect(200);
    expect(versions.body.map((v: { uploadedVia: string }) => v.uploadedVia)).toEqual(["e2e-agent", "e2e-agent"]);
  });

  it("publishes a site folder behind a password", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vellum-e2e-site-"));
    await mkdir(path.join(dir, "css"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Deck</title><h1>Deck</h1>");
    await writeFile(path.join(dir, "css", "site.css"), "h1{color:red}");
    const r = await cli(["upload", dir, "--slug", "deck", "--password", "hunter22", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out[0]!)).toMatchObject({ link: `${ORIGIN}/p/deck`, status: "live", created: true, opened: true });
    await request(ORIGIN).get("/p/deck").expect(401);
    const doc = await session.get("/api/documents").expect(200);
    expect(doc.body.documents[0]).toMatchObject({ slug: "deck", kind: "html", access: "password" });
  });

  it("keeps a --draft upload off its link and opens the dashboard page instead", async () => {
    const r = await cli(["upload", await file("d.md", "# Draft idea"), "--draft"]);
    expect(r.code).toBe(0);
    expect(r.out[0]).toMatch(new RegExp(`^${ORIGIN}/documents/[0-9a-f-]{36}$`));
    expect(r.opened).toEqual(r.out);
    await request(ORIGIN).get("/p/draft-idea").expect(404);
  });

  it("lists documents and says who it acts as", async () => {
    await cli(["upload", await file("x.md", "# Listed"), "--no-open"]);
    const list = await cli(["list"]);
    expect(list.out).toEqual(["live        listed  Listed"]);
    const who = await cli(["whoami"]);
    expect(who.out).toEqual([`Amirali <owner@example.com> on ${ORIGIN}, with the token “e2e-agent”`]);
  });

  it("fails clearly once the token is revoked", async () => {
    const tokens = await session.get("/api/settings/tokens").expect(200);
    await session.delete(`/api/settings/tokens/${tokens.body.tokens[0].id}`).set("Origin", ORIGIN).expect(204);
    const r = await cli(["upload", await file("x.md", "# Nope")]);
    expect(r.code).toBe(1);
    expect(r.err[0]).toMatch(/API token isn’t valid.*vellum login/);
  });
});
