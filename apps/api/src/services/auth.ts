import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { Owner, OwnerSettings } from "@vellum/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Creates the single owner from env on first boot. Later env changes are ignored (see owner:reset). */
export async function ensureOwner(db: Db, config: Config): Promise<void> {
  const { rowCount } = await db.query("SELECT 1 FROM owner");
  if (rowCount) return;
  const passwordHash = await hash(config.owner.password);
  await db.query(
    "INSERT INTO owner (email, password_hash, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [config.owner.email, passwordHash, config.owner.name],
  );
}

export async function resetOwnerPassword(db: Db, email: string, password: string): Promise<void> {
  await db.query("UPDATE owner SET email = $1, password_hash = $2", [email.toLowerCase(), await hash(password)]);
  await db.query("DELETE FROM sessions");
}

// Verified against when the email is wrong too, so response time doesn't reveal the email.
let dummyHash: Promise<string> | undefined;

export async function checkCredentials(db: Db, email: string, password: string): Promise<boolean> {
  const { rows } = await db.query<{ email: string; password_hash: string }>("SELECT email, password_hash FROM owner");
  const owner = rows[0];
  if (!owner || owner.email !== email.toLowerCase()) {
    dummyHash ??= hash(randomBytes(16).toString("hex"));
    await verify(await dummyHash, password);
    return false;
  }
  return verify(owner.password_hash, password);
}

export async function createSession(db: Db): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query("INSERT INTO sessions (id, expires_at) VALUES ($1, $2)", [sha256(token), expiresAt]);
  return { token, expiresAt };
}

export async function isValidSession(db: Db, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const { rowCount } = await db.query(
    "UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND expires_at > now()",
    [sha256(token)],
  );
  return rowCount === 1;
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
}

export async function getOwner(db: Db): Promise<Owner> {
  const { rows } = await db.query<{ email: string; display_name: string; theme: Owner["theme"]; reply_note: string }>(
    "SELECT email, display_name, theme, reply_note FROM owner",
  );
  const r = rows[0];
  if (!r) throw new Error("Owner account missing");
  return { email: r.email, displayName: r.display_name, theme: r.theme, replyNote: r.reply_note };
}

export async function updateOwnerSettings(db: Db, s: OwnerSettings): Promise<Owner> {
  await db.query("UPDATE owner SET display_name = $1, theme = $2, reply_note = $3", [s.displayName, s.theme, s.replyNote]);
  return getOwner(db);
}
