import { ApiError } from "../../../api.js";
import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { addFsHelp, LIMIT_NOTE, READ_STDOUT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { get } from "../lib/http.js";
import { parseIntegerOption } from "../lib/options.js";
import { dotEntries, scopedPath } from "../lib/paths.js";
import { statPath } from "../lib/remote.js";
import {
  inferTargetType,
  renderFlatLs,
  renderRecursiveLs,
  sortEntries,
} from "../lib/render.js";

export function registerLsCommand(fs) {
  addFsHelp(fs
    .command("ls")
    .description("List directory contents within the access point scope")
    .helpOption("--help", "display help for command")
    .argument("[paths...]", "path(s) relative to the access point scope")
    .option("-l, --long", "use a long listing format")
    .option("-a, --all", "include entries whose names begin with .")
    .option("-A, --almost-all", "include hidden entries except . and ..")
    .option("-d, --directory", "list directories themselves, not their contents")
    .option("-F, --classify", "append / indicator to directory names")
    .option("-p, --slash-directories", "append / indicator to directory names")
    .option("-h, --human-readable", "print human-readable sizes in long listings")
    .option("-R, --recursive", "list entries recursively")
    .option("-1, --one-column", "print one entry per line")
    .option("--sort <key>", "sort by: name | path | type | size | time")
    .option("-S, --sort-size", "sort by file size")
    .option("-t, --sort-time", "sort by modification time, newest first")
    .option("-r, --reverse", "reverse sort order")
    .option("--limit <n>", "max recursive entries returned before truncation"), {
      examples: [
        "puppyone fs ls",
        "puppyone fs ls -la docs",
        "puppyone fs ls -R --limit 200",
        "puppyone --json fs ls -la docs",
      ],
      notes: [
        SCOPE_NOTE,
        READ_STDOUT_NOTE,
        LIMIT_NOTE,
      ],
    })
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const requestedPaths = paths?.length ? paths : [""];
      const multiple = requestedPaths.length > 1;
      const results = [];
      const errors = [];

      for (const [index, rawPath] of requestedPaths.entries()) {
        const cleanPath = scopedPath(rawPath);
        let result;
        let entries;
        let targetType;
        try {
          if (opts.directory) {
            const stat = await statPath(client, cleanPath, headers);
            if (!stat.exists) throw new ApiError(404, "API_ERROR", `Path not found: ${cleanPath || "."}`);
            targetType = stat.type;
            entries = [{
              ...stat,
              name: cleanPath || ".",
              path: cleanPath,
            }];
            result = { path: cleanPath, entries, target_type: targetType };
          } else {
            const query = {
              path: cleanPath,
              include_hidden: !!(opts.all || opts.almostAll),
              include_size: !!(opts.long || opts.sortSize || opts.sort === "size"),
              include_times: !!(opts.long || opts.sortTime || opts.sort === "time"),
            };
            const recursiveQuery = { ...query, max_depth: -1 };
            if (opts.limit != null) recursiveQuery.limit = parseIntegerOption(opts.limit, "--limit");
            result = opts.recursive
              ? await get(client, "/ap-fs/tree", recursiveQuery, headers)
              : await get(client, "/ap-fs/ls", query, headers);
            if (opts.sortSize) opts.sort = "size";
            if (opts.sortTime) opts.sort = "time";
            entries = sortEntries(result.entries || [], opts, { recursive: !!opts.recursive });
            targetType = inferTargetType(result, entries, cleanPath);
            if (opts.all && targetType === "folder" && !opts.recursive) {
              entries = [...dotEntries(cleanPath), ...entries];
            }
          }
        } catch (e) {
          errors.push(errorPayload(cleanPath, e));
          if (!out.json) console.error(pathError("ls", cleanPath, e));
          continue;
        }
        results.push({ ...result, entries, recursive: !!opts.recursive, target_type: targetType });

        if (!out.json) {
          const showHeader = multiple && (targetType === "folder" || opts.recursive);
          if (showHeader) out.raw(`${cleanPath || "."}:`);
          if (opts.recursive && targetType === "folder") {
            if (result.truncated) {
              out.warn(`stdout is incomplete: returned ${result.returned_count ?? entries.length} entries because the ${result.limit} entry limit was reached. Use --limit or a narrower path; use --json to inspect complete=false.`);
            }
            renderRecursiveLs(out, entries, opts, cleanPath);
          } else {
            renderFlatLs(out, entries, opts, { parentPath: targetType === "folder" ? cleanPath : "" });
          }
          if (multiple && index < requestedPaths.length - 1) out.raw("");
        }
      }

      if (out.json) {
        if (errors.length) {
          console.log(JSON.stringify({ success: false, results, errors }, null, 2));
        } else if (results.length === 1) out.success(results[0]);
        else out.success({ results });
      }
      finishWithPartialFailure(errors);
    }));
}
