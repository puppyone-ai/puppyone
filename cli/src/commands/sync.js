import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, resolvePath, formatDate } from "../helpers.js";

// ─── Provider Metadata ────────────────────────────────────
// Static fallback. The `sync providers` command fetches from the API;
// these are only used when the API is unreachable.

const PROVIDERS = {
  github:                 { name: "GitHub",                 auth: "oauth",     alias: ["github", "gh"] },
  google_drive:           { name: "Google Drive",           auth: "oauth",     alias: ["google_drive", "gdrive", "google-drive"] },
  google_docs:            { name: "Google Docs",            auth: "oauth",     alias: ["google_docs", "gdocs", "google-docs"] },
  google_sheets:          { name: "Google Sheets",          auth: "oauth",     alias: ["google_sheets", "gsheets", "google-sheets"] },
  gmail:                  { name: "Gmail",                  auth: "oauth",     alias: ["gmail"] },
  google_calendar:        { name: "Google Calendar",        auth: "oauth",     alias: ["google_calendar", "gcal", "google-calendar"] },
  google_search_console:  { name: "Google Search Console",  auth: "oauth",     alias: ["google_search_console", "gsc", "google-search-console"] },
  url:                    { name: "URL / Web Page",         auth: "none",      alias: ["url", "web"] },
  openclaw:               { name: "Local Folder (OpenClaw)",auth: "access_key",alias: ["openclaw", "folder"] },
};

const ALIAS_MAP = {};
for (const [key, meta] of Object.entries(PROVIDERS)) {
  for (const a of meta.alias) ALIAS_MAP[a] = key;
}

function resolveProvider(input) {
  const k = input.toLowerCase().replace(/[\s-]+/g, "_");
  return ALIAS_MAP[k] ?? k;
}

const OAUTH_ENDPOINTS = {
  github: "github",
  google_drive: "google-drive",
  google_docs: "google-docs",
  google_sheets: "google-sheets",
  gmail: "gmail",
  google_calendar: "google-calendar",
  google_search_console: "google-search-console",
};

/**
 * Fetch connector specs from the backend API.
 * Returns a provider→{name, auth} map, or null on failure.
 */
async function fetchProviderMeta(client) {
  try {
    const data = await client.get("/sync/connectors");
    const specs = Array.isArray(data) ? data : data?.items ?? [];
    const map = {};
    for (const s of specs) {
      map[s.provider] = {
        name: s.display_name ?? s.provider,
        auth: s.auth ?? "none",
        oauth_type: s.oauth_type ?? null,
        oauth_ui_type: s.oauth_ui_type ?? null,
      };
    }
    return map;
  } catch {
    return null;
  }
}

function getProviderMeta(provider, dynamicProviders) {
  if (dynamicProviders && dynamicProviders[provider]) return dynamicProviders[provider];
  return PROVIDERS[provider] ?? null;
}

// ─── Register ─────────────────────────────────────────────

export function registerSync(program) {
  const sync = program
    .command("sync")
    .description("Data source sync — connect GitHub, Gmail, Google Workspace, and more");

  // ── providers ─────────────────────────────────────────────
  sync
    .command("providers")
    .description("List all supported data source providers")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      let projectId;
      try { projectId = requireProject(cmd); } catch { projectId = null; }

      try {
        if (!projectId) throw new Error("skip");
        const data = await client.get("/sync/connectors", { project_id: projectId });
        const connectors = Array.isArray(data) ? data : data?.items ?? [];
        if (connectors.length) {
          out.table(
            connectors.map((c) => ({
              provider: c.provider ?? c.name ?? c.id,
              name: c.display_name ?? c.name ?? "-",
              auth: c.auth_type ?? "-",
            })),
            [
              { key: "provider", label: "PROVIDER" },
              { key: "name", label: "NAME" },
              { key: "auth", label: "AUTH" },
            ]
          );
          out.success({ connectors });
          return;
        }
      } catch { /* fall through to local list */ }

      const rows = Object.entries(PROVIDERS)
        .filter(([k]) => k !== "openclaw")
        .map(([key, m]) => ({ provider: key, name: m.name, auth: m.auth, aliases: m.alias.filter((a) => a !== key).join(", ") || "-" }));

      out.table(rows, [
        { key: "provider", label: "PROVIDER" },
        { key: "name", label: "NAME" },
        { key: "auth", label: "AUTH" },
        { key: "aliases", label: "ALIASES" },
      ]);
      out.info("\n  Local folder sync: use `puppyone access` commands instead.");
      out.success({ providers: rows });
    }));

  // ── auth ──────────────────────────────────────────────────
  sync
    .command("auth")
    .description("Authorize an OAuth provider")
    .argument("<provider>", "provider name (notion, github, gdrive, ...)")
    .action(withErrors(async (providerArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const provider = resolveProvider(providerArg);
      const dynamicProviders = await fetchProviderMeta(client);
      const meta = getProviderMeta(provider, dynamicProviders);

      if (!meta) {
        out.error("UNKNOWN_PROVIDER", `Unknown provider: ${providerArg}`, `Run \`puppyone sync providers\` to see the list.`);
        return;
      }

      if (meta.auth !== "oauth") {
        const hints = {
          none: `${meta.name} doesn't require auth. Use \`puppyone sync add ${providerArg} ...\` directly.`,
          api_key: `${meta.name} uses an API key. Pass it with \`puppyone sync add ${providerArg} --api-key <key>\`.`,
          access_key: `${meta.name} uses access keys. Use \`puppyone access up <path> --key <key>\` instead.`,
        };
        out.info(hints[meta.auth] ?? `${meta.name} doesn't use OAuth.`);
        return;
      }

      const oauthPath = OAUTH_ENDPOINTS[provider] ?? meta.oauth_ui_type?.replace(/_/g, "-");
      if (!oauthPath) {
        out.error("NO_OAUTH", `OAuth not configured for ${meta.name}.`);
        return;
      }

      const data = await client.get(`/oauth/${oauthPath}/authorize`);
      const authUrl = data?.url ?? data?.authorization_url ?? data;

      out.info("Open this URL to authorize:");
      out.info("");
      out.info(`  ${authUrl}`);
      out.info("");
      out.info("Then check status:");
      out.info(`  puppyone sync auth-status ${providerArg}`);
      out.success({ provider, authorization_url: authUrl });
    }));

  // ── auth-status ───────────────────────────────────────────
  sync
    .command("auth-status")
    .description("Check OAuth authorization status")
    .argument("<provider>", "provider name")
    .action(withErrors(async (providerArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const provider = resolveProvider(providerArg);
      const oauthPath = OAUTH_ENDPOINTS[provider];

      if (!oauthPath) {
        out.error("NOT_OAUTH", `${providerArg} doesn't use OAuth.`);
        return;
      }

      const data = await client.get(`/oauth/${oauthPath}/status`);
      const connected = data?.connected ?? data?.is_connected ?? false;

      if (connected) {
        out.info(`${getProviderMeta(provider, null)?.name ?? providerArg}: authorized ✓`);
      } else {
        out.info(`${getProviderMeta(provider, null)?.name ?? providerArg}: not authorized ✗`);
        out.info(`  Run \`puppyone sync auth ${providerArg}\` to authorize.`);
      }
      out.success({ provider, connected });
    }));

  // ── add ───────────────────────────────────────────────────
  sync
    .command("add")
    .description("Add a new data source sync")
    .argument("<provider>", "provider (github, gdrive, gmail, gcal, gsheets, gdocs, gsc, url, ...)")
    .argument("[source]", "source URL or identifier (provider-specific)")
    .option("--folder <path>", "target folder path in the project")
    .option("--mode <mode>", "sync mode: import_once, manual, scheduled", "import_once")
    .option("--config <json>", "provider-specific config as JSON")
    .option("--direction <dir>", "sync direction: inbound, outbound, bidirectional", "inbound")
    .action(withErrors(async (providerArg, source, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const provider = resolveProvider(providerArg);
      const dynamicProviders = await fetchProviderMeta(client);
      const meta = getProviderMeta(provider, dynamicProviders);

      if (!meta) {
        out.error("UNKNOWN_PROVIDER", `Unknown provider: ${providerArg}`, "Run `puppyone sync providers` to see the list.");
        return;
      }

      if (provider === "openclaw") {
        out.info("For local folder sync, use `puppyone access up <path> --key <key>` instead.");
        return;
      }

      let config = {};

      if (opts.config) {
        try { config = JSON.parse(opts.config); } catch {
          out.error("INVALID_JSON", "Invalid --config JSON.");
          return;
        }
      }

      if (source) config.source_url = source;

      const body = {
        project_id: projectId,
        provider,
        config,
        sync_mode: opts.mode,
        direction: opts.direction,
      };

      if (opts.folder) {
        const folderId = await resolvePath(client, projectId, opts.folder);
        if (folderId) body.target_folder_node_id = folderId;
      }

      out.step(`Adding ${meta.name} sync...`);
      const result = await client.post("/sync/bootstrap", body);
      out.done("done");

      const syncId = result?.sync_id ?? result?.id ?? result?.sync?.id;
      out.info(`  Sync created: ${syncId ?? "(created)"}`);
      if (result?.node_name || result?.folder_name) {
        out.info(`  Target: ${result.node_name ?? result.folder_name}`);
      }
      out.success({ sync: result });
    }));

  // ── ls ────────────────────────────────────────────────────
  sync
    .command("ls")
    .description("List active syncs")
    .option("--provider <name>", "filter by provider")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const query = { project_id: projectId };
      if (opts.provider) query.provider = resolveProvider(opts.provider);

      const data = await client.get("/sync/syncs", query);
      const syncs = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        syncs.map((s) => ({
          id: (s.id ?? "").slice(0, 8),
          provider: s.provider ?? "-",
          name: s.name ?? s.config?.source_url?.slice(0, 30) ?? "-",
          status: s.status ?? s.state ?? "-",
          direction: s.direction ?? "-",
          mode: s.sync_mode ?? s.trigger_policy ?? "-",
          updated: formatDate(s.updated_at ?? s.last_synced_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "provider", label: "PROVIDER" },
          { key: "name", label: "SOURCE" },
          { key: "direction", label: "DIR" },
          { key: "status", label: "STATUS" },
          { key: "mode", label: "MODE" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ syncs });
    }));

  // ── info ──────────────────────────────────────────────────
  sync
    .command("info")
    .description("Show sync details")
    .argument("<id>", "sync ID (or prefix)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const syncs = await client.get("/sync/syncs", { project_id: projectId });
      const list = Array.isArray(syncs) ? syncs : syncs?.items ?? [];
      const s = list.find((x) => x.id === id || x.id?.startsWith(id));

      if (!s) {
        out.error("NOT_FOUND", `Sync not found: ${id}`);
        return;
      }

      const provName = getProviderMeta(s.provider, null)?.name ?? s.provider;
      const sourceDesc = s.config?.source_url ?? s.config?.feed_type ?? s.config?.site_url ?? "(configured)";

      out.info(`\n  ${provName}  →  ${s.node_name ?? s.node_id ?? "(project root)"}`);
      out.info("");
      out.kv([
        ["ID:", s.id],
        ["Provider:", provName],
        ["Source:", sourceDesc],
        ["Target Node:", s.node_id ?? "-"],
        ["Direction:", s.direction ?? "inbound"],
        ["Status:", s.status ?? s.state ?? "-"],
        ["Mode:", s.sync_mode ?? s.trigger_policy ?? "-"],
        ["Authority:", s.authority ?? "-"],
        ["Created:", formatDate(s.created_at)],
        ["Updated:", formatDate(s.updated_at)],
        ["Last Sync:", formatDate(s.last_synced_at)],
      ]);

      if (s.config && Object.keys(s.config).length) {
        out.info("\n  Config:");
        for (const [k, v] of Object.entries(s.config)) {
          if (k === "api_key" || k === "access_key") {
            out.info(`    ${k}: ***`);
          } else {
            out.info(`    ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
          }
        }
      }

      out.success({ sync: s });
    }));

  // ── rm ────────────────────────────────────────────────────
  sync
    .command("rm")
    .description("Remove a sync")
    .argument("<id>", "sync ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/sync/syncs/${id}`);
      out.info(`Sync removed: ${id}`);
      out.success({ deleted: id });
    }));

  // ── refresh ───────────────────────────────────────────────
  sync
    .command("refresh")
    .description("Manually trigger a sync pull")
    .argument("<id>", "sync ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.post(`/sync/syncs/${id}/refresh`);
      out.info(`Sync refresh triggered: ${id}`);
      out.success({ refreshed: id });
    }));

  // ── pause ─────────────────────────────────────────────────
  sync
    .command("pause")
    .description("Pause a sync")
    .argument("<id>", "sync ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.post(`/sync/syncs/${id}/pause`);
      out.info(`Sync paused: ${id}`);
      out.success({ paused: id });
    }));

  // ── resume ────────────────────────────────────────────────
  sync
    .command("resume")
    .description("Resume a paused sync")
    .argument("<id>", "sync ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.post(`/sync/syncs/${id}/resume`);
      out.info(`Sync resumed: ${id}`);
      out.success({ resumed: id });
    }));

  // ── trigger ───────────────────────────────────────────────
  sync
    .command("trigger")
    .description("Update sync trigger mode")
    .argument("<id>", "sync ID")
    .argument("<mode>", "trigger mode: import_once, manual, scheduled")
    .action(withErrors(async (id, mode, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.patch(`/sync/syncs/${id}/trigger`, { sync_mode: mode });
      out.info(`Sync trigger updated: ${id} → ${mode}`);
      out.success({ sync_id: id, mode });
    }));

  // ── log ───────────────────────────────────────────────────
  sync
    .command("log")
    .description("Show sync changelog")
    .option("-n, --limit <n>", "number of entries", "20")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const data = await client.get("/sync/changelog", {
        project_id: projectId,
        limit: opts.limit,
      });
      const entries = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        entries.map((e) => ({
          time: formatDate(e.created_at ?? e.timestamp),
          action: e.action ?? e.event ?? "-",
          provider: e.provider ?? "-",
          detail: e.detail ?? e.message ?? "-",
        })),
        [
          { key: "time", label: "TIME" },
          { key: "action", label: "ACTION" },
          { key: "provider", label: "PROVIDER" },
          { key: "detail", label: "DETAIL" },
        ]
      );
      out.success({ changelog: entries });
    }));
}
