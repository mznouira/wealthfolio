import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "pdfjs-dist": "pdfjs-dist/legacy/build/pdf.mjs",
    },
  },
});
