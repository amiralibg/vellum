import type { ApiError, DocumentListResponse, PushResult, WhoAmI } from "@vellum/shared";
import type { Credentials } from "./config.js";
import { CliError } from "./errors.js";

/** The fields `vellum upload` sends next to the file. */
export interface PushOptions {
  slug?: string;
  title?: string;
  password?: string;
  expiryPreset?: string;
  expiresAt?: string;
  draft?: boolean;
}

/** Vellum's API, as an API token sees it. */
export class Client {
  constructor(
    private readonly credentials: Credentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  whoami(): Promise<WhoAmI> {
    return this.request<WhoAmI>("GET", "/api/whoami");
  }

  list(): Promise<DocumentListResponse> {
    return this.request<DocumentListResponse>("GET", "/api/documents");
  }

  push(file: { filename: string; data: Uint8Array }, options: PushOptions): Promise<PushResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined || value === false) continue;
      form.append(key, String(value));
    }
    form.append("file", new Blob([file.data as Uint8Array<ArrayBuffer>]), file.filename);
    return this.request<PushResult>("POST", "/api/push", form);
  }

  private async request<T>(method: string, pathname: string, body?: FormData): Promise<T> {
    const url = this.credentials.url + pathname;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        body,
        headers: { Authorization: `Bearer ${this.credentials.token}`, Accept: "application/json" },
        redirect: "error",
      });
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message;
      throw new CliError(`Can’t reach Vellum at ${this.credentials.url}: ${cause.trim()}`);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (res.ok && json !== undefined) return json as T;
    if (res.ok) throw new CliError(`${this.credentials.url} answered, but not like Vellum does. Check the address.`);
    throw new CliError(describeFailure(res.status, (json as ApiError | undefined)?.error));
  }
}

function describeFailure(status: number, error: ApiError["error"] | undefined): string {
  if (status === 401) {
    return `${error?.message ?? "That API token isn’t valid."} Run \`vellum login\` with a new token.`;
  }
  if (!error) return `Vellum answered ${status}. Check the address, or try again.`;
  const details = Object.entries(error.fields ?? {})
    .filter(([, message]) => message !== error.message)
    .map(([field, message]) => `  ${flagFor(field)}: ${message}`);
  return [error.message, ...details].join("\n");
}

/** The API's field names, as the flags that set them. */
const flagFor = (field: string) =>
  ({ expiresAt: "--expires", expiryPreset: "--expires", slug: "--slug", title: "--title", password: "--password" })[
    field
  ] ?? field;
