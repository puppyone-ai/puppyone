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

export function statusAction(path, opts, cmd) {
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
    .description("Show agent workspace status (shortcut for `access status`)")
    .argument("[path]", "workspace path (omit for all)")
    .action(statusAction);
}
