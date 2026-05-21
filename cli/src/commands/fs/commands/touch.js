import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { addFsHelp, JSON_METADATA_NOTE, MUTATION_AUDIT_NOTE, MUTATION_SILENT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { getCurrentScopeBaseCommit, post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

export function registerTouchCommand(fs) {
  addFsHelp(fs
    .command("touch")
    .description("Create empty file(s) within the access point scope")
    .argument("<paths...>", "file path(s) relative to the access point scope"), {
      examples: [
        "puppyone fs touch notes/todo.md",
        "puppyone fs touch a.md b.md",
        "puppyone --json fs touch notes/todo.md",
      ],
      notes: [
        SCOPE_NOTE,
        MUTATION_SILENT_NOTE,
        MUTATION_AUDIT_NOTE,
        JSON_METADATA_NOTE,
      ],
    })
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const cleanPaths = paths.map(scopedPath);
      const baseCommitId = await getCurrentScopeBaseCommit(client, headers);
      const result = await post(client, "/ap-fs/touch", {
        path: cleanPaths[0],
        paths: cleanPaths,
        base_commit_id: baseCommitId,
      }, headers);
      if (out.json) out.success(result);
    }));
}
