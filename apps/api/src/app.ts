import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express, { type Request } from "express";
import helmet from "helmet";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { errorHandler, sameOrigin } from "./middleware/index.js";
import { authRouter } from "./routes/auth.js";
import { ownerRouter } from "./routes/owner.js";
import { publicRouter } from "./routes/public.js";
import { usercontentRouter } from "./routes/usercontent.js";
import { Analytics } from "./services/analytics.js";
import { DocumentService } from "./services/documents.js";
import { SiteTokens } from "./services/site-tokens.js";
import { Storage } from "./services/storage.js";

/** apps/api, from both src/app.ts (dev) and dist/server.js (bundled). */
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

export interface AppDeps {
  config: Config;
  db: Db;
}

export function createApp({ config, db }: AppDeps) {
  const storage = new Storage(config.dataDir);
  const documents = new DocumentService(db, storage, config);
  const siteTokens = new SiteTokens(config);
  const analytics = new Analytics(db, config);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  // Before host routing: Docker and Dokploy health checks use the container address.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const hostOf = (req: Request) => (config.trustProxy ? req.get("x-forwarded-host") : undefined) ?? req.get("host");

  // --- Usercontent origin: uploaded HTML sites only, behind signed tokens. Nothing else is served here.
  const usercontent = usercontentRouter(config, documents, storage, siteTokens);

  // --- App origin: dashboard, API and /p/:slug.
  const appSite = express.Router();
  appSite.use(cookieParser());

  appSite.use(
    "/api",
    helmet({ contentSecurityPolicy: false }),
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    sameOrigin(config),
    express.json({ limit: "100kb" }),
    express.Router().use("/auth", authRouter(db, config)).use(ownerRouter(db, config, documents, siteTokens, analytics)),
  );
  appSite.use("/api", (_req, res) => {
    res.status(404).json({ error: { message: "Not found." } });
  });

  // Uploaded sites live on the usercontent origin only. Answer here before the SPA fallback can.
  appSite.use("/u", (_req, res) => {
    res.status(404).type("text").send("Not found");
  });
  appSite.use("/p", publicRouter(db, config, documents, storage, siteTokens, analytics));

  appSite.use(
    "/assets/reader",
    express.static(path.join(apiRoot, "public/reader"), { maxAge: "1h", fallthrough: false }),
  );
  appSite.use(
    "/assets/fonts",
    express.static(path.join(apiRoot, "../../packages/ui/fonts"), { maxAge: "365d", immutable: true, fallthrough: false }),
  );

  appSite.get("/robots.txt", (_req, res) => {
    res.type("text").send("User-agent: *\nDisallow: /api/\n");
  });

  // Dashboard SPA (production build). In dev, Vite serves it and proxies here.
  const webDist = path.resolve(apiRoot, "../web/dist");
  if (existsSync(path.join(webDist, "index.html"))) {
    const dashboardHelmet = helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: [config.usercontentOrigin],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
    });
    appSite.use(dashboardHelmet);
    appSite.use("/assets", express.static(path.join(webDist, "assets"), { maxAge: "365d", immutable: true }));
    appSite.use(express.static(webDist, { index: false, maxAge: "1h" }));
    appSite.get("*", (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use((req, res, next) => {
    const host = hostOf(req);
    if (host === config.usercontentHost) return usercontent(req, res, next);
    if (host === config.appHost) return appSite(req, res, next);
    res.status(404).type("text").send("Unknown host");
  });

  app.use(errorHandler);
  return app;
}
