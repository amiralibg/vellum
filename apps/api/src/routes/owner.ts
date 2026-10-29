import { Router, type Request } from "express";
import multer from "multer";
import {
  accountSettingsSchema,
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
import { asyncHandler, currentUser, requireUser, validateBody } from "../middleware/index.js";
import { changePassword, getAccount, updateAccountSettings } from "../services/auth.js";
import type { Analytics } from "../services/analytics.js";
import type { DocumentService, ListFilter } from "../services/documents.js";
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
  router.use(requireUser(db, config));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });

  /** The browser's IANA zone, so "today", the 14 days and "this month" are the user's. */
  const zoneOf = (req: Request) => (typeof req.query.tz === "string" ? req.query.tz : "UTC");

  router.get(
    "/documents",
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

  const uploadedFile = (req: Request) => {
    if (!req.file) throw badRequest("Choose a file to upload.");
    // multer decodes the multipart filename as latin1.
    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    return { originalName, buffer: req.file.buffer };
  };

  router.post(
    "/documents",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      res.status(201).json(await documents.createFromUpload(currentUser(res).id, uploadedFile(req)));
    }),
  );

  router.get(
    "/documents/:id",
    asyncHandler(async (req, res) => {
      res.json(await documents.get(currentUser(res).id, req.params.id!));
    }),
  );

  router.patch(
    "/documents/:id",
    validateBody(documentSettingsPatchSchema),
    asyncHandler(async (req, res) => {
      res.json(await documents.update(currentUser(res).id, req.params.id!, req.body as DocumentSettingsPatch));
    }),
  );

  router.post(
    "/documents/:id/publish",
    asyncHandler(async (req, res) => {
      res.json(await documents.publish(currentUser(res).id, req.params.id!));
    }),
  );

  router.post(
    "/documents/:id/unpublish",
    asyncHandler(async (req, res) => {
      res.json(await documents.unpublish(currentUser(res).id, req.params.id!));
    }),
  );

  router.delete(
    "/documents/:id",
    asyncHandler(async (req, res) => {
      await documents.remove(currentUser(res).id, req.params.id!);
      res.status(204).end();
    }),
  );

  router.get(
    "/documents/:id/versions",
    asyncHandler(async (req, res) => {
      res.json(await documents.listVersions(currentUser(res).id, req.params.id!));
    }),
  );

  router.post(
    "/documents/:id/versions",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      res.status(201).json(await documents.addVersion(currentUser(res).id, req.params.id!, uploadedFile(req)));
    }),
  );

  router.post(
    "/documents/:id/versions/:versionId/restore",
    asyncHandler(async (req, res) => {
      res.json(await documents.restoreVersion(currentUser(res).id, req.params.id!, req.params.versionId!));
    }),
  );

  router.get(
    "/documents/:id/preview",
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
    asyncHandler(async (req, res) => {
      res.json(await analytics.stats(currentUser(res).id, req.params.id!, { tz: zoneOf(req) }));
    }),
  );

  router.get(
    "/documents/:id/views",
    asyncHandler(async (req, res) => {
      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) throw badRequest("Pages start at 1.");
      res.json(await analytics.page(currentUser(res).id, req.params.id!, page));
    }),
  );

  router.get(
    "/slugs/:slug",
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

  router.get(
    "/settings",
    asyncHandler(async (_req, res) => {
      res.json({ account: await getAccount(db, config, currentUser(res).id) });
    }),
  );

  router.patch(
    "/settings",
    validateBody(accountSettingsSchema),
    asyncHandler(async (req, res) => {
      res.json({ account: await updateAccountSettings(db, config, currentUser(res).id, req.body as AccountSettings) });
    }),
  );

  /** Signs out the account's other sessions; this one stays. */
  router.put(
    "/settings/password",
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
