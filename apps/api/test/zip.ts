import yazl from "yazl";

export interface ZipEntry {
  name: string;
  data?: string | Buffer;
  /** Unix mode bits, e.g. 0o120777 for a symlink. */
  mode?: number;
  /** Store uncompressed (deflate off). */
  store?: boolean;
}

/** Builds a zip in memory, the way a desktop zip tool would. */
export function makeZip(entries: ZipEntry[]): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const e of entries) {
    if (e.name.endsWith("/")) zip.addEmptyDirectory(e.name);
    else
      zip.addBuffer(Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? ""), e.name, {
        mode: e.mode,
        compress: !e.store,
      });
  }
  zip.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

/**
 * yazl refuses unsafe names, as it should. To build a hostile zip, write a same-length
 * placeholder name and patch the bytes in both the local header and the central directory.
 */
export async function makeZipWithRawName(placeholder: string, raw: string, entries: ZipEntry[] = []): Promise<Buffer> {
  if (placeholder.length !== raw.length) throw new Error("names must be the same length");
  const zip = await makeZip([...entries, { name: placeholder, data: "<p>pwned</p>" }]);
  const from = Buffer.from(placeholder);
  const to = Buffer.from(raw);
  let at = zip.indexOf(from);
  while (at !== -1) {
    to.copy(zip, at);
    at = zip.indexOf(from, at + to.length);
  }
  return zip;
}
