import { ApiError } from "../../../api.js";
import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { getScopeBaseCommit, rawPostBytes } from "../lib/http.js";
import { parseNonNegativeOption, parsePositiveOption } from "../lib/options.js";
import { scopedPath } from "../lib/paths.js";
import { resolveTransferDestination, statPath } from "../lib/remote.js";
import { collectLocalFiles, localPathInfo } from "../lib/transfer-local.js";

function joinRemoteRelative(parent, relativePath) {
  const cleanParent = scopedPath(parent);
  const cleanRelative = scopedPath(relativePath);
  return cleanParent ? `${cleanParent}/${cleanRelative}` : cleanRelative;
}

export function registerUploadCommand(fs) {
  fs
    .command("upload")
    .description("Upload local file(s) into the access point scope")
    .argument("<paths...>", "local source path(s) followed by remote destination")
    .option("-r, --recursive", "upload directories recursively")
    .option("-f, --force", "overwrite an existing remote destination")
    .option("-n, --no-clobber", "do not overwrite an existing remote destination")
    .option("--max-depth <n>", "max local directory depth for recursive uploads")
    .option("--limit <n>", "max files uploaded per recursive source", "5000")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      if (!paths || paths.length < 2) {
        out.error("MISSING_OPERAND", "upload requires at least a local source and remote destination.");
        return;
      }
      const { readFile } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const sources = paths.slice(0, -1);
      const remoteDst = paths[paths.length - 1];
      const multipleSources = sources.length > 1;
      const maxDepth = opts.maxDepth != null ? parseNonNegativeOption(opts.maxDepth, "--max-depth") : -1;
      const limit = parsePositiveOption(opts.limit, "--limit");
      const results = [];
      const errors = [];
      let truncated = false;

      for (const localSource of sources) {
        try {
          const info = await localPathInfo(localSource);
          if (!info) throw new ApiError(0, "LOCAL_NOT_FOUND", `Local path not found: ${localSource}`);
          if (info.isDirectory()) {
            if (!opts.recursive) {
              throw new ApiError(0, "IS_DIRECTORY", `${localSource} is a directory. Use -r to upload recursively.`);
            }
            const scan = await collectLocalFiles(localSource, { maxDepth, limit });
            const files = scan.files;
            if (scan.truncated) {
              truncated = true;
              out.warn(`operation is incomplete: recursive upload reached the ${scan.limit} file limit. Use --max-depth, a narrower source, or --limit.`);
            }
            const baseName = nodePath.basename(localSource.replace(/\/+$/, ""));
            const remoteBase = await resolveTransferDestination(
              client, baseName, remoteDst, headers, { multipleSources },
            );
            for (const file of files) {
              const remotePath = joinRemoteRelative(remoteBase, file.relativePath);
              const existing = await statPath(client, remotePath, headers);
              if (existing.exists && opts.noClobber && !opts.force) {
                results.push({ local_path: file.localPath, path: remotePath, skipped: true });
                continue;
              }
              const baseCommitId = await getScopeBaseCommit(client, remotePath, headers);
              const content = await readFile(file.localPath);
              const result = await rawPostBytes(client, "/ap-fs/upload", content, {
                path: remotePath,
                base_commit_id: baseCommitId,
                message: opts.message || `ap upload ${remotePath}`,
              }, headers);
              results.push({ ...result, local_path: file.localPath });
            }
            continue;
          }
          if (!info.isFile()) {
            throw new ApiError(0, "UNSUPPORTED_LOCAL_PATH", `Only files and directories can be uploaded: ${localSource}`);
          }
          const remotePath = await resolveTransferDestination(
            client, nodePath.basename(localSource), remoteDst, headers, { multipleSources },
          );
          const existing = await statPath(client, remotePath, headers);
          if (existing.exists && opts.noClobber && !opts.force) {
            results.push({ local_path: localSource, path: remotePath, skipped: true });
            continue;
          }
          const baseCommitId = await getScopeBaseCommit(client, remotePath, headers);
          const content = await readFile(localSource);
          const result = await rawPostBytes(client, "/ap-fs/upload", content, {
            path: remotePath,
            base_commit_id: baseCommitId,
            message: opts.message || `ap upload ${remotePath}`,
          }, headers);
          results.push({ ...result, local_path: localSource });
        } catch (e) {
          errors.push(errorPayload(localSource, e));
          if (!out.json) console.error(pathError("upload", localSource, e));
        }
      }
      if (out.json) {
        const payload = {
          results,
          errors,
          complete: !truncated,
          truncated,
          limit,
          returned_count: results.length,
          truncation_reason: truncated ? "file_limit_exceeded" : "",
        };
        if (errors.length) {
          console.log(JSON.stringify({ success: false, ...payload }, null, 2));
        } else if (results.length === 1 && !truncated && !opts.recursive) out.success(results[0]);
        else out.success(payload);
      }
      finishWithPartialFailure(errors);
    }));
}
