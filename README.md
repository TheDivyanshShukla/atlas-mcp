# @nara/atlas-mcp

Connect any AI coding agent (Cursor, Claude Code, Windsurf, VS Code/Copilot, Cline…) to your team's
**Atlas** knowledge hub. The agent pulls your approved prompts, docs and scoped secrets as context —
and Atlas passively captures what the AI builds, so the team can see it without anyone using Jira.

## One-command setup
```bash
# in your repo root
npx @nara/atlas-mcp init --project <atlas-project-slug>
```
This writes a `.atlas` marker (safe to commit) and adds the Atlas MCP server to every agent config it
finds (`.mcp.json` for Claude Code, `~/.cursor/mcp.json`, Windsurf, `.vscode/mcp.json`).

Then create an **MCP key** in Atlas → Settings → API keys → *MCP key* (pick toolsets, read-only, expiry),
and export it:
```bash
export ATLAS_MCP_KEY=atlas_mcp_xxxxxxxx      # add to your shell profile
export ATLAS_BASE_URL=https://atlas.naravirtual.in
```

Claude Code only — capture every prompt + session automatically (zero agent cooperation):
```bash
npx @nara/atlas-mcp hooks install
```

## What it exposes (scope-gated — tools you can't use are hidden)
- **context**: `atlas_context` (one-call prompts+docs bundle), `atlas_search`, `atlas_list_prompts`,
  `atlas_get_secret` (audited decrypted .env values — use instead of pasting creds).
- **capture**: `atlas_log_work` (records summary + prompt + changed files), `atlas_save_prompt`.
- **tasks**: `atlas_list_tasks`, `atlas_create_task`.

## How it works
A thin, cached client over the Atlas REST API. Reads are served from a local cache
(`~/.atlas/cache`, stale-while-revalidate) so they're instant and work offline; writes queue and flush
when the network returns. All auth, fine-grained scopes and audit are enforced server-side.

The `.atlas` file binds the repo to an Atlas project and selects toolsets:
```jsonc
{ "project": "general", "autoCapture": true, "toolsets": ["context","capture","tasks"], "readOnly": false }
```
The key (secret) is never in `.atlas` — it lives in your IDE env / shell profile.

---
## Install (public GitHub — no npm publish)
Repo: https://github.com/TheDivyanshShukla/atlas-mcp

**Zero-install (remote, recommended)** — point any client at the hosted server:
```bash
claude mcp add --transport http atlas https://atlas.naravirtual.in/api/mcp --header "Authorization: Bearer $ATLAS_MCP_KEY"
```
Or for Cursor/Windsurf/VS Code, paste the remote config (see Atlas → Connect agent for your exact snippet).

**Local (repo-aware)** — stdio via npx from GitHub (reads `.atlas`, offline cache, capture):
```bash
npx -y -p github:TheDivyanshShukla/atlas-mcp atlas .        # set up a repo
# agents are configured to run:  npx -y -p github:TheDivyanshShukla/atlas-mcp atlas-mcp
```
Auth is read from `ATLAS_MCP_KEY` (set once in your shell profile — works forever). Default endpoint is
`https://atlas.naravirtual.in`; override with `ATLAS_BASE_URL`. `prepare` builds on install, so no npm publish needed.
