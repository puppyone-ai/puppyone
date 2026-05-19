import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { addFsHelp, READ_STDOUT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { get } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";
import { unixBlocks, unixStatTimestamp, unixType } from "../lib/render.js";

export function registerStatCommand(fs) {
  addFsHelp(fs
    .command("stat")
    .description("Show file or directory information within the access point scope")
    .argument("[path]", "path relative to the access point scope"), {
      examples: [
        "puppyone fs stat",
        "puppyone fs stat docs/api-reference.md",
        "puppyone --json fs stat docs/api-reference.md",
      ],
      notes: [
        SCOPE_NOTE,
        READ_STDOUT_NOTE,
        "Unix mode, uid, gid, device, and inode are compatibility fields for a cloud-backed scope.",
      ],
    })
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const result = await get(client, "/ap-fs/stat", { path: scopedPath(path) }, headers);

      if (out.json) {
        out.success(result);
        return;
      }
      if (!result.exists) {
        out.error("NOT_FOUND", `Path not found: ${scopedPath(path) || "."}`);
        return;
      }
      const mode = result.type === "folder" ? "0755/drwxr-xr-x" : "0644/-rw-r--r--";
      const timestamp = unixStatTimestamp(result);
      const links = result.type === "folder" ? 2 : 1;
      out.raw([
        `  File: ${result.path || "."}`,
        `  Size: ${result.size_bytes ?? 0}\tBlocks: ${unixBlocks(result)}\tIO Block: 4096   ${unixType(result)}`,
        `Device: 0,0\tInode: 0\tLinks: ${links}`,
        `Access: (${mode})  Uid: ( 1000/puppyone)   Gid: ( 1000/puppyone)`,
        `Access: ${timestamp}`,
        `Modify: ${timestamp}`,
        `Change: ${timestamp}`,
        " Birth: -",
      ].join("\n"));
    }));
}
