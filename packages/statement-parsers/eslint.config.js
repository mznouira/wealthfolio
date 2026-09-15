import { createBaseConfig } from "../../eslint.base.config.js";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "vitest.config.ts"],
  },
  ...createBaseConfig({
    includeReact: false,
    includeTanstackQuery: false,
    includeReactRefresh: false,
    tsconfigPath: "./tsconfig.json",
  }),
];
