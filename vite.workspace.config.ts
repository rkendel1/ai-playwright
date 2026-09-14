import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  define: {
    __dirname: JSON.stringify("/"),
  },
  build: {
    lib: {
      entry: path.resolve("packages/workspace/browser-planner.ts"),
      formats: ["es"],
      fileName: () => "browser-planner.js",
    },
    outDir: "dist/packages/workspace",
    emptyOutDir: false,
  },
});
