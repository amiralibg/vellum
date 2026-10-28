import { lstat } from "node:fs/promises";
import path from "node:path";
import { Router, type Response } from "express";
import type { Config } from "../config.js";
import { asyncHandler } from "../middleware/index.js";
import { isExpired, type DocumentService } from "../services/documents.js";
import { ENTRY, siteType } from "../services/site.js";
import type { SiteTokens } from "../services/site-tokens.js";
import type { Storage } from "../services/storage.js";

/**
 * Everything the usercontent origin serves: files of uploaded HTML sites, at
 * /u/<token>/<path>, and a 404 for anything else. Every response is sandboxed, so even a
 * page opened directly in a tab runs with an opaque origin.
 */
export function usercontentRouter(config: Config, documents: DocumentService, storage: Storage, tokens: SiteTokens) {
  const router = Router();

  router.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": `sandbox allow-scripts allow-popups; frame-ancestors ${config.appOrigin}`,
      "X-Content-Type-Options": "nosniff",
      // The token is in the URL: never send it to the sites the document links to.
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    });
    next();
  });

  const notFound = (res: Response) => res.status(404).type("text").send("Not found");

  router.get(
    "/u/:token/*",
    asyncHandler(async (req, res) => {
      const claims = tokens.verify(req.params.token!);
      if (!claims) return notFound(res);

      const found = await documents.findSiteVersion(claims.d, claims.v);
      if (!found) return notFound(res);
      const { document: d, version: v, currentVersionId } = found;
      if (!claims.o) {
        // A reader's token only lasts while the document is still shared exactly as it was.
        const shared = d.status === "live" && !isExpired(d) && v.id === currentVersionId && d.password_rev === claims.r;
        if (!shared) return notFound(res);
      }

      const file = sitePath(req.params[0] ?? "");
      if (!file) return notFound(res);
      const root = storage.siteDir(d.id, v.number);
      const full = path.join(root, file);
      if (!full.startsWith(root + path.sep)) return notFound(res);
      const stat = await lstat(full).catch(() => null);
      if (!stat?.isFile()) return notFound(res);

      // Opaque-origin pages need CORS for module scripts, fonts and fetch(). There are no
      // cookies on this origin; the token in the path is the only credential.
      res.set({ "Access-Control-Allow-Origin": "*", "Content-Type": siteType(file)! });
      res.sendFile(full, { dotfiles: "allow", cacheControl: false, lastModified: false });
    }),
  );

  router.use((_req, res) => notFound(res));
  return router;
}

/** The request path inside a site, or null when it isn't a plain path to an allowed file type. */
function sitePath(raw: string): string | null {
  const rel = raw === "" || raw.endsWith("/") ? `${raw}${ENTRY}` : raw;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return null;
  return siteType(rel) ? parts.join("/") : null;
}
