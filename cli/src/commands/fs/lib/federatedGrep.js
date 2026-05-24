/**
 * Federated grep orchestrator.
 *
 * Contract: docs/proposals/PUP-federated-search.md §2.
 *
 * Drives the two channels:
 *   1. TRACKED CHANNEL  — POST /ap-fs/grep-indexed first; if the index
 *      is missing/stale, fall through to the legacy GET /ap-fs/grep
 *      (S3 scan) so we never return nothing just because the indexer
 *      hasn't caught up yet. Server hits are then enriched with
 *      remote+local file content via dualFetch.
 *   2. UNTRACKED CHANNEL — in parallel, walk the local working copy,
 *      skip any path the server already tracks, and grep what's left
 *      (.gitignore / .puppyignore content, uncommitted files).
 *
 * Returns one envelope that callers can render. Shape:
 *
 *   {
 *     hits: [
 *       { path, line, col, match,
 *         provenance: 'tracked' | 'local-only',
 *         remote_content, local_content, diff_status, // tracked only
 *         context_before, context_after,
 *         content_hash,
 *       },
 *       ...
 *     ],
 *     channel_used: { tracked: 'indexed' | 'fallback' | 'skipped',
 *                     untracked: 'ran' | 'skipped' },
 *     index_status: 'indexed' | 'stale' | 'missing',
 *     index_freshness: { ... },
 *     truncated: bool,
 *     truncation_reason: '...',
 *     errors: [ ... ],
 *   }
 */

import { dualFetch } from "./dualFetch.js";
import { localScan, buildLocalMatcher, fetchTrackedPaths } from "./localScan.js";
import { get, post } from "./http.js";

function buildLegacyParams({ pattern, regex, opts, path }) {
  return {
    pattern,
    path,
    regex,
    ignore_case: !!opts.ignoreCase,
    invert_match: !!opts.invertMatch,
    only_matching: !!opts.onlyMatching,
    include_hidden: !!opts.includeHidden,
    include: opts.include || "",
    exclude: opts.exclude || "",
    exclude_dir: opts.excludeDir || "",
    before_context: opts.beforeContext || 0,
    after_context: opts.afterContext || 0,
    include_offsets: !!opts.byteOffset,
    limit: opts.limit,
    max_count: opts.perFileLimit || opts.maxCount || 0,
    max_files: opts.maxFiles,
    max_bytes: opts.maxBytes,
    max_depth: opts.maxDepth,
  };
}

function indexedHitsToShape(hits) {
  return hits.map(h => ({
    path: h.path,
    line: h.line,
    col: h.col,
    match: h.match,
    context_before: h.context_before || [],
    context_after: h.context_after || [],
    content_hash: h.content_hash || "",
    provenance: "tracked",
  }));
}

function legacyResultToShape(result) {
  // Legacy /ap-fs/grep returns ``matches: [{path, line_number, line_text,
  // before_context, after_context, ...}]``. Normalise to the federated
  // shape so the renderer is channel-agnostic.
  const matches = result?.matches || [];
  return matches.map(m => ({
    path: m.path || result?.path || "",
    line: m.line_number,
    col: m.match_byte_offset || 0,
    match: m.line_text ?? m.match_text ?? "",
    context_before: (m.before_context || []).map(c => c.line_text ?? ""),
    context_after: (m.after_context || []).map(c => c.line_text ?? ""),
    content_hash: m.content_hash || "",
    provenance: "tracked",
  }));
}

function dedupeHits(hits) {
  const seen = new Map();
  for (const h of hits) {
    // Tracked hits arrive first; if a local-only hit matches the same
    // (path, line, col) — which it shouldn't, because local-only is
    // by construction outside the tracked set — prefer the tracked
    // version since it carries dualFetch metadata.
    const key = `${h.path}\0${h.line}\0${h.col}\0${h.match}`;
    if (!seen.has(key)) seen.set(key, h);
  }
  return [...seen.values()];
}

/**
 * @param {object} args
 * @param {object} args.client       — createApClient() result
 * @param {object} args.headers      — extra headers
 * @param {string} args.pattern      — raw pattern (already merged by buildPattern)
 * @param {boolean} args.regex       — whether the pattern is a regex
 * @param {string|null} args.localRoot — absolute path to the local
 *   working copy; null disables both dualFetch's local read AND the
 *   untracked channel.
 * @param {string} args.scopePath    — path within the AP scope
 * @param {object} args.opts         — CLI options (passed-through flags)
 * @param {boolean} [args.remoteOnly]
 * @param {boolean} [args.localOnly]
 */
export async function runFederatedGrep({
  client, headers, pattern, regex, localRoot, scopePath, opts,
  remoteOnly = false, localOnly = false,
}) {
  const envelope = {
    hits: [],
    channel_used: { tracked: "skipped", untracked: "skipped" },
    index_status: "missing",
    index_freshness: null,
    truncated: false,
    truncation_reason: "",
    errors: [],
  };

  // Build the local matcher once — both channels (untracked + the
  // dualFetch render) reuse it.
  let matcher = null;
  try {
    matcher = buildLocalMatcher(pattern, {
      regex,
      ignoreCase: !!opts.ignoreCase,
      wordMatch: !!opts.wordRegexp,
    });
  } catch (err) {
    envelope.errors.push({ stage: "matcher", message: err.message });
  }

  // Kick off both channels in parallel — the untracked channel
  // depends on the tracked path set, which we fetch separately so
  // a slow /ap-fs/tree doesn't block /ap-fs/grep-indexed.
  const trackedTask = localOnly ? Promise.resolve(null) : (async () => {
    try {
      const body = {
        pattern,
        path: scopePath || "",
        regex: !!regex,
        ignore_case: !!opts.ignoreCase,
        word_match: !!opts.wordRegexp,
        invert_match: !!opts.invertMatch,
        only_matching: !!opts.onlyMatching,
        before_context: opts.beforeContext || 0,
        after_context: opts.afterContext || 0,
        limit: opts.limit || 1000,
        per_file_limit: opts.perFileLimit || opts.maxCount || 0,
      };
      return await post(client, "/ap-fs/grep-indexed", body, headers);
    } catch (err) {
      envelope.errors.push({ stage: "indexed", message: err.message || String(err) });
      return null;
    }
  })();

  const trackedPathsTask = (remoteOnly || !localRoot || !matcher) ? Promise.resolve(new Set()) : (async () => {
    try {
      return await fetchTrackedPaths({
        get: (path, query, h) => get(client, path, query, h),
        headers,
        scopePath: scopePath || "",
      });
    } catch {
      return new Set();
    }
  })();

  const [tracked, trackedPaths] = await Promise.all([trackedTask, trackedPathsTask]);

  // Tracked channel — server-first with legacy fallback.
  if (!localOnly) {
    let trackedHits = [];
    if (tracked && Array.isArray(tracked.hits)) {
      trackedHits = indexedHitsToShape(tracked.hits);
      envelope.index_status = tracked.index_status || "missing";
      envelope.index_freshness = tracked.index_freshness || null;
      envelope.channel_used.tracked = "indexed";
      if (tracked.truncated) {
        envelope.truncated = true;
        envelope.truncation_reason = envelope.truncation_reason || "indexed_truncated";
      }
    }
    // Fallback when the index isn't up to date OR the indexed channel
    // returned zero hits but the index is missing/stale (so we can't
    // trust the zero).
    const indexAuthoritative =
      tracked && tracked.index_status === "indexed" && Array.isArray(tracked.hits);
    if (!indexAuthoritative) {
      try {
        const legacy = await get(client, "/ap-fs/grep", buildLegacyParams({
          pattern, regex, opts, path: scopePath || "",
        }), headers);
        const legacyHits = legacyResultToShape(legacy);
        // Merge tracked: indexed-channel hits + legacy-channel hits,
        // deduped. Legacy carries authoritative paths, indexed-channel
        // dedupe is just defensive.
        trackedHits = dedupeHits([...trackedHits, ...legacyHits]);
        envelope.channel_used.tracked = trackedHits.length ? "fallback" : envelope.channel_used.tracked;
        if (legacy?.truncated) {
          envelope.truncated = true;
          envelope.truncation_reason = envelope.truncation_reason || (legacy.truncation_reason || "legacy_truncated");
        }
      } catch (err) {
        envelope.errors.push({ stage: "legacy_grep", message: err.message || String(err) });
      }
    }

    // dualFetch — pair each tracked hit's path with remote + local copy.
    if (trackedHits.length) {
      try {
        trackedHits = await dualFetch({
          client, headers, localRoot, hits: trackedHits,
        });
      } catch (err) {
        envelope.errors.push({ stage: "dualFetch", message: err.message || String(err) });
      }
      envelope.hits.push(...trackedHits);
    }
  }

  // Untracked channel.
  if (!remoteOnly && localRoot && matcher) {
    try {
      const scan = await localScan({
        root: localRoot,
        scopePath: scopePath || "",
        matcher,
        trackedPaths,
        flags: {
          invertMatch: !!opts.invertMatch,
          onlyMatching: !!opts.onlyMatching,
          beforeContext: opts.beforeContext || 0,
          afterContext: opts.afterContext || 0,
          maxFiles: opts.maxFiles,
          maxBytes: opts.maxBytes,
          maxFileBytes: opts.maxBytes ? Math.min(opts.maxBytes, 4 * 1024 * 1024) : undefined,
          limit: opts.limit || 1000,
          perFileLimit: opts.perFileLimit || opts.maxCount || 0,
        },
      });
      envelope.channel_used.untracked = "ran";
      if (scan.truncated) {
        envelope.truncated = true;
        envelope.truncation_reason = envelope.truncation_reason || scan.truncation_reason;
      }
      envelope.hits.push(...scan.hits);
    } catch (err) {
      envelope.errors.push({ stage: "local_scan", message: err.message || String(err) });
    }
  }

  envelope.hits = dedupeHits(envelope.hits);
  return envelope;
}
