import { randomUUID } from "node:crypto";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import {
  DOCUMENT_PASSWORD_MIN,
  type Access,
  type DocumentDetail,
  type DocumentKind,
  type DocumentPreview,
  type DocumentListResponse,
  type DocumentSettingsPatch,
  type DocumentStatus,
  type DocumentSummary,
  type ExpiryPreset,
  type Heading,
  type VersionListItem,
  type VersionSummary,
} from "@vellum/shared";
import type pg from "pg";
import type { Config } from "../config.js";
import { transaction, type Db } from "../db/index.js";
import { badRequest, conflict, HttpError, notFound } from "../errors.js";
import { renderMarkdown, type RenderedMarkdown } from "./markdown.js";
import { Encryptor } from "./secrets.js";
import { ENTRY, extractZip, readSiteMeta, writeSingleHtml } from "./site.js";
import { isSlugTaken, isValidSlug, uniqueSlug } from "./slug.js";
import type { Storage } from "./storage.js";
import { assertWithinLimits } from "./users.js";

export interface UploadedFile {
  originalName: string;
  buffer: Buffer;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  slug: string;
  kind: DocumentKind;
  status: DocumentStatus;
  title: string;
  description: string;
  eyebrow: string;
  access: Access;
  password_hash: string | null;
  password_enc: string | null;
  password_rev: number;
  expires_at: Date | null;
  expiry_preset: ExpiryPreset;
  allow_download: boolean;
  noindex: boolean;
  track_views: boolean;
  reply_email: string;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

export interface VersionRow {
  id: string;
  number: number;
  original_name: string;
  source_type: VersionSummary["sourceType"];
  size_bytes: number;
  word_count: number;
  reading_minutes: number;
  headings: Heading[];
  rendered_html: string | null;
  entry_path: string | null;
  created_at: Date;
}

/** What the reader page needs to render a live document. */
export interface PublicDocument {
  document: DocumentRow;
  version: VersionRow;
  /** Who shared it: "Shared by …" and the note by the Reply button. */
  author: { name: string; replyNote: string };
}

export type ListFilter = "all" | "live" | "drafts" | "expired";

const DAY_MS = 86_400_000;
const PRESET_DAYS: Partial<Record<ExpiryPreset, number>> = { "7d": 7, "30d": 30 };

export const isExpired = (d: Pick<DocumentRow, "expires_at">, now = new Date()) =>
  d.expires_at !== null && d.expires_at.getTime() <= now.getTime();

export class DocumentService {
  private readonly encryptor: Encryptor;

  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
    private readonly config: Config,
  ) {
    this.encryptor = new Encryptor(config.encryptionKey);
  }

  async createFromUpload(userId: string, file: UploadedFile): Promise<DocumentDetail> {
    const type = uploadType(file.originalName);
    // Refuses early, before unpacking anything; checked again below with the size on disk.
    await assertWithinLimits(this.db, this.config, userId, { documents: 1, bytes: file.buffer.length });
    const documentId = randomUUID();
    const versionId = randomUUID();
    try {
      const v = await this.ingest(documentId, 1, file, type);
      const storedBytes = await this.storage.versionBytes(documentId, 1);
      const title = v.title || titleFromFilename(file.originalName);
      await transaction(this.db, async (client) => {
        await assertWithinLimits(client, this.config, userId, { documents: 1, bytes: storedBytes }, { lock: true });
        const slug = await uniqueSlug(this.db, title);
        await client.query(
          `INSERT INTO documents (id, user_id, slug, kind, title, description, eyebrow, current_version_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [documentId, userId, slug, type.kind, title, v.description, v.eyebrow, versionId],
        );
        await insertVersion(client, documentId, versionId, 1, file, v, storedBytes);
      });
    } catch (err) {
      await this.storage.removeDocument(documentId);
      throw err;
    }
    return this.get(userId, documentId);
  }

  /** A new file under the same link: slug and settings stay, the new version goes live. */
  async addVersion(userId: string, id: string, file: UploadedFile): Promise<DocumentDetail> {
    const doc = await this.row(userId, id);
    const type = uploadType(file.originalName);
    if (type.kind !== doc.kind) {
      throw new HttpError(
        415,
        doc.kind === "markdown"
          ? "This document is Markdown. Upload a .md file, or upload the HTML as a new document."
          : "This document is HTML. Upload an .html or .zip file, or upload the Markdown as a new document.",
      );
    }
    await assertWithinLimits(this.db, this.config, userId, { documents: 0, bytes: file.buffer.length });
    const versionId = randomUUID();
    const { rows } = await this.db.query<{ next: number }>(
      "SELECT COALESCE(max(number), 0) + 1 AS next FROM document_versions WHERE document_id = $1",
      [id],
    );
    const number = rows[0]!.next;
    try {
      const v = await this.ingest(id, number, file, type);
      const storedBytes = await this.storage.versionBytes(id, number);
      await transaction(this.db, async (client) => {
        await assertWithinLimits(client, this.config, userId, { documents: 0, bytes: storedBytes }, { lock: true });
        await insertVersion(client, id, versionId, number, file, v, storedBytes);
        await client.query(
          `UPDATE documents SET current_version_id = $2, description = $3, eyebrow = $4, updated_at = now()
           WHERE id = $1`,
          [id, versionId, v.description, v.eyebrow],
        );
      });
    } catch (err) {
      await this.storage.removeVersion(id, number);
      throw err;
    }
    return this.get(userId, id);
  }

  /** Versions from before storage limits have no stored_bytes; measures them on disk. Runs at boot. */
  async measureUnsizedVersions(): Promise<number> {
    const { rows } = await this.db.query<{ id: string; document_id: string; number: number }>(
      "SELECT id, document_id, number FROM document_versions WHERE stored_bytes IS NULL",
    );
    for (const r of rows) {
      const bytes = await this.storage.versionBytes(r.document_id, r.number);
      await this.db.query("UPDATE document_versions SET stored_bytes = $2 WHERE id = $1", [r.id, bytes]);
    }
    return rows.length;
  }

  /** Validates an upload and writes it to disk: the original, plus the unpacked site for HTML. */
  private async ingest(documentId: string, number: number, file: UploadedFile, type: UploadType): Promise<Ingested> {
    if (type.kind === "markdown") {
      const rendered = await renderMarkdown(decodeUtf8(file.buffer));
      await this.storage.writeOriginal(documentId, number, type.sourceType, file.buffer);
      return { ...rendered, sourceType: "md", entryPath: null };
    }
    await this.storage.writeOriginal(documentId, number, type.sourceType, file.buffer);
    const siteDir = this.storage.siteDir(documentId, number);
    if (type.sourceType === "zip") await extractZip(file.buffer, siteDir, this.config.zipLimits);
    else await writeSingleHtml(file.buffer, siteDir);
    const meta = await readSiteMeta(siteDir);
    return {
      ...meta,
      eyebrow: "",
      html: null,
      headings: [],
      wordCount: 0,
      readingMinutes: 0,
      sourceType: type.sourceType,
      entryPath: ENTRY,
    };
  }

  async listVersions(userId: string, id: string): Promise<VersionListItem[]> {
    const doc = await this.db.query<{ current_version_id: string }>(
      "SELECT current_version_id FROM documents WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    const current = doc.rows[0]?.current_version_id;
    if (!current) throw notFound("That document doesn’t exist.");
    const { rows } = await this.db.query<VersionRow>(
      "SELECT * FROM document_versions WHERE document_id = $1 ORDER BY number DESC",
      [id],
    );
    return rows.map((v) => ({ id: v.id, current: v.id === current, ...toVersionSummary(v) }));
  }

  /** Makes an earlier version current again. Nothing is deleted, so this can be undone the same way. */
  async restoreVersion(userId: string, id: string, versionId: string): Promise<DocumentDetail> {
    const { rowCount } = await this.db.query(
      `UPDATE documents d SET current_version_id = v.id, description = v.description, eyebrow = v.eyebrow, updated_at = now()
       FROM document_versions v
       WHERE d.id = $1 AND v.id = $2 AND v.document_id = d.id AND d.user_id = $3`,
      [id, versionId, userId],
    );
    if (!rowCount) throw notFound("That version doesn’t exist.");
    return this.get(userId, id);
  }

  async list(userId: string, filter: ListFilter, q: string): Promise<Omit<DocumentListResponse, "viewsThisMonth">> {
    const conditions: Record<ListFilter, string> = {
      all: "TRUE",
      live: "d.status = 'live' AND (d.expires_at IS NULL OR d.expires_at > now())",
      drafts: "d.status IN ('draft', 'unpublished')",
      expired: "d.status = 'live' AND d.expires_at <= now()",
    };
    const params: unknown[] = [userId];
    let search = "TRUE";
    if (q.trim()) {
      params.push(`%${q.trim().replace(/[\\%_]/g, "\\$&")}%`);
      search = "(d.title ILIKE $2 OR d.slug ILIKE $2)";
    }
    // All-time totals. People are unique visitors per day, summed, as on the document page.
    const { rows } = await this.db.query<DocumentRow & { views: number; people: number }>(
      `SELECT d.*, COALESCE(s.views, 0) AS views, COALESCE(s.people, 0) AS people
       FROM documents d
       LEFT JOIN (
         SELECT document_id, count(*)::int AS views, count(DISTINCT day::text || visitor_hash)::int AS people
         FROM views GROUP BY document_id
       ) s ON s.document_id = d.id
       WHERE d.user_id = $1 AND ${conditions[filter]} AND ${search} ORDER BY d.updated_at DESC`,
      params,
    );
    const counts = await this.db.query<{ all: number; live: number; drafts: number; expired: number }>(
      `SELECT count(*)::int AS all,
              count(*) FILTER (WHERE ${conditions.live})::int AS live,
              count(*) FILTER (WHERE ${conditions.drafts})::int AS drafts,
              count(*) FILTER (WHERE ${conditions.expired})::int AS expired
       FROM documents d WHERE d.user_id = $1`,
      [userId],
    );
    return {
      documents: rows.map((r) => this.toSummary(r)),
      counts: counts.rows[0]!,
    };
  }

  async get(userId: string, id: string): Promise<DocumentDetail> {
    const { rows } = await this.db.query<DocumentRow & { v: VersionRow }>(
      `SELECT d.*, row_to_json(v) AS v
       FROM documents d JOIN document_versions v ON v.id = d.current_version_id
       WHERE d.id = $1 AND d.user_id = $2`,
      [id, userId],
    );
    const row = rows[0];
    if (!row) throw notFound("That document doesn’t exist.");
    return this.toDetail(row, row.v);
  }

  async update(userId: string, id: string, patch: DocumentSettingsPatch): Promise<DocumentDetail> {
    const doc = await this.row(userId, id);
    if (patch.slug !== undefined) {
      if (!isValidSlug(patch.slug)) throw badRequest("Choose a different link.", { slug: "That link is reserved." });
      if (await isSlugTaken(this.db, patch.slug, id)) {
        throw conflict("That link is taken.", { slug: "Another document already uses this link." });
      }
    }

    const set: Record<string, unknown> = {};
    const columns = {
      title: "title",
      slug: "slug",
      trackViews: "track_views",
      allowDownload: "allow_download",
      noindex: "noindex",
      replyEmail: "reply_email",
    } as const;
    for (const [key, column] of Object.entries(columns) as [keyof typeof columns, string][]) {
      if (patch[key] !== undefined) set[column] = patch[key];
    }
    Object.assign(set, await this.accessChanges(doc, patch), this.expiryChanges(patch));

    const { password_rev: bumpRev, ...values } = set;
    const params: unknown[] = [id];
    const assignments = Object.entries(values).map(([column, value]) => {
      params.push(value);
      return `${column} = $${params.length}`;
    });
    if (bumpRev) assignments.push("password_rev = password_rev + 1");
    if (assignments.length) {
      try {
        await this.db.query(`UPDATE documents SET ${assignments.join(", ")}, updated_at = now() WHERE id = $1`, params);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw conflict("That link is taken.", { slug: "Another document already uses this link." });
        }
        throw err;
      }
    }
    return this.get(userId, id);
  }

  async publish(userId: string, id: string): Promise<DocumentDetail> {
    // Relative expiry presets on a draft start counting when it's first shared.
    const { rowCount } = await this.db.query(
      `UPDATE documents SET
         status = 'live',
         expires_at = CASE
           WHEN published_at IS NULL AND expiry_preset = '7d' THEN $2::timestamptz + interval '7 days'
           WHEN published_at IS NULL AND expiry_preset = '30d' THEN $2::timestamptz + interval '30 days'
           ELSE expires_at END,
         published_at = COALESCE(published_at, $2),
         updated_at = now()
       WHERE id = $1 AND user_id = $3`,
      [id, new Date(), userId],
    );
    if (!rowCount) throw notFound("That document doesn’t exist.");
    return this.get(userId, id);
  }

  /** Takes the link down. Files, versions and stats stay, and publishing again brings it back. */
  async unpublish(userId: string, id: string): Promise<DocumentDetail> {
    await this.row(userId, id);
    await this.db.query("UPDATE documents SET status = 'unpublished', updated_at = now() WHERE id = $1 AND status = 'live'", [
      id,
    ]);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { rowCount } = await this.db.query("DELETE FROM documents WHERE id = $1 AND user_id = $2", [id, userId]);
    if (!rowCount) throw notFound("That document doesn’t exist.");
    await this.storage.removeDocument(id);
  }

  /**
   * The live document at `slug`, or null when nothing should be shown there, which includes
   * every document of a disabled account. Expiry is the caller's check.
   */
  async findLiveBySlug(slug: string): Promise<PublicDocument | null> {
    const { rows } = await this.db.query<DocumentRow & { v: VersionRow; author_name: string; author_note: string }>(
      `SELECT d.*, row_to_json(v) AS v, u.display_name AS author_name, u.reply_note AS author_note
       FROM documents d
       JOIN document_versions v ON v.id = d.current_version_id
       JOIN users u ON u.id = d.user_id AND u.disabled_at IS NULL
       WHERE d.slug = $1 AND d.status = 'live'`,
      [slug],
    );
    const row = rows[0];
    if (!row) return null;
    const { v, author_name, author_note, ...document } = row;
    return {
      document,
      version: { ...v, created_at: new Date(v.created_at) },
      author: { name: author_name, replyNote: author_note },
    };
  }

  /** One version of a document, for serving its site files. Null when the version isn't the document's. */
  async findSiteVersion(
    documentId: string,
    versionId: string,
  ): Promise<(Omit<PublicDocument, "author"> & { currentVersionId: string }) | null> {
    const { rows } = await this.db.query<DocumentRow & { v: VersionRow; current_version_id: string }>(
      `SELECT d.*, row_to_json(v) AS v
       FROM documents d
       JOIN document_versions v ON v.document_id = d.id
       JOIN users u ON u.id = d.user_id AND u.disabled_at IS NULL
       WHERE d.id = $1 AND v.id = $2 AND d.kind = 'html'`,
      [documentId, versionId],
    );
    const row = rows[0];
    if (!row) return null;
    const { v, current_version_id, ...document } = row;
    return { document, version: v, currentVersionId: current_version_id };
  }

  /** The preview pane of the Publish settings screen. `frame` is set for HTML documents. */
  async preview(userId: string, id: string): Promise<{
    preview: Omit<DocumentPreview, "frameUrl">;
    frame: { versionId: string; entryPath: string } | null;
  }> {
    const { rows } = await this.db.query<{
      kind: DocumentKind;
      title: string;
      eyebrow: string;
      description: string;
      html: string | null;
      version_id: string;
      entry_path: string | null;
    }>(
      `SELECT d.kind, d.title, d.eyebrow, d.description, v.rendered_html AS html, v.id AS version_id, v.entry_path
       FROM documents d JOIN document_versions v ON v.id = d.current_version_id WHERE d.id = $1 AND d.user_id = $2`,
      [id, userId],
    );
    const row = rows[0];
    if (!row) throw notFound("That document doesn’t exist.");
    const { version_id, entry_path, html, ...rest } = row;
    return {
      preview: { ...rest, html: html ?? "" },
      frame: row.kind === "html" ? { versionId: version_id, entryPath: entry_path ?? ENTRY } : null,
    };
  }

  private async row(userId: string, id: string): Promise<DocumentRow> {
    const { rows } = await this.db.query<DocumentRow>("SELECT * FROM documents WHERE id = $1 AND user_id = $2", [id, userId]);
    if (!rows[0]) throw notFound("That document doesn’t exist.");
    return rows[0];
  }

  /**
   * Column changes for the access settings. Every password change (and switching back to
   * "anyone with the link") bumps password_rev, which invalidates readers' unlock cookies.
   */
  private async accessChanges(doc: DocumentRow, patch: DocumentSettingsPatch): Promise<Record<string, unknown>> {
    const access = patch.access ?? doc.access;
    if (access === "link") {
      return doc.access === "password" || doc.password_hash
        ? { access: "link", password_hash: null, password_enc: null, password_rev: true }
        : {};
    }
    const next = patch.password ?? "";
    const current = doc.password_enc ? this.encryptor.decrypt(doc.password_enc) : null;
    if (next && next !== current) {
      if (next.length < DOCUMENT_PASSWORD_MIN) {
        throw badRequest("Check the highlighted fields.", {
          password: `Use at least ${DOCUMENT_PASSWORD_MIN} characters.`,
        });
      }
      return { access, password_hash: await hash(next), password_enc: this.encryptor.encrypt(next), password_rev: true };
    }
    if (!doc.password_hash) {
      throw badRequest("Check the highlighted fields.", { password: "Choose a password readers will type to open it." });
    }
    return doc.access === access ? {} : { access };
  }

  private expiryChanges(patch: DocumentSettingsPatch): Record<string, unknown> {
    const preset = patch.expiryPreset;
    if (preset === undefined) return {};
    const now = new Date();
    if (preset === "never") return { expiry_preset: preset, expires_at: null };
    if (preset === "date") {
      const at = patch.expiresAt ? new Date(patch.expiresAt) : null;
      if (!at || at.getTime() <= now.getTime()) {
        throw badRequest("Check the highlighted fields.", { expiresAt: "Pick a date in the future." });
      }
      return { expiry_preset: preset, expires_at: at };
    }
    return { expiry_preset: preset, expires_at: new Date(now.getTime() + PRESET_DAYS[preset]! * DAY_MS) };
  }

  private toSummary(r: DocumentRow & { views: number; people: number }): DocumentSummary {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      kind: r.kind,
      status: r.status,
      views: r.views,
      people: r.people,
      updatedAt: r.updated_at.toISOString(),
      expiresAt: r.expires_at?.toISOString() ?? null,
      access: r.access,
    };
  }

  private toDetail(r: DocumentRow, v: VersionRow): DocumentDetail {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      kind: r.kind,
      status: r.status,
      description: r.description,
      access: r.access,
      password: r.access === "password" && r.password_enc ? this.encryptor.decrypt(r.password_enc) : null,
      expiryPreset: r.expiry_preset,
      expiresAt: r.expires_at?.toISOString() ?? null,
      trackViews: r.track_views,
      allowDownload: r.allow_download,
      noindex: r.noindex,
      replyEmail: r.reply_email,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      publishedAt: r.published_at?.toISOString() ?? null,
      url: `${this.config.appOrigin}/p/${r.slug}`,
      version: toVersionSummary(v),
    };
  }
}

function toVersionSummary(v: VersionRow): VersionSummary {
  return {
    number: v.number,
    originalName: v.original_name,
    sourceType: v.source_type,
    sizeBytes: v.size_bytes,
    wordCount: v.word_count,
    createdAt: new Date(v.created_at).toISOString(),
  };
}

type SourceType = VersionSummary["sourceType"];
interface UploadType {
  kind: DocumentKind;
  sourceType: SourceType;
}

function uploadType(name: string): UploadType {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return { kind: "markdown", sourceType: "md" };
  if (ext === ".html" || ext === ".htm") return { kind: "html", sourceType: "html" };
  if (ext === ".zip") return { kind: "html", sourceType: "zip" };
  throw new HttpError(415, "Upload a Markdown (.md) or HTML (.html) file, or a .zip with an index.html.");
}

/** What a version row stores, whichever kind of file it came from. */
interface Ingested extends Omit<RenderedMarkdown, "html"> {
  /** Rendered Markdown; HTML sites are served from disk instead. */
  html: string | null;
  sourceType: SourceType;
  entryPath: string | null;
}

async function insertVersion(
  client: pg.PoolClient,
  documentId: string,
  versionId: string,
  number: number,
  file: UploadedFile,
  rendered: Ingested,
  storedBytes: number,
): Promise<void> {
  await client.query(
    `INSERT INTO document_versions
       (id, document_id, number, original_name, source_type, size_bytes, word_count, reading_minutes, headings,
        rendered_html, eyebrow, description, entry_path, stored_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      versionId,
      documentId,
      number,
      file.originalName,
      rendered.sourceType,
      file.buffer.length,
      rendered.wordCount,
      rendered.readingMinutes,
      JSON.stringify(rendered.headings),
      rendered.html,
      rendered.eyebrow,
      rendered.description,
      rendered.entryPath,
      storedBytes,
    ],
  );
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    throw badRequest("That file isn’t UTF-8 text. Save it as UTF-8 and upload it again.");
  }
}

function titleFromFilename(name: string): string {
  const base = path.basename(name, path.extname(name)).replace(/[-_]+/g, " ").trim();
  return base ? base[0]!.toUpperCase() + base.slice(1) : "Untitled document";
}
