import type { Usage, UserItem, UserListResponse, UserPatch } from "@vellum/shared";
import type { Config } from "../config.js";
import { transaction, type Db, type Queryable } from "../db/index.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";

const MB = 1024 * 1024;

interface UsageRow {
  id: string;
  is_admin: boolean;
  max_documents: number | null;
  max_storage_mb: number | null;
  documents: number;
  storage_bytes: number;
}

/** Each user's documents and bytes on disk against their limits, in the order of `userIds`. Admins have no limits. */
export async function usageOf(db: Queryable, config: Config, userIds: string[]): Promise<Usage[]> {
  const { rows } = await db.query<UsageRow>(
    `SELECT u.id, u.is_admin, u.max_documents, u.max_storage_mb,
            (SELECT count(*)::int FROM documents d WHERE d.user_id = u.id) AS documents,
            (SELECT COALESCE(sum(COALESCE(v.stored_bytes, v.size_bytes)), 0)::float8
             FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.user_id = u.id) AS storage_bytes
     FROM users u WHERE u.id = ANY($1::uuid[])`,
    [userIds],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return userIds.map((id) => {
    const r = byId.get(id);
    if (!r) throw notFound("That account doesn’t exist.");
    return {
      documents: r.documents,
      storageBytes: r.storage_bytes,
      maxDocuments: r.is_admin ? null : (r.max_documents ?? config.userLimits.maxDocuments),
      maxStorageBytes: r.is_admin ? null : (r.max_storage_mb ?? config.userLimits.maxStorageMb) * MB,
    };
  });
}

const formatMb = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

/**
 * Throws when `add` would take the user over a limit. Inside a transaction, `lock` holds the
 * user's row until it ends, so two uploads at once can't both squeeze under the limit.
 */
export async function assertWithinLimits(
  db: Queryable,
  config: Config,
  userId: string,
  add: { documents: number; bytes: number },
  { lock = false } = {},
): Promise<void> {
  if (lock) await db.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const [u] = await usageOf(db, config, [userId]);
  if (u!.maxDocuments !== null && u!.documents + add.documents > u!.maxDocuments) {
    throw forbidden(
      `You’ve reached your limit of ${u!.maxDocuments} documents. Delete one you no longer need, or ask an admin to raise the limit.`,
    );
  }
  if (u!.maxStorageBytes !== null && u!.storageBytes + add.bytes > u!.maxStorageBytes) {
    const left = Math.max(0, u!.maxStorageBytes - u!.storageBytes);
    throw forbidden(
      `This upload needs ${formatMb(add.bytes)}, and you have ${formatMb(left)} left of your ${formatMb(u!.maxStorageBytes)}. ` +
        "Delete documents you no longer need, or ask an admin for more space.",
    );
  }
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  disabled_at: Date | null;
  max_documents: number | null;
  max_storage_mb: number | null;
  created_at: Date;
  last_seen_at: Date | null;
}

async function userRows(db: Queryable, id?: string): Promise<UserRow[]> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.id, u.email, u.display_name, u.is_admin, u.disabled_at, u.max_documents, u.max_storage_mb, u.created_at,
            (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
     FROM users u WHERE $1::uuid IS NULL OR u.id = $1 ORDER BY u.created_at, u.email`,
    [id ?? null],
  );
  return rows;
}

async function toItems(db: Queryable, config: Config, rows: UserRow[]): Promise<UserItem[]> {
  const usage = await usageOf(
    db,
    config,
    rows.map((r) => r.id),
  );
  return rows.map((r, i) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    isAdmin: r.is_admin,
    disabled: r.disabled_at !== null,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
    usage: usage[i]!,
    limits: { maxDocuments: r.max_documents, maxStorageMb: r.max_storage_mb },
  }));
}

export async function listUsers(db: Db, config: Config): Promise<UserListResponse> {
  return { users: await toItems(db, config, await userRows(db)), defaults: config.userLimits };
}

/**
 * An admin's changes to an account. Disabling signs the user out and takes every document of
 * theirs offline (the reader, usercontent and beacon queries all skip disabled authors).
 * There's always at least one enabled admin left.
 */
export async function updateUser(db: Db, config: Config, actorId: string, id: string, patch: UserPatch): Promise<UserItem> {
  return transaction(db, async (client) => {
    // Locks every enabled admin, so two admins can't demote each other at the same moment.
    const admins = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE is_admin AND disabled_at IS NULL ORDER BY id FOR UPDATE",
    );
    const target = (await userRows(client, id))[0];
    if (!target) throw notFound("That account doesn’t exist.");
    const wasDisabled = target.disabled_at !== null;
    const disabled = patch.disabled ?? wasDisabled;
    const isAdmin = patch.isAdmin ?? target.is_admin;

    if (disabled && !wasDisabled && id === actorId) throw badRequest("You can’t disable your own account.");
    const wasEnabledAdmin = target.is_admin && !wasDisabled;
    if (wasEnabledAdmin && !(isAdmin && !disabled) && admins.rowCount === 1) {
      throw conflict("Vellum needs at least one admin. Make someone else an admin first.");
    }

    await client.query(
      `UPDATE users SET
         is_admin = $2,
         disabled_at = CASE WHEN $3 THEN COALESCE(disabled_at, now()) END,
         max_documents = $4,
         max_storage_mb = $5
       WHERE id = $1`,
      [
        id,
        isAdmin,
        disabled,
        patch.maxDocuments === undefined ? target.max_documents : patch.maxDocuments,
        patch.maxStorageMb === undefined ? target.max_storage_mb : patch.maxStorageMb,
      ],
    );
    if (disabled && !wasDisabled) {
      await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      await client.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [id]);
    }
    return (await toItems(client, config, await userRows(client, id)))[0]!;
  });
}
