/**
 * Dual-version fetcher for federated grep / search hits.
 *
 * Contract: docs/proposals/PUP-federated-search.md §5 / §7.
 *
 * For every server-side hit we want to surface BOTH the remote tracked
 * content (via /ap-fs/cat) and the local working-copy content (via the
 * filesystem at <localRoot>/<path>) so the user can spot drift without
 * leaving the terminal.
 *
 * Design constraints baked in here:
 *
 *   - Distinct paths are deduped — if grep produced N hits across the
 *     same file we only fetch that file once. The hit array keeps a
 *     reference to the shared content rather than copying the bytes.
 *   - Failures (remote 404, local ENOENT, permission denied) become
 *     `diff_status` values, NOT exceptions. The renderer decides how
 *     to show "remote-missing" vs "local-missing".
 *   - The fetch fan-out is bounded (default 16) so very large hit
 *     sets don't open thousands of sockets.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { get } from "./http.js";

const DEFAULT_CONCURRENCY = 16;

async function fetchRemote(client, headers, path) {
  try {
    const data = await get(client, "/ap-fs/cat", { path }, headers);
    // /ap-fs/cat returns { type, content, content_text, ... } depending
    // on the file's stored type. For grep/search rendering we just want
    // the text representation; fall back across the available fields.
    const text =
      typeof data?.content_text === "string"
        ? data.content_text
        : typeof data?.content === "string"
          ? data.content
          // JSON files come back as already-parsed objects; serialise so
          // the renderer can diff against the local on-disk text.
          : data?.content != null
            ? JSON.stringify(data.content, null, 2)
            : "";
    return { ok: true, text, content_hash: data?.content_hash || "" };
  } catch (err) {
    if (err?.status === 404 || err?.code === "NOT_FOUND") {
      return { ok: false, missing: true };
    }
    return { ok: false, error: err?.message || String(err) };
  }
}

async function fetchLocal(localRoot, path) {
  if (!localRoot) return { ok: false, missing: true };
  try {
    const full = join(localRoot, path);
    const text = await readFile(full, "utf8");
    return { ok: true, text };
  } catch (err) {
    if (err?.code === "ENOENT") return { ok: false, missing: true };
    return { ok: false, error: err?.message || String(err) };
  }
}

function compareDiff(remote, local) {
  if (remote.missing) return "remote-missing";
  if (local.missing) return "local-missing";
  if (!remote.ok || !local.ok) return "error";
  return remote.text === local.text ? "same" : "differ";
}

/**
 * Enrich an array of grep/search hits with `remote_content`,
 * `local_content`, and `diff_status` keyed by `path`.
 *
 * @param {object} args
 * @param {object} args.client       — ApClient (createApClient from context.js)
 * @param {object} args.headers      — extra headers (X-PuppyOne-User, etc.)
 * @param {string|null} args.localRoot — root directory of the local
 *   working copy, or null to skip the local read entirely. When null
 *   every hit ends up `diff_status='local-missing'`.
 * @param {Array<{path: string}>} args.hits
 * @param {number} [args.concurrency=16]
 * @returns {Promise<Array>} — same hits, each with `remote_content`,
 *   `local_content`, `diff_status` attached. Hits that share a path
 *   share the same content objects.
 */
export async function dualFetch({ client, headers, localRoot, hits, concurrency = DEFAULT_CONCURRENCY }) {
  if (!hits?.length) return [];

  const paths = [...new Set(hits.map(h => h.path))];
  const byPath = new Map();

  // Bounded concurrency — simple semaphore over the unique-path list.
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= paths.length) return;
      const path = paths[idx];
      const [remote, local] = await Promise.all([
        fetchRemote(client, headers, path),
        fetchLocal(localRoot, path),
      ]);
      byPath.set(path, {
        remote,
        local,
        diff_status: compareDiff(remote, local),
      });
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, paths.length) }, () => worker());
  await Promise.all(workers);

  return hits.map(h => {
    const bundle = byPath.get(h.path) || { remote: { ok: false }, local: { ok: false }, diff_status: "error" };
    return {
      ...h,
      remote_content: bundle.remote.ok ? bundle.remote.text : null,
      local_content: bundle.local.ok ? bundle.local.text : null,
      diff_status: bundle.diff_status,
    };
  });
}
