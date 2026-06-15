/** Agent playbook — keep in sync with src/features/mcp/server/instructions.ts */
export const MCP_AGENT_INSTRUCTIONS = `Atlas MCP — agent-native tools. Docs are pages with ids, not repo files.

Read (always this order):
1. atlas_browse or atlas_search → get id + readAs.ref
2. atlas_read ref=<id> → full markdown body

Tools:
- atlas_browse — docs tree, code paths, prompts (each line has id=)
- atlas_search — keyword search with snippet + readAs.ref
- atlas_read — full content by doc/prompt id, code path, or title
- atlas_context — session start: prompts (full) + recent doc previews
- atlas_write — kind=doc|code, ref=id|path, mode=replace|append|delete, content=…
- atlas_get_secret / atlas_set_secret / atlas_import_env — credentials (never ask user to paste)
- atlas_log_work — session capture; atlas_save_prompt — reusable prompts
- atlas_list_tasks / atlas_create_task / atlas_update_task — task board

projectId: name or UUID; omit when key sees one project (~/.atlas binding).
Stdio atlas CLI: atlas_write accepts localPath (reads workspace file as content). Remote MCP: pass content inline.`;
