import { ApiError } from "../../../api.js";
import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { addFsHelp, JSON_METADATA_NOTE, LIMIT_NOTE, MUTATION_AUDIT_NOTE, MUTATION_SILENT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { getCurrentScopeBaseCommit, rawPostBytes } from "../lib/http.js";
import { isNoClobber } from "../lib/operation-intent.js";
import { parseNonNegativeOption, parsePositiveOption } from "../lib/options.js";
import { scopedPath } from "../lib/paths.js";
import { resolveTransferDestination, statPath } from "../lib/remote.js";
import { applyPolicyToScan, collectLocalFiles, localPathInfo } from "../lib/transfer-local.js";
import { PER_BATCH_MAX_BYTES, PER_BATCH_MAX_FILES, PER_FILE_MAX_BYTES } from "../lib/upload-policy.js";

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Print a one-screen policy summary and (when stdin is a TTY) prompt
 * for a [y/N] confirmation. Non-TTY just prints and proceeds —
 * automation scripts shouldn't hang waiting for stdin that doesn't
 * exist.
 */
async function confirmPolicyIfNeeded(policyApplied, out) {
  if (!policyApplied.shouldConfirm) return true;
  const lines = [];
  lines.push(
    `Upload preview: ${policyApplied.accepted.length} file${
      policyApplied.accepted.length === 1 ? "" : "s"
    } (${formatBytes(policyApplied.totalAcceptedBytes)})`,
  );
  if (policyApplied.skipped.length > 0) {
    lines.push(`  Skipped ${policyApplied.skipped.length}:`);
    if (policyApplied.reasonCounts.blocklist > 0) {
      lines.push(
        `    · ${policyApplied.reasonCounts.blocklist} in blocklisted folders (.git, node_modules, …) — override with --include-blocklist`,
      );
    }
    if (policyApplied.reasonCounts.gitignore > 0) {
      lines.push(
        `    · ${policyApplied.reasonCounts.gitignore} matched .gitignore / .puppyignore — override with --include-gitignored`,
      );
    }
    if (policyApplied.reasonCounts.hidden > 0) {
      lines.push(
        `    · ${policyApplied.reasonCounts.hidden} hidden files — override with --include-hidden`,
      );
    }
    if (policyApplied.reasonCounts.tooLarge > 0) {
      lines.push(
        `    · ${policyApplied.reasonCounts.tooLarge} larger than ${formatBytes(PER_FILE_MAX_BYTES)} per file (hard cap, cannot override)`,
      );
    }
  }
  if (out.json) {
    // JSON consumers don't see a prompt — they want the summary in
    // the result, not to be asked. Proceed silently.
    return true;
  }
  for (const line of lines) console.error(line);
  if (!process.stdin.isTTY) {
    console.error("(stdin is not a TTY — proceeding without prompt)");
    return true;
  }
  // Minimal TTY prompt — single character read, no external deps.
  process.stderr.write("Proceed? [y/N] ");
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        const ans = buf.trim().toLowerCase();
        resolve(ans === "y" || ans === "yes");
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function joinRemoteRelative(parent, relativePath) {
  const cleanParent = scopedPath(parent);
  const cleanRelative = scopedPath(relativePath);
  return cleanParent ? `${cleanParent}/${cleanRelative}` : cleanRelative;
}

export function registerUploadCommand(fs) {
  addFsHelp(fs
    .command("upload")
    .description("Upload local file(s) into the access point scope")
    .argument("<paths...>", "local source path(s) followed by remote destination")
    .option("-r, --recursive", "upload directories recursively")
    .option("-f, --force", "overwrite an existing remote destination")
    .option("-n, --no-clobber", "do not overwrite an existing remote destination")
    .option("--max-depth <n>", "max local directory depth for recursive uploads")
    .option("--limit <n>", "max files uploaded per recursive source", "5000")
    .option("--include-hidden", "include hidden files (start with .) — see PUP-3 policy")
    .option("--include-gitignored", "include files matched by .gitignore / .puppyignore at the source root")
    .option("--include-blocklist", "include files inside default-blocked folders (.git, node_modules, …)")
    .option("--no-default-ignores", "do not read .gitignore / .puppyignore from the source root")
    .option("--ignore-file <path>", "path to an additional ignore-rules file (can be repeated)", (v, prev) => (prev ? [...prev, v] : [v]))
    .option("--yes", "skip the interactive confirmation prompt when stdin is a TTY")
    .option("-m, --message <msg>", "commit message"), {
      examples: [
        "puppyone fs upload ./README.md docs/README.md",
        "puppyone fs upload -r ./images assets/",
        "puppyone fs upload -r ./docs docs --max-depth 2 --limit 500",
        "puppyone fs upload -r ./repo project/ --include-hidden",
        "puppyone fs upload -r ./repo project/ --no-default-ignores --yes",
        "puppyone --json fs upload ./README.md docs/README.md",
      ],
      notes: [
        SCOPE_NOTE,
        MUTATION_SILENT_NOTE,
        MUTATION_AUDIT_NOTE,
        JSON_METADATA_NOTE,
        LIMIT_NOTE,
        "Recursive uploads skip .git, node_modules, .DS_Store, etc. by default (PUP-3 policy). Use --include-blocklist to override.",
        "Hidden files and .gitignore matches are also skipped by default; override with --include-hidden / --include-gitignored.",
      ],
    })
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
      const policyOptions = {
        includeHidden: !!opts.includeHidden,
        includeIgnored: !!opts.includeGitignored,
        includeBlocklist: !!opts.includeBlocklist,
        // Commander turns ``--no-default-ignores`` into
        // ``opts.defaultIgnores === false``.
        noDefaultIgnores: opts.defaultIgnores === false,
        ignoreFiles: opts.ignoreFile || [],
      };
      const policySkippedTotals = { blocklist: 0, gitignore: 0, hidden: 0, tooLarge: 0 };
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
            if (scan.truncated) {
              truncated = true;
              out.warn(`operation is incomplete: recursive upload reached the ${scan.limit} file limit. Use --max-depth, a narrower source, or --limit.`);
            }
            // ── PUP-3 policy stage ────────────────────────────────
            // Strip blocklist + .gitignore + hidden files before the
            // upload commits. Per-batch caps are enforced separately
            // below so the user sees both reasons at once when
            // applicable.
            const policy = await applyPolicyToScan(scan, localSource, policyOptions);
            policySkippedTotals.blocklist += policy.reasonCounts.blocklist;
            policySkippedTotals.gitignore += policy.reasonCounts.gitignore;
            policySkippedTotals.hidden += policy.reasonCounts.hidden;
            policySkippedTotals.tooLarge += policy.reasonCounts.tooLarge;
            if (policy.accepted.length === 0 && policy.skipped.length > 0) {
              out.warn(`all files in ${localSource} were filtered by policy (use --include-* flags to override)`);
              continue;
            }
            // Batch caps (Q4). Reject early so the user adjusts and
            // re-runs rather than half-uploads.
            if (policy.accepted.length > PER_BATCH_MAX_FILES) {
              throw new ApiError(0, "BATCH_FILE_LIMIT", `Batch of ${policy.accepted.length} files exceeds the ${PER_BATCH_MAX_FILES}-file policy cap. Split the upload.`);
            }
            if (policy.totalAcceptedBytes > PER_BATCH_MAX_BYTES) {
              throw new ApiError(0, "BATCH_SIZE_LIMIT", `Batch total ${formatBytes(policy.totalAcceptedBytes)} exceeds the ${formatBytes(PER_BATCH_MAX_BYTES)} policy cap. Split the upload.`);
            }
            // TTY confirmation unless --yes / non-TTY / JSON mode.
            if (!opts.yes && !out.json) {
              const ok = await confirmPolicyIfNeeded(policy, out);
              if (!ok) {
                out.warn(`upload of ${localSource} cancelled by user`);
                continue;
              }
            }
            const files = policy.accepted;
            const baseName = nodePath.basename(localSource.replace(/\/+$/, ""));
            const remoteBase = await resolveTransferDestination(
              client, baseName, remoteDst, headers, { multipleSources },
            );
            for (const file of files) {
              const remotePath = joinRemoteRelative(remoteBase, file.relativePath);
              const existing = await statPath(client, remotePath, headers);
              if (existing.exists && isNoClobber(opts) && !opts.force) {
                results.push({ local_path: file.localPath, path: remotePath, skipped: true });
                continue;
              }
              const baseCommitId = await getCurrentScopeBaseCommit(client, headers);
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
          if (existing.exists && isNoClobber(opts) && !opts.force) {
            results.push({ local_path: localSource, path: remotePath, skipped: true });
            continue;
          }
          const baseCommitId = await getCurrentScopeBaseCommit(client, headers);
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
          policy_skipped: {
            blocklist: policySkippedTotals.blocklist,
            gitignore: policySkippedTotals.gitignore,
            hidden: policySkippedTotals.hidden,
            too_large: policySkippedTotals.tooLarge,
          },
        };
        if (errors.length) {
          console.log(JSON.stringify({ success: false, ...payload }, null, 2));
        } else if (results.length === 1 && !truncated && !opts.recursive) out.success(results[0]);
        else out.success(payload);
      }
      finishWithPartialFailure(errors);
    }));
}
