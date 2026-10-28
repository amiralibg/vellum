// Picks up TEST_DATABASE_URL from the repo's .env; everything else is pinned below.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // no .env: defaults apply
}
process.env.NODE_ENV = "test";
process.env.APP_URL = "http://app.test";
process.env.USERCONTENT_URL = "http://uc.test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/vellum_test";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.OWNER_PASSWORD = "correct horse battery";
process.env.OWNER_NAME = "Amirali";
process.env.SIGNING_SECRET = "test-signing-secret-0123456789abcdefghijklmnop";
process.env.ENCRYPTION_KEY = "test-encryption-key-0123456789abcdefghijklmnop";
process.env.MAX_UPLOAD_MB = "1";
process.env.MAX_UNZIPPED_MB = "3";
process.env.MAX_ZIP_FILES = "50";
