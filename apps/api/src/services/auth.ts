import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { Account, AccountSettings } from "@vellum/shared";
import type { Config } from "../config.js";
import type { Db, Queryable } from "../db/index.js";
import { badRequest, notFound } from "../errors.js";
import { usageOf } from "./users.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** A random secret for a cookie or a link, and the hash that's stored instead of it. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

/** Who a valid session belongs to. */
export interface SessionUser {
  id: string;
  isAdmin: boolean;
}

/** Creates the first admin from OWNER_* on first boot. Later env changes are ignored (see owner:reset). */
export async function ensureFirstAdmin(db: Db, config: Config): Promise<void> {
  const { rowCount } = await db.query("SELECT 1 FROM users LIMIT 1");
  if (rowCount) return;
  await db.query(
    "INSERT INTO users (email, password_hash, display_name, is_admin) VALUES ($1, $2, $3, true) ON CONFLICT (email) DO NOTHING",
    [config.owner.email, await hash(config.owner.password), config.owner.name],
  );
}

/**
 * The emergency way back in: the account with this email becomes an enabled admin with this
 * password (created if there's none), and its sessions are signed out.
 */
export async function resetAdmin(db: Db, email: string, password: string, name: string): Promise<"created" | "reset"> {
  const { rows } = await db.query<{ id: string; created: boolean }>(
    `INSERT INTO users (email, password_hash, display_name, is_admin) VALUES ($1, $2, $3, true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = true, disabled_at = NULL
     RETURNING id, (xmax = 0) AS created`,
    [email.toLowerCase(), await hash(password), name],
  );
  const user = rows[0]!;
  await db.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
  return user.created ? "created" : "reset";
}

// Verified against when the email is wrong too, so response time doesn't reveal the email.
let dummyHash: Promise<string> | undefined;

/** The account these credentials open, or null. A disabled account still verifies, so the caller can say why. */
export async function checkCredentials(
  db: Db,
  email: string,
  password: string,
): Promise<{ id: string; disabled: boolean } | null> {
  const { rows } = await db.query<{ id: string; password_hash: string; disabled: boolean }>(
    "SELECT id, password_hash, disabled_at IS NOT NULL AS disabled FROM users WHERE email = $1",
    [email.toLowerCase()],
  );
  const user = rows[0];
  if (!user) {
    dummyHash ??= hash(randomBytes(16).toString("hex"));
    await verify(await dummyHash, password);
    return null;
  }
  return (await verify(user.password_hash, password)) ? { id: user.id, disabled: user.disabled } : null;
}

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const { token, hash: id } = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [id, userId, expiresAt]);
  return { token, expiresAt };
}

/** The user behind a session cookie, or null when it's missing, expired, or the account is disabled. */
export async function sessionUser(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await db.query<{ id: string; is_admin: boolean }>(
    `UPDATE sessions s SET last_seen_at = now()
     FROM users u
     WHERE s.id = $1 AND s.expires_at > now() AND u.id = s.user_id AND u.disabled_at IS NULL
     RETURNING u.id, u.is_admin`,
    [sha256(token)],
  );
  const r = rows[0];
  return r ? { id: r.id, isAdmin: r.is_admin } : null;
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
}

export async function getAccount(db: Db, config: Config, userId: string): Promise<Account> {
  const { rows } = await db.query<{
    email: string;
    display_name: string;
    theme: Account["theme"];
    reply_note: string;
    is_admin: boolean;
  }>("SELECT email, display_name, theme, reply_note, is_admin FROM users WHERE id = $1", [userId]);
  const r = rows[0];
  if (!r) throw notFound("That account doesn’t exist.");
  const [usage] = await usageOf(db, config, [userId]);
  return {
    id: userId,
    email: r.email,
    displayName: r.display_name,
    theme: r.theme,
    replyNote: r.reply_note,
    isAdmin: r.is_admin,
    usage: usage!,
  };
}

export async function updateAccountSettings(db: Db, config: Config, userId: string, s: AccountSettings): Promise<Account> {
  await db.query("UPDATE users SET display_name = $2, theme = $3, reply_note = $4 WHERE id = $1", [
    userId,
    s.displayName,
    s.theme,
    s.replyNote,
  ]);
  return getAccount(db, config, userId);
}

/** Changes the password and signs out every other session of the account. */
export async function changePassword(
  db: Db,
  userId: string,
  currentToken: string,
  current: string,
  next: string,
): Promise<void> {
  const { rows } = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!rows[0] || !(await verify(rows[0].password_hash, current))) {
    throw badRequest("Check the highlighted fields.", { currentPassword: "That isn’t your current password." });
  }
  await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, await hash(next)]);
  await db.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [userId, sha256(currentToken)]);
}

/** Sets a new password and signs out every session of the account. */
export async function setPassword(db: Queryable, userId: string, password: string): Promise<void> {
  await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, await hash(password)]);
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}
