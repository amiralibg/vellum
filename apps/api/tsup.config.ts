import { defineConfig } from "tsup";

export default defineConfig({
  // Flat names: the image runs `node dist/server.js` and `node dist/owner-reset.js`.
  entry: { server: "src/server.ts", "owner-reset": "src/scripts/owner-reset.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  // Bundle the workspace package (it ships TypeScript source); keep npm deps external.
  noExternal: ["@vellum/shared"],
});
