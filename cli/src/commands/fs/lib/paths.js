import { normalizePath } from "../../../helpers.js";

export function scopedPath(path) {
  return normalizePath(path || "");
}

export function basename(path) {
  const clean = String(path || "").replace(/\/+$/, "");
  return clean.includes("/") ? clean.slice(clean.lastIndexOf("/") + 1) : clean;
}

export function joinPath(parent, child) {
  const cleanParent = scopedPath(parent);
  const childName = basename(child);
  return cleanParent ? `${cleanParent}/${childName}` : childName;
}

export function hasTrailingSlash(path) {
  return /\/+$/.test(String(path || ""));
}

export function stripRootPath(path, rootPath) {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  const root = String(rootPath || "").replace(/^\/+|\/+$/g, "");
  if (!root) return clean;
  if (clean === root) return "";
  const prefix = `${root}/`;
  return clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
}

export function dirname(path) {
  const clean = String(path || "").replace(/\/+$/, "");
  if (!clean || !clean.includes("/")) return "";
  return clean.slice(0, clean.lastIndexOf("/"));
}

export function relativeChildName(entry, parentPath) {
  if (entry.name === "." || entry.name === "..") return entry.name;
  const path = entry.path || entry.name || "";
  const parent = (parentPath || "").replace(/^\/+|\/+$/g, "");
  if (!parent) return basename(path);
  const prefix = `${parent}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : basename(path);
}

export function dotEntries(path = "") {
  const clean = scopedPath(path);
  return [
    { name: ".", path: clean, type: "folder", size_bytes: 0, children_count: null },
    { name: "..", path: dirname(clean), type: "folder", size_bytes: 0, children_count: null },
  ];
}
