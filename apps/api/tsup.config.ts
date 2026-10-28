import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/scripts/owner-reset.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  // Bundle the workspace package (it ships TypeScript source); keep npm deps external.
  noExternal: ["@vellum/shared"],
});
