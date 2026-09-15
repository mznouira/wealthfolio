#!/usr/bin/env node
// The Claude Code counterpart to opencode-scheduler.mjs. Same GitHub-issue
// polling and worktree/PR logic, driven through claude-driver.mjs instead.
// Always passes --unattended: a scheduled run has no one to answer a
// permission prompt, so anything outside .claude/settings.json's allow-list
// is auto-denied rather than hanging. See .factory/README.md.
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { helpText, parseSchedulerArgs, runScheduler } from "./factory-scheduler-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {
  engine: "claude",
  root,
  worktreeScript: join(root, "scripts", "claude-worktree.sh"),
  driverScript: join(root, "scripts", "claude-driver.mjs"),
  extraDriveArgs: ["--unattended"],
};

const opts = parseSchedulerArgs(process.argv.slice(2), {
  label: "claude",
  agent: "orchestrator",
  timeout: 1800000,
});

if (opts.help) {
  console.log(helpText("Claude Code", "claude"));
  process.exit(0);
}

runScheduler(opts, ctx).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
