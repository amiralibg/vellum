import { randomBytes } from "node:crypto";
import { verify } from "@node-rs/argon2";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { asyncHandler } from "../middleware/index.js";
import { beaconSchema, type Analytics } from "../services/analytics.js";
import { getOwner, isValidSession } from "../services/auth.js";
import { isExpired, type DocumentService, type PublicDocument } from "../services/documents.js";
import type { Storage } from "../services/storage.js";
import type { SiteTokens } from "../services/site-tokens.js";
import { ENTRY } from "../services/site.js";
import { UnlockCookies } from "../services/unlock.js";
import { isBot } from "../services/user-agent.js";
import { htmlPage } from "../reader/html-page.js";
import { markdownPage } from "../reader/markdown-page.js";
import { expiredPage, lockedPage, notFoundPage } from "../reader/state-pages.js";

/** CSP for server-rendered reader pages: only our own assets plus one nonce'd inline script. */
function readerHeaders(res: Response, config: Config, noindex: boolean): string {
  const nonce = randomBytes(16).toString("base64");
  res.set({
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self'",
      "font-src 'self'",
      // Markdown may reference images hosted elsewhere.
      "img-src 'self' https: data:",
      `connect-src 'self'`,
      `frame-src ${config.usercontentOrigin}`,
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
  });
  if (noindex) res.set("X-Robots-Tag", "noindex, nofollow");
  return nonce;
}

type Gate = { state: "missing" } | { state: "expired" | "locked" | "open"; found: PublicDocument };

const BEACON_REFUSED = { missing: 404, expired: 410, locked: 401 } as const;

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Country from a CDN header, when one is in front (Cloudflare). There's no GeoIP lookup. */
function countryOf(req: Request): string | null {
  const code = req.get("cf-ipcountry")?.toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

const WRONG_PASSWORD = "That password doesn’t match. Check for spaces or capital letters.";
const TOO_MANY = "Too many attempts. Wait 15 minutes and try again.";

export function publicRouter(
  db: Db,
  config: Config,
  documents: DocumentService,
  storage: Storage,
  siteTokens: SiteTokens,
  analytics: Analytics,
): Router {
  const router = Router();
  const unlock = new UnlockCookies(config);

  const sendNotFound = async (res: Response, slug: string) => {
    const nonce = readerHeaders(res, config, true);
    const owner = await getOwner(db);
    const address = `${config.appHost}/p/${slug}`;
    res.status(404).type("html").send(notFoundPage({ nonce, address, siteName: owner.displayName }));
  };

  const sendLocked = async (res: Response, { document: d }: PublicDocument, status: number, error?: string, attempt?: string) => {
    const nonce = readerHeaders(res, config, d.noindex);
    const owner = await getOwner(db);
    res
      .status(status)
      .type("html")
      .send(
        lockedPage({
          nonce,
          slug: d.slug,
          title: d.title,
          url: `${config.appOrigin}/p/${d.slug}`,
          noindex: d.noindex,
          sharer: { name: owner.displayName, replyEmail: d.reply_email },
          error,
          attempt,
        }),
      );
  };

  /**
   * Every way into a document goes through here: the page, the download, the unlock form and
   * the view beacon. Expiry wins over everything, including a reader who unlocked it before.
   */
  const gate = async (req: Request): Promise<Gate> => {
    const found = await documents.findLiveBySlug(req.params.slug!.toLowerCase());
    if (!found) return { state: "missing" };
    if (isExpired(found.document)) return { state: "expired", found };
    const d = found.document;
    if (d.access === "password" && !unlock.isValid(d, req.cookies?.[unlock.name] as string | undefined)) {
      return { state: "locked", found };
    }
    return { state: "open", found };
  };

  /** The gate for pages: sends the not found, expired or password page and returns null when the reader can't see the content. */
  const openable = async (req: Request, res: Response): Promise<PublicDocument | null> => {
    const g = await gate(req);
    if (g.state === "missing") {
      await sendNotFound(res, req.params.slug!);
      return null;
    }
    const d = g.found.document;
    if (g.state === "expired") {
      const nonce = readerHeaders(res, config, true);
      const owner = await getOwner(db);
      res
        .status(410)
        .type("html")
        .send(
          expiredPage({
            nonce,
            title: d.title,
            expiresAt: d.expires_at!,
            preset: d.expiry_preset,
            noindex: d.noindex,
            sharer: { name: owner.displayName, replyEmail: d.reply_email },
          }),
        );
      return null;
    }
    if (g.state === "locked") {
      await sendLocked(res, g.found, 401);
      return null;
    }
    return g.found;
  };

  router.get(
    "/:slug",
    asyncHandler(async (req, res) => {
      const found = await openable(req, res);
      if (!found) return;
      const { document: d, version: v } = found;
      const owner = await getOwner(db);
      const nonce = readerHeaders(res, config, d.noindex);
      // Link previews of a password document get the title only.
      const metaDescription = d.access === "password" ? "" : d.description;
      // Rendering never counts a view. The page's first beacon does, carrying this token.
      const view = d.track_views ? { token: analytics.issueToken(d, v), beacon: `/p/${d.slug}/beacon` } : undefined;
      if (d.kind === "html") {
        // A fresh token on every load; it only opens this version while it stays shared.
        const token = siteTokens.issue({ d: d.id, v: v.id, r: d.password_rev });
        return res.type("html").send(
          htmlPage({
            nonce,
            url: `${config.appOrigin}/p/${d.slug}`,
            slug: d.slug,
            title: d.title,
            metaDescription,
            frameSrc: siteTokens.url(token, v.entry_path ?? ENTRY),
            noindex: d.noindex,
            allowDownload: d.allow_download,
            replyEmail: d.reply_email,
            owner: { name: owner.displayName },
            view,
          }),
        );
      }
      res.type("html").send(
        markdownPage({
          nonce,
          url: `${config.appOrigin}/p/${d.slug}`,
          slug: d.slug,
          title: d.title,
          eyebrow: d.eyebrow,
          description: d.description,
          metaDescription,
          bodyHtml: v.rendered_html ?? "",
          headings: v.headings,
          wordCount: v.word_count,
          readingMinutes: v.reading_minutes,
          updatedAt: v.created_at,
          noindex: d.noindex,
          allowDownload: d.allow_download,
          replyEmail: d.reply_email,
          owner: { name: owner.displayName, replyNote: owner.replyNote },
          view,
        }),
      );
    }),
  );

  // Failed attempts per document and IP. A right password doesn't count, and doesn't get through once locked out.
  const unlockLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.params.slug!.toLowerCase()}|${ipKeyGenerator(req.ip ?? "")}`,
    handler: (req: Request, res: Response, next: NextFunction) => {
      documents
        .findLiveBySlug(req.params.slug!.toLowerCase())
        .then((found) => (found ? sendLocked(res, found, 429, TOO_MANY) : sendNotFound(res, req.params.slug!)))
        .catch(next);
    },
  });

  router.post(
    "/:slug/unlock",
    unlockLimiter,
    express.urlencoded({ extended: false, limit: "4kb" }),
    asyncHandler(async (req, res) => {
      const found = await documents.findLiveBySlug(req.params.slug!.toLowerCase());
      if (!found || isExpired(found.document) || found.document.access !== "password") {
        // Nothing to unlock: the page itself shows what the reader should see.
        if (found) return res.redirect(303, `/p/${found.document.slug}`);
        return sendNotFound(res, req.params.slug!);
      }
      const d = found.document;
      const attempt = typeof req.body?.password === "string" ? (req.body.password as string) : "";
      const ok = attempt !== "" && d.password_hash !== null && (await verify(d.password_hash, attempt));
      if (!ok) {
        return sendLocked(res, found, 401, attempt ? WRONG_PASSWORD : "Enter the password that came with the link.", attempt);
      }
      res.cookie(unlock.name, unlock.issue(d), unlock.options(d.slug));
      res.redirect(303, `/p/${d.slug}`);
    }),
  );


  // navigator.sendBeacon posts text/plain. With the reader page's no-referrer policy, browsers send `Origin: null`.
  const beaconLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).end();
    },
  });

  router.post(
    "/:slug/beacon",
    beaconLimiter,
    express.text({ type: () => true, limit: "8kb" }),
    asyncHandler(async (req, res) => {
      const origin = req.get("origin");
      if (origin && origin !== "null" && origin !== config.appOrigin) return res.status(403).end();
      const body = beaconSchema.safeParse(parseJson(req.body));
      if (!body.success) return res.status(400).end();

      const g = await gate(req);
      if (g.state !== "open") return res.status(BEACON_REFUSED[g.state]).end();
      const d = g.found.document;
      const claims = analytics.readToken(d, body.data.t);
      if (!claims) return res.status(403).end();

      // Accepted but not counted: tracking is off, it's the owner (by their session), or it's a bot.
      const userAgent = req.get("user-agent") ?? "";
      const counts =
        d.track_views &&
        !isBot(userAgent) &&
        !(await isValidSession(db, req.cookies?.[config.sessionCookie] as string | undefined));
      if (counts) await analytics.record(claims, d, body.data, { ip: req.ip ?? "", userAgent, country: countryOf(req) });
      res.status(204).end();
    }),
  );

  router.get(
    "/:slug/download",
    asyncHandler(async (req, res) => {
      const found = await openable(req, res);
      if (!found) return;
      const { document: d, version: v } = found;
      if (!d.allow_download) return sendNotFound(res, req.params.slug!);
      if (d.noindex) res.set("X-Robots-Tag", "noindex, nofollow");
      // An uploaded .html is only ever a download on this origin: never rendered, never sniffed.
      res.set({
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      });
      if (v.source_type !== "md") res.type("application/octet-stream");
      res.download(storage.originalPath(d.id, v.number, v.source_type), v.original_name, { dotfiles: "allow" });
    }),
  );

  return router;
}
