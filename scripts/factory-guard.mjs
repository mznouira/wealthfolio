#!/usr/bin/env node
// Shared guard/format logic for the agent factory. Both
// `.opencode/plugins/guard.ts` (imports this module directly) and the
// `.claude/settings.json` PreToolUse/PostToolUse hooks (shell out to this
// file's CLI) enforce the same rules from here. Edit the lists below once;
// both harnesses pick it up on their next tool call, no sync step needed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const SECRET_PATHS = [
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)auth\.json$/,
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)\.ssh\//,
];

const DESTRUCTIVE = [
  { re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, label: "recursive/force rm" },
  { re: /\bgit\s+reset\s+--hard\b/i, label: "git reset --hard" },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, label: "git clean -f" },
  { re: /\bgit\s+branch\s+-D\b/i, label: "git branch -D" },
  { re: /\b(mkfs|shutdown|reboot|halt)\b/i, label: "system-destructive command" },
  { re: /:\(\)\s*\{.*\}\s*;\s*:/, label: "fork bomb" },
  { re: /\b(npm|pnpm|yarn|bun)\s+publish\b/i, label: "package publish" },
  { re: /\bcargo\s+publish\b/i, label: "crate publish" },
];

export function isSecretPath(path) {
  if (!path) return false;
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? "";
  if (/example|sample|template/.test(base)) return false;
  return SECRET_PATHS.some((re) => re.test(normalized));
}

export function isForcePush(command) {
  if (!command) return false;
  return (
    /\bgit\s+push\b/.test(command) && /(^|\s)(--force|--force-with-lease|-f)(\s|$)/.test(command)
  );
}

// Returns a human-readable reason the command is blocked, or null if it's fine.
export function destructiveReason(command) {
  if (!command) return null;
  if (isForcePush(command)) return "force push (push a normal branch and let a human force-push)";
  const hit = DESTRUCTIVE.find(({ re }) => re.test(command));
  return hit ? hit.label : null;
}

// Pure decision, no execution — so callers can run the formatter with
// whatever mechanism they already test with (opencode's injected `$` shell,
// plain execFile for the Claude hook, etc.).
export function formatterFor(path) {
  if (/\.rs$/.test(path)) return "rustfmt";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|md|json|jsonc)$/.test(path)) return "prettier";
  return null;
}

export async function formatFile(path, cwd) {
  const formatter = formatterFor(path);
  if (formatter === "rustfmt") {
    await exec("rustfmt", ["--edition", "2021", path], { cwd }).catch(() => {});
  } else if (formatter === "prettier") {
    await exec("pnpm", ["exec", "prettier", "--write", path], { cwd }).catch(() => {});
  }
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

// Claude Code hook entry point: reads the PreToolUse/PostToolUse event JSON
// from stdin. Exit 2 blocks the tool call (PreToolUse); any other exit is
// non-blocking. Never throws on malformed input — a guard bug must not stall
// the harness.
async function runHook() {
  const raw = await readStdin();
  let event;
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  const toolName = event.tool_name;
  const input = event.tool_input || {};
  const cwd = event.cwd || process.cwd();

  if (event.hook_event_name === "PreToolUse") {
    if (toolName === "Read" && isSecretPath(input.file_path)) {
      console.error(`Blocked read of secret file: ${input.file_path}`);
      process.exit(2);
    }
    if (toolName === "Bash") {
      const reason = destructiveReason(input.command);
      if (reason) {
        console.error(`Blocked destructive command: ${input.command} (${reason})`);
        process.exit(2);
      }
    }
    process.exit(0);
  }

  if (event.hook_event_name === "PostToolUse") {
    if (toolName === "Edit" || toolName === "Write") {
      const path = input.file_path;
      if (typeof path === "string" && path) await formatFile(path, cwd);
    }
    process.exit(0);
  }

  process.exit(0);
}

async function main() {
  const [, , mode, ...rest] = process.argv;

  if (mode === "hook") return runHook();

  if (mode === "format") {
    await formatFile(rest[0], process.cwd());
    return;
  }

  console.error("usage: factory-guard.mjs <hook|format> ...");
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
