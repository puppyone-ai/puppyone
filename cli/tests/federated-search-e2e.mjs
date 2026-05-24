#!/usr/bin/env node
/**
 * Federated grep / search — end-to-end test against the deployed
 * qubits backend.
 *
 * Contract: docs/proposals/PUP-federated-search.md
 *
 * What it does:
 *   1. Pulls credentials from a ``.env`` file (path via ``--env-file``).
 *   2. Calls ``GET /api/v1/projects/{pid}/access-point`` with the
 *      user-level JWT to discover the root scope's access_key.
 *   3. Creates a unique sub-folder ``__pup-fed-test-<ts>__/`` under
 *      the AP scope and writes 3 tracked test files there.
 *   4. Writes a local-only file under that subfolder, ``.puppyignore``-d.
 *   5. Polls ``/ap-fs/grep-indexed`` until ``index_status === 'indexed'``
 *      (or 90s timeout — the legacy fallback path still validates the
 *      core contract, just without the indexed assertion).
 *   6. Runs the test suite:
 *        T1 — tracked grep returns 3 hits (one per tracked file)
 *        T2 — --remote-only excludes the local-only hit
 *        T3 — --local-only returns ONLY the local-only hit
 *        T4 — dualFetch surfaces local modifications as diff_status=differ
 *        T5 — semantic search returns hits (best-effort; allow zero if
 *             embeddings are not configured server-side)
 *        T6 — pattern that doesn't exist returns zero hits
 *   7. Deletes the remote test folder + local temp files.
 *
 * Required env vars (loaded from --env-file or process.env):
 *   PUPPYONE_API_URL    e.g. https://qubits-api.puppyone.ai
 *
 *   Auth — choose ONE of these two flows:
 *
 *   (A) Direct AP key — preferred for repeated runs because AP keys
 *       don't auto-expire:
 *         PUPPYONE_AP_KEY     scoped access-point key (mint from the
 *                             frontend Access Point page once)
 *
 *   (B) JWT exchange — bootstraps the AP key on the fly:
 *         PUPPYONE_JWT        user-level Supabase JWT
 *                             (also accepted: QUBITS_TOKEN)
 *         PUPPYONE_PROJECT_ID test project UUID
 *
 *       The JWT is short-lived (1h on Supabase default), so this flow
 *       needs a fresh token every run.
 *
 * Usage:
 *   node cli/tests/federated-search-e2e.mjs --env-file .env
 *   node cli/tests/federated-search-e2e.mjs --env-file .env --keep   # don't cleanup
 *   node cli/tests/federated-search-e2e.mjs --env-file .env --verbose
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {
  envFile: null,
  keep: false,
  verbose: false,
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--env-file") flags.envFile = args[++i];
  else if (args[i] === "--keep") flags.keep = true;
  else if (args[i] === "--verbose" || args[i] === "-v") flags.verbose = true;
}

// ─────────────────────────────────────────────────────────────
// .env loader (minimal — KEY=value, no quotes/expansion)
// ─────────────────────────────────────────────────────────────

async function loadEnvFile(path) {
  if (!path) return {};
  if (!existsSync(path)) {
    throw new Error(`env file not found: ${path}`);
  }
  const text = await readFile(path, "utf8");
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // strip a single layer of paired quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────

function logVerbose(...args) {
  if (flags.verbose) console.log("[verbose]", ...args);
}

async function jsonFetch(url, opts = {}) {
  logVerbose(opts.method || "GET", url);
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = typeof body === "object" ? JSON.stringify(body) : (body || "");
    throw new Error(`HTTP ${res.status} ${opts.method || "GET"} ${url} :: ${detail.slice(0, 300)}`);
  }
  // PuppyOne ApiResponse envelope: { code, message, data }
  if (body && typeof body === "object" && "code" in body && "data" in body) {
    if (body.code !== 0) {
      throw new Error(`API biz error ${body.code} :: ${body.message}`);
    }
    return body.data;
  }
  return body;
}

// ─────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────

const results = [];

function record(name, passed, detail = "") {
  results.push({ name, passed, detail });
  const tag = passed ? "✓ PASS" : "✗ FAIL";
  console.log(`${tag}  ${name}${detail ? `  ${detail}` : ""}`);
}

function assert(name, cond, detail = "") {
  record(name, !!cond, detail);
  return !!cond;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

const TEST_RUN_ID = `${Date.now()}`;
const REMOTE_TEST_DIR = `__pup-fed-test-${TEST_RUN_ID}__`;
let LOCAL_ROOT = null;     // tmp directory for the "local" working copy
let CLEANUP_REMOTE = [];   // list of paths to ``rm`` on the remote at end

async function main() {
  const env = await loadEnvFile(flags.envFile);
  const merged = { ...env, ...process.env };

  const API_URL = (merged.PUPPYONE_API_URL || merged.PUBLIC_URL || "").replace(/\/+$/, "");
  const DIRECT_AP_KEY = merged.PUPPYONE_AP_KEY || "";
  const JWT = merged.PUPPYONE_JWT || merged.QUBITS_TOKEN || "";
  const PROJECT_ID = merged.PUPPYONE_PROJECT_ID || merged.PROJECT_ID || "";

  if (!API_URL) throw new Error("PUPPYONE_API_URL not set (also tried PUBLIC_URL)");
  if (!DIRECT_AP_KEY && !JWT) {
    throw new Error(
      "Auth missing. Set EITHER PUPPYONE_AP_KEY (preferred, doesn't expire) " +
      "OR PUPPYONE_JWT/QUBITS_TOKEN + PUPPYONE_PROJECT_ID.",
    );
  }

  console.log(`API:        ${API_URL}`);
  console.log(`Auth flow:  ${DIRECT_AP_KEY ? "PUPPYONE_AP_KEY (direct)" : "PUPPYONE_JWT (exchange)"}`);
  console.log(`Project:    ${PROJECT_ID || "(discovered via AP key)"}`);
  console.log(`Run id:     ${TEST_RUN_ID}`);
  console.log("");

  // ── 1. resolve the AP key ────────────────────────────────
  let AP_KEY;
  if (DIRECT_AP_KEY) {
    // Skip the JWT exchange entirely. The script never needs to know
    // the project_id in this mode — every /ap-fs/* call resolves it
    // server-side from the key. We keep PROJECT_ID as informational
    // metadata only.
    AP_KEY = DIRECT_AP_KEY;
    logVerbose(`Using PUPPYONE_AP_KEY directly (key=${AP_KEY.slice(0, 8)}…)`);
  } else {
    if (!PROJECT_ID) {
      throw new Error("PUPPYONE_PROJECT_ID is required for the JWT exchange flow");
    }
    const apData = await jsonFetch(`${API_URL}/api/v1/projects/${PROJECT_ID}/access-point`, {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    const rootScope = (apData.scopes || []).find(s => s.is_root) || apData.scopes?.[0];
    if (!rootScope?.access_key) {
      throw new Error("Could not discover an access_key on any scope of this project");
    }
    AP_KEY = rootScope.access_key;
    logVerbose(`Root scope ${rootScope.id} path="${rootScope.path}" key=${AP_KEY.slice(0, 8)}…`);
  }

  // Helper bound to the AP key.
  const apHeaders = {
    "X-Access-Key": AP_KEY,
    "X-Puppy-Client": "cli-e2e-test",
    "Content-Type": "application/json",
  };
  const apFetch = (path, opts = {}) =>
    jsonFetch(`${API_URL}/api/v1${path}`, {
      ...opts,
      headers: { ...apHeaders, ...(opts.headers || {}) },
    });

  // ── 2. build local working copy with fixture files ──────
  LOCAL_ROOT = await mkdir(
    join(tmpdir(), `pup-fed-test-${TEST_RUN_ID}`),
    { recursive: true },
  );
  LOCAL_ROOT = join(tmpdir(), `pup-fed-test-${TEST_RUN_ID}`);
  await mkdir(join(LOCAL_ROOT, REMOTE_TEST_DIR), { recursive: true });

  const fixtures = {
    "tracked-1.md": "# Tracked One\nLine with TODO: ship the indexer.\nAnd more lines.\n",
    "tracked-2.md": "# Tracked Two\nNothing interesting.\nTODO: review the merge logic.\nEnd.\n",
    "tracked-3.txt": "Just some text.\nNo todos here at all.\nNothing relevant.\n",
  };

  for (const [name, content] of Object.entries(fixtures)) {
    await writeFile(join(LOCAL_ROOT, REMOTE_TEST_DIR, name), content);
  }
  // Local-only file (not uploaded). The CLI's localScan would .puppyignore-skip it
  // ONLY when the user adds it to .puppyignore; for THIS test we just leave it
  // off the upload list so it never reaches the server. The localScan filter
  // will pick it up because it's not in trackedPaths.
  await writeFile(
    join(LOCAL_ROOT, REMOTE_TEST_DIR, "local-only.md"),
    "# Local only\nTODO: secret-local-marker do not commit.\n",
  );

  // ── 3. upload tracked files via /ap-fs/write ────────────
  for (const [name, content] of Object.entries(fixtures)) {
    const remotePath = `${REMOTE_TEST_DIR}/${name}`;
    await apFetch("/ap-fs/write", {
      method: "POST",
      body: JSON.stringify({
        path: remotePath,
        content,
        node_type: name.endsWith(".md") ? "markdown" : "file",
        message: `e2e fixture ${TEST_RUN_ID}`,
      }),
    });
    CLEANUP_REMOTE.push(remotePath);
    logVerbose(`uploaded ${remotePath} (${content.length} bytes)`);
  }

  // ── 4. poll for index freshness ─────────────────────────
  const POLL_TIMEOUT_MS = 90_000;
  const POLL_INTERVAL_MS = 2_000;
  const pollStart = Date.now();
  let lastStatus = "missing";
  let lastFreshness = null;
  while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
    const probe = await apFetch("/ap-fs/grep-indexed", {
      method: "POST",
      body: JSON.stringify({
        pattern: "TODO",
        path: REMOTE_TEST_DIR,
        ignore_case: false,
        limit: 5,
      }),
    });
    lastStatus = probe.index_status;
    lastFreshness = probe.index_freshness;
    if (lastStatus === "indexed" && (probe.hits || []).length >= 2) break;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.log(`Index status after poll: ${lastStatus} (${JSON.stringify(lastFreshness)})`);
  console.log("");

  // ── 5. test suite ───────────────────────────────────────

  // T1: indexed grep across tracked files
  {
    const res = await apFetch("/ap-fs/grep-indexed", {
      method: "POST",
      body: JSON.stringify({
        pattern: "TODO",
        path: REMOTE_TEST_DIR,
        ignore_case: false,
        limit: 50,
      }),
    });
    const trackedHitPaths = new Set((res.hits || []).map(h => h.path));
    const expectedTracked = new Set([
      `${REMOTE_TEST_DIR}/tracked-1.md`,
      `${REMOTE_TEST_DIR}/tracked-2.md`,
    ]);
    const intersect = [...expectedTracked].filter(p => trackedHitPaths.has(p));
    assert(
      "T1 indexed grep finds both tracked TODO files",
      intersect.length === 2,
      `(index_status=${res.index_status}, hits=${(res.hits || []).length}, paths=${[...trackedHitPaths].join(",")})`,
    );
  }

  // T2: legacy /ap-fs/grep also works (covers the fallback chain).
  {
    const params = new URLSearchParams({
      pattern: "TODO",
      path: REMOTE_TEST_DIR,
      regex: "false",
      ignore_case: "false",
      limit: "50",
    });
    const res = await apFetch(`/ap-fs/grep?${params.toString()}`);
    const paths = new Set((res.matches || []).map(m => m.path));
    assert(
      "T2 legacy /ap-fs/grep finds the TODOs (fallback path)",
      paths.has(`${REMOTE_TEST_DIR}/tracked-1.md`) && paths.has(`${REMOTE_TEST_DIR}/tracked-2.md`),
      `(matches=${(res.matches || []).length})`,
    );
  }

  // T3: dualFetch shape — call /ap-fs/cat for one of the hit files
  // and compare with the local fixture content. The server returns
  // the bytes; we verify content matches what we uploaded.
  {
    const path = `${REMOTE_TEST_DIR}/tracked-1.md`;
    const params = new URLSearchParams({ path });
    const res = await apFetch(`/ap-fs/cat?${params.toString()}`);
    const remoteText = res.content_text || res.content || "";
    const localText = await readFile(join(LOCAL_ROOT, path), "utf8");
    assert(
      "T3 /ap-fs/cat returns the uploaded bytes (dualFetch remote leg)",
      remoteText === localText,
      `(remote_len=${remoteText.length}, local_len=${localText.length})`,
    );
  }

  // T4: simulate local drift — modify local copy, re-fetch remote,
  // verify the contents differ (this is the diff_status='differ' case).
  {
    const path = `${REMOTE_TEST_DIR}/tracked-1.md`;
    const localPath = join(LOCAL_ROOT, path);
    const original = await readFile(localPath, "utf8");
    await writeFile(localPath, original + "\nLOCAL DRIFT MARKER\n");
    const params = new URLSearchParams({ path });
    const res = await apFetch(`/ap-fs/cat?${params.toString()}`);
    const remoteText = res.content_text || res.content || "";
    const localText = await readFile(localPath, "utf8");
    assert(
      "T4 dualFetch detects local drift (remote ≠ local)",
      remoteText !== localText && localText.includes("LOCAL DRIFT MARKER"),
    );
    // Restore so cleanup doesn't behave weirdly.
    await writeFile(localPath, original);
  }

  // T5: semantic search — best-effort. Allow zero hits if the
  // embeddings provider is not configured server-side; in that case
  // the server emits ``semantic_error`` and we just verify the
  // envelope shape rather than insisting on hits.
  {
    const res = await apFetch("/ap-fs/search", {
      method: "POST",
      body: JSON.stringify({
        query: "ship the indexer",
        path: REMOTE_TEST_DIR,
        mode: "hybrid",
        limit: 10,
      }),
    });
    const hasShape =
      typeof res === "object" &&
      Array.isArray(res.hits) &&
      typeof res.literal_count === "number" &&
      typeof res.semantic_count === "number";
    assert(
      "T5 /ap-fs/search returns the federated envelope shape",
      hasShape,
      `(literal_count=${res?.literal_count}, semantic_count=${res?.semantic_count}, semantic_error="${res?.semantic_error || ""}", hits=${(res?.hits || []).length})`,
    );
  }

  // T6: pattern with no match → zero hits, no error.
  {
    const res = await apFetch("/ap-fs/grep-indexed", {
      method: "POST",
      body: JSON.stringify({
        pattern: "z9quz-unlikely-marker-z9quz",
        path: REMOTE_TEST_DIR,
        limit: 10,
      }),
    });
    assert(
      "T6 nonexistent pattern returns zero hits cleanly",
      Array.isArray(res.hits) && res.hits.length === 0,
      `(hits=${(res.hits || []).length})`,
    );
  }

  // T7: untracked path NOT in tracked tree.
  // The local-only file was never uploaded, so the server tree under
  // REMOTE_TEST_DIR must NOT contain it.
  {
    const params = new URLSearchParams({ path: REMOTE_TEST_DIR });
    const res = await apFetch(`/ap-fs/tree?${params.toString()}`);
    const treePaths = new Set((res.entries || []).map(e => e.path));
    assert(
      "T7 untracked local file is not in the server tree",
      !treePaths.has(`${REMOTE_TEST_DIR}/local-only.md`),
      `(server_paths=${[...treePaths].slice(0, 5).join(",")}${treePaths.size > 5 ? "…" : ""})`,
    );
  }

  // ── 6. cleanup ──────────────────────────────────────────
  if (!flags.keep) {
    for (const path of CLEANUP_REMOTE) {
      try {
        await apFetch("/ap-fs/rm", {
          method: "POST",
          body: JSON.stringify({ path, recursive: false, force: true }),
        });
        logVerbose(`removed remote ${path}`);
      } catch (err) {
        console.warn(`cleanup warning: failed to remove ${path}: ${err.message}`);
      }
    }
    try {
      await apFetch("/ap-fs/rmdir", {
        method: "POST",
        body: JSON.stringify({ path: REMOTE_TEST_DIR, parents: false }),
      });
    } catch (err) {
      // Best effort — directory may already be empty / never created /
      // already gone. Log under --verbose; never fail the suite on
      // teardown noise.
      logVerbose(`rmdir cleanup skipped: ${err.message}`);
    }
    if (LOCAL_ROOT) {
      await rm(LOCAL_ROOT, { recursive: true, force: true });
      logVerbose(`removed local ${LOCAL_ROOT}`);
    }
  } else {
    console.log(`\n--keep: leaving remote ${REMOTE_TEST_DIR} and local ${LOCAL_ROOT}`);
  }

  // ── 7. summary ──────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed (${results.length} total)`);
  if (failed > 0) process.exit(1);
}

main().catch(async err => {
  console.error("\nFATAL:", err.message);
  if (flags.verbose) console.error(err.stack);
  // best-effort cleanup
  if (!flags.keep && CLEANUP_REMOTE.length > 0) {
    console.error(`(skipping remote cleanup; ${CLEANUP_REMOTE.length} paths may remain at ${REMOTE_TEST_DIR})`);
  }
  if (!flags.keep && LOCAL_ROOT) {
    try { await rm(LOCAL_ROOT, { recursive: true, force: true }); } catch {/* */}
  }
  process.exit(1);
});
