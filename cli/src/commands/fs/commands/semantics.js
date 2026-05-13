import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";

const SEMANTICS = {
  summary: "PuppyOne FS is a Unix-like scoped cloud Context Drive, not a local POSIX filesystem.",
  guarantees: [
    "Mutating fs commands apply directly to the cloud Context Drive and are recorded in PuppyOne version history and audit logs.",
    "Read commands are scoped by the active Access Point and respect excluded paths.",
    "rm removes paths from the current tree; recovery is through PuppyOne version history/rollback, not a .trash directory.",
  ],
  differences: [
    "chmod/chown/chgrp, inode/device semantics, symlinks, sockets, and hard links are not POSIX-modeled.",
    "mtime/ctime are derived from PuppyOne version history, not local filesystem timestamps.",
    "size fields may require blob metadata; avoid large recursive size scans unless needed.",
    "Recursive tree/find/ls -R responses expose complete/truncated/returned_count/limit fields in --json and should be narrowed with -L, -maxdepth, or --limit.",
    "grep is a live scoped text search in V1: it accepts common Unix grep flags, scans current tree text blobs with resource caps, skips binary/non-text files, and exposes complete/truncated metadata in --json.",
    "upload/download are PuppyOne bridge commands, so their recursive forms expose --max-depth and --limit as resource controls.",
  ],
  resource_guidance: [
    "Default output keeps stdout Unix-like; warnings and truncation diagnostics go to stderr.",
    "--json output exposes complete/truncated/returned_count/limit/truncation_reason for scripts and agents.",
    "Prefer explicit paths over scanning the access point root.",
    "Use tree -L <n>, find -maxdepth <n>, and --limit for recursive commands.",
    "Use head/tail for previews; raw file reads support range reads when available.",
  ],
};

export function registerSemanticsCommand(fs) {
  fs
    .command("semantics")
    .description("Show PuppyOne FS Unix-compatibility notes for agents")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      if (out.json) {
        out.success({ fs_semantics: SEMANTICS });
        return;
      }

      out.raw([
        SEMANTICS.summary,
        "",
        "Guarantees:",
        ...SEMANTICS.guarantees.map(item => `  - ${item}`),
        "",
        "Differences from local Unix:",
        ...SEMANTICS.differences.map(item => `  - ${item}`),
        "",
        "Resource guidance:",
        ...SEMANTICS.resource_guidance.map(item => `  - ${item}`),
      ].join("\n"));
    }));
}
