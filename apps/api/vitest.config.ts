import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
