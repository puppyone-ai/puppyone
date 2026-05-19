import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { addFsHelp, JSON_METADATA_NOTE, MUTATION_AUDIT_NOTE, MUTATION_SILENT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { getCurrentScopeBaseCommit, post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

export function registerRmdirCommand(fs) {
  addFsHelp(fs
    .command("rmdir")
    .description("Remove empty directories within the access point scope")
    .argument("<paths...>", "empty directory path(s) relative to the access point scope")
    .option("-p, --parents", "remove empty parent directories after each directory"), {
      examples: [
        "puppyone fs rmdir empty-folder",
        "puppyone fs rmdir -p notes/2026/may",
        "puppyone --json fs rmdir empty-folder",
      ],
      notes: [
        SCOPE_NOTE,
        MUTATION_SILENT_NOTE,
        MUTATION_AUDIT_NOTE,
        JSON_METADATA_NOTE,
        "Use rm -r for non-empty directories.",
      ],
    })
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const cleanPaths = paths.map(scopedPath);
      const errors = [];
      const results = [];

      for (const cleanPath of cleanPaths) {
        try {
          const baseCommitId = await getCurrentScopeBaseCommit(client, headers);
          const result = await post(client, "/ap-fs/rmdir", {
            path: cleanPath,
            parents: !!opts.parents,
            base_commit_id: baseCommitId,
          }, headers);
          results.push(result);
        } catch (e) {
          errors.push(errorPayload(cleanPath, e));
          if (!out.json) {
            console.error(pathError("rmdir", cleanPath, e));
          }
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
