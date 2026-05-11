import { ApiError } from "../../../api.js";
import { basename } from "./paths.js";
import { parseIntegerOption } from "./options.js";

function wildcardToRegex(pattern, flags = "") {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, flags);
}

function entryDepth(path, rootPath = "") {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  const root = String(rootPath || "").replace(/^\/+|\/+$/g, "");
  if (!clean || clean === root) return 0;
  const rel = root && clean.startsWith(`${root}/`) ? clean.slice(root.length + 1) : clean;
  return rel.split("/").filter(Boolean).length;
}

export function matchesFindEntry(entry, opts = {}, rootPath = "") {
  const depth = entryDepth(entry.path || entry.name, rootPath);
  if (opts.mindepth != null && depth < parseIntegerOption(opts.mindepth, "-mindepth")) {
    return false;
  }
  if (opts.maxdepth != null && depth > parseIntegerOption(opts.maxdepth, "-maxdepth")) {
    return false;
  }
  for (const condition of opts.conditions || []) {
    let matched = true;
    if (condition.kind === "type") {
      if (!["f", "d"].includes(condition.value)) {
        throw new ApiError(0, "INVALID_TYPE", "find -type supports only f or d.");
      }
      matched = condition.value === "f" ? entry.type !== "folder" : entry.type === "folder";
    } else if (condition.kind === "name") {
      matched = wildcardToRegex(condition.value).test(basename(entry.path || entry.name));
    } else if (condition.kind === "iname") {
      matched = wildcardToRegex(condition.value, "i").test(basename(entry.path || entry.name));
    } else if (condition.kind === "path") {
      matched = wildcardToRegex(condition.value).test(entry.path || ".");
    }
    if (condition.negate ? matched : !matched) return false;
  }
  return true;
}

export function parseFindArgs(args = []) {
  let path = ".";
  let index = 0;
  if (args[index] && !String(args[index]).startsWith("-")) {
    path = args[index];
    index += 1;
  }

  const filters = { conditions: [] };
  let negateNext = false;
  while (index < args.length) {
    const token = args[index];
    if (token === "-not" || token === "!") {
      negateNext = !negateNext;
      index += 1;
      continue;
    }
    if (token === "-print") {
      index += 1;
      continue;
    }
    if (["-name", "-iname", "-path", "-type"].includes(token)) {
      if (args[index + 1] == null) {
        throw new ApiError(0, "MISSING_ARGUMENT", `find ${token} requires an argument.`);
      }
      filters.conditions.push({
        kind: token.slice(1),
        value: args[index + 1],
        negate: negateNext,
      });
      negateNext = false;
      index += 2;
      continue;
    }
    if (token === "-maxdepth" || token === "-mindepth") {
      if (args[index + 1] == null) {
        throw new ApiError(0, "MISSING_ARGUMENT", `find ${token} requires an integer.`);
      }
      filters[token.slice(1)] = args[index + 1];
      index += 2;
      continue;
    }
    throw new ApiError(0, "INVALID_FIND_EXPRESSION", `Unsupported find expression: ${token}`);
  }
  return { path, filters };
}
