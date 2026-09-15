#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { baseOptions, parseCommonArgs, HELP_COMMON } from "./factory-driver-common.mjs";

const HELP = `Drive an OpenCode session over the HTTP API.

Usage:
  node scripts/opencode-driver.mjs --prompt "..." [options]
  node scripts/opencode-driver.mjs --prompt-file spec.md [options]
  node scripts/opencode-driver.mjs --server http://127.0.0.1:4096 --prompt "..."

Options:
${HELP_COMMON}
  --port <n>            Port for a spawned server (default: 4096)
  --server <url>        Attach to a running server instead of spawning one

Set OPENCODE_SERVER_PASSWORD (and optionally OPENCODE_SERVER_USERNAME) when the
target server requires basic auth.`;

function parseArgs(argv) {
  const opts = baseOptions({ agent: "orchestrator", timeout: 600000 });
  opts.port = 4096;
  opts.server = null;
  return parseCommonArgs(argv, opts, {
    "--port": (o, next) => (o.port = Number(next())),
    "--server": (o, next) => (o.server = next()),
  });
}

function authHeaders() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return {};
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return { authorization: `Basic ${encoded}` };
}

function parseModel(value) {
  const index = value.indexOf("/");
  if (index === -1) {
    console.error(`error: --model must be provider/model, got: ${value}`);
    process.exit(2);
  }
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) };
}

async function request(baseUrl, headers, method, path, body, timeout) {
  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForHealth(baseUrl, headers, server, getStderr, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (server && server.exitCode !== null) {
      throw new Error(`server exited early (${server.exitCode}):\n${getStderr()}`);
    }
    try {
      await request(baseUrl, headers, "GET", "/global/health", undefined, 5000);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`server did not become healthy at ${baseUrl}`);
}

function collectText(parts) {
  return (parts || [])
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const prompt = opts.promptFile ? readFileSync(opts.promptFile, "utf8") : opts.prompt;
  if (!prompt) {
    console.error("error: provide --prompt or --prompt-file");
    process.exit(2);
  }

  const model = opts.model ? parseModel(opts.model) : null;
  const headers = authHeaders();
  let server = null;
  let baseUrl = opts.server;

  const shutdown = () => {
    if (!server) return;
    server.kill("SIGTERM");
    const pending = server;
    server = null;
    pending.stdout?.destroy();
    pending.stderr?.destroy();
    setTimeout(() => pending.kill("SIGKILL"), 1500).unref();
  };

  if (!baseUrl) {
    baseUrl = `http://127.0.0.1:${opts.port}`;
    let stderr = "";
    server = spawn("opencode", ["serve", "--port", String(opts.port)], {
      cwd: opts.dir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    try {
      await waitForHealth(baseUrl, headers, server, () => stderr);
    } catch (error) {
      shutdown();
      throw error;
    }
  }

  try {
    const session = await request(
      baseUrl,
      headers,
      "POST",
      "/session",
      { title: opts.title || prompt.slice(0, 60) },
      60000,
    );

    if (opts.dryRun) {
      console.log(`dry-run ok: server=${baseUrl} session=${session.id}`);
      return;
    }

    const body = {
      agent: opts.agent,
      parts: [{ type: "text", text: prompt }],
    };
    if (model) body.model = model;

    const result = await request(
      baseUrl,
      headers,
      "POST",
      `/session/${session.id}/message`,
      body,
      opts.timeout,
    );

    if (result.info && result.info.error) {
      console.error(`agent error: ${result.info.error.name}: ${result.info.error.message}`);
      process.exitCode = 1;
      return;
    }

    console.log(opts.json ? JSON.stringify(result, null, 2) : collectText(result.parts));
  } finally {
    shutdown();
  }
}

main()
  .then(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
