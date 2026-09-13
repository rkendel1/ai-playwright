import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.e2e.ts", "packages/**/__tests__/**/*.test.ts"],
    testTimeout: 30000,
  },
});
