export const MCP_AGENT_INSTRUCTIONS = "Atlas is your team's knowledge hub for this repo. Workflow: " +
    "(1) atlas_context at task start. " +
    "(2) atlas_get_secret for credentials. " +
    "(3) atlas_save_prompt when the user gives reusable instructions worth keeping. " +
    "(4) atlas_upsert_doc for docs at paths like docs/decisions/adr-001.md. " +
    "(5) atlas_upload_file for code at paths like src/lib/foo.ts. " +
    "(6) atlas_set_secret / atlas_import_env for env vars. " +
    "(7) atlas_create_task + atlas_update_task for long-term work. " +
    "(8) atlas_log_work when you finish a session.";
