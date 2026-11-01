import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { Client, type PushOptions } from "./client.js";
import { loadCredentials, normalizeUrl, saveCredentials, type ConfigEnv } from "./config.js";
import { CliError } from "./errors.js";
import { parseExpires } from "./expires.js";
import { pack } from "./pack.js";

export const VERSION = "0.1.0";

/** Everything the CLI touches outside itself, so tests can stand in for it. */
export interface Io extends ConfigEnv {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  prompt: (question: string, options?: { hidden?: boolean }) => Promise<string>;
  open: (url: string) => Promise<void>;
  fetch: typeof fetch;
  /** The bundled SKILL.md. */
  skillFile: string;
}

const HELP = `vellum: upload to your Vellum account and get a link

Usage
  vellum upload <file-or-folder> [options]   Publish a document and print its link
  vellum list [--json]                       Your documents and their links
  vellum whoami [--json]                     Which account and token the CLI uses
  vellum login [--url <url>] [--token <t>]   Save your Vellum address and API token
  vellum install-skill [--dir <dir>]         Teach Claude Code agents to use this CLI

Run \`vellum upload --help\` for upload's options.
Make a token in Vellum → Settings → API tokens. VELLUM_URL and VELLUM_TOKEN override \`vellum login\`.`;

const UPLOAD_HELP = `vellum upload <file-or-folder> [options]

Uploads Markdown (.md), HTML (.html), a .zip with an index.html, or a folder with an index.html
(zipped for you). It goes live, the link is printed on stdout and opened in your browser.

Options
  --slug <slug>        The link's name: /p/<slug>. If you already have a document there, the file
                       becomes its new version and the link stays the same. A slug another account
                       uses is refused.
  --title <title>      The document's title. A new document's slug comes from it.
  --password <pw>      Readers need this password (at least 4 characters).
  --expires <when>     7d, 30d, never, or a date like 2026-12-01 (closes at the end of that day).
  --draft              Don't publish: a new document stays a draft, an existing one keeps its status.
                       Prints and opens the document's dashboard page instead of the link.
  --dashboard          Print and open the dashboard page instead of the link.
  --no-open            Don't open the browser.
  --json               Print the result as JSON.

Without --slug every upload is a new document. --title, --password and --expires change an existing
document only when given.`;

export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const [command, ...rest] = argv;
    switch (command) {
      case "upload":
      case "push":
        return await upload(rest, io);
      case "list":
      case "ls":
        return await list(rest, io);
      case "whoami":
        return await whoami(rest, io);
      case "login":
        return await login(rest, io);
      case "install-skill":
        return await installSkill(rest, io);
      case "--version":
      case "-v":
        io.stdout(VERSION);
        return 0;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(HELP);
        return 0;
      default:
        throw new CliError(`Unknown command “${command}”.\n\n${HELP}`, 2);
    }
  } catch (err) {
    if (err instanceof CliError) {
      io.stderr(`vellum: ${err.message}`);
      return err.code;
    }
    io.stderr(`vellum: ${(err as Error).message}`);
    return 1;
  }
}

function parse<O extends NonNullable<ParseArgsConfig["options"]>>(args: string[], options: O, allowPositionals = false) {
  try {
    return parseArgs({ args, options: { ...options, help: { type: "boolean", short: "h" } }, allowPositionals, strict: true });
  } catch (err) {
    throw new CliError((err as Error).message.replace(/\. To specify a positional.*$/s, "."), 2);
  }
}

async function upload(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    args,
    {
      slug: { type: "string" },
      title: { type: "string" },
      password: { type: "string" },
      expires: { type: "string" },
      draft: { type: "boolean" },
      dashboard: { type: "boolean" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" },
    },
    true,
  );
  if (values.help) {
    io.stdout(UPLOAD_HELP);
    return 0;
  }
  if (positionals.length !== 1) {
    throw new CliError(`Give one file or folder to upload.\n\n${UPLOAD_HELP}`, 2);
  }

  const options: PushOptions = {
    slug: values.slug?.trim().toLowerCase(),
    title: values.title,
    password: values.password,
    draft: values.draft,
    ...(values.expires !== undefined ? parseExpires(values.expires) : {}),
  };
  const credentials = await loadCredentials(io);
  const file = await pack(positionals[0]!);
  const result = await new Client(credentials, io.fetch).push(file, options);
  const doc = result.document;

  // A draft's or an unpublished document's link answers "not found", so its dashboard page is the useful one.
  const target = values.dashboard || doc.status !== "live" ? result.dashboardUrl : doc.url;
  let opened = false;
  if (!values["no-open"]) {
    try {
      await io.open(target);
      opened = true;
    } catch (err) {
      io.stderr(`vellum: couldn’t open a browser (${(err as Error).message}). The link is below.`);
    }
  }

  if (values.json) {
    io.stdout(
      JSON.stringify(
        {
          url: target,
          link: doc.url,
          dashboardUrl: result.dashboardUrl,
          slug: doc.slug,
          title: doc.title,
          status: doc.status,
          created: result.created,
          version: doc.version.number,
          opened,
        },
        null,
        2,
      ),
    );
  } else {
    io.stderr(summary(result.created, doc.slug, doc.status, doc.version.number, file.zipped));
    io.stdout(target);
  }
  return 0;
}

function summary(created: boolean, slug: string, status: string, version: number, zipped: boolean): string {
  const what = created ? `“${slug}”` : `version ${version} of “${slug}”`;
  const state =
    status === "live" ? "is live" : status === "draft" ? "is a draft" : "is uploaded; the document stays unpublished";
  return `${zipped ? "Zipped the folder. " : ""}${what[0]!.toUpperCase()}${what.slice(1)} ${state}.`;
}

async function list(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, { json: { type: "boolean" } });
  if (values.help) {
    io.stdout("vellum list [--json]\n\nYour documents, newest change first: status, slug, title and link.");
    return 0;
  }
  const credentials = await loadCredentials(io);
  const { documents } = await new Client(credentials, io.fetch).list();
  const rows = documents.map((d) => ({
    slug: d.slug,
    title: d.title,
    status: d.status,
    kind: d.kind,
    link: `${credentials.url}/p/${d.slug}`,
    dashboardUrl: `${credentials.url}/documents/${d.id}`,
    updatedAt: d.updatedAt,
  }));
  if (values.json) {
    io.stdout(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (!rows.length) {
    io.stderr("No documents yet. `vellum upload <file>` makes one.");
    return 0;
  }
  const width = Math.max(...rows.map((r) => r.slug.length));
  for (const r of rows) io.stdout(`${r.status.padEnd(11)} ${r.slug.padEnd(width)}  ${r.title}`);
  return 0;
}

async function whoami(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, { json: { type: "boolean" } });
  if (values.help) {
    io.stdout("vellum whoami [--json]\n\nChecks the token and shows the account it acts as.");
    return 0;
  }
  const credentials = await loadCredentials(io);
  const me = await new Client(credentials, io.fetch).whoami();
  if (values.json) io.stdout(JSON.stringify({ url: credentials.url, ...me }, null, 2));
  else io.stdout(`${me.account.displayName} <${me.account.email}> on ${credentials.url}, with the token “${me.token.name}”`);
  return 0;
}

async function login(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, { url: { type: "string" }, token: { type: "string" } });
  if (values.help) {
    io.stdout(
      "vellum login [--url <url>] [--token <token>]\n\nAsks for what's missing, checks the token, and saves both to " +
        "~/.config/vellum/config.json (readable by you only).",
    );
    return 0;
  }
  const url = normalizeUrl(values.url ?? (await io.prompt("Vellum address (like https://docs.example.com): ")));
  const token = (values.token ?? (await io.prompt("API token (Settings → API tokens): ", { hidden: true }))).trim();
  if (!token) throw new CliError("No token given.", 2);
  const me = await new Client({ url, token }, io.fetch).whoami();
  const file = await saveCredentials(io, { url, token });
  io.stdout(`Signed in as ${me.account.displayName} <${me.account.email}> with the token “${me.token.name}”.`);
  io.stderr(`Saved to ${file}`);
  return 0;
}

async function installSkill(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, { dir: { type: "string" } });
  if (values.help) {
    io.stdout(
      "vellum install-skill [--dir <skills-dir>]\n\nCopies the vellum skill to <skills-dir>/vellum/SKILL.md. " +
        "The default is $CLAUDE_CONFIG_DIR/skills, else ~/.claude/skills.",
    );
    return 0;
  }
  const dir = values.dir ?? path.join(io.env.CLAUDE_CONFIG_DIR || path.join(io.home, ".claude"), "skills");
  const dest = path.join(dir, "vellum", "SKILL.md");
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(io.skillFile, dest);
  io.stdout(`Installed the vellum skill at ${dest}`);
  return 0;
}
