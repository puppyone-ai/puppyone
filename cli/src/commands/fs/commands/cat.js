import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { addFsHelp, READ_STDOUT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { get, rawGet } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

export function registerCatCommand(fs) {
  addFsHelp(fs
    .command("cat")
    .description("Read a file within the access point scope")
    .argument("<paths...>", "file path(s) relative to the access point scope"), {
      examples: [
        "puppyone fs cat README.md",
        "puppyone fs cat notes/a.md notes/b.md",
        "puppyone --json fs cat README.md",
      ],
      notes: [
        SCOPE_NOTE,
        READ_STDOUT_NOTE,
        "Raw mode streams file bytes directly and does not add extra separators.",
      ],
    })
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const errors = [];
      if (out.json) {
        const results = [];
        for (const path of paths) {
          const cleanPath = scopedPath(path);
          try {
            const result = await get(client, "/ap-fs/cat", {
              path: cleanPath,
              structured: true,
            }, headers);
            results.push(result);
          } catch (e) {
            errors.push(errorPayload(cleanPath, e));
          }
        }
        if (errors.length) {
          console.log(JSON.stringify({
            success: false,
            files: results,
            errors,
          }, null, 2));
        } else if (results.length === 1) out.success(results[0]);
        else out.success({ files: results });
        finishWithPartialFailure(errors);
        return;
      }
      for (const path of paths) {
        const cleanPath = scopedPath(path);
        try {
          const res = await rawGet(client, "/ap-fs/raw", { path: cleanPath }, headers);
          const buf = Buffer.from(await res.arrayBuffer());
          process.stdout.write(buf);
        } catch (e) {
          errors.push(errorPayload(cleanPath, e));
          console.error(pathError("cat", cleanPath, e));
        }
      }
      finishWithPartialFailure(errors);
    }));
}
