import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, detectNodeType, extraHeaders } from "../lib/context.js";
import { getScopeBaseCommit, post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

export function registerWriteCommand(fs) {
  fs
    .command("write")
    .description("Write a file within the access point scope")
    .argument("<path>", "destination path relative to the access point scope")
    .option("--content <text>", "inline content string")
    .option("--file <local-path>", "read content from a local file")
    .option("--type <type>", "node type: json | markdown | file (auto-detected from extension)")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const cleanPath = scopedPath(path);

      let content;
      if (opts.content != null) {
        content = opts.content;
      } else if (opts.file) {
        const { readFileSync } = await import("node:fs");
        content = readFileSync(opts.file, "utf-8");
      } else if (!process.stdin.isTTY) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        content = Buffer.concat(chunks).toString("utf-8");
      } else {
        out.error("NO_CONTENT", "No content provided.", "Use --content, --file, or pipe via stdin.");
        return;
      }

      const nodeType = opts.type || detectNodeType(cleanPath);
      const baseCommitId = await getScopeBaseCommit(client, cleanPath, headers);
      const result = await post(client, "/ap-fs/write", {
        path: cleanPath,
        content,
        node_type: nodeType,
        base_commit_id: baseCommitId,
        message: opts.message || `ap edit ${cleanPath}`,
      }, headers);

      if (out.json) out.success(result);
    }));
}
