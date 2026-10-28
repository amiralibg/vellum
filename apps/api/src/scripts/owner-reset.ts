// Sets the owner's email and password from OWNER_EMAIL / OWNER_PASSWORD and signs out every session.
// Usage: pnpm --filter @vellum/api owner:reset   (in Docker: node dist/owner-reset.js)
import { loadConfig } from "../config.js";
import { createDb, migrate } from "../db/index.js";
import { ensureOwner, resetOwnerPassword } from "../services/auth.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
await migrate(db);
await ensureOwner(db, config);
await resetOwnerPassword(db, config.owner.email, config.owner.password);
console.log(`Owner reset to ${config.owner.email}. All sessions were signed out.`);
await db.end();
