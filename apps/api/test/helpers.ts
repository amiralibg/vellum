import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, migrate, type Db } from "../src/db/index.js";
import { ensureOwner } from "../src/services/auth.js";

export const APP = "app.test";
export const ORIGIN = "http://app.test";
export const OWNER = { email: "owner@example.com", password: "correct horse battery" };

/** A fresh app over a clean database for each test. `env` overrides the test environment for this file. */
export function useTestApp(env: Record<string, string> = {}) {
  const ctx = {} as { app: ReturnType<typeof createApp>; db: Db; dataDir: string };

  beforeAll(async () => {
    ctx.dataDir = await mkdtemp(path.join(os.tmpdir(), "vellum-test-"));
    process.env.DATA_DIR = ctx.dataDir;
    const config = loadConfig({ ...process.env, ...env });
    ctx.db = createDb(config.databaseUrl);
    await migrate(ctx.db);
  });

  beforeEach(async () => {
    await ctx.db.query("TRUNCATE owner, sessions, documents, document_versions, daily_salts CASCADE");
    const config = loadConfig({ ...process.env, ...env });
    await ensureOwner(ctx.db, config);
    ctx.app = createApp({ config, db: ctx.db });
  });

  afterAll(async () => {
    await ctx.db.end();
    await rm(ctx.dataDir, { recursive: true, force: true });
  });

  return ctx;
}

/** Requests as a browser on APP_URL would send them. */
export function client(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const withHost = <T extends request.Test>(t: T) => t.set("Host", APP);
  return {
    agent,
    get: (url: string) => withHost(agent.get(url)),
    post: (url: string) => withHost(agent.post(url)).set("Origin", ORIGIN),
    patch: (url: string) => withHost(agent.patch(url)).set("Origin", ORIGIN),
    delete: (url: string) => withHost(agent.delete(url)).set("Origin", ORIGIN),
  };
}

export async function signedIn(app: ReturnType<typeof createApp>) {
  const c = client(app);
  await c.post("/api/auth/login").send(OWNER).expect(200);
  return c;
}

export async function uploadMarkdown(
  c: ReturnType<typeof client>,
  source: string,
  filename = "proposal.md",
): Promise<{ id: string; slug: string }> {
  const res = await c.post("/api/documents").attach("file", Buffer.from(source), filename).expect(201);
  return res.body as { id: string; slug: string };
}

export async function publishMarkdown(
  c: ReturnType<typeof client>,
  source: string,
  settings: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const doc = await uploadMarkdown(c, source);
  if (Object.keys(settings).length) await c.patch(`/api/documents/${doc.id}`).send(settings).expect(200);
  await c.post(`/api/documents/${doc.id}/publish`).expect(200);
  return doc;
}

/** The `name=value` pair of a Set-Cookie header, plus its attributes. */
export function setCookie(res: request.Response, name: string): string | undefined {
  const all = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return all.find((c) => c.startsWith(`${name}=`));
}
