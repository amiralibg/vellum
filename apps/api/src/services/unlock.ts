import type { Config } from "../config.js";
import type { DocumentRow } from "./documents.js";
import { Signer } from "./secrets.js";

/** How long a reader stays unlocked on one browser. Expiry and password changes end it sooner. */
export const UNLOCK_TTL_MS = 30 * 86_400_000;
const PURPOSE = "unlock";

interface UnlockClaims {
  d: string; // document id
  r: number; // password_rev at unlock time
  e: number; // expiry, ms since epoch
}

/**
 * The reader's proof that they typed a document's password. Scoped to Path=/p/<slug>, and
 * signed over the password revision, so changing the password locks everyone out again.
 */
export class UnlockCookies {
  readonly name: string;
  private readonly signer: Signer;

  constructor(private readonly config: Config) {
    this.signer = new Signer(config.signingSecret);
    this.name = config.secureCookies ? "__Secure-vellum_unlock" : "vellum_unlock";
  }

  issue(doc: Pick<DocumentRow, "id" | "password_rev">, now = Date.now()): string {
    const claims: UnlockClaims = { d: doc.id, r: doc.password_rev, e: now + UNLOCK_TTL_MS };
    return this.signer.sign(PURPOSE, claims);
  }

  isValid(doc: Pick<DocumentRow, "id" | "password_rev">, token: string | undefined, now = Date.now()): boolean {
    const claims = this.signer.verify<UnlockClaims>(PURPOSE, token);
    return Boolean(claims && claims.d === doc.id && claims.r === doc.password_rev && claims.e > now);
  }

  options(slug: string) {
    return {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: "lax" as const,
      path: `/p/${slug}`,
      maxAge: UNLOCK_TTL_MS,
    };
  }
}
