/**
 * Global commands: ls, ps, status
 *
 * Action handlers are exported for reuse by `access` subcommand group.
 * Top-level shortcuts are registered by registerGlobalCommands().
 */

import { resolve } from "node:path";
import { createOutput } from "../output.js";
import { getAllWorkspaces, getWorkspace } from "../registry.js";

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

function formatUptime(isoString) {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function renderBar(pct, width) {
  const filled = Math.round(pct / 100 * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function printWorkspaceDetail(out, w) {
  out.info("");
  out.info(`Workspace: ${w.path}`);
  if (w.name) out.info(`Name:      ${w.name}`);
  out.info("");

  out.info("  Connection");
  out.info(`    API:        ${w.api_url ?? "http://localhost:9090"}`);
  out.info(`    Agent:      ${w.agent_id ?? "—"}`);
  out.info(`    Project:    ${w.project_id ?? "—"}`);
  out.info("");

  out.info("  Daemon");
  if (w.running) {
    out.info(`    Status:     ● Running (PID ${w.pid})`);
    out.info(`    Uptime:     ${formatUptime(w.stats?.started_at)}`);
  } else {
    out.info(`    Status:     ○ Stopped`);
  }
  out.info(`    Cursor:     ${w.cursor}`);
  out.info("");

  out.info("  Sync");
  out.info(`    Files:      ${w.files_tracked} tracked`);
  out.info(`    Last Sync:  ${timeAgo(w.last_sync)}`);
  if (w.stats?.last_error) {
    out.info(`    Last Error: ${w.stats.last_error}`);
  }

  const conflicts = w.conflicts || [];
  if (conflicts.length > 0) {
    out.info(`    Conflicts:  ${conflicts.length}`);
    for (const c of conflicts.slice(0, 5)) {
      out.info(`      - ${c.file} (${timeAgo(c.backed_up_at)})`);
    }
    if (conflicts.length > 5) out.info(`      ... and ${conflicts.length - 5} more`);
  }

  const active = w.transfers.active || [];
  if (active.length > 0) {
    out.info("");
    out.info("  Active Transfers");
    for (const t of active) {
      const dir = t.direction === "up" ? "↑" : "↓";
      out.info(`    ${dir} ${t.file}  ${formatBytes(t.bytes_done || 0)} / ${formatBytes(t.bytes_total || 0)}`);
    }
  }
  out.info("");
}

// ============================================================
// Exported action handlers
// ============================================================

export function lsAction(opts, cmd) {
  const out = createOutput(cmd);
  const workspaces = getAllWorkspaces();

  if (workspaces.length === 0) {
    out.info("");
    out.info("  No agent connections registered.");
    out.info("  Run `puppyone access up <path> --key <key>` to get started.");
    out.info("");
    return;
  }

  out.info("");
  out.info("Agent Connections");
  out.info("");

  const cols = [
    { key: "path", label: "PATH" },
    { key: "name", label: "NAME" },
    { key: "status", label: "STATUS" },
    { key: "files", label: "FILES" },
    { key: "lastSync", label: "LAST SYNC" },
  ];

  const rows = workspaces.map(w => ({
    path: shortenPath(w.path),
    name: w.name || w.agent_id?.slice(0, 8) || "—",
    status: w.running ? "● Syncing" : "○ Stopped",
    files: w.running ? String(w.files_tracked) : "—",
    lastSync: timeAgo(w.last_sync),
  }));

  out.table(rows, cols);

  const active = workspaces.filter(w => w.running).length;
  out.info("");
  out.info(`  ${workspaces.length} connection${workspaces.length > 1 ? "s" : ""}, ${active} active`);
  out.info("");

  out.success?.({
    workspaces: workspaces.map(w => ({
      path: w.path, name: w.name, running: w.running,
      files_tracked: w.files_tracked, last_sync: w.last_sync,
    })),
  });
}

export function psAction(opts, cmd) {
  const out = createOutput(cmd);
  const workspaces = getAllWorkspaces();
  const running = workspaces.filter(w => w.running);

  if (running.length === 0) {
    out.info("");
    out.info("  No daemons running.");
    out.info("  Run `puppyone access up <path>` to start sync.");
    out.info("");
    return;
  }

  out.info("");
  out.info("Agent Processes");
  out.info("");

  const cols = [
    { key: "pid", label: "PID" },
    { key: "path", label: "WORKSPACE" },
    { key: "uptime", label: "UPTIME" },
    { key: "cursor", label: "CURSOR" },
    { key: "files", label: "FILES" },
  ];

  const rows = running.map(w => ({
    pid: String(w.pid),
    path: shortenPath(w.path),
    uptime: formatUptime(w.stats?.started_at),
    cursor: String(w.cursor),
    files: String(w.files_tracked),
  }));

  out.table(rows, cols);

  const allTransfers = running.flatMap(w => (w.transfers.active || []).map(t => ({ ...t, workspace: w.path })));
  if (allTransfers.length > 0) {
    out.info("");
    out.info("  Active Transfers:");
    for (const t of allTransfers) {
      const dir = t.direction === "up" ? "↑" : "↓";
      const done = t.bytes_done || 0;
      const total = t.bytes_total || 0;
      const pct = total > 0 ? Math.round(done / total * 100) : 0;
      const bar = renderBar(pct, 20);
      const sizeDone = formatBytes(done);
      const sizeTotal = formatBytes(total);
      out.info(`  ${dir} ${t.file.padEnd(30)} ${sizeDone} / ${sizeTotal}  ${String(pct).padStart(3)}%  ${bar}`);
    }
  }

  const totalCompleted = running.reduce((s, w) => s + (w.transfers.completed_count || 0), 0);
  const totalErrors = running.reduce((s, w) => s + (w.transfers.error_count || 0), 0);
  const totalConflicts = running.reduce((s, w) => s + (w.conflicts?.length || 0), 0);

  out.info("");
  const parts = [`${running.length} process${running.length > 1 ? "es" : ""}`];
  if (allTransfers.length > 0) parts.push(`${allTransfers.length} active transfer${allTransfers.length > 1 ? "s" : ""}`);
  if (totalCompleted > 0) parts.push(`${totalCompleted} completed`);
  if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors > 1 ? "s" : ""}`);
  if (totalConflicts > 0) parts.push(`${totalConflicts} conflict${totalConflicts > 1 ? "s" : ""}`);
  out.info(`  ${parts.join(", ")}`);
  out.info("");
}

export function accessStatusAction(path, opts, cmd) {
  const out = createOutput(cmd);

  if (path) {
    const absPath = resolve(path);
    const w = getWorkspace(absPath);
    if (!w) {
      out.error("NOT_FOUND", `"${absPath}" is not a registered workspace.`, "Run `puppyone access ls` to see all connections.");
      return;
    }
    printWorkspaceDetail(out, w);
  } else {
    const workspaces = getAllWorkspaces();
    if (workspaces.length === 0) {
      out.info("");
      out.info("  No agent connections registered.");
      out.info("");
      return;
    }
    for (const w of workspaces) {
      printWorkspaceDetail(out, w);
    }
  }
}

// For backward compat: `access status` still uses the old logic
export { accessStatusAction as statusAction };

// ── Provider display helpers ─────────────────────────────────

const STATUS_ICONS = { active: "\u25CF", syncing: "\u25CF", paused: "\u25CB", error: "\u2717" };

function statusLabel(s) {
  const icon = STATUS_ICONS[s] || "\u25CF";
  return `${icon} ${s}`;
}

function maskKey(key) {
  if (!key || key.length < 8) return key || "\u2014";
  const idx = key.indexOf("_");
  const pre = idx > 0 ? idx + 1 : 4;
  return key.slice(0, pre) + "..." + key.slice(-4);
}

// ── Project dashboard (new global status) ────────────────────

export async function dashboardAction(path, opts, cmd) {
  // If a local path is given, fall back to access agent status
  if (path && (path.startsWith("/") || path.startsWith("~") || path.startsWith("."))) {
    return accessStatusAction(path, opts, cmd);
  }

  const out = createOutput(cmd);

  let client;
  let projectId;
  try {
    const { createClient } = await import("../api.js");
    client = createClient(cmd);
    const { requireProject } = await import("../helpers.js");
    projectId = requireProject(cmd);
  } catch (e) {
    // Not logged in or no project — fall back to access status
    return accessStatusAction(path, opts, cmd);
  }

  try {
    const d = await client.get(`/projects/${projectId}/dashboard`);

    // --json mode
    out.success?.({ dashboard: d });

    // Human-readable
    out.info("");
    out.info(`  PuppyOne \u2014 ${d.project.name} (${d.project.id.slice(0, 12)}...)`);
    out.info(`  ${"─".repeat(50)}`);
    out.info("");

    // Content
    out.info("  Content");
    out.info(`    ${d.nodes.total} nodes (${d.nodes.folders} folders, ${d.nodes.files} files)`);
    out.info("");

    // Connections
    if (d.connections.length > 0) {
      out.info(`  Connections (${d.connections.length})`);

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
        out.warn(`  ${errConns.length} connection(s) in error:`);
        for (const c of errConns) {
          out.info(`    - ${c.provider}/${c.name}: ${c.error_message || "unknown"}`);
        }
      }
    } else {
      out.info("  Connections: (none)");
      out.info("    Run `puppyone sync add <provider> ...` to connect a data source.");
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

    // Local access daemons
    const workspaces = getAllWorkspaces();
    const activeWs = workspaces.filter(w => w.running);
    if (workspaces.length > 0) {
      out.info(`  Access Daemons (${activeWs.length}/${workspaces.length} running)`);
      for (const w of workspaces) {
        const icon = w.running ? "\u25CF" : "\u25CB";
        const label = w.running ? "syncing" : "stopped";
        const last = w.last_sync ? timeAgo(w.last_sync) : "\u2014";
        out.info(`    ${icon} ${shortenPath(w.path)}  ${label}  ${w.files_tracked} files  ${last}`);
      }
      out.info("");
    }
  } catch (e) {
    // If dashboard fails (e.g. old backend), fall back to access status
    if (e.status === 404) {
      return accessStatusAction(path, opts, cmd);
    }
    const { ApiError } = await import("../api.js");
    if (e instanceof ApiError) {
      out.error(e.code, e.message, e.hint);
    } else {
      out.error("UNEXPECTED", e.message);
    }
  }
}

// ============================================================
// Register top-level shortcuts (backward compat)
// ============================================================

export function registerGlobalCommands(program) {
  program
    .command("ps")
    .description("List running agent daemons (shortcut for `access ps`)")
    .action(psAction);

  program
    .command("status")
    .description("Project dashboard — or access status if path given")
    .argument("[path]", "workspace path (omit for project dashboard)")
    .action(dashboardAction);
}
