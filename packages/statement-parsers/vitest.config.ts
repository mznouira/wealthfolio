import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      // W2-D4 node plan B — pdfjs-dist's standard build is not Node-supported; the legacy build is (browser path unaffected; this config only applies to the package's own vitest).
      "pdfjs-dist": "pdfjs-dist/legacy/build/pdf.mjs",
    },
  },
});
