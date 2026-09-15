// Extend the root Prettier configuration.
// No style overrides: ported code is root-style (printWidth 100,
// double quotes, semi). Do not copy addon-sdk's 90/singleQuote overrides.
const baseConfig = require("../../.prettierrc.cjs");

module.exports = {
  ...baseConfig,
};
