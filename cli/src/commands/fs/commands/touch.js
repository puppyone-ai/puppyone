import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { getScopeBaseCommit, post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

export function registerTouchCommand(fs) {
  fs
    .command("touch")
    .description("Create empty file(s) within the access point scope")
    .argument("<paths...>", "file path(s) relative to the access point scope")
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const cleanPaths = paths.map(scopedPath);
      const baseCommitId = await getScopeBaseCommit(client, cleanPaths[0], headers);
      const result = await post(client, "/ap-fs/touch", {
        path: cleanPaths[0],
        paths: cleanPaths,
        base_commit_id: baseCommitId,
      }, headers);
      if (out.json) out.success(result);
    }));
}
