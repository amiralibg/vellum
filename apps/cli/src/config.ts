import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.js";

/** Where the CLI talks to and as whom. */
export interface Credentials {
  url: string;
  token: string;
}

export interface ConfigEnv {
  env: NodeJS.ProcessEnv;
  home: string;
}

/** `$XDG_CONFIG_HOME/vellum/config.json`, else `~/.config/vellum/config.json`. */
export function configPath({ env, home }: ConfigEnv): string {
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "vellum", "config.json");
}

async function readSaved(where: ConfigEnv): Promise<Partial<Credentials>> {
  try {
    const saved = JSON.parse(await readFile(configPath(where), "utf8")) as Partial<Credentials>;
    return { url: saved.url, token: saved.token };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new CliError(`Can’t read ${configPath(where)}: ${(err as Error).message}`);
  }
}

/** VELLUM_URL and VELLUM_TOKEN win over what `vellum login` saved. */
export async function loadCredentials(where: ConfigEnv): Promise<Credentials> {
  const saved = await readSaved(where);
  const url = where.env.VELLUM_URL || saved.url;
  const token = where.env.VELLUM_TOKEN || saved.token;
  if (!url || !token) {
    throw new CliError(
      "Not signed in. Run `vellum login`, or set VELLUM_URL and VELLUM_TOKEN (make a token in Vellum → Settings → API tokens).",
    );
  }
  return { url: normalizeUrl(url), token };
}

/** Readable by this user only: the file holds a token. */
export async function saveCredentials(where: ConfigEnv, credentials: Credentials): Promise<string> {
  const file = configPath(where);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  return file;
}

/** "docs.example.com/" → "https://docs.example.com"; a bare localhost gets http. */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(raw);
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `${local ? "http" : "https"}://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CliError(`“${input}” isn’t a URL. Use your Vellum address, like https://docs.example.com.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CliError(`Use an http or https address for Vellum, not ${url.protocol}`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}
