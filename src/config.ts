import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export type AtlasConfig = {
  project?: string;
  autoCapture?: boolean;
  toolsets?: string[];
  readOnly?: boolean;
  redactSecretsInLogs?: boolean;
};

export type Resolved = {
  baseUrl: string;
  apiKey: string | null;
  config: AtlasConfig;
  cwd: string;
};

/** Walk up from cwd to find the nearest `.atlas` marker (repo root activation). */
export function findDotAtlas(start = process.cwd()): { path: string; root: string } | null {
  let dir = start;
  for (let i = 0; i < 40; i++) {
    const p = join(dir, ".atlas");
    if (existsSync(p)) return { path: p, root: dir };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(): Resolved {
  const found = findDotAtlas();
  let config: AtlasConfig = {};
  if (found) {
    try {
      config = JSON.parse(readFileSync(found.path, "utf8"));
    } catch {
      // tolerate a comment-free JSON; ignore parse errors
    }
  }
  return {
    baseUrl: (process.env.ATLAS_BASE_URL || "https://atlas.naravirtual.in").replace(/\/$/, ""),
    apiKey: process.env.ATLAS_MCP_KEY || process.env.ATLAS_API_KEY || null,
    config,
    cwd: found?.root ?? process.cwd(),
  };
}

/** Default toolsets when `.atlas` doesn't specify. Write is ON by default (agents create docs,
 *  upload files, save prompts). Narrow it per-repo in `.atlas` or per-key in Atlas if you want. */
export const DEFAULT_TOOLSETS = ["context", "capture", "tasks", "write"];
