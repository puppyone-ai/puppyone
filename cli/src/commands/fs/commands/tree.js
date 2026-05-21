import { Option } from "commander";
import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { addFsHelp, LIMIT_NOTE, READ_STDOUT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { get } from "../lib/http.js";
import { parseBackendDepth, parseIntegerOption, parseTreeLevel } from "../lib/options.js";
import { scopedPath } from "../lib/paths.js";
import { inferTargetType, renderTree, sortEntries } from "../lib/render.js";

export function registerTreeCommand(fs) {
  addFsHelp(fs
    .command("tree")
    .description("Show directory tree within the access point scope")
    .argument("[path]", "path relative to the access point scope")
    .option("-d, --directories-only", "list directories only")
    .option("-L, --level <n>", "max display depth for Unix tree compatibility (-1 = unlimited)")
    .addOption(new Option("--depth <n>", "deprecated backend max-depth alias").hideHelp())
    .option("--limit <n>", "max entries returned before truncation")
    .option("-a, --all", "include entries whose names begin with ."), {
      examples: [
        "puppyone fs tree",
        "puppyone fs tree docs -L 2",
        "puppyone fs tree -a --limit 500",
        "puppyone --json fs tree -L 2",
      ],
      notes: [
        SCOPE_NOTE,
        READ_STDOUT_NOTE,
        LIMIT_NOTE,
      ],
    })
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const cleanPath = scopedPath(path);
      const maxDepth = opts.level != null
        ? parseTreeLevel(opts.level)
        : opts.depth != null
          ? parseBackendDepth(opts.depth)
          : -1;
      const query = {
        path: cleanPath,
        max_depth: maxDepth,
        include_hidden: !!opts.all,
        directories_only: !!opts.directoriesOnly,
      };
      if (opts.limit != null) query.limit = parseIntegerOption(opts.limit, "--limit");
      const result = await get(client, "/ap-fs/tree", query, headers);
      const entries = sortEntries(
        opts.directoriesOnly
          ? (result.entries || []).filter(entry => entry.type === "folder")
          : (result.entries || []),
        { sort: "path" },
        { recursive: true },
      );
      const targetType = inferTargetType(result, entries, cleanPath);

      if (out.json) {
        out.success({
          ...result,
          entries,
          max_depth: maxDepth,
          directories_only: !!opts.directoriesOnly,
          target_type: targetType,
        });
        return;
      }
      if (result.truncated) {
        out.warn(`stdout is incomplete: returned ${result.returned_count ?? entries.length} entries because the ${result.limit} entry limit was reached. Use -L or --limit to narrow the scan; use --json to inspect complete=false.`);
      }
      renderTree(out, entries, cleanPath || ".", { rootType: targetType });
    }));
}
