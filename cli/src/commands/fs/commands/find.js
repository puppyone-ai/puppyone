import { ApiError } from "../../../api.js";
import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { matchesFindEntry, parseFindArgs } from "../lib/find-expr.js";
import { get } from "../lib/http.js";
import { parseIntegerOption } from "../lib/options.js";
import { basename, scopedPath } from "../lib/paths.js";
import { statPath } from "../lib/remote.js";

export function registerFindCommand(fs) {
  fs
    .command("find")
    .description("Find paths within the access point scope")
    .argument("[args...]", "path and expression, e.g. . -name '*.md' -type f")
    .option("--limit <n>", "max tree entries scanned before truncation")
    .allowUnknownOption(true)
    .addHelpText("after", "\nExpressions:\n  -name <pattern>       match basename with wildcard pattern\n  -iname <pattern>      case-insensitive -name\n  -path <pattern>       match the full scoped path\n  -type <f|d>           filter by file or directory\n  -mindepth <n>         minimum search depth\n  -maxdepth <n>         maximum search depth\n  -not, !               negate the next predicate\n  -print                accepted for Unix compatibility")
    .action(withErrors(async (args, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const { path, filters } = parseFindArgs(args || []);
      const cleanPath = scopedPath(path);
      const limit = opts.limit != null ? parseIntegerOption(opts.limit, "--limit") : null;
      const scan = {
        complete: true,
        truncated: false,
        limit: null,
        returnedCount: null,
        truncationReason: "",
      };
      const stat = await statPath(client, cleanPath, headers);
      if (!stat.exists) {
        throw new ApiError(404, "API_ERROR", `Path not found: ${cleanPath || "."}`);
      }

      const maxdepth = filters.maxdepth != null ? parseIntegerOption(filters.maxdepth, "-maxdepth") : null;
      const entries = [{
        ...stat,
        path: cleanPath,
        name: cleanPath ? basename(cleanPath) : ".",
      }];
      if (stat.type === "folder" && maxdepth !== 0) {
        const treeDepth = maxdepth == null ? -1 : Math.max(0, maxdepth - 1);
        const query = {
          path: cleanPath,
          max_depth: treeDepth,
          include_hidden: true,
        };
        if (limit != null) query.limit = limit;
        const result = await get(client, "/ap-fs/tree", query, headers);
        entries.push(...(result.entries || []));
        if (result.truncated) {
          scan.complete = false;
          scan.truncated = true;
          scan.limit = result.limit ?? null;
          scan.returnedCount = result.returned_count ?? (result.entries || []).length;
          scan.truncationReason = result.truncation_reason || "entry_limit_exceeded";
        }
      }

      const filtered = entries.filter(entry => matchesFindEntry(entry, filters, cleanPath));
      if (out.json) {
        out.success({
          path: cleanPath,
          entries: filtered,
          complete: scan.complete,
          truncated: scan.truncated,
          limit: scan.limit,
          returned_count: filtered.length,
          scanned_count: entries.length,
          scan_returned_count: scan.returnedCount,
          truncation_reason: scan.truncationReason,
        });
        return;
      }
      if (scan.truncated) {
        out.warn(`stdout is incomplete: scanned ${scan.returnedCount} tree entries because the ${scan.limit} entry limit was reached. Use -maxdepth, a narrower path, or --limit; use --json to inspect complete=false.`);
      }
      out.raw(filtered.map(entry => entry.path || ".").join("\n"));
    }));
}
