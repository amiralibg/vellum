import request from "supertest";
import { describe, expect, it } from "vitest";
import { useTestApp } from "./helpers.js";

// Behind Traefik (TRUST_PROXY=1) every request reaches the container under its internal address;
// the public host comes in X-Forwarded-Host.
const t = useTestApp({ TRUST_PROXY: "1" });

const viaProxy = (path: string, host: string) =>
  request(t.app).get(path).set("Host", "vellum-app:8000").set("X-Forwarded-Host", host).set("X-Forwarded-Proto", "https");

describe("behind a reverse proxy", () => {
  it("routes by the forwarded host: the app on APP_URL, uploaded sites only on USERCONTENT_URL", async () => {
    const login = await viaProxy("/login", "app.test");
    expect(login.status).not.toBe(404);
    await viaProxy("/api/auth/me", "app.test").expect(401);
    await viaProxy("/api/auth/me", "uc.test").expect(404);
    await viaProxy("/api/auth/me", "elsewhere.example").expect(404);
  });

  it("answers health checks on the container address", async () => {
    await request(t.app).get("/health").set("Host", "10.0.1.5:8000").expect(200, { status: "ok" });
  });
});
