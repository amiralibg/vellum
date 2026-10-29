import pg from "pg";
import { migrations } from "./migrations.js";

export type Db = pg.Pool;
/** The pool, or one client inside a transaction. */
export type Queryable = pg.Pool | pg.PoolClient;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Runs the migrations not applied yet. `list` is for tests that upgrade from an older schema. */
export async function migrate(db: Db, list = migrations): Promise<void> {
  const client = await db.connect();
  try {
    // One boot at a time, so two replicas can't race on the same migration.
    await client.query("SELECT pg_advisory_lock(7461626)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    for (const m of list) {
      if (applied.has(m.name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [m.name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(7461626)").catch(() => {});
    client.release();
  }
}

export async function transaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
