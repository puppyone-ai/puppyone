import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { getScopeBaseCommit, post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";
import { promptYesNo, resolveMoveDestination, statPath } from "../lib/remote.js";

export function registerMvCommand(fs) {
  fs
    .command("mv")
    .description("Move or rename within the access point scope")
    .argument("<paths...>", "source path(s) followed by destination path")
    .option("-f, --force", "overwrite an existing destination")
    .option("-i, --interactive", "prompt before overwrite")
    .option("-n, --no-clobber", "do not overwrite an existing destination")
    .option("-T, --no-target-directory", "treat destination as a normal file")
    .option("-t, --target-directory <dir>", "move all sources into dir")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      if (!paths || (!opts.targetDirectory && paths.length < 2) || (opts.targetDirectory && paths.length < 1)) {
        out.error("MISSING_OPERAND", "mv requires at least a source and destination.");
        return;
      }
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const sources = opts.targetDirectory ? paths : paths.slice(0, -1);
      const dst = opts.targetDirectory || paths[paths.length - 1];
      const multipleSources = sources.length > 1;
      const results = [];
      const errors = [];

      for (const src of sources) {
        const oldPath = scopedPath(src);
        try {
          const newPath = await resolveMoveDestination(
            client, oldPath, dst, headers, {
              multipleSources: multipleSources || !!opts.targetDirectory,
              noTargetDirectory: !!opts.noTargetDirectory,
            },
          );
          if (opts.interactive) {
            const dstStat = await statPath(client, newPath, headers);
            if (dstStat.exists && !await promptYesNo(`overwrite '${newPath}'?`)) {
              results.push({ old_path: oldPath, new_path: newPath, skipped: true, reason: "not overwritten" });
              continue;
            }
          }
          const baseCommitId = await getScopeBaseCommit(client, oldPath, headers);
          const result = await post(client, "/ap-fs/mv", {
            old_path: oldPath,
            new_path: newPath,
            base_commit_id: baseCommitId,
            no_clobber: !!opts.noClobber && !opts.force,
            message: opts.message || `ap move ${oldPath} -> ${newPath}`,
          }, headers);
          results.push(result);
        } catch (e) {
          errors.push(errorPayload(oldPath, e));
          if (!out.json) console.error(pathError("mv", oldPath, e));
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
