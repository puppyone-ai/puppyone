import type { DataNode, DataPort } from "@puppyone/shared-ui";
import type { FilesVisibilitySettings } from "../../preferences";

export function createExplorerDataPort(dataPort: DataPort, settings: FilesVisibilitySettings): DataPort {
  if (settings.showHiddenFiles || settings.excludePatterns.length === 0) return dataPort;
  const matchers = settings.excludePatterns
    .map(createExplorerExcludeMatcher)
    .filter((matcher): matcher is ExcludeMatcher => matcher !== null);

  if (matchers.length === 0) return dataPort;

  return {
    ...dataPort,
    listChildren: async (folderPath) => {
      const children = await dataPort.listChildren(folderPath);
      return children.filter((node) => !matchers.some((matcher) => matcher(node)));
    },
  };
}

type ExcludeMatcher = (node: DataNode) => boolean;

function createExplorerExcludeMatcher(rawPattern: string): ExcludeMatcher | null {
  const pattern = rawPattern.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!pattern) return null;

  const targetPattern = pattern.includes("/") ? pattern : `**/${pattern}`;
  const regex = globPatternToRegExp(targetPattern);
  if (!regex) return null;

  return (node) => regex.test(normalizeExplorerPath(node.path));
}

function globPatternToRegExp(pattern: string): RegExp | null {
  let source = "";

  for (let index = 0; index < pattern.length;) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*") {
      if (next === "*") {
        if (afterNext === "/") {
          source += "(?:.*/)?";
          index += 3;
        } else {
          source += ".*";
          index += 2;
        }
      } else {
        source += "[^/]*";
        index += 1;
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    source += escapeRegExp(char);
    index += 1;
  }

  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

function normalizeExplorerPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getDataParentPath(path: string): string | null {
  const segments = path.split("/");
  segments.pop();
  return segments.length > 0 ? segments.join("/") : null;
}

export function joinDataPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function remapActivePathAfterRename(current: string | null, previousPath: string, nextPath: string): string | null {
  if (!current) return current;
  if (current === previousPath) return nextPath;
  if (current.startsWith(`${previousPath}/`)) return `${nextPath}${current.slice(previousPath.length)}`;
  return current;
}
