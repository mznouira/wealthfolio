#!/usr/bin/env node
// The Claude Code counterpart to opencode-driver.mjs. Claude Code has no HTTP
// server mode to drive, so this shells out to `claude -p` directly instead of
// spawning/health-checking a server. Same CLI surface as the opencode driver
// (see factory-driver-common.mjs) so the two are interchangeable in scripts.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { baseOptions, parseCommonArgs, HELP_COMMON } from "./factory-driver-common.mjs";

const HELP = `Drive a headless Claude Code session.

Usage:
  node scripts/claude-driver.mjs --prompt "..." [options]
  node scripts/claude-driver.mjs --prompt-file spec.md --agent orchestrator

Options:
${HELP_COMMON}
  --unattended          No one is watching: deny (rather than hang on) any
                         permission prompt not already covered by
                         .claude/settings.json's allow-list. Use for
                         scheduled/nightly runs.`;

function parseArgs(argv) {
  const opts = baseOptions({ agent: "orchestrator", timeout: 600000 });
  opts.unattended = false;
  return parseCommonArgs(argv, opts, {
    "--unattended": (o) => (o.unattended = true),
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (opts.dryRun) {
    const exitCode = await new Promise((resolve) => {
      const child = spawn("claude", ["--version"], { cwd: opts.dir, stdio: "ignore" });
      child.on("error", () => resolve(1));
      child.on("close", (code) => resolve(code));
    });
    console.log(
      exitCode === 0
        ? `dry-run ok: claude CLI available (dir=${opts.dir})`
        : "dry-run failed: claude CLI not found",
    );
    process.exitCode = exitCode === 0 ? 0 : 1;
    return;
  }

  const prompt = opts.promptFile ? readFileSync(opts.promptFile, "utf8") : opts.prompt;
  if (!prompt) {
    console.error("error: provide --prompt or --prompt-file");
    process.exit(2);
  }

  const args = [
    "-p",
    prompt,
    "--agent",
    opts.agent,
    "--output-format",
    opts.json ? "json" : "text",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.title) args.push("--name", opts.title);
  if (opts.unattended) args.push("--permission-prompts", "none");

  const controller = new AbortController();
  const timer = opts.timeout > 0 ? setTimeout(() => controller.abort(), opts.timeout) : null;

  let stdout = "";
  let stderr = "";
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: opts.dir,
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
    });
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  }).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (exitCode !== 0) {
    console.error(stderr.trim() || `claude exited with code ${exitCode}`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(stdout.endsWith("\n") ? stdout : stdout + "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
