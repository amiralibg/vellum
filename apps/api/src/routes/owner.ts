import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  accountSettingsSchema,
  apiTokenCreateSchema,
  pushFieldsSchema,
  type ApiTokenCreate,
  type PushResult,
  type WhoAmI,
  documentSettingsPatchSchema,
  passwordChangeSchema,
  type AccountSettings,
  type DocumentListResponse,
  type DocumentPreview,
  type DocumentSettingsPatch,
  type PasswordChange,
  type SlugAvailability,
} from "@vellum/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { badRequest } from "../errors.js";
import { asyncHandler, currentUser, requireUser, requireUserOrToken, validateBody } from "../middleware/index.js";
import { changePassword, getAccount, updateAccountSettings } from "../services/auth.js";
import type { Analytics } from "../services/analytics.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../services/api-tokens.js";
import type { DocumentService, ListFilter, UploadedFile } from "../services/documents.js";
import type { SiteTokens } from "../services/site-tokens.js";
import { isSlugTaken, isValidSlug } from "../services/slug.js";

const FILTERS = new Set<ListFilter>(["all", "live", "drafts", "expired"]);

/**
 * The signed-in user's own documents and settings: everything under /api except auth and admin.
 * Another user's document answers 404, as if it didn't exist; admins included.
 */
export function ownerRouter(
  db: Db,
  config: Config,
  documents: DocumentService,
  siteTokens: SiteTokens,
  analytics: Analytics,
): Router {
  const router = Router();
  // Every route says who may call it: `user` is a dashboard session only; `userOrToken` also
  // takes an API token. Tokens get only what the CLI needs, so nothing destructive and no account settings.
  const user = requireUser(db, config);
  const userOrToken = requireUserOrToken(db, config);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });

  /** The browser's IANA zone, so "today", the 14 days and "this month" are the user's. */
  const zoneOf = (req: Request) => (typeof req.query.tz === "string" ? req.query.tz : "UTC");

  router.get(
    "/documents",
    userOrToken,
    asyncHandler(async (req, res) => {
      const { id: userId } = currentUser(res);
      const filter = (typeof req.query.status === "string" ? req.query.status : "all") as ListFilter;
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const [list, viewsThisMonth] = await Promise.all([
        documents.list(userId, FILTERS.has(filter) ? filter : "all", q),
        analytics.viewsThisMonth(userId, { tz: zoneOf(req) }),
      ]);
      const body: DocumentListResponse = { ...list, viewsThisMonth };
      res.json(body);
    }),
  );

  const uploadedFile = (req: Request, res: Response): UploadedFile => {
    if (!req.file) throw badRequest("Choose a file to upload.");
    // multer decodes the multipart filename as latin1.
    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const via = currentUser(res).token?.name;
    return { originalName, buffer: req.file.buffer, ...(via ? { uploadedVia: via } : {}) };
  };

  router.post(
    "/documents",
    userOrToken,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      res.status(201).json(await documents.createFromUpload(currentUser(res).id, uploadedFile(req, res)));
    }),
  );

  router.get(
    "/documents/:id",
    userOrToken,
    asyncHandler(async (req, res) => {
      res.json(await documents.get(currentUser(res).id, req.params.id!));
    }),
  );

  router.patch(
    "/documents/:id",
    userOrToken,
    validateBody(documentSettingsPatchSchema),
    asyncHandler(async (req, res) => {
      res.json(await documents.update(currentUser(res).id, req.params.id!, req.body as DocumentSettingsPatch));
    }),
  );

  router.post(
    "/documents/:id/publish",
    userOrToken,
    asyncHandler(async (req, res) => {
      res.json(await documents.publish(currentUser(res).id, req.params.id!));
    }),
  );

  router.post(
    "/documents/:id/unpublish",
    user,
    asyncHandler(async (req, res) => {
      res.json(await documents.unpublish(currentUser(res).id, req.params.id!));
    }),
  );

  router.delete(
    "/documents/:id",
    user,
    asyncHandler(async (req, res) => {
      await documents.remove(currentUser(res).id, req.params.id!);
      res.status(204).end();
    }),
  );

  router.get(
    "/documents/:id/versions",
    userOrToken,
    asyncHandler(async (req, res) => {
      res.json(await documents.listVersions(currentUser(res).id, req.params.id!));
    }),
  );

  router.post(
    "/documents/:id/versions",
    userOrToken,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      res.status(201).json(await documents.addVersion(currentUser(res).id, req.params.id!, uploadedFile(req, res)));
    }),
  );

  router.post(
    "/documents/:id/versions/:versionId/restore",
    user,
    asyncHandler(async (req, res) => {
      res.json(await documents.restoreVersion(currentUser(res).id, req.params.id!, req.params.versionId!));
    }),
  );

  router.get(
    "/documents/:id/preview",
    user,
    asyncHandler(async (req, res) => {
      const id = req.params.id!;
      const { preview, frame } = await documents.preview(currentUser(res).id, id);
      // An owner token opens the current version whatever its status, for its author's eyes only.
      const frameUrl = frame ? siteTokens.url(siteTokens.issue({ d: id, v: frame.versionId, r: 0, o: 1 }), frame.entryPath) : null;
      const body: DocumentPreview = { ...preview, frameUrl };
      res.json(body);
    }),
  );

  router.get(
    "/documents/:id/stats",
    user,
    asyncHandler(async (req, res) => {
      res.json(await analytics.stats(currentUser(res).id, req.params.id!, { tz: zoneOf(req) }));
    }),
  );

  router.get(
    "/documents/:id/views",
    user,
    asyncHandler(async (req, res) => {
      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) throw badRequest("Pages start at 1.");
      res.json(await analytics.page(currentUser(res).id, req.params.id!, page));
    }),
  );

  router.get(
    "/slugs/:slug",
    userOrToken,
    asyncHandler(async (req, res) => {
      const slug = req.params.slug!.toLowerCase();
      const except = typeof req.query.except === "string" ? req.query.except : undefined;
      let body: SlugAvailability;
      if (!isValidSlug(slug)) body = { slug, available: false, reason: "invalid" };
      else if (await isSlugTaken(db, slug, except)) body = { slug, available: false, reason: "taken" };
      else body = { slug, available: true };
      res.json(body);
    }),
  );

  /** The CLI's upload: a file plus optional settings, to a live link in one request. */
  router.post(
    "/push",
    userOrToken,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const parsed = pushFieldsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
        throw badRequest(Object.values(fields)[0] ?? "Check the upload’s settings.", fields);
      }
      const { created, document } = await documents.push(currentUser(res).id, uploadedFile(req, res), parsed.data);
      const body: PushResult = { created, document, dashboardUrl: `${config.appOrigin}/documents/${document.id}` };
      res.status(created ? 201 : 200).json(body);
    }),
  );

  /** Who an API token acts as, so the CLI can check it. */
  router.get(
    "/whoami",
    userOrToken,
    asyncHandler(async (_req, res) => {
      const { id, token } = currentUser(res);
      const account = await getAccount(db, config, id);
      const body: WhoAmI = {
        account: { email: account.email, displayName: account.displayName },
        token: { name: token?.name ?? "" },
      };
      res.json(body);
    }),
  );

  router.get(
    "/settings/tokens",
    user,
    asyncHandler(async (_req, res) => {
      res.json({ tokens: await listApiTokens(db, currentUser(res).id) });
    }),
  );

  router.post(
    "/settings/tokens",
    user,
    validateBody(apiTokenCreateSchema),
    asyncHandler(async (req, res) => {
      const { name } = req.body as ApiTokenCreate;
      res.status(201).json(await createApiToken(db, currentUser(res).id, name));
    }),
  );

  router.delete(
    "/settings/tokens/:tokenId",
    user,
    asyncHandler(async (req, res) => {
      await revokeApiToken(db, currentUser(res).id, req.params.tokenId!);
      res.status(204).end();
    }),
  );

  router.get(
    "/settings",
    user,
    asyncHandler(async (_req, res) => {
      res.json({ account: await getAccount(db, config, currentUser(res).id) });
    }),
  );

  router.patch(
    "/settings",
    user,
    validateBody(accountSettingsSchema),
    asyncHandler(async (req, res) => {
      res.json({ account: await updateAccountSettings(db, config, currentUser(res).id, req.body as AccountSettings) });
    }),
  );

  /** Signs out the account's other sessions; this one stays. */
  router.put(
    "/settings/password",
    user,
    validateBody(passwordChangeSchema),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body as PasswordChange;
      const token = req.cookies?.[config.sessionCookie] as string;
      await changePassword(db, currentUser(res).id, token, currentPassword, newPassword);
      res.status(204).end();
    }),
  );

  return router;
}
