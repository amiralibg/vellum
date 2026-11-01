import { randomBytes } from "node:crypto";
import type { ApiTokenItem, CreatedApiToken } from "@vellum/shared";
import type { Db } from "../db/index.js";
import { notFound } from "../errors.js";
import { sha256 } from "./auth.js";

/** Recognisable in config files and secret scanners. */
const PREFIX = "vlm_";

/** Who a valid API token acts as. */
export interface TokenUser {
  id: string;
  isAdmin: boolean;
  tokenId: string;
  tokenName: string;
}

interface TokenRow {
  id: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
}

const toItem = (r: TokenRow): ApiTokenItem => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
});

export async function listApiTokens(db: Db, userId: string): Promise<ApiTokenItem[]> {
  const { rows } = await db.query<TokenRow>(
    "SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(toItem);
}

/** Only the hash is stored; the token is returned this once. */
export async function createApiToken(db: Db, userId: string, name: string): Promise<CreatedApiToken> {
  const token = PREFIX + randomBytes(32).toString("base64url");
  const { rows } = await db.query<TokenRow>(
    `INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3)
     RETURNING id, name, created_at, last_used_at`,
    [userId, name, sha256(token)],
  );
  return { ...toItem(rows[0]!), token };
}

export async function revokeApiToken(db: Db, userId: string, id: string): Promise<void> {
  const { rowCount } = await db.query("DELETE FROM api_tokens WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!rowCount) throw notFound("That token doesn’t exist.");
}

/** The account behind an API token, or null when it's unknown, revoked, or the account is disabled. */
export async function tokenUser(db: Db, token: string): Promise<TokenUser | null> {
  if (!token.startsWith(PREFIX)) return null;
  const { rows } = await db.query<{ id: string; is_admin: boolean; token_id: string; token_name: string }>(
    `UPDATE api_tokens t SET last_used_at = now()
     FROM users u
     WHERE t.token_hash = $1 AND u.id = t.user_id AND u.disabled_at IS NULL
     RETURNING u.id, u.is_admin, t.id AS token_id, t.name AS token_name`,
    [sha256(token)],
  );
  const r = rows[0];
  return r ? { id: r.id, isAdmin: r.is_admin, tokenId: r.token_id, tokenName: r.token_name } : null;
}
