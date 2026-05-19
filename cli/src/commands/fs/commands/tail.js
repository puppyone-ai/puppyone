import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { readTailBuffer } from "../lib/content-read.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { addFsHelp, READ_STDOUT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { parseIntegerOption } from "../lib/options.js";
import { scopedPath } from "../lib/paths.js";

export function registerTailCommand(fs) {
  addFsHelp(fs
    .command("tail")
    .description("Output the last part of file(s) within the access point scope")
    .argument("<paths...>", "file path(s) relative to the access point scope")
    .option("-n, --lines <n>", "print the last n lines", "10")
    .option("-c, --bytes <n>", "print the last n bytes"), {
      examples: [
        "puppyone fs tail logs/app.log",
        "puppyone fs tail -n 40 logs/app.log",
        "puppyone fs tail -c 1024 data.bin",
        "puppyone --json fs tail -n 5 logs/app.log",
      ],
      notes: [
        SCOPE_NOTE,
        READ_STDOUT_NOTE,
        "Use -c for byte-accurate previews and -n for text previews.",
      ],
    })
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const byteCount = opts.bytes != null ? parseIntegerOption(opts.bytes, "-c/--bytes") : null;
      const lineCount = parseIntegerOption(opts.lines, "-n/--lines");
      const results = [];
      const errors = [];
      let printed = 0;

      for (const path of paths) {
        const cleanPath = scopedPath(path);
        let output;
        try {
          output = await readTailBuffer(client, cleanPath, headers, { byteCount, lineCount });
          results.push({ path: cleanPath, bytes: output.length });
        } catch (e) {
          errors.push(errorPayload(cleanPath, e));
          if (!out.json) console.error(pathError("tail", cleanPath, e));
          continue;
        }

        if (!out.json) {
          if (paths.length > 1) {
            if (printed > 0) process.stdout.write("\n");
            process.stdout.write(`==> ${cleanPath} <==\n`);
          }
          process.stdout.write(output);
          printed += 1;
        }
      }

      if (out.json) {
        if (errors.length) {
          console.log(JSON.stringify({ success: false, files: results, errors }, null, 2));
        } else {
          out.success({ files: results });
        }
      }
      finishWithPartialFailure(errors);
    }));
}
