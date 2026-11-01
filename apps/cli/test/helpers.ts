import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Io } from "../src/cli.js";

export interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  form?: FormData;
}

/** An Io whose output, prompts, browser and network are all in memory. */
export async function fakeIo(
  respond: (req: Recorded) => { status?: number; body?: unknown } = () => ({ body: {} }),
  overrides: Partial<Io> = {},
) {
  const home = await mkdtemp(path.join(os.tmpdir(), "vellum-cli-"));
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const requests: Recorded[] = [];
  const answers: string[] = [];
  const io: Io = {
    env: {},
    home,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    prompt: async () => answers.shift() ?? "",
    open: async (url) => {
      opened.push(url);
    },
    fetch: (async (input: string | URL, init?: RequestInit) => {
      const req: Recorded = {
        method: init?.method ?? "GET",
        url: String(input),
        headers: new Headers(init?.headers),
        form: init?.body instanceof FormData ? init.body : undefined,
      };
      requests.push(req);
      const { status = 200, body } = respond(req);
      return new Response(body === undefined ? "" : JSON.stringify(body), { status });
    }) as typeof fetch,
    skillFile: fileURLToPath(new URL("../skill/SKILL.md", import.meta.url)),
    ...overrides,
  };
  return { io, home, out, err, opened, requests, answers };
}

export const signedInEnv = { VELLUM_URL: "https://docs.example.com", VELLUM_TOKEN: "vlm_test" };

/** A PushResult, as the API sends it. */
export function pushResult(overrides: { created?: boolean; status?: string; slug?: string; number?: number } = {}) {
  const slug = overrides.slug ?? "acme-proposal";
  return {
    created: overrides.created ?? true,
    dashboardUrl: "https://docs.example.com/documents/d1",
    document: {
      id: "d1",
      slug,
      title: "Acme proposal",
      status: overrides.status ?? "live",
      url: `https://docs.example.com/p/${slug}`,
      version: { number: overrides.number ?? 1 },
    },
  };
}
