import { loadConfig } from "./config.js";
import { ApiError, collectOpts } from "./api.js";
import { createOutput } from "./output.js";

export function requireProject(cmd) {
  const opts = collectOpts(cmd);
  if (opts.project) return opts.project;
  const config = loadConfig();
  if (config.active_project?.id) return config.active_project.id;
  throw new ApiError(0, "NO_PROJECT", "No active project set.", "Run `puppyone project use <id-or-name>` first.");
}

export function requireOrg(cmd) {
  const opts = collectOpts(cmd);
  if (opts.org) return opts.org;
  const config = loadConfig();
  if (config.active_org?.id) return config.active_org.id;
  throw new ApiError(0, "NO_ORG", "No active organization set.", "Run `puppyone org use <id-or-name>` first.");
}

export async function resolvePath(client, projectId, pathStr) {
  if (!pathStr || pathStr === "/" || pathStr === ".") return null;

  const parts = pathStr.replace(/^\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  let parentId = null;

  for (const part of parts) {
    const query = { project_id: projectId };
    if (parentId) query.parent_id = parentId;
    const children = await client.get("/nodes", query);
    const list = Array.isArray(children) ? children : children?.items ?? [];
    const match = list.find((n) => n.name === part);
    if (!match) {
      throw new ApiError(404, "NOT_FOUND", `Path not found: "${part}" in /${parts.join("/")}`, "Check the path exists.");
    }
    parentId = match.id;
  }

  return parentId;
}

export async function resolveNode(client, projectId, pathStr) {
  if (!pathStr || pathStr === "/" || pathStr === ".") return null;

  const parts = pathStr.replace(/^\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  let parentId = null;
  let node = null;

  for (const part of parts) {
    const query = { project_id: projectId };
    if (parentId) query.parent_id = parentId;
    const children = await client.get("/nodes", query);
    const list = Array.isArray(children) ? children : children?.items ?? [];
    const match = list.find((n) => n.name === part);
    if (!match) {
      throw new ApiError(404, "NOT_FOUND", `Path not found: "${part}" in /${parts.join("/")}`, "Check the path exists.");
    }
    parentId = match.id;
    node = match;
  }

  return node;
}

export function splitPath(pathStr) {
  const clean = pathStr.replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return { parentPath: null, name: null };
  const name = parts.pop();
  const parentPath = parts.length > 0 ? "/" + parts.join("/") : null;
  return { parentPath, name };
}

export function withErrors(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      const cmd = args[args.length - 1];
      const out = createOutput(cmd);
      if (e instanceof ApiError) {
        out.error(e.code, e.message, e.hint);
      } else if (e.cause?.code === "ECONNREFUSED" || e.message?.includes("fetch")) {
        out.error("API_UNREACHABLE", "Cannot reach API server.", "Check your API URL and server status.");
      } else {
        out.error("UNEXPECTED", e.message);
      }
    }
  };
}

export function formatDate(str) {
  if (!str) return "-";
  const d = new Date(str);
  return d.toLocaleString();
}

export function formatSize(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const TYPE_ICONS = { folder: "📁", json: "📄", markdown: "📝", file: "📎", sync: "🔄" };

export function typeIcon(type) {
  return TYPE_ICONS[type] ?? "📄";
}
