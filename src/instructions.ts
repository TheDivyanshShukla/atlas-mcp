/** Agent playbook — keep in sync with src/features/mcp/server/instructions.ts */
export const MCP_AGENT_INSTRUCTIONS = `Atlas is this team's project brain. Search before you guess; save only what teammates will reuse.

Find things (cheap):
- atlas_search with query + optional types filter: prompt | doc | code | secret | asset | voice | task. Examples: types=doc for runbooks, types=task for board items, types=code for saved snippets. Secret hits are key names only.
- atlas_context once at session start if you need a broad snapshot (prompts + recent docs). Prefer filtered search when you know what surface you need.
- atlas_file mode=read only when search gave you a path and you need the full body.

Secrets: atlas_get_secret by key name. Never ask the user to paste credentials.

What belongs where:
- docs (atlas_file kind=doc): project resources, decisions, runbooks, status updates, logs worth keeping — paths like docs/…
- code (atlas_file kind=code): rare reusable snippets or non-obvious wisdom only. Not whole files, not the codebase, not boilerplate. One insight per save.
- tasks (atlas_create_task / atlas_update_task): project progress and follow-ups — not documentation.
- prompts (atlas_save_prompt): reusable instructions the user explicitly wants kept — not every message.

Write files: atlas_file with kind, path, mode (read|write|append|delete).
- URL MCP: pass content inline (Read the workspace file first — localPath does not work remotely).
- Stdio atlas CLI: localPath reads from your open workspace. Default project in ~/.atlas/config.json (global).
projectId accepts project name or UUID.

Env: atlas_set_secret for one key; atlas_import_env for a .env body.

Finish: atlas_log_work with a one-line summary and changed files when you did meaningful work. Skip if nothing worth logging.

Token discipline: narrow search with types; don't list-all; don't re-save what Atlas already has.`;
