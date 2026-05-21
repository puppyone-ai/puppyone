import { registerCatCommand } from "./commands/cat.js";
import { registerCpCommand } from "./commands/cp.js";
import { registerDownloadCommand } from "./commands/download.js";
import { registerFindCommand } from "./commands/find.js";
import { registerGrepCommand } from "./commands/grep.js";
import { registerHeadCommand } from "./commands/head.js";
import { registerLsCommand } from "./commands/ls.js";
import { registerMkdirCommand } from "./commands/mkdir.js";
import { registerMvCommand } from "./commands/mv.js";
import { registerRmCommand } from "./commands/rm.js";
import { registerRmdirCommand } from "./commands/rmdir.js";
import { registerSemanticsCommand } from "./commands/semantics.js";
import { registerStatCommand } from "./commands/stat.js";
import { registerTailCommand } from "./commands/tail.js";
import { registerTouchCommand } from "./commands/touch.js";
import { registerTreeCommand } from "./commands/tree.js";
import { registerUploadCommand } from "./commands/upload.js";
import { registerWriteCommand } from "./commands/write.js";
import {
  addFsHelp,
  JSON_METADATA_NOTE,
  MUTATION_AUDIT_NOTE,
  MUTATION_SILENT_NOTE,
  READ_STDOUT_NOTE,
  SCOPE_NOTE,
} from "./lib/help.js";

export function registerFs(program) {
  const fs = addFsHelp(program
    .command("fs")
    .description("Filesystem operations against the active Access Point")
    .option("--access-key <key>", "Access Point key override")
    .option("-u, --api-url <url>", "PuppyOne API URL override")
    .option("--profile <name>", "Access Point profile override")
    .option("--actor <user>", "Acting user identity for user-bound access keys")
    .addHelpText("after", "\nPuppyOne FS is Unix-like, scoped, and audit-backed. Run `puppyone fs semantics` for agent-facing differences and resource limits."), {
      examples: [
        "puppyone fs semantics",
        "puppyone fs ls -la",
        "puppyone fs tree -L 2",
        "puppyone fs cat notes/readme.md",
        "printf 'hello\\n' | puppyone fs write notes/hello.md --type markdown",
        "puppyone --json fs stat notes/hello.md",
      ],
      notes: [
        SCOPE_NOTE,
        READ_STDOUT_NOTE,
        MUTATION_SILENT_NOTE,
        MUTATION_AUDIT_NOTE,
        JSON_METADATA_NOTE,
      ],
    });

  registerFsCommands(fs);
}

export function registerFsCommands(fs) {
  registerLsCommand(fs);
  registerTreeCommand(fs);
  registerFindCommand(fs);
  registerGrepCommand(fs);
  registerCatCommand(fs);
  registerHeadCommand(fs);
  registerTailCommand(fs);
  registerStatCommand(fs);
  registerWriteCommand(fs);
  registerMkdirCommand(fs);
  registerTouchCommand(fs);
  registerUploadCommand(fs);
  registerDownloadCommand(fs);
  registerCpCommand(fs);
  registerMvCommand(fs);
  registerRmdirCommand(fs);
  registerRmCommand(fs);
  registerSemanticsCommand(fs);
}
