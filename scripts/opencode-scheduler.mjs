#!/usr/bin/env node
// Thin OpenCode-flavored entry point over the shared factory-scheduler-core.
// See .factory/README.md.
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { helpText, parseSchedulerArgs, runScheduler } from "./factory-scheduler-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {
  engine: "opencode",
  root,
  worktreeScript: join(root, "scripts", "opencode-worktree.sh"),
  driverScript: join(root, "scripts", "opencode-driver.mjs"),
  extraDriveArgs: [],
};

const opts = parseSchedulerArgs(process.argv.slice(2), {
  label: "opencode",
  agent: "orchestrator",
  timeout: 1800000,
});

if (opts.help) {
  console.log(helpText("OpenCode", "opencode"));
  process.exit(0);
}

runScheduler(opts, ctx).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
