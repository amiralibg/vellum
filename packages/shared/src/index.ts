import { z } from "zod";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens, up to 64 characters.");

const emailSchema = z.email("Enter an email address.").trim().toLowerCase().max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const ACCOUNT_PASSWORD_MIN = 8;
export const accountPasswordSchema = z
  .string()
  .min(ACCOUNT_PASSWORD_MIN, `Use at least ${ACCOUNT_PASSWORD_MIN} characters.`)
  .max(200, "Use 200 characters or fewer.");

const displayNameSchema = z.string().trim().min(1, "Enter the name readers see.").max(80);

export const themeSchema = z.enum(["system", "light", "dark"]);
export type ThemePreference = z.infer<typeof themeSchema>;

export const documentKindSchema = z.enum(["markdown", "html"]);
export type DocumentKind = z.infer<typeof documentKindSchema>;

export const documentStatusSchema = z.enum(["draft", "live", "unpublished"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const accessSchema = z.enum(["link", "password"]);
export type Access = z.infer<typeof accessSchema>;

/** "7d" and "30d" count from when they're chosen (or from first publish, for drafts). */
export const expiryPresetSchema = z.enum(["never", "7d", "30d", "date"]);
export type ExpiryPreset = z.infer<typeof expiryPresetSchema>;

export const DOCUMENT_PASSWORD_MIN = 4;

/** Settings the owner edits on the Publish settings screen. */
export const documentSettingsSchema = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(200),
  slug: slugSchema,
  access: accessSchema,
  /** Only read when access is "password". Empty keeps the current password. */
  password: z.string().max(200, "Use 200 characters or fewer."),
  expiryPreset: expiryPresetSchema,
  /** The closing moment for the "date" preset; ignored for the others. */
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  trackViews: z.boolean(),
  allowDownload: z.boolean(),
  noindex: z.boolean(),
  replyEmail: z.union([z.email("Enter an email address for the Reply button."), z.literal("")]),
});
export type DocumentSettings = z.infer<typeof documentSettingsSchema>;
export const documentSettingsPatchSchema = documentSettingsSchema.partial();
export type DocumentSettingsPatch = z.infer<typeof documentSettingsPatchSchema>;

export const accountSettingsSchema = z.object({
  displayName: displayNameSchema,
  theme: themeSchema,
  replyNote: z.string().trim().max(120),
});
export type AccountSettings = z.infer<typeof accountSettingsSchema>;

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: accountPasswordSchema,
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

/** What an account uses against its limits. A null limit means none (admins). */
export interface Usage {
  documents: number;
  storageBytes: number;
  maxDocuments: number | null;
  maxStorageBytes: number | null;
}

/** The signed-in user. */
export interface Account extends AccountSettings {
  id: string;
  email: string;
  isAdmin: boolean;
  usage: Usage;
}

// --- Invites and password resets: links an admin hands out; Vellum sends no email.

export const inviteCreateSchema = z.object({
  note: z.string().trim().max(80, "Use 80 characters or fewer."),
});
export type InviteCreate = z.infer<typeof inviteCreateSchema>;

export const inviteAcceptSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  password: accountPasswordSchema,
});
export type InviteAccept = z.infer<typeof inviteAcceptSchema>;

export const passwordResetSchema = z.object({ password: accountPasswordSchema });
export type PasswordReset = z.infer<typeof passwordResetSchema>;

/** A pending invite, as admins see it. The link itself is only shown once, when it's created. */
export interface InviteItem {
  id: string;
  note: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

/** A freshly created invite or reset link. */
export interface IssuedLink {
  url: string;
  expiresAt: string;
}

export interface CreatedInvite extends IssuedLink {
  invite: InviteItem;
}

/** What the invite page shows before the form. */
export interface InviteInfo {
  /** The name the admin gave the invite ("Welcome, Sara"); empty when they left it blank. */
  name: string;
  invitedBy: string;
  expiresAt: string;
}

/** What the password reset page shows before the form. */
export interface ResetInfo {
  email: string;
  expiresAt: string;
}

// --- Admin: accounts. Admins manage accounts but never see other users' documents.

export const userPatchSchema = z
  .object({
    isAdmin: z.boolean(),
    disabled: z.boolean(),
    /** Null puts the env default back. */
    maxDocuments: z.number().int().min(1, "Allow at least 1 document.").max(100_000).nullable(),
    maxStorageMb: z.number().int().min(1, "Allow at least 1 MB.").max(1_000_000).nullable(),
  })
  .partial();
export type UserPatch = z.infer<typeof userPatchSchema>;

export interface UserItem {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  usage: Usage;
  /** The admin's own limits for this user; null where the default applies. */
  limits: { maxDocuments: number | null; maxStorageMb: number | null };
}

export interface UserListResponse {
  users: UserItem[];
  /** USER_MAX_DOCUMENTS and USER_MAX_STORAGE_MB. */
  defaults: { maxDocuments: number; maxStorageMb: number };
}

export interface Heading {
  id: string;
  text: string;
}

export interface VersionSummary {
  number: number;
  originalName: string;
  sourceType: "md" | "html" | "zip";
  sizeBytes: number;
  wordCount: number;
  createdAt: string;
}

export interface VersionListItem extends VersionSummary {
  id: string;
  current: boolean;
}

export interface DocumentSummary {
  id: string;
  slug: string;
  title: string;
  kind: DocumentKind;
  status: DocumentStatus;
  views: number;
  people: number;
  updatedAt: string;
  expiresAt: string | null;
  access: "link" | "password";
}

export interface DocumentListResponse {
  documents: DocumentSummary[];
  counts: { all: number; live: number; drafts: number; expired: number };
  viewsThisMonth: number;
}

export interface DocumentDetail extends Omit<DocumentSettings, "password"> {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  url: string;
  /** The current password, decrypted for the owner. Null for link-only documents. */
  password: string | null;
  version: VersionSummary;
}

/** What Publish settings shows in its preview pane. */
export interface DocumentPreview {
  kind: DocumentKind;
  title: string;
  eyebrow: string;
  description: string;
  /** Sanitized Markdown body; empty for HTML documents. */
  html: string;
  /** HTML documents: the site on the usercontent origin, with a short-lived owner token. */
  frameUrl: string | null;
}

/** One reader's visit, as the owner sees it. */
export interface ViewItem {
  id: string;
  at: string;
  /** "Visitor N": the Nth different visitor to this document that day (UTC). */
  visitor: number;
  /** ISO 3166 alpha-2, only when a CDN header provided it. */
  country: string | null;
  device: string;
  browser: string;
  /** Percent of the document scrolled into view; null for HTML documents. */
  depth: number | null;
  /** Seconds the tab was visible; null for HTML documents. */
  seconds: number | null;
}

export interface SectionReach {
  id: string;
  text: string;
  /** Percent of views of the current version that reached this H2. */
  pct: number;
}

/** The analytics on the document page. Counts cover the last 14 days in the owner's time zone. */
export interface DocumentStats {
  days: { date: string; views: number }[];
  totals: {
    views: number;
    /** Unique visitors per day, summed over the days: someone who reads on two days counts twice. */
    people: number;
    /** Markdown only; null for HTML documents or before any views. */
    avgSeconds: number | null;
    /** Percent of views that reached the last H2 or scrolled 90%. Markdown only. */
    readToEnd: number | null;
  };
  /** False for HTML documents, which count opens only. */
  tracksReading: boolean;
  /** Current version only. */
  sections: SectionReach[];
  sectionsVersion: number;
  /** Views of the current version in the window: what the section percentages are of. */
  sectionsBase: number;
  /** A section more people reach than the one right before it. */
  skipAhead: { section: string; previous: string; pct: number } | null;
  recent: ViewItem[];
  /** Every view ever, for "See all". */
  allViews: number;
}

export interface ViewsPage {
  views: ViewItem[];
  page: number;
  pageSize: number;
  total: number;
  tracksReading: boolean;
}

export interface SlugAvailability {
  slug: string;
  available: boolean;
  reason?: "taken" | "invalid";
}

export interface ApiError {
  error: { message: string; fields?: Record<string, string> };
}
