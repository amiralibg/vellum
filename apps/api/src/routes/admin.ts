import { Router } from "express";
import { inviteCreateSchema, userPatchSchema, type InviteCreate, type UserPatch } from "@vellum/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { asyncHandler, currentUser, requireAdmin, requireUser, validateBody } from "../middleware/index.js";
import type { Invites } from "../services/invites.js";
import { listUsers, updateUser } from "../services/users.js";

/** /api/admin: accounts and invites. Admins never see other users' documents or stats through here. */
export function adminRouter(db: Db, config: Config, invites: Invites): Router {
  const router = Router();
  router.use(requireUser(db, config), requireAdmin);

  router.get(
    "/users",
    asyncHandler(async (_req, res) => {
      res.json(await listUsers(db, config));
    }),
  );

  router.patch(
    "/users/:id",
    validateBody(userPatchSchema),
    asyncHandler(async (req, res) => {
      res.json(await updateUser(db, config, currentUser(res).id, req.params.id!, req.body as UserPatch));
    }),
  );

  router.post(
    "/users/:id/reset-link",
    asyncHandler(async (req, res) => {
      res.status(201).json(await invites.issueReset(currentUser(res).id, req.params.id!));
    }),
  );

  router.get(
    "/invites",
    asyncHandler(async (_req, res) => {
      res.json(await invites.pending());
    }),
  );

  router.post(
    "/invites",
    validateBody(inviteCreateSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await invites.create(currentUser(res).id, (req.body as InviteCreate).note));
    }),
  );

  router.delete(
    "/invites/:id",
    asyncHandler(async (req, res) => {
      await invites.revoke(req.params.id!);
      res.status(204).end();
    }),
  );

  return router;
}
