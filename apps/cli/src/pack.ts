import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { CliError } from "./errors.js";

/** What Vellum takes: Markdown, a single HTML page, or a zip with an index.html. */
const ACCEPTED = new Set([".md", ".markdown", ".html", ".htm", ".zip"]);

/** Left out when zipping a folder. */
const SKIPPED = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db"]);

export interface Packed {
  filename: string;
  data: Uint8Array;
  /** True when a folder was zipped on the way. */
  zipped: boolean;
}

/** Reads a file to upload as it is, or zips a site folder that has an index.html at its root. */
export async function pack(target: string): Promise<Packed> {
  let info;
  try {
    info = await stat(target);
  } catch {
    throw new CliError(`There’s no file or folder at ${target}.`);
  }

  if (info.isDirectory()) {
    const files = await listFiles(target);
    if (!files.includes("index.html")) {
      throw new CliError(`${target} has no index.html at its top level. A folder is uploaded as a site, so it needs one.`);
    }
    const tree: Zippable = {};
    for (const rel of files) tree[rel] = await readFile(path.join(target, rel));
    const name = path.basename(path.resolve(target)) || "site";
    return { filename: `${name}.zip`, data: zipSync(tree, { level: 6 }), zipped: true };
  }

  const ext = path.extname(target).toLowerCase();
  if (!ACCEPTED.has(ext)) {
    throw new CliError(
      `Vellum takes Markdown (.md), HTML (.html), a .zip with an index.html, or a folder with an index.html. ${path.basename(target)} is none of those.`,
    );
  }
  return { filename: path.basename(target), data: await readFile(target), zipped: false };
}

/** Every regular file under `dir`, as forward-slash paths relative to it. Symlinks are skipped. */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}
