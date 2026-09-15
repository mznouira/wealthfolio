import type { Plugin } from "@opencode-ai/plugin";
import { isSecretPath, destructiveReason, formatterFor } from "../../scripts/factory-guard.mjs";

// Adapter around scripts/factory-guard.mjs, which is the shared source for
// this logic (the Claude Code hooks in .claude/settings.json enforce the
// same rules from that same file). Edit the rules there, not here.
export const Guard: Plugin = async ({ $, directory }) => {
  return {
    "tool.execute.before": async (input, output) => {
      const args = output.args ?? {};

      if (input.tool === "read" || input.tool === "list") {
        const path =
          typeof args.filePath === "string"
            ? args.filePath
            : typeof args.path === "string"
              ? args.path
              : "";
        if (path && isSecretPath(path)) {
          throw new Error(`Blocked read of secret file: ${path}`);
        }
      }

      if (input.tool === "bash") {
        const command = typeof args.command === "string" ? args.command : "";
        const reason = destructiveReason(command);
        if (reason) {
          throw new Error(`Blocked destructive command: ${command} (${reason})`);
        }
      }
    },

    "tool.execute.after": async (input) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const path = input.args?.filePath ?? input.args?.path;
      if (typeof path !== "string" || !path) return;

      const formatter = formatterFor(path);
      try {
        if (formatter === "rustfmt") {
          await $`rustfmt --edition 2021 ${path}`.cwd(directory).quiet();
        } else if (formatter === "prettier") {
          await $`pnpm exec prettier --write ${path}`.cwd(directory).quiet();
        }
      } catch {
        // formatting is best-effort; a failure must not break the tool call
      }
    },
  };
};
