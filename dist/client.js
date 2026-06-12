import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
/**
 * Thin client over the Atlas REST API with a file-backed read cache (stale-while-revalidate,
 * near-offline) and a write queue that flushes when the network returns. All auth/scope
 * enforcement and audit happen server-side — this is just a fast, resilient edge cache.
 */
const CACHE_DIR = join(homedir(), ".atlas", "cache");
const QUEUE_FILE = join(homedir(), ".atlas", "queue.json");
const TTL_MS = 60_000;
function ensureDir() {
    if (!existsSync(CACHE_DIR))
        mkdirSync(CACHE_DIR, { recursive: true });
}
function cacheKey(path) {
    return join(CACHE_DIR, encodeURIComponent(path) + ".json");
}
function log(msg) {
    // NEVER write to stdout — it corrupts the stdio JSON-RPC stream. stderr only.
    process.stderr.write(`[atlas-mcp] ${msg}\n`);
}
export class AtlasClient {
    baseUrl;
    apiKey;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    headers() {
        return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
    }
    /** Cached GET: serve fresh cache; otherwise fetch, falling back to stale cache when offline. */
    async get(path, opts = { cache: true }) {
        ensureDir();
        const file = cacheKey(path);
        if (opts.cache && existsSync(file)) {
            try {
                const { at, data } = JSON.parse(readFileSync(file, "utf8"));
                if (Date.now() - at < TTL_MS)
                    return data;
            }
            catch {
                /* ignore */
            }
        }
        try {
            const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
            if (!res.ok)
                throw new Error(`${res.status} ${await res.text()}`);
            const data = (await res.json());
            if (opts.cache)
                writeFileSync(file, JSON.stringify({ at: Date.now(), data }));
            return data;
        }
        catch (e) {
            // offline / error → serve stale cache if we have it
            if (existsSync(file)) {
                try {
                    log(`offline — serving stale cache for ${path}`);
                    return JSON.parse(readFileSync(file, "utf8")).data;
                }
                catch {
                    /* ignore */
                }
            }
            throw e;
        }
    }
    /** POST that queues on failure (offline) and flushes later. */
    async post(path, body, opts = {}) {
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify(body),
            });
            if (!res.ok)
                throw new Error(`${res.status} ${await res.text()}`);
            return (await res.json());
        }
        catch (e) {
            if (opts.queue) {
                ensureDir();
                const q = existsSync(QUEUE_FILE) ? JSON.parse(readFileSync(QUEUE_FILE, "utf8")) : [];
                q.push({ path, body, at: Date.now() });
                writeFileSync(QUEUE_FILE, JSON.stringify(q));
                log(`offline — queued POST ${path} (${q.length} pending)`);
                return { queued: true };
            }
            throw e;
        }
    }
    /** Flush any queued writes (best-effort, called on startup). */
    async flushQueue() {
        if (!existsSync(QUEUE_FILE))
            return;
        let q = [];
        try {
            q = JSON.parse(readFileSync(QUEUE_FILE, "utf8"));
        }
        catch {
            return;
        }
        const remaining = [];
        for (const item of q) {
            try {
                const res = await fetch(`${this.baseUrl}${item.path}`, {
                    method: "POST",
                    headers: this.headers(),
                    body: JSON.stringify(item.body),
                });
                if (!res.ok)
                    remaining.push(item);
            }
            catch {
                remaining.push(item);
            }
        }
        writeFileSync(QUEUE_FILE, JSON.stringify(remaining));
        if (q.length && remaining.length < q.length)
            log(`flushed ${q.length - remaining.length} queued writes`);
    }
}
