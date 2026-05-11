import { ApiError } from "../../../api.js";
import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { readRawBuffer } from "../lib/content-read.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { get } from "../lib/http.js";
import { isNoClobber } from "../lib/operation-intent.js";
import { parseNonNegativeOption, parsePositiveOption } from "../lib/options.js";
import { basename, scopedPath, stripRootPath } from "../lib/paths.js";
import { statPath } from "../lib/remote.js";
import { localPathInfo, writeLocalFile } from "../lib/transfer-local.js";

export function registerDownloadCommand(fs) {
  fs
    .command("download")
    .description("Download file(s) from the access point scope to the local filesystem")
    .argument("<paths...>", "remote source path(s) followed by local destination")
    .option("-r, --recursive", "download directories recursively")
    .option("-f, --force", "overwrite an existing local destination")
    .option("-n, --no-clobber", "do not overwrite an existing local destination")
    .option("--max-depth <n>", "max remote directory depth for recursive downloads")
    .option("--limit <n>", "max remote entries scanned per recursive source", "5000")
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      if (!paths || paths.length < 2) {
        out.error("MISSING_OPERAND", "download requires at least a remote source and local destination.");
        return;
      }
      const { mkdir } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const sources = paths.slice(0, -1).map(scopedPath);
      const localDst = paths[paths.length - 1];
      const maxDepth = opts.maxDepth != null ? parseNonNegativeOption(opts.maxDepth, "--max-depth") : -1;
      const limit = parsePositiveOption(opts.limit, "--limit");
      const dstInfo = await localPathInfo(localDst);
      const dstIsDirectory = !!dstInfo && dstInfo.isDirectory();
      const multipleSources = sources.length > 1;
      if (multipleSources && !dstIsDirectory) {
        throw new ApiError(0, "NOT_A_DIRECTORY", `Local destination must be a directory for multiple downloads: ${localDst}`);
      }
      const results = [];
      const errors = [];
      let truncated = false;

      for (const remoteSource of sources) {
        try {
          const stat = await statPath(client, remoteSource, headers);
          if (!stat.exists) throw new ApiError(404, "API_ERROR", `Path not found: ${remoteSource || "."}`);
          if (stat.type === "folder") {
            if (!opts.recursive) {
              throw new ApiError(0, "IS_DIRECTORY", `${remoteSource || "."} is a directory. Use -r to download recursively.`);
            }
            const baseLocal = dstIsDirectory
              ? nodePath.join(localDst, basename(remoteSource || "."))
              : localDst;
            await mkdir(baseLocal, { recursive: true });
            const tree = await get(client, "/ap-fs/tree", {
              path: remoteSource,
              max_depth: maxDepth,
              limit,
              include_hidden: true,
            }, headers);
            if (tree.truncated) {
              truncated = true;
              out.warn(`operation is incomplete: scanned ${tree.returned_count ?? (tree.entries || []).length} remote entries because the ${tree.limit} entry limit was reached. Use --max-depth, a narrower source, or --limit.`);
            }
            for (const entry of tree.entries || []) {
              const rel = stripRootPath(entry.path, remoteSource);
              const localPath = nodePath.join(baseLocal, rel);
              if (entry.type === "folder") {
                await mkdir(localPath, { recursive: true });
                continue;
              }
              const { buffer } = await readRawBuffer(client, entry.path, headers);
              const written = await writeLocalFile(localPath, buffer, {
                force: !!opts.force,
                noClobber: isNoClobber(opts) && !opts.force,
              });
              results.push({ path: entry.path, local_path: localPath, skipped: !written });
            }
            continue;
          }
          const localPath = (multipleSources || dstIsDirectory || /\/$/.test(localDst))
            ? nodePath.join(localDst, basename(remoteSource))
            : localDst;
          const { buffer } = await readRawBuffer(client, remoteSource, headers);
          const written = await writeLocalFile(localPath, buffer, {
            force: !!opts.force,
            noClobber: isNoClobber(opts) && !opts.force,
          });
          results.push({ path: remoteSource, local_path: localPath, skipped: !written });
        } catch (e) {
          errors.push(errorPayload(remoteSource, e));
          if (!out.json) console.error(pathError("download", remoteSource, e));
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
          truncation_reason: truncated ? "entry_limit_exceeded" : "",
        };
        if (errors.length) {
          console.log(JSON.stringify({ success: false, ...payload }, null, 2));
        } else if (results.length === 1 && !truncated && !opts.recursive) out.success(results[0]);
        else out.success(payload);
      }
      finishWithPartialFailure(errors);
    }));
}
