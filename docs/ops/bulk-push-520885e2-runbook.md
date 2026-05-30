# Runbook — Bulk push `invalid git loose object` (the 520885e2 class)

**Status:** active runbook, audience = on-call / support
**Symptom signature:**
```
Bulk push failed: invalid git loose object for {hash}:
Error -3 while decompressing data: incorrect header check
```

This runbook covers the residual edge case that the 2026-05-24
self-heal patch did NOT cover.

---

## 1. What was fixed (and why some users still hit it)

The 2026-05-24 patch handled stale bytes in the **deferred-read
namespace** (S3 prefix `mut/{project_id}/objects/…`). When the
engine falls through to that namespace and the bytes aren't a valid
Git loose object, it now logs a warning and treats the read as 404,
falling through to the next read path. No data is deleted.

The residual case is stale bytes in the **primary namespace** (S3
prefix `version/{project_id}/objects/…`). The read path for the
primary namespace was never wrapped in the same guard, because at
the time we thought stale bytes there were impossible — they'd come
only from a bug we'd already retired. They CAN, however, exist on
projects that experienced an earlier failed-but-partial upload.

## 2. Why "same file in same repo" fails while other shapes work

Three observations from production reports:

| Scenario | Result | Reason |
|---|---|---|
| Same file → new project | ✓ Works | New project's S3 prefix is empty; the upload writes fresh bytes. |
| Different file → same project | ✓ Works | Different `content_hash` → different S3 key → no collision with the stale residue. |
| **Same file → same project** | **✗ Fails** | The exact S3 key (under that project's prefix, for that hash) already has stale residual bytes from the earlier failed upload. |

The failure chain:

1. Old project has stale bytes at `version/{project_id}/objects/52/0885e2…` (from a partial upload that left non-zlib bytes behind).
2. User retries the upload with the same file. `bulk push` runs the negotiate phase, which calls `async_exists` to ask "does the server have this hash?"
3. `async_exists` does an S3 HEAD — it sees a key with positive size — returns `True`. The negotiate phase concludes the server already has the object and skips re-uploading it.
4. Some later step in the publish pipeline tries to *read* the object (commit body assembly, tree validation, etc.). That read does NOT verify `_verify_loose_hash` for the primary namespace path, so the stale bytes come back to the caller.
5. The caller `zlib.decompress`-es them. Boom: `Error -3 while decompressing data: incorrect header check`.

And the upload path (`_do_put`) has an "if not exists then PUT" optimisation, so it never overwrites the stale bytes on its own. The user is stuck in a loop: every retry hits the same `exists=True → read → zlib fail` path.

## 3. Workarounds the user can apply themselves

1. **Re-create the project.** A fresh project has no residual S3 bytes for any hash. Verified to work in production. The cost is losing the existing project's history; only acceptable when the project is new enough that there's nothing to lose.
2. **Modify the file.** Even a one-byte change shifts the SHA-1, so the upload hits a fresh S3 key. Annoying but works for "I just need to ship the content."
3. **Wait for ops to clean up** (see §4).

## 4. Ops cleanup — supported flow

**Endpoint:** `POST /api/v1/ap-fs/admin/object-integrity`
**Auth:** AP key with `rw` mode (the same gate that protects writes).

### Step 1 — diagnose (dry-run, default)

The user's bulk-push error message names the offending hash (the 40-hex SHA-1 right after "invalid git loose object for"). Diagnose just that hash:

```bash
curl -sS -X POST "$API_URL/api/v1/ap-fs/admin/object-integrity" \
  -H "X-Access-Key: $AP_KEY" \
  -H "X-Puppy-Client: ops" \
  -H "Content-Type: application/json" \
  -d '{
    "hashes": ["520885e2…"],
    "dry_run": true
  }'
```

Expected response on a hit:
```json
{
  "checked": 1,
  "diagnosed": [{
    "hash": "520885e2…",
    "status": "corrupt_primary_loose",
    "key": "version/{project_id}/objects/52/0885e2…",
    "size_bytes": 160,
    "verify_error": "invalid git loose object for 520885e2…",
    "zlib_error": "error",
    "also_packed": false
  }],
  "deleted": [],
  "dry_run": true
}
```

If `diagnosed` is empty, the problem isn't this class — file a fresh bug.

### Step 2 — confirm with the user

Before deleting, double-check with the user:
- "Is the project still useful as-is? (any working files / commits worth preserving)"
- "Are you OK if your next upload re-creates this blob?"

If the user agrees, proceed to step 3. **If they hesitate, stop and escalate** — deleting the stale bytes is reversible only if the bytes are also present elsewhere (pack file or another project's prefix); we'd rather not gamble.

### Step 3 — delete (dry_run=false)

```bash
curl -sS -X POST "$API_URL/api/v1/ap-fs/admin/object-integrity" \
  -H "X-Access-Key: $AP_KEY" \
  -H "X-Puppy-Client: ops" \
  -H "Content-Type: application/json" \
  -d '{
    "hashes": ["520885e2…"],
    "dry_run": false
  }'
```

The endpoint deletes only keys that:
- failed `_verify_loose_hash` (truly corrupt, not just "looks weird"),
- belong to the user's own project (AP scope bounds them automatically),
- were targeted explicitly (an explicit `hashes` list — full sweeps still require a follow-up audit).

### Step 4 — user retries upload

The next `bulk push` for that file: `async_exists` HEAD → 404 (we just deleted the key) → object reported missing → upload writes correct bytes → publish succeeds.

## 5. Full-sweep mode (rare)

If a user reports more than ~5 hashes failing, run a full sweep first to find the rest before opening multiple tickets:

```bash
curl -sS -X POST "$API_URL/api/v1/ap-fs/admin/object-integrity" \
  -H "X-Access-Key: $AP_KEY" \
  -H "X-Puppy-Client: ops" \
  -H "Content-Type: application/json" \
  -d '{ "hashes": [], "dry_run": true }'
```

Empty `hashes` array triggers an S3-LIST sweep of the project's primary objects prefix (capped at 10 000 keys per call). The response's `diagnosed` array lists every corrupt key found. Take that list, hand it to step 3.

## 6. What auto-heals now, and what stays ops-supervised

The residual was closed by three automatic mechanisms plus one
ops-supervised tool. The design carefully avoids the expensive /
destructive approaches that were rejected.

**Automatic (no ops needed):**

| Mechanism | Where | Cost |
|---|---|---|
| **Read-side verify + fall-through** | `get` / `async_get` verify primary-namespace bytes; corrupt ones fall through to the deferred/packed lookup (or clean 404) instead of reaching zlib | The read path already does the GET; verify adds only a decode + sha1 on bytes already in hand. The user-visible symptom (`invalid git loose object` zlib crash) is gone. |
| **Hash-on-write self-heal** | `_do_put(expected_hash=)` — when a key already exists, verify the resident bytes; overwrite only if corrupt | Only on the `_do_put` exists-hit path, NOT the hot bulk path: the staged-flush bulk write uses `skip_exists=True` (unconditional overwrite, no verify), so a normal push of unchanged objects pays nothing extra. |
| **Background integrity scan** | `object_integrity_worker` (runbook §8) — periodic full sweep, diagnoses (and optionally heals) corrupt primary loose objects | Off by default; bounded projects-per-run; diagnosis-only until ops flips the heal flag. |

**Rejected approaches (and why):**

| Approach | Why rejected |
|---|---|
| Verify bytes on every `async_exists` HEAD | Turns a free HEAD into a paid GET + zlib for every existence probe — bulk push negotiates against thousands of hashes per call. We verify on *read* (already a GET) and *write-with-resident-bytes*, never on the exists probe. |
| Auto-delete corrupt bytes during read | We tried this on the deferred namespace and **destroyed a user's project root tree** (pre-Git-protocol JSON misdiagnosed as garbage). Read paths must not have destructive side effects. Deletion stays human-gated. |

The ops-supervised tool (`/admin/object-integrity`) remains for targeted
cleanup when a specific user reports a hash and ops wants explicit
control over deletion.

## 7. Related code

- Endpoint definition: [`backend/src/version_engine/entrypoints/http/access_point_fs.py`](../../backend/src/version_engine/entrypoints/http/access_point_fs.py) — `admin_object_integrity` + `_ObjectIntegrityRequest`.
- Deferred-namespace self-heal + primary-namespace verify + hash-on-write: [`backend/src/version_engine/storage/backends/s3.py`](../../backend/src/version_engine/storage/backends/s3.py) — `_get_deferred_loose` / `_async_get_deferred_loose` (deferred), `get` / `async_get` (primary read verify), `_do_put` (hash-on-write self-heal).
- The "do not delete on read" contract: [`backend/tests/version_engine/test_deferred_loose_self_heal.py`](../../backend/tests/version_engine/test_deferred_loose_self_heal.py) — 6 tests, including explicit `assert delete_calls == []`.

## 8. Hardening status

- **✅ Done — Hash-on-write:** `_do_put(expected_hash=)` verifies resident bytes when a key already exists and overwrites on mismatch, so newly-written corrupt bytes (or a re-upload over a stale squatter) self-heal within the request. See §6. Tests: `TestHashOnWrite` in `test_deferred_loose_self_heal.py`.
- **✅ Done — Background scan:** `object_integrity_worker.process_object_integrity_projects` runs a periodic full sweep across active projects, logs a structured "ticket" line per corrupt project, and optionally heals. Scheduled via `VERSION_INTEGRITY_SCAN_ENABLED` (off by default) at `VERSION_INTEGRITY_SCAN_INTERVAL_SECONDS`. Tests: `TestPrimaryLooseIntegrityScan`.
- **✅ Done — Read-side verify:** `get` / `async_get` verify primary bytes and fall through corrupt ones, so the user-visible zlib crash can no longer happen even before the bytes are healed. Tests: `TestPrimaryNamespaceVerify`.
- **Obviated — `--force` upload flag:** originally proposed so a user could bypass the dedup skip to self-heal. No longer needed: product / AP / folder-upload writes flush with `skip_exists=True` (unconditional overwrite) and the non-staged `_do_put` path self-heals via hash-on-write. A re-upload of the same file now overwrites a stale squatter automatically — no manual flag. (Adding a no-op `--force` would imply a capability that does nothing, so it was deliberately NOT added.)
