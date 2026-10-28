import { SLUG_PATTERN } from "@vellum/shared";
import type { Db } from "../db/index.js";

/** Paths under APP_URL that /p/ doesn't use, kept out anyway to avoid confusing links. */
const RESERVED = new Set(["api", "admin", "assets", "health", "login", "settings", "new"]);

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED.has(slug);
}

export async function isSlugTaken(db: Db, slug: string, exceptDocumentId?: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM documents WHERE slug = $1 AND id IS DISTINCT FROM $2", [
    slug,
    exceptDocumentId ?? null,
  ]);
  return Boolean(rowCount);
}

/** A free slug based on `title`: "acme-proposal", then "acme-proposal-2", … */
export async function uniqueSlug(db: Db, title: string): Promise<string> {
  const base = slugify(title).slice(0, 58).replace(/-+$/g, "") || "document";
  const root = isValidSlug(base) ? base : `${base}-doc`;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    if (!(await isSlugTaken(db, candidate))) return candidate;
  }
}
