/** Agent playbook — keep in sync with src/features/mcp/server/instructions.ts */
export const MCP_AGENT_INSTRUCTIONS = `Atlas MCP — agent-native tools. Docs are pages with ids, not repo files.

Read: atlas_browse/atlas_search → atlas_read ref=<readAs.ref>

atlas_search params:
- query (required) — text or grep pattern
- searchType — keyword (default) | title | grep
- scope — ["doc","code",…] omit = all surfaces
- limit — max hits per surface (default 8)
- options — type-specific: { regex, caseInsensitive } for grep

Tools: atlas_browse, atlas_read, atlas_context, atlas_write, secrets, tasks, atlas_log_work.

projectId optional when key sees one project (~/.atlas). Stdio: atlas_write localPath; remote: content inline.`;
