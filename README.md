# atlas-mcp

Connect any AI coding agent (Cursor, Claude Code, Windsurf, VS Code/Copilot, Cline…) to your team's
**Atlas** knowledge hub. The agent pulls your approved prompts, docs and scoped secrets as context —
and Atlas passively captures what the AI builds, so the team can see it without anyone using Jira.

## Install globally (once per machine)

```bash
bun install -g github:TheDivyanshShukla/atlas-mcp
# or: npm install -g github:TheDivyanshShukla/atlas-mcp
```

This puts **`atlas`** on your PATH — repo setup, hooks, and the stdio MCP server IDEs spawn.

## One-command setup

```bash
# in your repo root — uses folder name as project; creates if missing
atlas .
# or pin a specific Atlas project by name:
atlas . --project Conference
```

Requires `ATLAS_MCP_KEY` in your environment (or pass `--key`). If the project exists, you get linked immediately; if not, Atlas asks to create it.

Then create an **MCP key** in Atlas → Settings → API keys → *MCP key* (pick toolsets, read-only, expiry),
and export it:

```bash
export ATLAS_MCP_KEY=atlas_mcp_xxxxxxxx      # add to your shell profile
export ATLAS_BASE_URL=https://atlas.naravirtual.in
```

Claude Code only — capture every prompt + session automatically (zero agent cooperation):

```bash
atlas hooks install
```

## What it exposes (scope-gated — tools you can't use are hidden)

- **context**: `atlas_browse`, `atlas_read`, `atlas_search`, `atlas_context`, `atlas_get_secret`.
- **write**: `atlas_write` (replace/append/delete; stdio supports `localPath`).
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

## Agent transport options

Repo: https://github.com/TheDivyanshShukla/atlas-mcp

**Remote (zero local install beyond the key)** — point any client at the hosted server:

```bash
claude mcp add --transport http atlas https://atlas.naravirtual.in/api/mcp --header "Authorization: Bearer $ATLAS_MCP_KEY"
```

Or for Cursor/Windsurf/VS Code, paste the remote config (see Atlas → Connect agent for your exact snippet).

**Local (repo-aware, recommended for capture)** — stdio via globally installed `atlas` (reads `.atlas`, offline cache):

```bash
atlas .                              # set up a repo
# agents are configured to run:  atlas
```

Auth is read from `ATLAS_MCP_KEY` (set once in your shell profile). Default endpoint is
`https://atlas.naravirtual.in`; override with `ATLAS_BASE_URL`.
