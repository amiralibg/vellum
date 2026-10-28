import type { Config } from "../config.js";
import { Signer } from "./secrets.js";

/** Reader tokens are reissued on every /p/ load, so an hour only has to outlast one visit. */
export const SITE_TOKEN_TTL_MS = 60 * 60 * 1000;
const PURPOSE = "usercontent";

export interface SiteClaims {
  d: string; // document id
  v: string; // version id
  r: number; // password_rev, so changing the password ends open tokens too
  e: number; // expiry, ms since epoch
  /** Owner preview: any version of the document, published or not. */
  o?: 1;
}

/**
 * The capability in `USERCONTENT_URL/u/<token>/…`. It sits in the path rather than a query
 * string so relative URLs inside an uploaded zip (style.css, img/logo.png) carry it along.
 */
export class SiteTokens {
  private readonly signer: Signer;

  constructor(private readonly config: Config) {
    this.signer = new Signer(config.signingSecret);
  }

  issue(claims: Omit<SiteClaims, "e">, now = Date.now()): string {
    return this.signer.sign(PURPOSE, { ...claims, e: now + SITE_TOKEN_TTL_MS });
  }

  /** The claims of a genuine, unexpired token, or null. Whether the document may still be shown is the caller's check. */
  verify(token: string, now = Date.now()): SiteClaims | null {
    const claims = this.signer.verify<SiteClaims>(PURPOSE, token);
    if (!claims || typeof claims.d !== "string" || typeof claims.v !== "string" || !(claims.e > now)) return null;
    return claims;
  }

  url(token: string, entry: string): string {
    return `${this.config.usercontentOrigin}/u/${token}/${entry}`;
  }
}
