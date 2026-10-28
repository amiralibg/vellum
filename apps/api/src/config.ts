import path from "node:path";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8000),
    APP_URL: z.url(),
    USERCONTENT_URL: z.url(),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: z.string().min(1),
    DATA_DIR: z.string().min(1).default("./data"),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(20),
    MAX_UNZIPPED_MB: z.coerce.number().positive().default(100),
    MAX_ZIP_FILES: z.coerce.number().int().positive().default(1000),
    OWNER_EMAIL: z.email(),
    OWNER_PASSWORD: z.string().min(8, "OWNER_PASSWORD must be at least 8 characters"),
    OWNER_NAME: z.string().min(1).default("Owner"),
    SIGNING_SECRET: z.string().min(32, "SIGNING_SECRET must be at least 32 characters"),
    ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters"),
  })
  .refine((env) => new URL(env.APP_URL).origin !== new URL(env.USERCONTENT_URL).origin, {
    message: "USERCONTENT_URL must be a different origin from APP_URL",
    path: ["USERCONTENT_URL"],
  });

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const appUrl = new URL(e.APP_URL);
  const usercontentUrl = new URL(e.USERCONTENT_URL);
  const secure = appUrl.protocol === "https:";
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    trustProxy: e.TRUST_PROXY,
    appOrigin: appUrl.origin,
    appHost: appUrl.host,
    usercontentOrigin: usercontentUrl.origin,
    usercontentHost: usercontentUrl.host,
    databaseUrl: e.DATABASE_URL,
    dataDir: path.resolve(e.DATA_DIR),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    zipLimits: {
      maxUnzippedBytes: Math.round(e.MAX_UNZIPPED_MB * 1024 * 1024),
      maxFiles: e.MAX_ZIP_FILES,
    },
    owner: { email: e.OWNER_EMAIL.toLowerCase(), password: e.OWNER_PASSWORD, name: e.OWNER_NAME },
    signingSecret: e.SIGNING_SECRET,
    encryptionKey: e.ENCRYPTION_KEY,
    /** `__Host-` needs Secure, which plain-http dev can't set reliably (Safari). */
    sessionCookie: secure ? "__Host-vellum_session" : "vellum_session",
    secureCookies: secure,
  };
}
