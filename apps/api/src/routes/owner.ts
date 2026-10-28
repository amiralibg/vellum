import { Router, type Request } from "express";
import multer from "multer";
import {
  documentSettingsPatchSchema,
  ownerSettingsSchema,
  type DocumentListResponse,
  type DocumentPreview,
  type DocumentSettingsPatch,
  type OwnerSettings,
  type SlugAvailability,
} from "@vellum/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { badRequest } from "../errors.js";
import { asyncHandler, requireOwner, validateBody } from "../middleware/index.js";
import { getOwner, updateOwnerSettings } from "../services/auth.js";
import type { Analytics } from "../services/analytics.js";
import type { DocumentService, ListFilter } from "../services/documents.js";
import type { SiteTokens } from "../services/site-tokens.js";
import { isSlugTaken, isValidSlug } from "../services/slug.js";

const FILTERS = new Set<ListFilter>(["all", "live", "drafts", "expired"]);

/** Everything under /api except auth. Every route here requires the owner session. */
export function ownerRouter(
  db: Db,
  config: Config,
  documents: DocumentService,
  siteTokens: SiteTokens,
  analytics: Analytics,
): Router {
  const router = Router();
  router.use(requireOwner(db, config));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });

  /** The browser's IANA zone, so "today", the 14 days and "this month" are the owner's. */
  const zoneOf = (req: Request) => (typeof req.query.tz === "string" ? req.query.tz : "UTC");

  router.get(
    "/documents",
    asyncHandler(async (req, res) => {
      const filter = (typeof req.query.status === "string" ? req.query.status : "all") as ListFilter;
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const [list, viewsThisMonth] = await Promise.all([
        documents.list(FILTERS.has(filter) ? filter : "all", q),
        analytics.viewsThisMonth({ tz: zoneOf(req) }),
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
      res.status(201).json(await documents.createFromUpload(uploadedFile(req)));
    }),
  );

  router.get(
    "/documents/:id",
    asyncHandler(async (req, res) => {
      res.json(await documents.get(req.params.id!));
    }),
  );

  router.patch(
    "/documents/:id",
    validateBody(documentSettingsPatchSchema),
    asyncHandler(async (req, res) => {
      res.json(await documents.update(req.params.id!, req.body as DocumentSettingsPatch));
    }),
  );

  router.post(
    "/documents/:id/publish",
    asyncHandler(async (req, res) => {
      res.json(await documents.publish(req.params.id!));
    }),
  );

  router.post(
    "/documents/:id/unpublish",
    asyncHandler(async (req, res) => {
      res.json(await documents.unpublish(req.params.id!));
    }),
  );

  router.delete(
    "/documents/:id",
    asyncHandler(async (req, res) => {
      await documents.remove(req.params.id!);
      res.status(204).end();
    }),
  );

  router.get(
    "/documents/:id/versions",
    asyncHandler(async (req, res) => {
      res.json(await documents.listVersions(req.params.id!));
    }),
  );

  router.post(
    "/documents/:id/versions",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      res.status(201).json(await documents.addVersion(req.params.id!, uploadedFile(req)));
    }),
  );

  router.post(
    "/documents/:id/versions/:versionId/restore",
    asyncHandler(async (req, res) => {
      res.json(await documents.restoreVersion(req.params.id!, req.params.versionId!));
    }),
  );

  router.get(
    "/documents/:id/preview",
    asyncHandler(async (req, res) => {
      const id = req.params.id!;
      const { preview, frame } = await documents.preview(id);
      // An owner token opens the current version whatever its status, for the owner's eyes only.
      const frameUrl = frame ? siteTokens.url(siteTokens.issue({ d: id, v: frame.versionId, r: 0, o: 1 }), frame.entryPath) : null;
      const body: DocumentPreview = { ...preview, frameUrl };
      res.json(body);
    }),
  );

  router.get(
    "/documents/:id/stats",
    asyncHandler(async (req, res) => {
      res.json(await analytics.stats(req.params.id!, { tz: zoneOf(req) }));
    }),
  );

  router.get(
    "/documents/:id/views",
    asyncHandler(async (req, res) => {
      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) throw badRequest("Pages start at 1.");
      res.json(await analytics.page(req.params.id!, page));
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
      res.json({ owner: await getOwner(db) });
    }),
  );

  router.patch(
    "/settings",
    validateBody(ownerSettingsSchema),
    asyncHandler(async (req, res) => {
      res.json({ owner: await updateOwnerSettings(db, req.body as OwnerSettings) });
    }),
  );

  return router;
}
