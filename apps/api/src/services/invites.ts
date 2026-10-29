import { hash } from "@node-rs/argon2";
import type { CreatedInvite, InviteAccept, InviteInfo, InviteItem, IssuedLink, ResetInfo } from "@vellum/shared";
import type { Config } from "../config.js";
import { transaction, type Db } from "../db/index.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { newToken, setPassword, sha256 } from "./auth.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

const INVITE_GONE = "This invite link no longer works. It was used, revoked or has expired. Ask for a new one.";
const RESET_GONE = "This password link no longer works. It was used or has expired. Ask an admin for a new one.";

const PENDING = "i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()";

/**
 * Links an admin hands out by hand, since Vellum sends no email: invites (anyone who opens one
 * picks their own email, name and password) and password resets for one account. Only the
 * sha256 of a link's token is stored, and each works once.
 */
export class Invites {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  async create(actorId: string, note: string, now = new Date()): Promise<CreatedInvite> {
    const { token, hash: tokenHash } = newToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const { rows } = await this.db.query<{ id: string }>(
      "INSERT INTO invites (token_hash, note, created_by, expires_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [tokenHash, note, actorId, expiresAt],
    );
    const invite = (await this.pending(rows[0]!.id))[0]!;
    return { invite, url: `${this.config.appOrigin}/invite/${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** Invites that can still be accepted, newest first. */
  async pending(id?: string): Promise<InviteItem[]> {
    const { rows } = await this.db.query<{
      id: string;
      note: string;
      created_by: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `SELECT i.id, i.note, u.display_name AS created_by, i.created_at, i.expires_at
       FROM invites i JOIN users u ON u.id = i.created_by
       WHERE ${PENDING} AND ($1::uuid IS NULL OR i.id = $1)
       ORDER BY i.created_at DESC`,
      [id ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    }));
  }

  async revoke(id: string): Promise<void> {
    const { rowCount } = await this.db.query(`UPDATE invites i SET revoked_at = now() WHERE i.id = $1 AND ${PENDING}`, [id]);
    if (!rowCount) throw notFound("That invite was already used, revoked or has expired.");
  }

  async info(token: string): Promise<InviteInfo> {
    const { rows } = await this.db.query<{ note: string; invited_by: string; expires_at: Date }>(
      `SELECT i.note, u.display_name AS invited_by, i.expires_at FROM invites i JOIN users u ON u.id = i.created_by
       WHERE i.token_hash = $1 AND ${PENDING}`,
      [sha256(token)],
    );
    if (!rows[0]) throw notFound(INVITE_GONE);
    return { name: rows[0].note, invitedBy: rows[0].invited_by, expiresAt: rows[0].expires_at.toISOString() };
  }

  /** Creates the account and uses up the invite, or neither. Returns the new user's id. */
  async accept(token: string, input: InviteAccept): Promise<string> {
    const passwordHash = await hash(input.password);
    try {
      return await transaction(this.db, async (client) => {
        const invite = await client.query<{ id: string }>(
          `UPDATE invites i SET used_at = now() WHERE i.token_hash = $1 AND ${PENDING} RETURNING i.id`,
          [sha256(token)],
        );
        if (!invite.rows[0]) throw notFound(INVITE_GONE);
        const user = await client.query<{ id: string }>(
          "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
          [input.email, passwordHash, input.displayName],
        );
        const userId = user.rows[0]!.id;
        await client.query("UPDATE invites SET used_by = $2 WHERE id = $1", [invite.rows[0].id, userId]);
        return userId;
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw conflict("Check the highlighted fields.", { email: "There’s already an account with this email. Sign in instead." });
      }
      throw err;
    }
  }

  /** A new password link for one account. Any earlier link for it stops working. */
  async issueReset(actorId: string, userId: string, now = new Date()): Promise<IssuedLink> {
    const { rows } = await this.db.query<{ disabled: boolean }>(
      "SELECT disabled_at IS NOT NULL AS disabled FROM users WHERE id = $1",
      [userId],
    );
    if (!rows[0]) throw notFound("That account doesn’t exist.");
    if (rows[0].disabled) throw badRequest("Enable this account before giving it a new password link.");
    const { token, hash: tokenHash } = newToken();
    const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
    await transaction(this.db, async (client) => {
      await client.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
      await client.query(
        "INSERT INTO password_resets (token_hash, user_id, created_by, expires_at) VALUES ($1, $2, $3, $4)",
        [tokenHash, userId, actorId, expiresAt],
      );
    });
    return { url: `${this.config.appOrigin}/reset/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async resetInfo(token: string): Promise<ResetInfo> {
    const { rows } = await this.db.query<{ email: string; expires_at: Date }>(
      `SELECT u.email, r.expires_at FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.disabled_at IS NULL`,
      [sha256(token)],
    );
    if (!rows[0]) throw notFound(RESET_GONE);
    return { email: rows[0].email, expiresAt: rows[0].expires_at.toISOString() };
  }

  /** Sets the new password, signs out every session of the account and uses up the link. Returns the user's id. */
  async useReset(token: string, password: string): Promise<string> {
    return transaction(this.db, async (client) => {
      const { rows } = await client.query<{ user_id: string }>(
        `UPDATE password_resets r SET used_at = now()
         FROM users u
         WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.id = r.user_id AND u.disabled_at IS NULL
         RETURNING r.user_id`,
        [sha256(token)],
      );
      if (!rows[0]) throw notFound(RESET_GONE);
      await setPassword(client, rows[0].user_id, password);
      return rows[0].user_id;
    });
  }
}
