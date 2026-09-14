import type { Plugin } from "@opencode-ai/plugin"

const SECRET_PATHS: RegExp[] = [
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)auth\.json$/,
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)\.ssh\//,
]

const DESTRUCTIVE: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+branch\s+-D\b/i,
  /\b(mkfs|shutdown|reboot|halt)\b/i,
  /:\(\)\s*\{.*\}\s*;\s*:/,
  /\b(npm|pnpm|yarn|bun)\s+publish\b/i,
  /\bcargo\s+publish\b/i,
]

function isSecret(path: string): boolean {
  const normalized = path.replace(/\\/g, "/")
  const base = normalized.split("/").pop() ?? ""
  if (/example|sample|template/.test(base)) return false
  return SECRET_PATHS.some((re) => re.test(normalized))
}

function isForcePush(cmd: string): boolean {
  return /\bgit\s+push\b/.test(cmd) && /(^|\s)(--force|--force-with-lease|-f)(\s|$)/.test(cmd)
}

export const Guard: Plugin = async ({ $, directory }) => {
  return {
    "tool.execute.before": async (input, output) => {
      const args = output.args ?? {}

      if (input.tool === "read" || input.tool === "list") {
        const path = typeof args.filePath === "string" ? args.filePath : typeof args.path === "string" ? args.path : ""
        if (path && isSecret(path)) {
          throw new Error(`Blocked read of secret file: ${path}`)
        }
      }

      if (input.tool === "bash") {
        const command = typeof args.command === "string" ? args.command : ""
        if (isForcePush(command)) {
          throw new Error("Blocked force push. Push a normal branch and let a human force-push.")
        }
        const hit = DESTRUCTIVE.find((re) => re.test(command))
        if (hit) {
          throw new Error(`Blocked destructive command: ${command}`)
        }
      }
    },

    "tool.execute.after": async (input) => {
      if (input.tool !== "edit" && input.tool !== "write") return
      const path = input.args?.filePath ?? input.args?.path
      if (typeof path !== "string" || !path) return

      try {
        if (/\.rs$/.test(path)) {
          await $`rustfmt --edition 2021 ${path}`.cwd(directory).quiet()
        } else if (/\.(ts|tsx|js|jsx|mjs|cjs|css|md|json|jsonc)$/.test(path)) {
          await $`pnpm exec prettier --write ${path}`.cwd(directory).quiet()
        }
      } catch {
        // formatting is best-effort; a failure must not break the tool call
      }
    },
  }
}
