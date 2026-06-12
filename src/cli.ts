#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { runServer } from "./index.js";
import { loadConfig, DEFAULT_TOOLSETS } from "./config.js";

function out(m: string) {
  process.stderr.write(m + "\n");
}
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function readJson(p: string): Record<string, unknown> {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  } catch {
    return {};
  }
}
function writeJson(p: string, data: unknown) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

// Install once globally: bun install -g github:TheDivyanshShukla/atlas-mcp
const GITHUB_PKG = "github:TheDivyanshShukla/atlas-mcp";
const SERVER_ENTRY = { command: "atlas", args: [] as string[] };

function hasGlobalCli(name: string): boolean {
  try {
    const probe = process.platform === "win32" ? `where ${name}` : `command -v ${name}`;
    execSync(probe, { stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

function ensureGlobalInstall() {
  if (hasGlobalCli("atlas")) return;
  out(`\n⚠ atlas is not on PATH. Install globally once, then re-run:\n`);
  out(`  bun install -g ${GITHUB_PKG}`);
  out(`  npm install -g ${GITHUB_PKG}\n`);
}

/** Write the Atlas MCP server into each detected agent's config. */
function writeAgentConfigs(baseUrl: string) {
  const env = { ATLAS_MCP_KEY: "${ATLAS_MCP_KEY}", ATLAS_BASE_URL: baseUrl };
  const stdioEntry = { ...SERVER_ENTRY, env };
  const cwd = process.cwd();
  const home = homedir();
  const targets: { name: string; path: string; apply: (c: Record<string, any>) => Record<string, any> }[] = [
    {
      name: "Claude Code (.mcp.json)",
      path: join(cwd, ".mcp.json"),
      apply: (c) => ({ ...c, mcpServers: { ...(c.mcpServers ?? {}), atlas: stdioEntry } }),
    },
    {
      name: "Cursor (~/.cursor/mcp.json)",
      path: join(home, ".cursor", "mcp.json"),
      apply: (c) => ({ ...c, mcpServers: { ...(c.mcpServers ?? {}), atlas: stdioEntry } }),
    },
    {
      name: "Windsurf (~/.codeium/windsurf/mcp_config.json)",
      path: join(home, ".codeium", "windsurf", "mcp_config.json"),
      apply: (c) => ({ ...c, mcpServers: { ...(c.mcpServers ?? {}), atlas: stdioEntry } }),
    },
    {
      name: "VS Code (.vscode/mcp.json)",
      path: join(cwd, ".vscode", "mcp.json"),
      apply: (c) => ({ ...c, servers: { ...(c.servers ?? {}), atlas: stdioEntry } }),
    },
  ];
  for (const t of targets) {
    try {
      writeJson(t.path, t.apply(readJson(t.path)));
      out(`  ✓ ${t.name}`);
    } catch (e) {
      out(`  · skipped ${t.name} (${(e as Error).message})`);
    }
  }
}

async function apiFetch<T>(baseUrl: string, key: string, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Resolve the project to bind: pick existing / custom / folder; offer to create if missing. */
async function resolveProject(baseUrl: string, key: string | undefined, folder: string): Promise<string> {
  const flag = arg("project");
  if (flag) return flag;

  const interactive = process.stdin.isTTY && !process.env.CI;
  // need a key to list/create; without one, just default to the folder name
  if (!key) {
    if (!interactive) return folder;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question(`Project name for this repo [${folder}]: `)).trim();
    rl.close();
    return ans || folder;
  }

  const who = await apiFetch<{ projects: { id: string; name: string }[] }>(baseUrl, key, "/api/v1/projects");
  const projects = who?.projects ?? [];

  if (!interactive) {
    // non-interactive: reuse a same-named project if it exists, else the folder name
    const match = projects.find((p) => p.name.toLowerCase() === folder.toLowerCase());
    return match?.name ?? folder;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  out(`\nWhich Atlas project should this repo map to?`);
  projects.forEach((p, i) => out(`  ${i + 1}) ${p.name}`));
  out(`  n) New project (named "${folder}")`);
  out(`  or type a custom name`);
  const ans = (await rl.question(`> `)).trim();

  let chosen: string;
  const num = Number(ans);
  if (ans === "" || ans.toLowerCase() === "n") chosen = folder;
  else if (Number.isInteger(num) && num >= 1 && num <= projects.length) chosen = projects[num - 1].name;
  else chosen = ans;

  // create-if-missing, with confirmation
  const exists = projects.some((p) => p.name.toLowerCase() === chosen.toLowerCase());
  if (!exists) {
    const yn = (await rl.question(`Project "${chosen}" doesn't exist in Atlas. Create it? [Y/n] `)).trim().toLowerCase();
    if (yn === "" || yn === "y" || yn === "yes") {
      const created = await apiFetch<{ id: string; name: string }>(baseUrl, key, "/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: chosen }),
      });
      if (created) out(`  ✓ Created project "${created.name}"`);
      else out(`  · Could not create (key may lack projects:write) — binding by name anyway; create it in Atlas.`);
    }
  }
  rl.close();
  return chosen;
}

async function init() {
  const key = arg("key") || process.env.ATLAS_MCP_KEY;
  const folder = process.cwd().split(/[\\/]/).filter(Boolean).pop() || "general";
  const baseUrl = (arg("base-url") || process.env.ATLAS_BASE_URL || "https://atlas.naravirtual.in").replace(/\/$/, "");

  const project = await resolveProject(baseUrl, key, folder);

  // .atlas — committed, no secrets. Holds the project binding + how the agent should behave here.
  const dotAtlas = join(process.cwd(), ".atlas");
  const existing = existsSync(dotAtlas) ? readJson(dotAtlas) : {};
  writeJson(dotAtlas, {
    project,
    autoCapture: existing.autoCapture ?? true,
    toolsets: existing.toolsets ?? DEFAULT_TOOLSETS, // write access ON by default
    readOnly: existing.readOnly ?? false,
    redactSecretsInLogs: existing.redactSecretsInLogs ?? true,
  });
  out(`\nWrote .atlas (project: ${project}, write access on) — safe to commit.`);

  ensureGlobalInstall();

  out(`\nAdding the Atlas MCP to your agents:`);
  writeAgentConfigs(baseUrl);

  out(`\nNext:`);
  if (!key) {
    out(`  1. Create an MCP key in Atlas → Settings → API keys → "MCP key" (Write toolset is on by default).`);
    out(`  2. Export it:  export ATLAS_MCP_KEY=atlas_mcp_…   (add to your shell profile)`);
  } else {
    out(`  Key detected in env. You're set.`);
  }
  out(`  3. (Claude Code) capture every prompt automatically:  atlas hooks install`);
  out(`  4. Restart your IDE/agent.\n`);
}

/** Install Claude Code hooks that POST prompts + sessions to Atlas (zero-cooperation capture). */
function hooksInstall() {
  const settingsPath = join(process.cwd(), ".claude", "settings.json");
  const s = readJson(settingsPath) as any;
  s.hooks ??= {};
  const hook = (event: string) => ({
    matcher: "*",
    hooks: [{ type: "command", command: `atlas hook ${event}` }],
  });
  s.hooks.UserPromptSubmit = [hook("prompt")];
  s.hooks.Stop = [hook("stop")];
  writeJson(settingsPath, s);
  out(`Installed Claude Code hooks → ${settingsPath}`);
  out(`UserPromptSubmit + Stop now POST to Atlas activity. Restart Claude Code.`);
}

/** Hook runner: reads the hook event JSON on stdin and logs to Atlas. */
async function hook(event: string) {
  const { baseUrl, apiKey, config } = loadConfig();
  if (!apiKey) return; // silently no-op without a key
  let payload: any = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8")); // stdin
  } catch {
    /* ignore */
  }
  let branch: string | undefined;
  let files: string[] = [];
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    files = execSync("git diff --name-only HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split("\n")
      .filter(Boolean)
      .slice(0, 100);
  } catch {
    /* not a git repo */
  }
  const body =
    event === "prompt"
      ? { client: "claude-code", kind: "prompt", prompt: payload.prompt ?? payload.user_prompt, branch }
      : { client: "claude-code", kind: "session", summary: `Session in ${config.project ?? "repo"}`, files, branch };
  try {
    await fetch(`${baseUrl}/api/v1/activity`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* best-effort */
  }
}

const invokedAs = process.argv[1]?.split(/[\\/]/).pop()?.replace(/\.(js|cjs|mjs)$/, "") ?? "";
const cmd = process.argv[2];

function shouldRunServer(): boolean {
  // IDEs spawn `atlas` with piped stdio (not a TTY). A bare `atlas` in your terminal shows help.
  return cmd === "serve" || invokedAs === "atlas-mcp" || (!cmd && !process.stdin.isTTY);
}

function showHelp() {
  out(`atlas — connect this repo to your Atlas knowledge hub\n`);
  out(`Install once:  bun install -g ${GITHUB_PKG}\n`);
  out(`  atlas .                 set up .atlas + agent configs here`);
  out(`  atlas . --project foo   bind to a specific Atlas project`);
  out(`  atlas hooks install     install Claude Code auto-capture hooks`);
  out(`  atlas serve             run the MCP server over stdio (IDEs spawn \`atlas\` for you)`);
}

(async () => {
  // `atlas .` or `atlas init` → scaffold .atlas + agent configs in the current folder
  if (cmd === "." || cmd === "init" || cmd === "setup") await init();
  else if (cmd === "hooks" && process.argv[3] === "install") hooksInstall();
  else if (cmd === "hook") await hook(process.argv[3] ?? "stop");
  else if (shouldRunServer()) await runServer();
  else if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") showHelp();
  else {
    out(`Unknown command: ${cmd}\n`);
    showHelp();
    process.exit(1);
  }
})().catch((e) => {
  process.stderr.write(`[atlas-mcp] ${(e as Error).message}\n`);
  process.exit(1);
});
