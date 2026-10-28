import { describe, expect, it } from "vitest";
import { PITCH } from "./fixtures.js";
import { signedIn, useTestApp } from "./helpers.js";

const t = useTestApp();



describe("HTML uploads", () => {
  it("takes the title and description from the file", async () => {
    const owner = await signedIn(t.app);
    const res = await owner.post("/api/documents").attach("file", Buffer.from(PITCH), "pitch.html").expect(201);
    expect(res.body).toMatchObject({
      kind: "html",
      title: "Weft — Seed round",
      description: "We're raising $2M to make invoicing boring.",
      slug: "weft-seed-round",
    });
    expect(res.body.version).toMatchObject({ sourceType: "html", originalName: "pitch.html" });
  });
});
