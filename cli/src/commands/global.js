/**
 * Global commands: status (project dashboard)
 *
 * Top-level shortcuts are registered by registerGlobalCommands().
 */

import { createOutput } from "../output.js";

function shortenPath(p) {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
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
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── Provider display helpers ─────────────────────────────────

const STATUS_ICONS = { active: "\u25CF", syncing: "\u25CF", paused: "\u25CB", error: "\u2717" };

function statusLabel(s) {
  const icon = STATUS_ICONS[s] || "\u25CF";
  return `${icon} ${s}`;
}

// ── Project dashboard ────────────────────────────────────────

export async function dashboardAction(path, opts, cmd) {
  const out = createOutput(cmd);

  let client;
  let projectId;
  try {
    const { createClient } = await import("../api.js");
    client = createClient(cmd);
    const { requireProject } = await import("../helpers.js");
    projectId = requireProject(cmd);
  } catch (e) {
    out.error("NOT_AUTHENTICATED", "Login and select a project first.",
      "Run: puppyone auth login && puppyone project use <name>");
    return;
  }

  try {
    const d = await client.get(`/projects/${projectId}/dashboard`);

    out.success?.({ dashboard: d });

    out.info("");
    out.info(`  PuppyOne \u2014 ${d.project.name} (${d.project.id.slice(0, 12)}...)`);
    out.info(`  ${"─".repeat(50)}`);
    out.info("");

    // Content
    out.info("  Content");
    out.info(`    ${d.nodes.total} nodes (${d.nodes.folders} folders, ${d.nodes.files} files)`);
    out.info("");

    // Access Points
    if (d.connections.length > 0) {
      out.info(`  Access Points (${d.connections.length})`);

      const connCols = [
        { key: "provider", label: "PROVIDER" },
        { key: "name", label: "NAME" },
        { key: "status", label: "STATUS" },
        { key: "lastSync", label: "LAST SYNC" },
      ];
      const connRows = d.connections.map(c => ({
        provider: c.provider,
        name: (c.name || "").slice(0, 30),
        status: statusLabel(c.status),
        lastSync: c.last_synced_at ? timeAgo(c.last_synced_at) : "\u2014",
      }));
      out.table(connRows, connCols);

      const errConns = d.connections.filter(c => c.status === "error");
      if (errConns.length > 0) {
        out.info("");
        out.warn(`  ${errConns.length} access point(s) in error:`);
        for (const c of errConns) {
          out.info(`    - ${c.provider}/${c.name}: ${c.error_message || "unknown"}`);
        }
      }
    } else {
      out.info("  Access Points: (none)");
      out.info("    Run `puppyone access add <provider> ...` to add a data source.");
    }
    out.info("");

    // Tools
    if (d.tools.length > 0) {
      out.info(`  Tools (${d.tools.length})`);
      const toolCols = [
        { key: "name", label: "NAME" },
        { key: "type", label: "TYPE" },
        { key: "index", label: "INDEX" },
      ];
      const toolRows = d.tools.map(t => {
        let idx = "\u2014";
        if (t.type === "search") {
          if (t.index_status === "ready") {
            idx = `\u2713 ready (${t.chunks_count ?? 0} chunks)`;
          } else if (t.index_status === "indexing") {
            const pct = t.total_files && t.indexed_files != null
              ? ` (${t.indexed_files}/${t.total_files})`
              : "";
            idx = `\u21BB indexing${pct}`;
          } else if (t.index_status === "error") {
            idx = `\u2717 error`;
          } else if (t.index_status === "pending") {
            idx = `\u25CB pending`;
          }
        }
        return { name: t.name, type: t.type || "\u2014", index: idx };
      });
      out.table(toolRows, toolCols);
    } else {
      out.info("  Tools: (none)");
    }
    out.info("");

    // Uploads
    const activeUploads = d.uploads || [];
    if (activeUploads.length > 0) {
      out.info(`  Uploads (${activeUploads.length} in progress)`);
      for (const u of activeUploads) {
        out.info(`    - ${u.type} ${u.status} ${u.progress}%${u.message ? " — " + u.message : ""}`);
      }
      out.info("");
    }
  } catch (e) {
    const { ApiError } = await import("../api.js");
    if (e instanceof ApiError) {
      out.error(e.code, e.message, e.hint);
    } else {
      out.error("UNEXPECTED", e.message);
    }
  }
}

// ============================================================
// Register top-level shortcuts
// ============================================================

export function registerGlobalCommands(program) {
  program
    .command("status")
    .description("Project dashboard")
    .action((opts, cmd) => dashboardAction(null, opts, cmd));
}
