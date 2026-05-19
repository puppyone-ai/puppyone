import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, detectNodeType, extraHeaders } from "../lib/context.js";
import { addFsHelp, JSON_METADATA_NOTE, MUTATION_AUDIT_NOTE, MUTATION_SILENT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

export function registerWriteCommand(fs) {
  addFsHelp(fs
    .command("write")
    .description("Write a file within the access point scope")
    .argument("<path>", "destination path relative to the access point scope")
    .option("--content <text>", "inline content string")
    .option("--file <local-path>", "read content from a local file")
    .option("--type <type>", "node type: json | markdown | file (auto-detected from extension)")
    .option("--base-commit <sha>", "optional scope head precondition")
    .option("-m, --message <msg>", "commit message"), {
      examples: [
        "printf 'hello\\n' | puppyone fs write notes/hello.md --type markdown",
        "puppyone fs write notes/hello.md --content 'hello' --type markdown",
        "puppyone fs write data/config.json --file ./config.json --type json -m 'Update config'",
        "puppyone --json fs write notes/hello.md --content 'hello'",
      ],
      notes: [
        SCOPE_NOTE,
        "Content source order is --content, then --file, then stdin.",
        MUTATION_SILENT_NOTE,
        MUTATION_AUDIT_NOTE,
        JSON_METADATA_NOTE,
      ],
    })
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
      const result = await post(client, "/ap-fs/write", {
        path: cleanPath,
        content,
        node_type: nodeType,
        base_commit_id: opts.baseCommit || null,
        message: opts.message || `ap edit ${cleanPath}`,
      }, headers);

      if (out.json) out.success(result);
    }));
}
