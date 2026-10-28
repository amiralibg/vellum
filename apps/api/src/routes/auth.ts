import { Router } from "express";
import rateLimit from "express-rate-limit";
import { loginSchema, type LoginInput } from "@vellum/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { unauthorized } from "../errors.js";
import { asyncHandler, requireOwner, validateBody } from "../middleware/index.js";
import { checkCredentials, createSession, deleteSession, getOwner } from "../services/auth.js";

export function authRouter(db: Db, config: Config): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    // No `domain`: the cookie stays host-only on APP_URL.
  };

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
      res.status(429).json({ error: { message: "Too many sign-in attempts. Wait 15 minutes and try again." } });
    },
  });

  router.post(
    "/login",
    loginLimiter,
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as LoginInput;
      if (!(await checkCredentials(db, email, password))) throw unauthorized("That email and password don’t match.");
      const session = await createSession(db);
      res.cookie(config.sessionCookie, session.token, { ...cookieOptions, expires: session.expiresAt });
      res.json({ owner: await getOwner(db) });
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      await deleteSession(db, req.cookies?.[config.sessionCookie] as string | undefined);
      res.clearCookie(config.sessionCookie, cookieOptions);
      res.status(204).end();
    }),
  );

  router.get(
    "/me",
    requireOwner(db, config),
    asyncHandler(async (_req, res) => {
      res.json({ owner: await getOwner(db) });
    }),
  );

  return router;
}
