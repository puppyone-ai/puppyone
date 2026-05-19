import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { addFsHelp, JSON_METADATA_NOTE, MUTATION_AUDIT_NOTE, MUTATION_SILENT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { getCurrentScopeBaseCommit, post } from "../lib/http.js";
import {
  buildCopyMoveIntents,
  isNoClobber,
  resolveOverwritePromptPath,
} from "../lib/operation-intent.js";
import { promptYesNo, statPath } from "../lib/remote.js";

export function registerCpCommand(fs) {
  addFsHelp(fs
    .command("cp")
    .description("Copy files or directories within the access point scope")
    .argument("<paths...>", "source path(s) followed by destination path")
    .option("-r, --recursive", "copy directories recursively")
    .option("-R", "copy directories recursively")
    .option("-f, --force", "overwrite an existing destination")
    .option("-i, --interactive", "prompt before overwrite")
    .option("-n, --no-clobber", "do not overwrite an existing destination")
    .option("-T, --no-target-directory", "treat destination as a normal file")
    .option("-t, --target-directory <dir>", "copy all sources into dir")
    .option("-m, --message <msg>", "commit message"), {
      examples: [
        "puppyone fs cp notes/a.md notes/b.md",
        "puppyone fs cp -r docs docs-copy",
        "puppyone fs cp a.md b.md folder/",
        "puppyone --json fs cp notes/a.md notes/b.md",
      ],
      notes: [
        SCOPE_NOTE,
        MUTATION_SILENT_NOTE,
        MUTATION_AUDIT_NOTE,
        JSON_METADATA_NOTE,
      ],
    })
    .action(withErrors(async (paths, opts, cmd) => {
      const options = cmd?.opts?.() ?? opts ?? {};
      const out = createOutput(cmd);
      let intents;
      try {
        intents = buildCopyMoveIntents(paths, options, "cp");
      } catch (error) {
        out.error(error.code || "INVALID_ARGUMENT", error.message);
        return;
      }
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const results = [];
      const errors = [];

      for (const intent of intents) {
        const { oldPath, newPath } = intent;
        try {
          if (options.interactive) {
            const promptPath = await resolveOverwritePromptPath(
              (path) => statPath(client, path, headers),
              intent,
            );
            if (promptPath && !await promptYesNo(`overwrite '${promptPath}'?`)) {
              results.push({ old_path: oldPath, new_path: promptPath, skipped: true, reason: "not overwritten" });
              continue;
            }
          }
          const baseCommitId = await getCurrentScopeBaseCommit(client, headers);
          const result = await post(client, "/ap-fs/cp", {
            old_path: oldPath,
            new_path: newPath,
            recursive: !!(options.recursive || options.R),
            base_commit_id: baseCommitId,
            no_clobber: isNoClobber(options) && !options.force,
            target_directory: !!intent.targetDirectory,
            no_target_directory: !!intent.noTargetDirectory,
            message: options.message || `ap copy ${oldPath} -> ${newPath}`,
          }, headers);
          results.push(result);
        } catch (e) {
          errors.push(errorPayload(oldPath, e));
          if (!out.json) console.error(pathError("cp", oldPath, e));
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
