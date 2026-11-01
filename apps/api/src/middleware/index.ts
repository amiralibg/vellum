import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { forbidden, HttpError, unauthorized } from "../errors.js";
import { tokenUser } from "../services/api-tokens.js";
import { sessionUser, type SessionUser } from "../services/auth.js";

type Async = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Express 4 doesn't catch rejected promises; route them to the error handler. */
export const asyncHandler =
  (fn: Async): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Who's making the request. `token` is set when an API token, not a session, says so. */
export interface RequestUser extends SessionUser {
  token?: { id: string; name: string };
}

/**
 * The API token in `Authorization: Bearer …` (possibly empty), or undefined without one. Other schemes, such as
 * Basic auth added by a proxy in front of Vellum, aren't ours and are ignored.
 */
const bearerToken = (req: Request): string | undefined => {
  const match = /^bearer(?:\s+(.*))?$/i.exec(req.get("authorization")?.trim() ?? "");
  return match ? (match[1] ?? "").trim() : undefined;
};

/** Lets signed-in users through; `currentUser(res)` says who. API tokens are refused: see requireUserOrToken. */
export function requireUser(db: Db, config: Config): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    if (bearerToken(req) !== undefined) {
      throw forbidden("API tokens can’t do that. Sign in to Vellum in a browser instead.");
    }
    const token = req.cookies?.[config.sessionCookie] as string | undefined;
    const user = await sessionUser(db, token);
    if (!user) throw unauthorized();
    res.locals.user = user;
    next();
  });
}

/**
 * Like requireUser, and also lets an API token through. Only for routes on the user's own
 * documents that the CLI needs; a request with a token is judged by the token alone.
 */
export function requireUserOrToken(db: Db, config: Config): RequestHandler {
  const sessionOnly = requireUser(db, config);
  return asyncHandler(async (req, res, next) => {
    const bearer = bearerToken(req);
    if (bearer === undefined) return sessionOnly(req, res, next);
    const user = bearer ? await tokenUser(db, bearer) : null;
    if (!user) throw unauthorized("That API token isn’t valid. Make a new one in Vellum’s Settings.");
    const locals: RequestUser = { id: user.id, isAdmin: user.isAdmin, token: { id: user.tokenId, name: user.tokenName } };
    res.locals.user = locals;
    next();
  });
}

/** After requireUser: admins only. */
export const requireAdmin: RequestHandler = (_req, res, next) => {
  next(currentUser(res).isAdmin ? undefined : forbidden("Only admins can do that."));
};

export function currentUser(res: Response): RequestUser {
  const user = res.locals.user as RequestUser | undefined;
  if (!user) throw new Error("currentUser() needs requireUser() in front of the route");
  return user;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie-authenticated writes: the browser always sends Origin on
 * cross-site POSTs, and the usercontent origin is a different origin, so it's refused too.
 * Requests with a Bearer token are API-token requests, which a browser can't forge cross-site
 * (no CORS here), and requireUser refuses them on every cookie-only route.
 */
export function sameOrigin(config: Config): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (bearerToken(req) !== undefined) return next();
    if (req.get("origin") !== config.appOrigin) return next(forbidden("Cross-origin request refused."));
    next();
  };
}

export function validateBody<T extends z.ZodType>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      return next(new HttpError(400, "Check the highlighted fields.", fields));
    }
    req.body = parsed.data;
    next();
  };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, fields: err.fields } });
    return;
  }
  // multer and body-parser errors
  const e = err as { code?: string; type?: string; status?: number };
  if (e.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: { message: "That file is too large." } });
    return;
  }
  if (e.type === "entity.parse.failed") {
    res.status(400).json({ error: { message: "The request body isn’t valid JSON." } });
    return;
  }
  // Postgres "invalid input syntax" for a malformed uuid in the URL
  if ((err as { code?: string }).code === "22P02") {
    res.status(404).json({ error: { message: "Not found." } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { message: "Something went wrong on the server. Try again." } });
};
