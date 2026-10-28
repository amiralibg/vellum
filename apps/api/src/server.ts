import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db/index.js";
import { ensureOwner } from "./services/auth.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);

await migrate(db);
await ensureOwner(db, config);

const server = createApp({ config, db }).listen(config.port, "0.0.0.0", () => {
  console.log(`Vellum API on :${config.port} · app ${config.appOrigin} · usercontent ${config.usercontentOrigin}`);
});

const shutdown = () => {
  server.close(() => void db.end().then(() => process.exit(0)));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
