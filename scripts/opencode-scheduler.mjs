#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worktreeScript = join(root, "scripts", "opencode-worktree.sh");
const driverScript = join(root, "scripts", "opencode-driver.mjs");

const HELP = `Poll labeled GitHub issues and run OpenCode on each in an isolated worktree.

Usage:
  node scripts/opencode-scheduler.mjs [options]

Options:
  --label <name>      Issue label to poll (default: opencode)
  --limit <n>         Max issues per pass (default: 5)
  --interval <sec>    Loop forever with this delay; 0 runs once (default: 0)
  --from <ref>        Start worktrees from this ref (default: HEAD)
  --pr-base <branch>  Base branch for opened PRs (default: main)
  --agent <name>      OpenCode agent (default: orchestrator)
  --timeout <ms>      Per-issue driver timeout (default: 1800000)
  --open-pr           Commit, push, and open a PR for changed worktrees
  --comment           Comment the run summary back on the issue
  --keep              Keep worktrees after each run
  --dry-run           Print planned actions without running anything
  -h, --help          Show this help

Safety: without --open-pr and --comment the scheduler only runs the agent and
reports locally. Issues already labeled "opencode:pr" or "opencode:skip" are
ignored.`;

function parseArgs(argv) {
  const opts = {
    label: "opencode",
    limit: 5,
    interval: 0,
    from: "HEAD",
    prBase: "main",
    agent: "orchestrator",
    timeout: 1800000,
    openPr: false,
    comment: false,
    keep: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`error: ${arg} requires a value`);
        process.exit(2);
      }
      return value;
    };
    switch (arg) {
      case "--label":
        opts.label = next();
        break;
      case "--limit":
        opts.limit = Number(next());
        break;
      case "--interval":
        opts.interval = Number(next());
        break;
      case "--from":
        opts.from = next();
        break;
      case "--pr-base":
        opts.prBase = next();
        break;
      case "--agent":
        opts.agent = next();
        break;
      case "--timeout":
        opts.timeout = Number(next());
        break;
      case "--open-pr":
        opts.openPr = true;
        break;
      case "--comment":
        opts.comment = true;
        break;
      case "--keep":
        opts.keep = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        console.error(`error: unknown argument: ${arg}`);
        process.exit(2);
    }
  }
  return opts;
}

const hasLabel = (issue, name) => (issue.labels || []).some((label) => label.name === name);

async function listIssues(label, limit) {
  const { stdout } = await exec("gh", [
    "issue",
    "list",
    "--label",
    label,
    "--state",
    "open",
    "--limit",
    String(limit),
    "--json",
    "number,title,body,labels",
  ]);
  return JSON.parse(stdout);
}

function promptFor(issue) {
  return `Implement GitHub issue #${issue.number}: ${issue.title}

${issue.body || "(no body)"}

## Instructions

- Plan, implement, and verify the change in this worktree.
- Follow AGENTS.md and the verification skill.
- Make surgical changes. Do not commit, push, or open a PR; the scheduler handles that.
- End with a concise summary: files changed, verification results, and open questions.`;
}

async function git(args, cwd) {
  return exec("git", args, { cwd });
}

async function runIssue(issue, opts) {
  const branch = `agent/issue-${issue.number}`;
  const name = `issue-${issue.number}`;

  if (opts.dryRun) {
    console.log(`[dry-run] #${issue.number} ${issue.title} -> worktree ${name} (${branch})`);
    return;
  }

  const created = await exec(worktreeScript, ["create", name, "--from", opts.from, "--no-launch"], {
    cwd: root,
  });
  const worktree = (created.stdout.match(/^worktree:\s*(.+)$/m) || [])[1];
  if (!worktree) throw new Error(`could not determine worktree path for #${issue.number}`);

  const dir = mkdtempSync(join(tmpdir(), "opencode-issue-"));
  const promptFile = join(dir, "prompt.md");
  writeFileSync(promptFile, promptFor(issue));

  try {
    const { stdout: summary } = await exec(
      process.execPath,
      [
        driverScript,
        "--dir",
        worktree,
        "--agent",
        opts.agent,
        "--prompt-file",
        promptFile,
        "--title",
        `#${issue.number} ${issue.title}`,
        "--timeout",
        String(opts.timeout),
      ],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 },
    );
    console.log(`[#${issue.number}] ${summary.trim().slice(0, 500)}`);

    const status = await git(["status", "--porcelain"], worktree);
    const changed = status.stdout.trim().length > 0;

    if (changed && opts.openPr) {
      await git(["add", "-A"], worktree);
      await git(["commit", "-m", `feat: #${issue.number} ${issue.title}`], worktree);
      await git(["push", "-u", "origin", branch], worktree);
      const { stdout: prUrl } = await exec(
        "gh",
        [
          "pr",
          "create",
          "--head",
          branch,
          "--base",
          opts.prBase,
          "--title",
          `#${issue.number} ${issue.title}`,
          "--body",
          `Closes #${issue.number}\n\n${summary.trim()}`,
        ],
        { cwd: worktree },
      );
      console.log(`[#${issue.number}] PR: ${prUrl.trim()}`);
      await exec("gh", ["issue", "edit", String(issue.number), "--add-label", "opencode:pr"]).catch(
        () => {},
      );
    } else if (opts.comment) {
      await exec("gh", ["issue", "comment", String(issue.number), "--body", summary.trim()]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (!opts.keep) {
      await exec(worktreeScript, ["remove", name, "--force"], { cwd: root }).catch(() => {});
    }
  }
}

async function pass(opts) {
  const issues = await listIssues(opts.label, opts.limit);
  const pending = issues.filter(
    (issue) => !hasLabel(issue, "opencode:pr") && !hasLabel(issue, "opencode:skip"),
  );

  if (pending.length === 0) {
    console.log(`no pending issues with label "${opts.label}"`);
    return;
  }

  for (const issue of pending) {
    try {
      await runIssue(issue, opts);
    } catch (error) {
      console.error(
        `[#${issue.number}] failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (!Number.isFinite(opts.interval) || opts.interval < 0) {
    console.error("error: --interval must be a non-negative number");
    process.exit(2);
  }

  do {
    await pass(opts);
    if (opts.interval > 0)
      await new Promise((resolve) => setTimeout(resolve, opts.interval * 1000));
  } while (opts.interval > 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
