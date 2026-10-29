import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Files live at DATA_DIR/documents/<id>/v<n>/. Postgres holds the metadata. */
export class Storage {
  constructor(private readonly dataDir: string) {}

  versionDir(documentId: string, version: number): string {
    return path.join(this.dataDir, "documents", documentId, `v${version}`);
  }

  /** Unpacked HTML site of one version. Only the usercontent origin serves from here. */
  siteDir(documentId: string, version: number): string {
    return path.join(this.versionDir(documentId, version), "site");
  }

  originalPath(documentId: string, version: number, ext: string): string {
    return path.join(this.versionDir(documentId, version), `original.${ext}`);
  }

  async writeOriginal(documentId: string, version: number, ext: string, data: Buffer): Promise<void> {
    await mkdir(this.versionDir(documentId, version), { recursive: true });
    await writeFile(this.originalPath(documentId, version, ext), data);
  }

  /** Bytes on disk for one version: the original and, for HTML, the unpacked site. What storage limits count. */
  async versionBytes(documentId: string, version: number): Promise<number> {
    const dir = this.versionDir(documentId, version);
    const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const e of entries) {
      if (e.isFile()) total += (await lstat(path.join(e.parentPath, e.name))).size;
    }
    return total;
  }

  async removeVersion(documentId: string, version: number): Promise<void> {
    await rm(this.versionDir(documentId, version), { recursive: true, force: true });
  }

  async removeDocument(documentId: string): Promise<void> {
    await rm(path.join(this.dataDir, "documents", documentId), { recursive: true, force: true });
  }
}
