/**
 * puppyone connection <subcommand>  (alias: conn)
 *
 * THE unified entry point for managing ALL connections:
 * syncs, agents, MCP endpoints, sandbox endpoints, filesystem mounts.
 *
 * Everything lives in the `connections` table, discriminated by `provider`.
 *
 * Config is passed via generic mechanisms — no per-provider code:
 *   --set key=value   (repeatable, auto type-coerced)
 *   --config '{}'     (JSON, lower priority than --set)
 *   conn schema <p>   (discover available fields from backend)
 */

import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { requireProject, withErrors, formatDate } from "../helpers.js";

// ── Alias map (CLI convenience only, NOT config source of truth) ──

const PROVIDER_ALIASES = {
  gcal: "google_calendar", "google-calendar": "google_calendar",
  gh: "github",
  gdrive: "google_drive", "google-drive": "google_drive",
  gdocs: "google_docs", "google-docs": "google_docs",
  gsheets: "google_sheets", "google-sheets": "google_sheets",
  gsc: "google_search_console", "google-search-console": "google_search_console",
  hn: "hackernews",
  ph: "posthog",
  web: "url",
  folder: "filesystem", local: "filesystem",
};

const PLATFORM_TYPES = new Set(["agent", "mcp", "sandbox", "filesystem"]);

function resolveProvider(input) {
  const lower = input.toLowerCase().replace(/[\s-]+/g, "_");
  return PROVIDER_ALIASES[lower] || lower;
}

function isPlatformType(provider) {
  return PLATFORM_TYPES.has(provider);
}

// ── Helpers ──

const STATUS_ICONS = { active: "\u25CF", syncing: "\u25CF", paused: "\u25CB", error: "\u2717" };
function statusLabel(s) { return `${STATUS_ICONS[s] || "\u25CF"} ${s}`; }
function maskKey(key) {
  if (!key || key.length < 8) return key || "\u2014";
  const idx = key.indexOf("_");
  const pre = idx > 0 ? idx + 1 : 4;
  return key.slice(0, pre) + "..." + key.slice(-4);
}
function timeAgo(isoString) {
  if (!isoString) return "never";
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Parse repeatable --set key=value into a config object.
 * Auto-coerces: numbers, booleans, null.
 */
function parseSetValues(setArgs) {
  if (!setArgs || setArgs.length === 0) return {};
  const config = {};
  for (const pair of setArgs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 1) continue;
    const key = pair.slice(0, eqIdx).trim();
    let val = pair.slice(eqIdx + 1).trim();
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (val === "null") val = null;
    else if (val !== "" && !isNaN(Number(val))) val = Number(val);
    config[key] = val;
  }
  return config;
}

/**
 * Fetch connector specs from backend (cached per-invocation).
 */
let _connectorCache = null;
async function fetchConnectorSpecs(client) {
  if (_connectorCache) return _connectorCache;
  try {
    const data = await client.get("/sync/connectors");
    _connectorCache = Array.isArray(data) ? data : (data?.data ?? data?.connectors ?? []);
    return _connectorCache;
  } catch {
    return [];
  }
}

function findSpec(specs, provider) {
  return specs.find(s => s.provider === provider);
}

async function readScriptFile(config) {
  if (config.script_content && !config.script_content.includes("\n") && config.script_content.length < 260) {
    try {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const content = readFileSync(resolve(config.script_content), "utf-8");
      if (!config.runtime) {
        const ext = config.script_content.split(".").pop();
        config.runtime = { py: "python", js: "node", sh: "shell" }[ext] ?? "python";
      }
      config.script_content = content;
    } catch { /* not a file path, keep as-is */ }
  }
}


export function registerConnection(program) {
  const conn = program
    .command("connection")
    .alias("conn")
    .description("Manage all connections (syncs, agents, MCP, sandbox, filesystem)");

  // ── schema ─────────────────────────────────────
  // Fetches config_fields from backend — the ONLY source of truth.

  conn
    .command("schema")
    .description("Show config fields for a provider (fetched from backend)")
    .argument("<provider>", "provider name (gmail, gcal, notion, github, ...)")
    .action(withErrors(async (providerArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const provider = resolveProvider(providerArg);

      if (isPlatformType(provider)) {
        out.info(`\n  "${provider}" is a platform type (agent / mcp / sandbox / filesystem).`);
        out.info("  These do not have configurable sync fields.");
        out.info("  Use `puppyone conn add <type> --name <name>` to create.\n");
        return;
      }

      const specs = await fetchConnectorSpecs(client);
      const spec = findSpec(specs, provider);

      if (!spec) {
        out.error("UNKNOWN_PROVIDER", `Unknown provider: "${providerArg}".`,
          "Run `puppyone conn schema --list` or check `puppyone sync providers`.");
        return;
      }

      out.info("");
      out.info(`  ${spec.display_name}  (${spec.provider})`);
      out.info(`  Auth: ${spec.auth}`);
      if (spec.oauth_type) out.info(`  OAuth type: ${spec.oauth_type}`);
      out.info(`  Sync modes: ${(spec.supported_sync_modes || []).join(", ")}`);
      out.info("");

      const fields = spec.config_fields || [];
      if (fields.length > 0) {
        out.info("  Config fields (use --set key=value):");
        out.info("");
        out.table(fields.map(f => ({
          key: f.key,
          type: f.type || "text",
          label: f.label,
          default: f.default !== undefined && f.default !== null ? String(f.default) : "\u2014",
          required: f.required ? "yes" : "",
          placeholder: f.placeholder || "",
        })), [
          { key: "key", label: "KEY" },
          { key: "type", label: "TYPE" },
          { key: "label", label: "DESCRIPTION" },
          { key: "default", label: "DEFAULT" },
          { key: "required", label: "REQ" },
          { key: "placeholder", label: "EXAMPLE" },
        ]);
      } else {
        out.info("  No configurable fields. Only general options apply.");
      }

      out.info("");
      out.info("  General options (all sync providers):");
      out.info("    --set source_url=<url>    source URL (if applicable)");
      out.info("    --name <name>             connection name");
      out.info("    --folder <path>           target folder in project");
      out.info("    --mode <mode>             import_once | manual | scheduled");
      out.info("    --config <json>           raw JSON config (merged, lower priority)");

      if (spec.auth === "oauth") {
        out.info("");
        out.info("  OAuth required. Authorize first:");
        out.info(`    puppyone sync auth ${providerArg}`);
      }

      out.info("");
      out.info("  Example:");
      if (fields.some(f => f.key === "source_url")) {
        out.info(`    puppyone conn add ${providerArg} <url>`);
      } else if (fields.length > 0) {
        const example = fields.map(f => {
          const val = f.placeholder || f.default || `<${f.key}>`;
          return `--set ${f.key}=${val}`;
        }).join(" ");
        out.info(`    puppyone conn add ${providerArg} ${example}`);
      } else {
        out.info(`    puppyone conn add ${providerArg}`);
      }
      out.info("");

      out.success?.({ provider: spec.provider, config_fields: fields, auth: spec.auth });
    }));

  // ── add ─────────────────────────────────────────

  conn
    .command("add")
    .description("Add a new connection (any type)")
    .argument("<type>", "provider type: notion | github | gmail | mcp | sandbox | agent | folder | ...")
    .argument("[source]", "source URL, path, or name (depends on type)")
    .option("--name <name>", "connection name")
    .option("--folder <folder>", "target folder path in project (for syncs)")
    .option("--mode <mode>", "sync mode: import_once | manual | scheduled", "import_once")
    .option("--model <model>", "LLM model (for agent type)")
    .option("--system-prompt <prompt>", "system prompt (for agent type)")
    .option("--type <subtype>", "sub-type: chat | devbox (agent), e2b | docker (sandbox)")
    .option("--set <kv...>", "config key=value (repeatable): --set max_results=100 --set query=is:unread")
    .option("--config <json>", "provider-specific config as JSON (merged, lower priority than --set)")
    .option("--file <path>", "read script content from local file (for script provider)")
    .action(withErrors(async (type, source, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const provider = resolveProvider(type);

      // ── Platform types ──
      if (provider === "agent") {
        const name = opts.name || source || "Agent";
        const body = { name, project_id: projectId, type: opts.type || "chat" };
        if (opts.model) body.model = opts.model;
        if (opts.systemPrompt) body.system_prompt = opts.systemPrompt;
        const created = await client.post("/agent-config", body);
        out.info(`  Agent created: ${created.name} (${created.id})`);
        _showAgentGuidance(out, created, client.baseUrl);
        out.success?.({ connection: created });
        return;
      }
      if (provider === "mcp") {
        const name = opts.name || source || "MCP Endpoint";
        const created = await client.post("/mcp-endpoints", { name, project_id: projectId });
        out.info(`  MCP endpoint created: ${created.name} (${created.id})`);
        _showMcpGuidance(out, created, client.baseUrl);
        out.success?.({ connection: created });
        return;
      }
      if (provider === "sandbox") {
        const name = opts.name || source || "Sandbox";
        const body = { name, project_id: projectId };
        const created = await client.post("/sandbox-endpoints", body);
        out.info(`  Sandbox created: ${created.name} (${created.id})`);
        _showSandboxGuidance(out, created);
        out.success?.({ connection: created });
        return;
      }
      if (provider === "filesystem") {
        const name = opts.name || "Filesystem Sync";
        const created = await client.post("/agent-config", { name, project_id: projectId, type: "devbox" });
        out.info(`  Filesystem agent created: ${created.name} (${created.id})`);
        _showFilesystemGuidance(out, created, source);
        out.success?.({ connection: created });
        return;
      }

      // ── Sync providers: fetch spec from backend ──
      const specs = await fetchConnectorSpecs(client);
      const spec = findSpec(specs, provider);

      if (!spec) {
        out.error("UNKNOWN_PROVIDER", `Unknown provider: "${type}".`,
          "Run `puppyone conn schema <provider>` to see available providers.\nRun `puppyone sync providers` for full list.");
        return;
      }

      // OAuth check
      if (spec.auth === "oauth" && spec.oauth_type) {
        out.step(`Checking ${spec.display_name} authorization...`);
        try {
          const oauthPath = spec.oauth_type.replace(/_/g, "-");
          const status = await client.get(`/oauth/${oauthPath}/status`);
          const connected = status?.connected ?? status?.is_connected ?? false;
          if (!connected) {
            out.info("");
            out.info(`  ${spec.display_name} is not authorized yet.`);
            out.info("");
            out.info("  Step 1: Authorize");
            out.info(`    puppyone sync auth ${type}`);
            out.info("");
            out.info("  Step 2: Then re-run this command");
            out.info(`    puppyone conn add ${type}${source ? " " + source : ""}`);
            out.info("");
            try {
              const authData = await client.get(`/oauth/${oauthPath}/authorize`);
              const authUrl = authData?.url ?? authData?.authorization_url ?? authData;
              if (authUrl && typeof authUrl === "string" && authUrl.startsWith("http")) {
                out.info("  Opening browser for authorization...");
                out.info(`  ${authUrl}`);
                try {
                  const { exec: execCb } = await import("node:child_process");
                  const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
                  execCb(`${openCmd} "${authUrl}"`);
                } catch {}
              }
            } catch {}
            return;
          }
          out.info("authorized \u2713");
        } catch {
          out.info("(could not check OAuth status, proceeding)");
        }
      }

      // Build config: --config JSON (low priority) + --set key=value (high priority) + source
      const config = {};
      if (opts.config) {
        try { Object.assign(config, JSON.parse(opts.config)); } catch {
          out.error("INVALID_JSON", "Invalid --config JSON.");
          return;
        }
      }
      Object.assign(config, parseSetValues(opts.set));
      if (source) config.source_url = source;

      // Validate required fields from backend spec
      const fields = spec.config_fields || [];
      for (const f of fields) {
        if (!f.required) continue;
        if (!config[f.key] && config[f.key] !== 0) {
          out.error("MISSING_FIELD", `${spec.display_name} requires "${f.key}" (${f.label}).`,
            `Use --set ${f.key}=<value> or run \`puppyone conn schema ${type}\` for details.`);
          return;
        }
      }

      // Handle script: --file or --set script_content=path
      if (provider === "script") {
        if (opts.file) {
          const { readFileSync } = await import("node:fs");
          const { resolve } = await import("node:path");
          config.script_content = readFileSync(resolve(opts.file), "utf-8");
          if (!config.runtime) {
            const ext = opts.file.split(".").pop();
            config.runtime = { py: "python", js: "node", sh: "shell" }[ext] ?? "python";
          }
        } else {
          await readScriptFile(config);
        }
      }

      // Handle hackernews feed_type from source argument
      if (provider === "hackernews" && source && !config.feed_type) {
        config.feed_type = source;
      }

      const body = {
        project_id: projectId,
        provider,
        config,
        sync_mode: opts.mode || "import_once",
      };
      if (opts.folder) body.target_folder_node_id = opts.folder;

      out.step(`Adding ${spec.display_name} sync...`);
      const created = await client.post("/sync/bootstrap", body);
      out.done("done");

      const syncId = created?.sync_id ?? created?.id ?? created?.sync?.id;
      out.info(`  Sync created: ${syncId ?? "(created)"}`);
      if (created?.node_name || created?.folder_name) {
        out.info(`  Target: ${created.node_name ?? created.folder_name}`);
      }
      out.info("");
      out.info(`  View:    puppyone conn ls --provider ${provider}`);
      out.info(`  Refresh: puppyone conn refresh <id>`);
      out.info(`  Schema:  puppyone conn schema ${type}`);
      out.success?.({ sync: created });
    }));

  // ── ls ──────────────────────────────────────────

  conn
    .command("ls")
    .description("List all connections")
    .option("--provider <provider>", "filter by provider")
    .option("--status <status>", "filter by status (active, paused, error, syncing)")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const query = { project_id: projectId };
      if (opts.provider) query.provider = resolveProvider(opts.provider);
      if (opts.status) query.status = opts.status;

      const connections = await client.get("/connections", query);
      out.success?.({ connections });

      if (!connections || connections.length === 0) {
        out.info("\n  No connections found.\n  Run `puppyone conn add <type> ...` to create one.\n");
        return;
      }

      out.info(`\n  Connections (${connections.length})\n`);

      out.table(connections.map(c => ({
        id: c.id.slice(0, 8) + "...",
        provider: c.provider,
        name: (c.name || "").slice(0, 25),
        direction: c.direction || "\u2014",
        status: statusLabel(c.status),
        key: maskKey(c.access_key),
        lastSync: c.last_synced_at ? timeAgo(c.last_synced_at) : "\u2014",
      })), [
        { key: "id", label: "ID" },
        { key: "provider", label: "PROVIDER" },
        { key: "name", label: "NAME" },
        { key: "direction", label: "DIR" },
        { key: "status", label: "STATUS" },
        { key: "key", label: "KEY" },
        { key: "lastSync", label: "LAST SYNC" },
      ]);

      const byProvider = {};
      for (const c of connections) byProvider[c.provider] = (byProvider[c.provider] || 0) + 1;
      const summary = Object.entries(byProvider).map(([k, v]) => `${v} ${k}`).join(", ");
      const errCount = connections.filter(c => c.status === "error").length;
      out.info(`\n  ${connections.length} total: ${summary}${errCount > 0 ? ` (${errCount} error)` : ""}\n`);
    }));

  // ── info ────────────────────────────────────────

  conn
    .command("info")
    .description("Show detailed info for a connection")
    .argument("<id>", "connection ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const c = await client.get(`/connections/${id}`);
      out.success?.({ connection: c });

      out.info("");
      out.kv([
        ["ID", c.id],
        ["Provider", c.provider],
        ["Name", c.name || "\u2014"],
        ["Project", c.project_id],
        ["Node", c.node_name ? `${c.node_name} (${c.node_id})` : (c.node_id || "\u2014")],
        ["Direction", c.direction || "\u2014"],
        ["Status", statusLabel(c.status)],
        ["Access Key", c.access_key || "\u2014"],
        ["Trigger", c.trigger ? JSON.stringify(c.trigger) : "\u2014"],
        ["Last Sync", c.last_synced_at ? formatDate(c.last_synced_at) : "never"],
        ["Error", c.error_message || "\u2014"],
        ["Created", formatDate(c.created_at)],
        ["Updated", formatDate(c.updated_at)],
      ]);
      out.info("");

      if (c.config && Object.keys(c.config).length > 0) {
        out.info("  Config:");
        for (const [k, v] of Object.entries(c.config)) {
          if (k === "api_key" || k === "access_key") { out.info(`    ${k}: ***`); continue; }
          const display = typeof v === "object" ? JSON.stringify(v) : String(v);
          out.info(`    ${k}: ${display.slice(0, 80)}`);
        }
        out.info("");
      }

      _showProviderGuidance(out, c, client.baseUrl);
    }));

  // ── pause / resume / rm / key / refresh / trigger ──

  conn.command("pause").description("Pause a connection").argument("<id>")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd); const client = createClient(cmd);
      await client.patch(`/connections/${id}`, { status: "paused" });
      out.success?.({ id, status: "paused" }); out.done(`Connection ${id} paused.`);
    }));

  conn.command("resume").description("Resume a paused connection").argument("<id>")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd); const client = createClient(cmd);
      await client.patch(`/connections/${id}`, { status: "active" });
      out.success?.({ id, status: "active" }); out.done(`Connection ${id} resumed.`);
    }));

  conn.command("rm").description("Delete a connection").argument("<id>")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd); const client = createClient(cmd);
      await client.del(`/connections/${id}`);
      out.success?.({ id, deleted: true }); out.done(`Connection ${id} deleted.`);
    }));

  conn.command("key").description("Show or regenerate access key").argument("<id>").option("--regenerate")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd); const client = createClient(cmd);
      if (opts.regenerate) {
        const result = await client.post(`/connections/${id}/regenerate-key`);
        out.success?.({ id, access_key: result.access_key }); out.done(`New key: ${result.access_key}`);
      } else {
        const c = await client.get(`/connections/${id}`);
        out.success?.({ id, access_key: c.access_key });
        c.access_key ? out.raw(c.access_key) : out.info("  No access key set.");
      }
    }));

  conn.command("refresh").description("Trigger a manual sync refresh").argument("<id>")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd); const client = createClient(cmd);
      await client.post(`/sync/syncs/${id}/refresh`);
      out.success?.({ id, refreshed: true }); out.done(`Refresh triggered for ${id}.`);
    }));

  conn.command("trigger").description("Update trigger mode").argument("<id>").argument("<mode>", "manual | import_once | scheduled | realtime")
    .action(withErrors(async (id, mode, opts, cmd) => {
      const out = createOutput(cmd); const client = createClient(cmd);
      await client.patch(`/connections/${id}`, { trigger: { type: mode } });
      out.success?.({ id, trigger: { type: mode } }); out.done(`Trigger mode set to "${mode}" for ${id}.`);
    }));

  // ── update ─────────────────────────────────────

  conn
    .command("update")
    .description("Update config of an existing connection")
    .argument("<id>", "connection ID")
    .option("--set <kv...>", "config key=value (repeatable)")
    .option("--config <json>", "full config JSON (merged)")
    .option("--file <path>", "read script content from local file (for script provider)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      const c = await client.get(`/connections/${id}`);
      const existingConfig = c.config || {};

      const updates = {};
      if (opts.config) {
        try { Object.assign(updates, JSON.parse(opts.config)); } catch {
          out.error("INVALID_JSON", "Invalid --config JSON.");
          return;
        }
      }
      Object.assign(updates, parseSetValues(opts.set));

      // --file reads local file into script_content
      if (opts.file) {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const filePath = resolve(opts.file);
        updates.script_content = readFileSync(filePath, "utf-8");
        if (!updates.runtime && !existingConfig.runtime) {
          const ext = opts.file.split(".").pop();
          updates.runtime = { py: "python", js: "node", sh: "shell" }[ext] ?? "python";
        }
      }

      if (Object.keys(updates).length === 0) {
        out.error("NO_CHANGES", "No updates provided. Use --set, --config, or --file.");
        return;
      }

      const newConfig = { ...existingConfig, ...updates };
      await client.patch(`/connections/${id}`, { config: newConfig });
      out.done(`Connection ${id} config updated.`);

      const changedKeys = Object.keys(updates).join(", ");
      out.info(`  Updated keys: ${changedKeys}`);
      out.success?.({ id, updated_keys: Object.keys(updates) });
    }));

  // ── logs ───────────────────────────────────────

  conn
    .command("logs")
    .description("Show execution history for a connection")
    .argument("<id>", "connection ID")
    .option("--limit <n>", "max runs to show", "10")
    .option("--run <runId>", "show full details for a specific run")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      // Show single run details
      if (opts.run) {
        const run = await client.get(`/sync/runs/${opts.run}`);
        out.info("");
        out.kv([
          ["Run ID", run.id],
          ["Sync ID", run.sync_id],
          ["Status", run.status],
          ["Trigger", run.trigger_type || "\u2014"],
          ["Started", run.started_at || "\u2014"],
          ["Finished", run.finished_at || "\u2014"],
          ["Duration", run.duration_ms != null ? `${run.duration_ms}ms` : "\u2014"],
          ["Exit Code", run.exit_code != null ? String(run.exit_code) : "\u2014"],
          ["Summary", run.result_summary || "\u2014"],
          ["Error", run.error || "\u2014"],
        ]);
        if (run.stdout) {
          out.info("\n  ── stdout ──\n");
          out.info(run.stdout.slice(0, 5000));
          if (run.stdout.length > 5000) out.info("\n  ... (truncated)");
        }
        out.info("");
        out.success?.({ run });
        return;
      }

      // List runs
      const limit = Number(opts.limit) || 10;
      const runs = await client.get(`/sync/syncs/${id}/runs`, { limit });
      out.success?.({ runs });

      if (!runs || runs.length === 0) {
        out.info("\n  No execution history yet.\n  Run `puppyone conn run <id>` to trigger one.\n");
        return;
      }

      out.info(`\n  Execution history (${runs.length})\n`);

      out.table(runs.map(r => ({
        id: r.id.slice(0, 8) + "...",
        status: r.status,
        trigger: r.trigger_type || "\u2014",
        started: r.started_at ? timeAgo(r.started_at) : "\u2014",
        duration: r.duration_ms != null ? `${r.duration_ms}ms` : "\u2014",
        summary: (r.result_summary || r.error || "").slice(0, 40),
      })), [
        { key: "id", label: "RUN" },
        { key: "status", label: "STATUS" },
        { key: "trigger", label: "TRIGGER" },
        { key: "started", label: "STARTED" },
        { key: "duration", label: "DURATION" },
        { key: "summary", label: "SUMMARY" },
      ]);
      out.info("");
    }));

  // ── run ────────────────────────────────────────

  conn
    .command("run")
    .description("Trigger execution and show result (alias for refresh with output)")
    .argument("<id>", "connection ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      out.step("Executing...");
      const result = await client.post(`/sync/syncs/${id}/refresh`);
      out.done("done");

      const data = result?.data;
      if (data && data.synced > 0 && data.results?.length > 0) {
        const r = data.results[0];
        out.info(`  Provider: ${r.provider}`);
        out.info(`  Version:  ${r.version}`);
        out.info(`  Summary:  ${r.summary || "\u2014"}`);
        if (r.run_id) {
          out.info(`  Run ID:   ${r.run_id}`);
          out.info(`\n  View logs: puppyone conn logs ${id} --run ${r.run_id}`);
        }
      } else {
        out.info("  No changes detected (content unchanged).");
      }
      out.info("");
      out.success?.({ result: data });
    }));
}


// ── Type-specific guidance ──────────────────────────────────

function _showAgentGuidance(out, agent, baseUrl) {
  const key = agent.mcp_api_key || agent.access_key;
  if (!key) return;
  out.info(`\n  Access Key: ${key}\n`);
  out.info("  Sync a local folder:");
  out.info(`    puppyone access up ~/workspace --key ${key}\n`);
  out.info("  Connect from Claude / Cursor:");
  out.info(`    npx -y mcp-remote ${baseUrl}/mcp?api_key=${key}`);
}

function _showMcpGuidance(out, endpoint, baseUrl) {
  const key = endpoint.api_key || endpoint.access_key;
  if (!key) return;
  out.info(`\n  API Key: ${key}`);
  out.info("  (save this key \u2014 it won't be shown again)\n");
  out.info("  Connect from Claude Desktop / Cursor:");
  out.info(`    npx -y mcp-remote ${baseUrl}/mcp?api_key=${key}`);
}

function _showSandboxGuidance(out, endpoint) {
  const key = endpoint.api_key || endpoint.access_key;
  if (!key) return;
  out.info(`\n  Access Key: ${key}\n`);
  out.info("  Execute commands:");
  out.info(`    puppyone sandbox exec ${endpoint.id} "echo hello"`);
}

function _showFilesystemGuidance(out, agent, sourcePath) {
  const key = agent.mcp_api_key || agent.access_key;
  if (!key) return;
  const folder = sourcePath || "~/workspace";
  out.info(`\n  Access Key: ${key}\n`);
  out.info("  Start syncing:");
  out.info(`    puppyone access up ${folder} --key ${key}\n`);
  out.info("  Or just (auto-connects):");
  out.info(`    puppyone access up ${folder}`);
}

function _showProviderGuidance(out, connection, baseUrl) {
  const { provider, access_key: key, id } = connection;
  if (provider === "agent" && key) {
    out.info("  \u2500 How to use this agent:");
    out.info(`    Sync folder:  puppyone access up ~/folder --key ${key}`);
    out.info(`    MCP connect:  npx -y mcp-remote ${baseUrl}/mcp?api_key=${key}`);
    out.info(`    Chat:         puppyone agent chat ${id}\n`);
  } else if (provider === "mcp" && key) {
    out.info("  \u2500 How to connect:");
    out.info(`    npx -y mcp-remote ${baseUrl}/mcp?api_key=${key}\n`);
  } else if (provider === "sandbox" && key) {
    out.info("  \u2500 How to execute:");
    out.info(`    puppyone sandbox exec ${id} "<command>"\n`);
  } else if (provider === "filesystem" && key) {
    out.info("  \u2500 How to sync:");
    out.info(`    puppyone access up ~/folder --key ${key}\n`);
  } else {
    out.info("  \u2500 Management:");
    out.info(`    Refresh: puppyone conn refresh ${id}`);
    out.info(`    Pause:   puppyone conn pause ${id}`);
    out.info(`    Schema:  puppyone conn schema ${provider}\n`);
  }
}
