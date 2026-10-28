import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM for values the owner must be able to read back (document passwords). */
export class Encryptor {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(`vellum:encrypt:${secret}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), body].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
  }

  /** Null when the value was encrypted with another key or tampered with. */
  decrypt(sealed: string): string | null {
    const [v, iv, tag, body] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || body === undefined) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
}

/**
 * HMAC-signed JSON tokens. `purpose` separates uses of the one SIGNING_SECRET, so an
 * unlock cookie can never be replayed as a usercontent token or the other way round.
 */
export class Signer {
  constructor(private readonly secret: string) {}

  sign(purpose: string, payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.mac(purpose, body)}`;
  }

  verify<T>(purpose: string, token: string | undefined): T | null {
    if (!token) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = Buffer.from(this.mac(purpose, body));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    } catch {
      return null;
    }
  }

  private mac(purpose: string, body: string): string {
    return createHmac("sha256", this.secret).update(`${purpose}\n${body}`).digest("base64url");
  }
}
