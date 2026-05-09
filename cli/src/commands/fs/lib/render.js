import { ApiError } from "../../../api.js";
import {
  dirname,
  relativeChildName,
  stripRootPath,
} from "./paths.js";

const FS_SORT_KEYS = new Set(["name", "path", "type", "size", "time"]);

export function sortEntries(entries, opts = {}, { recursive = false } = {}) {
  const key = opts.sort || (recursive ? "path" : "name");
  if (!FS_SORT_KEYS.has(key)) {
    throw new ApiError(
      0,
      "INVALID_SORT",
      `Unsupported sort key: ${key}`,
      "Use one of: name, path, type, size, time.",
    );
  }

  const value = (entry) => {
    if (key === "path") return entry.path || entry.name || "";
    if (key === "type") return `${entry.type || ""}:${entry.name || ""}`;
    if (key === "size") return entry.size_bytes ?? -1;
    if (key === "time") return Date.parse(entry.modified_at || entry.created_at || "") || 0;
    return entry.name || entry.path || "";
  };

  const sorted = [...entries].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const comparison = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return (key === "size" || key === "time") ? -comparison : comparison;
  });
  return opts.reverse ? sorted.reverse() : sorted;
}

export function unixMode(entry) {
  return entry.type === "folder" ? "drwxr-xr-x" : "-rw-r--r--";
}

export function unixSize(entry) {
  return entry.size_bytes ?? 0;
}

export function unixBlocks(entry) {
  return Math.ceil(unixSize(entry) / 512);
}

export function formatHumanSize(bytes) {
  const units = ["B", "K", "M", "G", "T"];
  let value = Number(bytes || 0);
  let unit = units[0];
  for (let i = 0; i < units.length - 1 && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i + 1];
  }
  return unit === "B" ? String(Math.trunc(value)) : `${value.toFixed(value >= 10 ? 0 : 1)}${unit}`;
}

export function unixLsDate(entry) {
  const raw = entry.modified_at || entry.updated_at || entry.created_at || entry.time;
  if (!raw) return "           -";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "           -";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, " ")}  ${date.getUTCFullYear()}`;
}

export function unixStatTimestamp(entry) {
  const raw = entry.modified_at || entry.updated_at || entry.created_at || entry.time;
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "-";
  return `${date.toISOString().replace("T", " ").replace("Z", "")}000000 +0000`;
}

export function decorateLsName(entry, name, opts = {}) {
  if ((opts.classify || opts.slashDirectories) && entry.type === "folder") {
    return `${name}/`;
  }
  return name;
}

export function renderLongEntry(entry, name, opts = {}) {
  const mode = unixMode(entry);
  const sizeText = opts.humanReadable ? formatHumanSize(unixSize(entry)) : String(unixSize(entry));
  const size = sizeText.padStart(8, " ");
  return `${mode} 1 puppyone puppyone ${size} ${unixLsDate(entry)} ${decorateLsName(entry, name, opts)}`;
}

export function renderFlatLs(out, entries, opts = {}, { parentPath = "" } = {}) {
  if (!entries.length) {
    if (opts.long) out.raw("total 0");
    return;
  }

  const lines = entries.map((entry) => {
    const name = parentPath ? relativeChildName(entry, parentPath) : entry.name;
    return opts.long ? renderLongEntry(entry, name, opts) : decorateLsName(entry, name, opts);
  });
  if (opts.long) {
    lines.unshift(`total ${entries.reduce((sum, entry) => sum + unixBlocks(entry), 0)}`);
  }
  out.raw(lines.join("\n"));
}

export function inferTargetType(result, entries, path) {
  if (result.target_type) return result.target_type;
  const cleanPath = String(path || "").replace(/^\/+|\/+$/g, "");
  if (
    cleanPath
    && entries.length === 1
    && entries[0]?.path === cleanPath
    && entries[0]?.type !== "folder"
  ) {
    return entries[0].type || "file";
  }
  return "folder";
}

export function renderRecursiveLs(out, entries, opts = {}, rootPath = "") {
  const root = (rootPath || "").replace(/^\/+|\/+$/g, "");
  const groups = new Map();
  for (const entry of entries) {
    const parent = dirname(entry.path || entry.name || "");
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(entry);
  }

  const dirs = new Set([""]);
  if (root) dirs.add(root);
  for (const entry of entries) {
    if (entry.type === "folder") dirs.add(entry.path || entry.name || "");
  }

  const orderedDirs = [...dirs]
    .filter(dir => !root || dir === root || dir.startsWith(`${root}/`))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const sections = [];
  for (const dir of orderedDirs) {
    const children = sortEntries(groups.get(dir) || [], { ...opts, sort: "name" });
    if (!children.length && dir !== root && dir !== "") continue;
    const header = dir || ".";
    const body = children.map((entry) => {
      const name = relativeChildName(entry, dir);
      return opts.long ? renderLongEntry(entry, name, opts) : decorateLsName(entry, name, opts);
    });
    if (opts.long) {
      body.unshift(`total ${children.reduce((sum, entry) => sum + unixBlocks(entry), 0)}`);
    }
    sections.push(`${header}:\n${body.join("\n")}`.trimEnd());
  }

  if (sections.length) out.raw(sections.join("\n\n"));
}

export function buildTree(entries, rootPath = "") {
  const root = { name: ".", type: "folder", children: new Map() };
  for (const entry of entries) {
    const entryPath = stripRootPath(entry.path || entry.name || "", rootPath);
    const parts = entryPath.split("/").filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    parts.forEach((part, index) => {
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          type: index === parts.length - 1 ? entry.type : "folder",
          children: new Map(),
        });
      }
      node = node.children.get(part);
      if (index === parts.length - 1) node.type = entry.type;
    });
  }
  return root;
}

export function renderTree(out, entries, rootLabel = ".", { rootType = "folder" } = {}) {
  const root = buildTree(entries, rootLabel);
  const lines = [rootLabel || "."];
  let dirCount = 0;
  let fileCount = rootType && rootType !== "folder" ? 1 : 0;

  if (rootType && rootType !== "folder") {
    lines.push("");
    lines.push(`0 directories, ${fileCount} ${fileCount === 1 ? "file" : "files"}`);
    out.raw(lines.join("\n"));
    return;
  }

  function walk(node, prefix = "") {
    const children = [...node.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    children.forEach((child, index) => {
      const last = index === children.length - 1;
      lines.push(`${prefix}${last ? "`-- " : "|-- "}${child.name}`);
      if (child.type === "folder") {
        dirCount += 1;
        walk(child, `${prefix}${last ? "    " : "|   "}`);
      } else {
        fileCount += 1;
      }
    });
  }

  walk(root);
  lines.push("");
  lines.push(`${dirCount} ${dirCount === 1 ? "directory" : "directories"}, ${fileCount} ${fileCount === 1 ? "file" : "files"}`);
  out.raw(lines.join("\n"));
}

export function unixType(entry) {
  if (entry.type === "folder") return "directory";
  return "regular file";
}
