import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, DEFAULT_TOOLSETS } from "./config.js";
import { AtlasClient } from "./client.js";
import { MCP_AGENT_INSTRUCTIONS } from "./instructions.js";
function log(m) {
    process.stderr.write(`[atlas-mcp] ${m}\n`);
}
function hasScope(scopes, required) {
    const [rRes, rAct] = required.split(":");
    return scopes.some((s) => {
        const [res, act] = s.includes(":") ? s.split(":") : ["*", s];
        if (res !== "*" && res !== rRes)
            return false;
        return act === rAct || (rAct === "read" && act === "write");
    });
}
export async function runServer() {
    const { baseUrl, apiKey, config, cwd } = loadConfig();
    if (!apiKey) {
        log("No ATLAS_MCP_KEY set. Run `atlas .` in your repo to set up. Exiting.");
        process.exit(1);
    }
    const client = new AtlasClient(baseUrl, apiKey);
    let me;
    try {
        me = await client.get("/api/v1/whoami", { cache: false });
    }
    catch (e) {
        log(`Could not validate key against ${baseUrl}: ${e.message}`);
        process.exit(1);
    }
    await client.flushQueue().catch(() => { });
    // resolve the bound project from .atlas (slug/name/id) → a concrete project id
    const wantedToolsets = (config.toolsets ?? DEFAULT_TOOLSETS).filter((t) => me.toolsets.length === 0 || me.toolsets.includes(t));
    const boundProject = me.projects.find((p) => p.id === config.project || p.name.toLowerCase() === (config.project ?? "").toLowerCase()) ??
        me.projects[0];
    const projectId = boundProject?.id;
    const readOnly = me.readOnly || !!config.readOnly;
    log(`connected as ${me.userId} · project=${boundProject?.name ?? "none"} · toolsets=[${wantedToolsets.join(",")}] · ${readOnly ? "read-only" : "read-write"}`);
    const server = new McpServer({ name: "atlas", version: "0.1.5" }, { instructions: MCP_AGENT_INSTRUCTIONS + ` Bound project: ${boundProject?.name ?? "none"}.` });
    const can = (scope, toolset) => hasScope(me.scopes, scope) && (!toolset || wantedToolsets.includes(toolset));
    // ---- context (read) ----
    server.registerTool("atlas_whoami", { description: "Who am I in Atlas, the bound project, and what this key can do.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify({ ...me, boundProject }, null, 2) }] }));
    if (can("projects:read", "context")) {
        server.registerTool("atlas_list_projects", { description: "List Atlas projects this key can access (id + name). projectId on other tools accepts either.", inputSchema: {} }, async () => {
            const r = await client.get("/api/v1/projects", { cache: false });
            return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
        });
    }
    if (can("projects:write", "write") && !readOnly) {
        server.registerTool("atlas_create_project", {
            description: "Create a new Atlas project (same as `atlas .` when the project doesn't exist).",
            inputSchema: { name: z.string(), description: z.string().optional() },
        }, async ({ name, description }) => {
            const r = await client.post("/api/v1/projects", { name, description });
            return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
        });
    }
    if (can("prompts:read", "context")) {
        server.registerTool("atlas_context", {
            description: "Load the project's approved prompts + recent docs in one call (use at task start).",
            inputSchema: { projectId: z.string().optional().describe("project name or UUID; defaults to .atlas binding") },
        }, async ({ projectId: pid }) => {
            const id = pid ?? projectId;
            if (!id)
                return { content: [{ type: "text", text: "No project bound. Add a project to .atlas." }] };
            const bundle = await client.get(`/api/v1/agent/context?projectId=${id}`);
            return { content: [{ type: "text", text: JSON.stringify(bundle, null, 2) }] };
        });
        server.registerTool("atlas_search", {
            description: "Search the project across prompts, docs, code, voice and secret KEYS.",
            inputSchema: { query: z.string(), projectId: z.string().optional() },
        }, async ({ query, projectId: pid }) => {
            const id = pid ?? projectId;
            const r = await client.get(`/api/v1/search?projectId=${id}&q=${encodeURIComponent(query)}`);
            return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
        });
        server.registerTool("atlas_list_prompts", { description: "List the project's reusable prompts.", inputSchema: { projectId: z.string().optional() } }, async ({ projectId: pid }) => {
            const r = await client.get(`/api/v1/prompts?projectId=${pid ?? projectId}`);
            return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
        });
    }
    if (can("secrets:reveal", "context")) {
        server.registerTool("atlas_get_secret", {
            description: "Fetch a decrypted secret/.env value by key name (audited). Use instead of asking the user to paste credentials.",
            inputSchema: { key: z.string(), projectId: z.string().optional() },
        }, async ({ key, projectId: pid }) => {
            const id = pid ?? projectId;
            const list = await client.get(`/api/v1/secrets?projectId=${id}`, { cache: false });
            const match = list.secrets.find((s) => s.key === key);
            if (!match)
                return { content: [{ type: "text", text: `No secret named ${key}` }], isError: true };
            const val = await client.get(`/api/v1/secrets?projectId=${id}&secretId=${match.id}`, { cache: false });
            return { content: [{ type: "text", text: val.value }] };
        });
    }
    // ---- capture (write) ----
    if (can("activity:write", "capture") && !readOnly) {
        server.registerTool("atlas_log_work", {
            description: "Record what you did for the team's AI-activity feed: a one-line summary, the user's request, and changed files. Call this when you finish a task.",
            inputSchema: {
                summary: z.string(),
                prompt: z.string().optional(),
                files: z.array(z.string()).optional(),
                branch: z.string().optional(),
                projectId: z.string().optional().describe("project name or UUID; defaults to .atlas binding"),
            },
        }, async ({ summary, prompt, files, branch, projectId: pid }) => {
            let resolved = projectId;
            if (pid) {
                resolved =
                    me.projects.find((p) => p.id === pid || p.name.toLowerCase() === pid.toLowerCase())?.id ?? pid;
            }
            await client.post("/api/v1/activity", { projectId: resolved, client: "mcp", kind: "session", summary, prompt, files, branch }, { queue: true });
            return { content: [{ type: "text", text: "Logged to Atlas activity." }] };
        });
    }
    if (can("prompts:write", "capture") && !readOnly) {
        server.registerTool("atlas_save_prompt", {
            description: "Save a strong user prompt to the shared library — reusable instructions/templates, not every message.",
            inputSchema: {
                title: z.string(),
                body: z.string(),
                tags: z.array(z.string()).optional(),
                projectId: z.string().optional(),
            },
        }, async ({ title, body, tags, projectId: pid }) => {
            const id = me.projects.find((p) => p.id === pid || p.name.toLowerCase() === (pid ?? "").toLowerCase())?.id ?? projectId;
            const r = await client.post("/api/v1/prompts", { projectId: id, title, body, tags: tags ?? [] });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        });
    }
    if (can("docs:write", "write") && !readOnly) {
        server.registerTool("atlas_upsert_doc", {
            description: "Create/update a doc by path (e.g. docs/runbooks/deploy.md). Folders auto-created.",
            inputSchema: {
                path: z.string(),
                content: z.string(),
                title: z.string().optional(),
                projectId: z.string().optional(),
            },
        }, async ({ path, content, title, projectId: pid }) => {
            const r = await client.post("/api/v1/docs/upsert", { projectId: pid ?? projectId, path, content, title });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        });
    }
    if (can("code:write", "write") && !readOnly) {
        server.registerTool("atlas_upload_file", {
            description: "Upload/replace a file by relative path (e.g. src/lib/util.ts).",
            inputSchema: { path: z.string(), content: z.string(), projectId: z.string().optional() },
        }, async ({ path, content, projectId: pid }) => {
            const r = await client.post("/api/v1/code/files", { projectId: pid ?? projectId, path, content });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        });
    }
    if (can("secrets:write", "write") && !readOnly) {
        server.registerTool("atlas_set_secret", {
            description: "Set one secret/env var by key (audited).",
            inputSchema: {
                key: z.string(),
                value: z.string(),
                group: z.string().optional(),
                projectId: z.string().optional(),
            },
        }, async ({ key, value, group, projectId: pid }) => {
            const r = await client.post("/api/v1/secrets", { projectId: pid ?? projectId, key, value, group });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        });
        server.registerTool("atlas_import_env", {
            description: "Import .env file content; group from path (e.g. .env.production → production).",
            inputSchema: { content: z.string(), path: z.string().optional(), group: z.string().optional(), projectId: z.string().optional() },
        }, async ({ content, path, group, projectId: pid }) => {
            const r = await client.post("/api/v1/secrets", { projectId: pid ?? projectId, content, path, group });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        });
    }
    // ---- tasks ----
    if (can("tasks:read", "tasks")) {
        server.registerTool("atlas_list_tasks", { description: "List the project's tasks/todos.", inputSchema: { projectId: z.string().optional() } }, async ({ projectId: pid }) => {
            const r = await client.get(`/api/v1/tasks?projectId=${pid ?? projectId}`, { cache: false });
            return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
        });
    }
    if (can("tasks:write", "tasks") && !readOnly) {
        server.registerTool("atlas_create_task", {
            description: "Create a follow-up task on the project task board.",
            inputSchema: { title: z.string(), description: z.string().optional(), priority: z.enum(["low", "medium", "high"]).optional(), projectId: z.string().optional() },
        }, async ({ title, description, priority, projectId: pid }) => {
            const r = await client.post("/api/v1/tasks", { projectId: pid ?? projectId, title, description, priority });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        });
        server.registerTool("atlas_update_task", {
            description: "Update task status (todo/doing/blocked/done), title, or priority.",
            inputSchema: {
                taskId: z.string(),
                title: z.string().optional(),
                description: z.string().optional(),
                status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
                priority: z.enum(["low", "medium", "high"]).optional(),
                projectId: z.string().optional(),
            },
        }, async ({ taskId, title, description, status, priority, projectId: pid }) => {
            const r = await client.patch("/api/v1/tasks", { projectId: pid ?? projectId, taskId, title, description, status, priority });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        });
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log(`ready (cwd=${cwd})`);
}
