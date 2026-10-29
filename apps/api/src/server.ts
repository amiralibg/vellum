import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db/index.js";
import { ensureFirstAdmin } from "./services/auth.js";
import { DocumentService } from "./services/documents.js";
import { Storage } from "./services/storage.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);

await migrate(db);
await ensureFirstAdmin(db, config);
// Once, after the upgrade that added storage limits: versions from before it are measured on disk.
const measured = await new DocumentService(db, new Storage(config.dataDir), config).measureUnsizedVersions();
if (measured) console.log(`Measured the size on disk of ${measured} earlier versions.`);

const server = createApp({ config, db }).listen(config.port, "0.0.0.0", () => {
  console.log(`Vellum API on :${config.port} · app ${config.appOrigin} · usercontent ${config.usercontentOrigin}`);
});

const shutdown = () => {
  server.close(() => void db.end().then(() => process.exit(0)));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
