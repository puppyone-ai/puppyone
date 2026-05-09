import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { getScopeBaseCommit, post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";
import { statPath } from "../lib/remote.js";

export function registerRmCommand(fs) {
  fs
    .command("rm")
    .description("Remove files within the access point scope")
    .argument("<paths...>", "path(s) relative to the access point scope")
    .option("-f, --force", "ignore nonexistent files")
    .option("-r, --recursive", "remove directories and their contents")
    .option("-R", "remove directories and their contents")
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const cleanPaths = paths.map(scopedPath);
      const errors = [];
      const existingPaths = [];
      for (const path of cleanPaths) {
        try {
          const stat = await statPath(client, path, headers);
          if (!stat.exists) {
            if (!opts.force) {
              const error = { code: "API_ERROR", message: `Path not found: ${path || "."}` };
              errors.push(errorPayload(path, error));
              if (!out.json) console.error(pathError("rm", path, error));
            }
            continue;
          }
          if (stat.type === "folder" && !(opts.recursive || opts.R)) {
            const error = { code: "IS_DIRECTORY", message: `Is a directory: ${path || "."}` };
            errors.push(errorPayload(path, error));
            if (!out.json) console.error(pathError("rm", path, error));
            continue;
          }
          existingPaths.push(path);
        } catch (e) {
          errors.push(errorPayload(path, e));
          if (!out.json) console.error(pathError("rm", path, e));
        }
      }

      let result = null;
      if (existingPaths.length) {
        const baseCommitId = await getScopeBaseCommit(client, existingPaths[0], headers);
        result = await post(client, "/ap-fs/rm", {
          path: existingPaths[0],
          paths: existingPaths,
          force: true,
          recursive: !!(opts.recursive || opts.R),
          base_commit_id: baseCommitId,
        }, headers);
      }
      if (out.json) {
        if (errors.length) {
          console.log(JSON.stringify({
            success: false,
            result,
            errors,
          }, null, 2));
        } else if (result) {
          out.success(result);
        } else {
          out.success({ paths: cleanPaths, removed: false });
        }
      }
      finishWithPartialFailure(errors);
    }));
}
