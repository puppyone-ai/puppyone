/**
 * ``puppyone fs search`` — federated semantic / hybrid search.
 *
 * Contract: docs/proposals/PUP-federated-search.md §8.
 *
 * Architecture mirrors ``fs grep`` but the server channel is the
 * pgvector-backed ``/ap-fs/search`` endpoint. The local channel is
 * literal substring (no client-side embeddings in v1) so a query
 * like "client retention" falls back to ``grep "client retention"``
 * against the user's untracked files when the server returns
 * nothing.
 */

import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { errorPayload, finishWithPartialFailure, pathError } from "../lib/errors.js";
import { post } from "../lib/http.js";
import { dualFetch } from "../lib/dualFetch.js";
import { localScan, buildLocalMatcher, fetchTrackedPaths } from "../lib/localScan.js";
import { get } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

const VALID_MODES = new Set(["hybrid", "semantic", "literal"]);

function diffStatusTag(status) {
  if (status === "differ") return " ⚠differ";
  if (status === "local-missing") return " (no local copy)";
  if (status === "remote-missing") return " (server missing)";
  return "";
}

export function registerSearchCommand(fs) {
  fs
    .command("search")
    .description("Federated semantic / hybrid search across the AP scope")
    .argument("<query>", "natural-language query")
    .argument("[path]", "sub-path within the AP scope to restrict the search")
    .option("--mode <mode>", "server search mode: hybrid | semantic | literal", "hybrid")
    .option("--limit <n>", "max hits returned", "20")
    .option("--remote-only", "skip the local-untracked literal fallback")
    .option("--local-only", "skip the server semantic channel")
    .option("--local-root <dir>", "local working-copy root (defaults to cwd)")
    .addHelpText("after", `
Examples:
  puppyone fs search "client retention strategy"
  puppyone fs search "auth bug" notes --mode hybrid --limit 30
  puppyone --json fs search "embedding pipeline" --mode semantic

Notes:
  Server channel returns hits ranked by RRF fusion of pgvector + tsvector
  similarity. Each hit is paired with the file's remote tracked content
  AND its local working copy so drift is visible inline.
  Local untracked channel does literal substring matching across .gitignore
  / .puppyignore files and uncommitted files only.
`)
    .action(withErrors(async (query, rawPath, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);

      if (!VALID_MODES.has(opts.mode)) {
        throw new Error(`--mode must be one of: hybrid, semantic, literal (got "${opts.mode}")`);
      }
      const limit = Math.max(1, Math.min(parseInt(opts.limit, 10) || 20, 200));
      const cleanPath = scopedPath(rawPath || "");

      const errors = [];
      let serverEnvelope = null;
      let localResult = null;

      const localRoot = opts.localOnly || opts.localRoot ? (opts.localRoot || process.cwd()) : process.cwd();

      // Channels run in parallel — semantic doesn't depend on the
      // tracked-path set; local literal scan does, so its task waits
      // on tracked-path resolution.
      const serverTask = opts.localOnly ? Promise.resolve(null) : (async () => {
        try {
          return await post(client, "/ap-fs/search", {
            query,
            path: cleanPath,
            mode: opts.mode,
            limit,
          }, headers);
        } catch (e) {
          errors.push(errorPayload(cleanPath, e));
          if (!out.json) console.error(pathError("search", cleanPath, e));
          return null;
        }
      })();

      const trackedPathsTask = opts.remoteOnly ? Promise.resolve(new Set()) : (async () => {
        try {
          return await fetchTrackedPaths({
            get: (p, q, h) => get(client, p, q, h),
            headers,
            scopePath: cleanPath,
          });
        } catch {
          return new Set();
        }
      })();

      const [server, trackedPaths] = await Promise.all([serverTask, trackedPathsTask]);
      serverEnvelope = server;

      // Server hits — pair each with remote + local content via dualFetch.
      let serverHits = [];
      if (server && Array.isArray(server.hits)) {
        serverHits = await dualFetch({
          client, headers,
          localRoot: opts.remoteOnly ? null : localRoot,
          hits: server.hits.map(h => ({ ...h, provenance: "tracked" })),
        });
      }

      // Local untracked literal fallback — only when the server channel
      // failed or returned nothing AND the user didn't pass --remote-only.
      // The user said "if nothing on server, search locally" — and we
      // also always include local-only matches against ignored /
      // uncommitted files via the trackedPaths filter.
      let localHits = [];
      if (!opts.remoteOnly) {
        try {
          // Literal mode: match any of the query's whitespace-separated
          // tokens (case-insensitive). Substring rather than regex so
          // user input like "client.md" doesn't blow up.
          const tokens = query
            .split(/\s+/)
            .map(t => t.trim())
            .filter(Boolean);
          if (tokens.length) {
            const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            const matcher = buildLocalMatcher(escaped.join("|"), {
              regex: true,
              ignoreCase: true,
            });
            const scan = await localScan({
              root: localRoot,
              scopePath: cleanPath,
              matcher,
              trackedPaths,
              flags: {
                limit,
                perFileLimit: 5,
              },
            });
            localHits = scan.hits || [];
          }
        } catch (e) {
          errors.push({ stage: "local_scan", message: e.message || String(e) });
        }
      }

      const combinedHits = [
        ...serverHits,
        ...localHits.filter(h => !serverHits.some(sh => sh.path === h.path && sh.line === h.line)),
      ].slice(0, limit);

      if (out.json) {
        out.success({
          query,
          mode: opts.mode,
          server: serverEnvelope,
          hits: combinedHits,
          errors,
        });
        if (!errors.length && !combinedHits.length) process.exitCode = 1;
        finishWithPartialFailure(errors);
        return;
      }

      if (serverEnvelope?.semantic_error) {
        out.warn(`semantic channel degraded: ${serverEnvelope.semantic_error}`);
      }

      if (!combinedHits.length) {
        out.warn(`no matches for "${query}" under ${cleanPath || "."}`);
        process.exitCode = 1;
        finishWithPartialFailure(errors);
        return;
      }

      for (const h of combinedHits) {
        const provTag = h.provenance === "local-only" ? "L" : "R";
        const scoreTag = h.score != null ? ` (score=${h.score.toFixed(3)})` : "";
        out.raw(`[${provTag}] ${h.path}:${h.line}: ${h.match}${diffStatusTag(h.diff_status)}${scoreTag}`);
      }

      finishWithPartialFailure(errors);
    }));
}
