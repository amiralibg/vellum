import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { Element, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";
import yauzl from "yauzl";
import { HttpError } from "../errors.js";

/**
 * Uploaded HTML sites: a single .html file, or a .zip with index.html at its root.
 * They're unpacked to DATA_DIR/documents/<id>/v<n>/site/ and only ever served from the
 * usercontent origin (see routes/usercontent.ts).
 */

export const ENTRY = "index.html";

/** The only file types a site may contain, and the Content-Type each is served with. */
export const SITE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};

export const siteType = (file: string): string | undefined => SITE_TYPES[path.extname(file).toLowerCase()];

export interface ZipLimits {
  maxUnzippedBytes: number;
  maxFiles: number;
}

/** A file that inflates past this ratio is a bomb, not a website. Small files are left alone. */
const MAX_RATIO = 100;
const RATIO_MIN_BYTES = 1024 * 1024;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Zip tools add these; they aren't part of the site. */
const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

const unsafe = (message: string) => new HttpError(400, message);

/**
 * Checks one entry name. yauzl already refuses `..`, absolute paths and backslashes while
 * decoding; this is the second layer, and it also refuses names that would collide or hide.
 */
export function safeEntryPath(name: string): string {
  const parts = name.split("/");
  const bad = parts.some((p, i) => p === ".." || p === "." || (p === "" && i !== parts.length - 1));
  if (bad || name.startsWith("/") || /^[a-z]:/i.test(name) || name.includes("\\") || /[\u0000-\u001f]/.test(name)) {
    throw unsafe(`The zip has a file outside its own folder (${name}). Vellum won’t unpack it.`);
  }
  return name;
}

interface PlannedEntry {
  entry: yauzl.Entry;
  target: string; // path relative to the site root
}

/**
 * Unpacks `zip` into `siteDir` after checking every entry against the limits. Nothing is
 * written until the whole central directory has passed, and inflated bytes are counted again
 * while writing, so a zip that lies about its sizes is caught too.
 */
export async function extractZip(zip: Buffer, siteDir: string, limits: ZipLimits): Promise<void> {
  let zipfile: yauzl.ZipFile;
  try {
    zipfile = await yauzl.fromBufferPromise(zip, { lazyEntries: true, validateEntrySizes: true });
  } catch {
    throw unsafe("That file isn’t a zip Vellum can read. Zip the folder again and upload it.");
  }

  let entries: yauzl.Entry[];
  try {
    entries = await readAll(zipfile);
  } catch (err) {
    zipfile.close();
    const message = (err as Error).message;
    if (/relative path|absolute path|invalid characters/.test(message)) {
      throw unsafe("The zip has a file outside its own folder. Vellum won’t unpack it.");
    }
    throw unsafe("That file isn’t a zip Vellum can read. Zip the folder again and upload it.");
  }

  const plan = planEntries(entries, limits);
  try {
    let written = 0;
    for (const { entry, target } of plan) {
      const dest = path.join(siteDir, target);
      if (!dest.startsWith(siteDir + path.sep)) throw unsafe(`The zip has a file outside its own folder (${target}).`);
      await mkdir(path.dirname(dest), { recursive: true });
      const stream = await zipfile.openReadStreamPromise(entry);
      let entryBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          entryBytes += chunk.length;
          written += chunk.length;
          if (entryBytes > entry.uncompressedSize || written > limits.maxUnzippedBytes) {
            done(unsafe("The zip unpacks to more than it says. Vellum won’t unpack it."));
          } else done(null, chunk);
        },
      });
      await pipeline(stream, meter, createWriteStream(dest, { flags: "wx" }));
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw unsafe("That zip is damaged. Zip the folder again and upload it.");
  } finally {
    zipfile.close();
  }
}

function readAll(zipfile: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zipfile.on("entry", (e: yauzl.Entry) => {
      entries.push(e);
      zipfile.readEntry();
    });
    zipfile.on("end", () => resolve(entries));
    zipfile.on("error", reject);
    zipfile.readEntry();
  });
}

function planEntries(entries: yauzl.Entry[], limits: ZipLimits): PlannedEntry[] {
  const files: PlannedEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    const name = safeEntryPath(entry.fileName);
    const mode = (entry.externalFileAttributes >>> 16) & S_IFMT;
    if (mode === S_IFLNK) throw unsafe(`The zip has a symbolic link (${name}). Replace it with the real file.`);
    if (name.endsWith("/") || IGNORED.some((re) => re.test(name))) continue;
    if (!siteType(name)) {
      throw new HttpError(
        415,
        `The zip has a file type Vellum doesn’t serve (${name}). Remove it and upload again.`,
      );
    }
    if (files.length >= limits.maxFiles) {
      throw unsafe(`The zip has more than ${limits.maxFiles} files.`);
    }
    if (entry.uncompressedSize >= RATIO_MIN_BYTES && entry.uncompressedSize > entry.compressedSize * MAX_RATIO) {
      throw unsafe(`${name} unpacks to more than ${MAX_RATIO} times its size. Vellum won’t unpack it.`);
    }
    total += entry.uncompressedSize;
    if (total > limits.maxUnzippedBytes) {
      throw new HttpError(
        413,
        `The zip unpacks to more than ${Math.round(limits.maxUnzippedBytes / 1024 / 1024)} MB.`,
      );
    }
    files.push({ entry, target: name });
  }
  return withRootEntry(files);
}

/**
 * index.html must be at the root. Zipping a folder (instead of its contents) puts everything
 * one level down, so a single top-level folder that holds index.html is unwrapped.
 */
function withRootEntry(files: PlannedEntry[]): PlannedEntry[] {
  if (files.some((f) => f.target === ENTRY)) return files;
  const tops = new Set(files.map((f) => f.target.split("/")[0]));
  const [top] = tops;
  if (tops.size === 1 && top && files.some((f) => f.target === `${top}/${ENTRY}`)) {
    return files.map((f) => ({ ...f, target: f.target.slice(top.length + 1) }));
  }
  throw unsafe("The zip needs an index.html at the top level. Vellum opens that file first.");
}

export async function writeSingleHtml(html: Buffer, siteDir: string): Promise<void> {
  await mkdir(siteDir, { recursive: true });
  await writeFile(path.join(siteDir, ENTRY), html);
}

export interface SiteMeta {
  title: string;
  description: string;
}

/** <title> and <meta name="description"> from the site's index.html. */
export async function readSiteMeta(siteDir: string): Promise<SiteMeta> {
  const source = await readFile(path.join(siteDir, ENTRY), "utf8");
  const tree: Root = fromHtml(source);
  let title = "";
  let description = "";
  let ogDescription = "";
  visit(tree, "element", (node: Element) => {
    if (node.tagName === "title" && !title) title = toString(node);
    if (node.tagName === "meta") {
      const name = String(node.properties.name ?? node.properties.property ?? "").toLowerCase();
      const content = String(node.properties.content ?? "");
      if (name === "description" && !description) description = content;
      if (name === "og:description" && !ogDescription) ogDescription = content;
    }
  });
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  return { title: clean(title).slice(0, 200), description: clean(description || ogDescription).slice(0, 500) };
}
