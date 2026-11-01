import { defineConfig } from "tsup";

export default defineConfig({
  entry: { vellum: "src/bin.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  // One file with no runtime dependencies, so `npm install -g` of the packed tarball just works.
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
});
