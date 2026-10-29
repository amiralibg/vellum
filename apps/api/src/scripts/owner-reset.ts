// The way back in when no admin can sign in: the account with OWNER_EMAIL becomes an enabled admin with
// OWNER_PASSWORD (created if there's none), and its sessions are signed out. Other accounts are left alone.
// Usage: pnpm --filter @vellum/api owner:reset   (in Docker: node dist/owner-reset.js)
import { loadConfig } from "../config.js";
import { createDb, migrate } from "../db/index.js";
import { resetAdmin } from "../services/auth.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
await migrate(db);
const result = await resetAdmin(db, config.owner.email, config.owner.password, config.owner.name);
console.log(
  result === "created"
    ? `Created admin ${config.owner.email}.`
    : `Reset ${config.owner.email}: new password, admin, enabled. Its sessions were signed out.`,
);
await db.end();
