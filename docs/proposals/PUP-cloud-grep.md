# PUP — Cloud-side grep via DB index

**Status:** locked, shipped 2026-05-25
**Supersedes:** the prior "PUP-federated-search.md" proposal (federated
local + remote search + semantic mode) — see §1 for what changed and why.

---

## 1. Scope change vs the original proposal

The first proposal had three product surfaces:

| Surface | Decision |
|---|---|
| ``puppyone fs grep`` — cloud + local + dualFetch comparison | **Cloud-only.** Local search is the user's job (``git grep`` / ``rg`` / IDE). PuppyOne CLI is a cloud-disk operations surface (analogue: ``aws s3 ls`` / ``gsutil cp``), not a local-machine search tool. |
| ``puppyone fs search`` — semantic / hybrid via Turbopuffer | **Removed.** Semantic search belongs in the product UI, where the user has context to interpret embedding scores. A CLI's job is "give me lines that match this regex," not "find me embeddings near this meaning." |
| Server-side text index (``version_text_index``) | **Kept.** Still powers cloud-side grep at scale. |

**What stayed:**
- The ``version_text_index`` table + ``pg_trgm`` + ``tsvector`` GIN indexes.
- The post-commit indexer hook (``index_commit_delta`` from
  ``run_post_project_update_hook``).
- The ``POST /ap-fs/grep-indexed`` endpoint.
- The legacy ``GET /ap-fs/grep`` endpoint as S3-walk fallback for
  scopes the indexer hasn't caught up on.

**What got deleted:**
- ``POST /ap-fs/search`` endpoint + ``_run_semantic_channel`` helper.
- CLI ``puppyone fs search`` command.
- CLI federation libraries: ``dualFetch.js``, ``localScan.js``,
  ``federatedGrep.js``.
- CLI ``--federated`` / ``--remote-only`` / ``--local-only`` /
  ``--local-root`` flags on ``puppyone fs grep``.

---

## 2. Final architecture

```
puppyone fs grep PATTERN [path]
    │
    ▼
For each path requested:
  1. POST /ap-fs/grep-indexed (DB: tsvector + pg_trgm)
       │
       ├─ index_status == "indexed" → normalise to legacy
       │  ``matches[]`` shape; render and done.
       │
       └─ index_status ∈ {"stale", "missing"} → fall through
          to GET /ap-fs/grep (S3-walk + Python regex).
```

No local channel. No dualFetch. No remote/local diff. The CLI just
returns whatever the server returned, formatted in the legacy grep
shape so all existing render modes (``-c``, ``-l``, ``-L``, context,
counts) keep working.

## 3. Why DB index instead of always S3-walking

Target users have huge repos (enterprise monorepos, TB of text).
Walking S3 blobs and running Python regex per file is O(repo size)
per query — useless at scale. The DB index gives us:

- **`tsvector` GIN** for word-aware match (``-w`` and default grep).
- **`pg_trgm` GIN** for substring + regex match (``-E`` / ``-F``).
- Partitioned by ``(project_id, scope_path)`` so queries scan inside
  the AP's blast radius, not the whole project.
- Content keyed by ``content_hash`` so the same blob across branches
  indexes exactly once.
- Chunked storage (~4 KB per row) so trigram candidate sets stay
  bounded and per-line offsets are recoverable.

S3 scan remains as the indexer-catch-up fallback. Once the indexer
has processed a scope's commits, the S3 path is dead weight — but
keeping it means brand-new projects don't see "0 hits" while the
indexer is still building.

## 4. Schema

```sql
CREATE TABLE public.version_text_index (
  id              BIGSERIAL PRIMARY KEY,
  project_id      TEXT NOT NULL,
  scope_path      TEXT NOT NULL DEFAULT '',
  file_path       TEXT NOT NULL,            -- repo-relative; AP-scope
                                            -- enforcement is by file_path
                                            -- prefix, not scope_path column
  content_hash    TEXT NOT NULL,            -- sha1 of the blob
  chunk_idx       INT  NOT NULL,            -- 0-based chunk inside file
  line_start      INT  NOT NULL,            -- 1-based line of chunk[0]
  text            TEXT NOT NULL,            -- raw chunk text
  tsv             tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  UNIQUE (project_id, content_hash, chunk_idx)
);
CREATE INDEX idx_vti_project_scope ON public.version_text_index (project_id, scope_path);
CREATE INDEX idx_vti_tsv           ON public.version_text_index USING GIN (tsv);
CREATE INDEX idx_vti_trgm          ON public.version_text_index USING GIN (text gin_trgm_ops);
CREATE INDEX idx_vti_file_path     ON public.version_text_index (project_id, file_path);
```

Plus a per-scope freshness watermark in ``version_text_index_state``.

## 5. ``POST /ap-fs/grep-indexed``

Request:
```json
{
  "pattern": "TODO",
  "path": "",
  "regex": false,
  "ignore_case": true,
  "word_match": false,
  "invert_match": false,
  "only_matching": false,
  "before_context": 0,
  "after_context": 0,
  "limit": 1000,
  "per_file_limit": 0
}
```

Response:
```json
{
  "index_status": "indexed | stale | missing",
  "head_commit_id": "abc123",
  "index_freshness": {"indexed_commit_id": "...", "head_commit_id": "...", "commits_behind": 0},
  "hits": [
    {"path": "notes/client.md", "line": 42, "col": 5, "match": "TODO: rewrite",
     "content_hash": "def456", "context_before": [...], "context_after": [...]}
  ],
  "truncated": false,
  "candidates_examined": 17
}
```

``index_status`` semantics:
- ``indexed`` — authoritative. CLI uses this result, skips S3 fallback.
- ``stale``   — behind HEAD. CLI falls back to ``GET /ap-fs/grep``.
- ``missing`` — no rows for this scope yet. CLI falls back.

## 6. CLI behaviour

```javascript
// puppyone fs grep PATTERN [path]
for (const path of requestedPaths) {
  const indexedResult = await tryIndexedGrep({client, headers, ...});
  if (indexedResult) { results.push(indexedResult); continue; }
  results.push(await get(client, "/ap-fs/grep", { ...queryBase, path }, headers));
}
```

``tryIndexedGrep`` returns the legacy-shape envelope when
``index_status === "indexed"`` and ``null`` otherwise. The renderer
(``renderMatches`` / ``renderCount`` / ``renderFiles``) doesn't need
to know which channel produced the data.

## 7. Indexer

Hooked into ``run_post_project_update_hook``: each commit's add /
update changes feed ``index_commit_delta(project_id, commit_id, changes,
read_blob)``, which:

1. Filters changes to ``add`` / ``update`` (deletes don't index).
2. ``read_blob(path)`` via ``ProductOperationAdapter.read_file``.
3. Skips binary content (null-byte probe).
4. Chunks line-aligned ~4 KB.
5. Upserts to ``version_text_index`` keyed by
   ``(project_id, content_hash, chunk_idx)``.
6. Bumps the project-root freshness watermark on success.

Failure is swallowed with ``log_warning`` — the index is a read-side
accelerator, not a write-side invariant.

## 8. Out of scope (explicitly)

- Web UI for grep. CLI-only by product decision.
- Local working-copy grep. Use ``git grep`` / ``rg`` / IDE for that.
- Semantic / hybrid search via CLI. Use the product UI's ``/tools/search``
  flow.
- Cross-project federated search. Each AP key is scoped to its project.
- Replacing PG full-text with ES / OpenSearch. ``tsvector + pg_trgm``
  is enough until query patterns demonstrate otherwise.
- Per-file freshness watermarks. v1 uses a single project-root watermark.
