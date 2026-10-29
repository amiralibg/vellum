import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  inviteAcceptSchema,
  loginSchema,
  passwordResetSchema,
  type InviteAccept,
  type LoginInput,
  type PasswordReset,
} from "@vellum/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { forbidden, unauthorized } from "../errors.js";
import { asyncHandler, currentUser, requireUser, validateBody } from "../middleware/index.js";
import { checkCredentials, createSession, deleteSession, getAccount } from "../services/auth.js";
import type { Invites } from "../services/invites.js";

const tooMany = (message: string) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
      res.status(429).json({ error: { message } });
    },
  });

export function authRouter(db: Db, config: Config, invites: Invites): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    // No `domain`: the cookie stays host-only on APP_URL.
  };

  const signIn = async (res: Response, userId: string) => {
    const session = await createSession(db, userId);
    res.cookie(config.sessionCookie, session.token, { ...cookieOptions, expires: session.expiresAt });
    res.json({ account: await getAccount(db, config, userId) });
  };

  router.post(
    "/login",
    tooMany("Too many sign-in attempts. Wait 15 minutes and try again."),
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as LoginInput;
      const user = await checkCredentials(db, email, password);
      if (!user) throw unauthorized("That email and password don’t match.");
      if (user.disabled) throw forbidden("This account has been disabled. Ask an admin if you think that’s a mistake.");
      await signIn(res, user.id);
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
    requireUser(db, config),
    asyncHandler(async (_req, res) => {
      res.json({ account: await getAccount(db, config, currentUser(res).id) });
    }),
  );

  // Invite and reset links carry 256-bit tokens, so guessing is hopeless; the limit keeps it that way cheaply.
  const linkLimiter = tooMany("Too many attempts. Wait 15 minutes and try again.");

  router.get(
    "/invites/:token",
    linkLimiter,
    asyncHandler(async (req, res) => {
      res.json(await invites.info(req.params.token!));
    }),
  );

  router.post(
    "/invites/:token",
    linkLimiter,
    validateBody(inviteAcceptSchema),
    asyncHandler(async (req, res) => {
      await signIn(res, await invites.accept(req.params.token!, req.body as InviteAccept));
    }),
  );

  router.get(
    "/resets/:token",
    linkLimiter,
    asyncHandler(async (req, res) => {
      res.json(await invites.resetInfo(req.params.token!));
    }),
  );

  /** Every session of the account is signed out, then this browser is signed in with the new password. */
  router.post(
    "/resets/:token",
    linkLimiter,
    validateBody(passwordResetSchema),
    asyncHandler(async (req, res) => {
      await signIn(res, await invites.useReset(req.params.token!, (req.body as PasswordReset).password));
    }),
  );

  return router;
}
