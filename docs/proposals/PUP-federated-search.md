# PUP — Federated grep / search across server index + local working copy

**Status:** locked, ready for implementation
**Last updated:** 2026-05-24

## 1. Product framing

`grep` / `search` are **CLI-only** features (no web UI). The CLI runs
both against the **server's source of truth** (DB-indexed, scope-bounded
by the AP key the user is logged into) and against the user's **local
working copy** at the same time, with two distinct purposes:

- **Server path** — finds matches in the canonical repo content. The
  server is the SOT for tracked files. When the server hits, the CLI
  fetches BOTH the remote file content AND the local working copy of
  the same path so the user can compare without leaving the terminal.
- **Local untracked path** — finds matches in files that the server
  CANNOT know about: paths listed in `.gitignore` / `.puppyignore`, and
  newly added files that haven't been committed. These are filtered to
  paths NOT present in the server's tracked tree so we don't
  double-report files the server already handled.

The two paths run in parallel; final output merges hits and dedupes by
`(path, line, col)`.

## 2. Architecture target

```
puppyone fs grep PATTERN [path]
    │
    ├──► [TRACKED CHANNEL] server-first chain
    │    1. POST /ap-fs/grep-indexed (DB: tsvector + pg_trgm)
    │    2. if index_status != "indexed" → GET /ap-fs/grep (legacy S3 scan)
    │    3. for each hit: dualFetch — remote /ap-fs/cat + local file read
    │       → hit row carries (remote_content, local_content, diff_status)
    │
    └──► [UNTRACKED CHANNEL] parallel local-only scan
         CLI enumerates server's tracked path set under AP scope.
         Local walk; for each candidate file:
           keep iff path NOT in tracked set AND matches pattern.
         provenance = "local-only" (no remote content to fetch)

    Merge: server_hits ∪ untracked_hits, dedup by (path, line, col).
```

`puppyone fs search QUERY` mirrors this but the server path uses the
existing `SearchService.search_scope` (pgvector + RRF) and the local
untracked path falls back to literal substring match on the query
tokens (no client-side embeddings in v1).

## 3. Why a DB-backed index (not file-walk grep)

Target users have huge repos (think enterprise monorepos with TB of
text). Walking S3 blobs and running Python regex on each commit-aged
content is O(repo size) per query — useless at scale. Instead:

- **`tsvector` GIN index** for word-aware match (`-w`, default `grep`).
- **`pg_trgm` GIN index** for substring + regex prefix match.
- Both partitioned by `(project_id, scope_path)` so queries do an
  O(log N) scan inside the AP's blast radius, not the whole repo.
- Content keyed by `content_hash` so the same blob across branches
  indexes once.
- Chunked storage (one row per ~4 KB block) so line numbers are
  recoverable and trigram candidate sets stay bounded.

`pg_trgm` is the load-bearing choice: it supports regex via
`LIKE`/`~` operators backed by trigram filtering. PostgreSQL is enough
for the v1 target; switching to OpenSearch is a Phase-3 perf
optimization, not a v1 requirement.

## 4. Schema (Phase A1)

```sql
CREATE TABLE public.version_text_index (
  id              BIGSERIAL PRIMARY KEY,
  project_id      TEXT NOT NULL,
  scope_path      TEXT NOT NULL DEFAULT '',
  file_path       TEXT NOT NULL,             -- repo-relative
  content_hash    TEXT NOT NULL,             -- sha1 of the blob
  chunk_idx       INT  NOT NULL,             -- 0-based chunk inside file
  line_start      INT  NOT NULL,             -- 1-based line of chunk[0]
  text            TEXT NOT NULL,             -- raw chunk text
  tsv             tsvector
                  GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,

  UNIQUE (project_id, content_hash, chunk_idx)
);

CREATE INDEX idx_vti_project_scope
  ON public.version_text_index (project_id, scope_path);
CREATE INDEX idx_vti_tsv         ON public.version_text_index USING GIN (tsv);
CREATE INDEX idx_vti_trgm        ON public.version_text_index
  USING GIN (text gin_trgm_ops);
CREATE INDEX idx_vti_file_path   ON public.version_text_index (project_id, file_path);
```

Note: we don't store `commit_id` per row — the same `content_hash` is
valid as long as that blob exists anywhere in the project, and the
fresh-or-stale check against HEAD is a per-request join, not a
denormalized field that needs reindexing.

## 5. Endpoints (Phase A3 + A4 + A5)

### `POST /ap-fs/grep-indexed`

Request:
```json
{
  "pattern": "TODO",
  "path": "",
  "flags": {"ignore_case": true, "word_match": false, "regex_mode": "literal"},
  "limit": 200
}
```

Response:
```json
{
  "index_status": "indexed | stale | missing",
  "head_commit_id": "abc123",
  "hits": [
    {"path": "notes/client.md", "line": 42, "col": 5, "match": "TODO: rewrite",
     "content_hash": "def456", "context_before": [...], "context_after": [...]}
  ],
  "truncated": false,
  "index_freshness": {"indexed_commit_id": "...", "head_commit_id": "...",
                      "commits_behind": 0}
}
```

`index_status` semantics:
- `indexed` — index is up-to-date for this scope; results are
  authoritative. CLI may skip the legacy fallback.
- `stale` — scope has commits past `indexed_commit_id`. CLI fetches
  results AND falls back to S3 scan for safety.
- `missing` — index has no rows for this scope. CLI runs legacy S3
  scan as the primary tracked-path query.

### `GET /ap-fs/grep` (legacy, retained)

Unchanged. Becomes the fallback when `index_status != indexed`.
Marked in code as `# fallback path, see docs/proposals/PUP-federated-search.md`.

### `POST /ap-fs/search`

Request:
```json
{
  "query": "client retention strategy",
  "path": "",
  "mode": "hybrid | semantic | literal",
  "limit": 20
}
```

Response: same shape as `grep-indexed` plus a `score` field per hit and
the `mode` actually used (degraded if a server-side index is missing).
Internally delegates to `SearchService.search_scope`, with scope
bounded by the AP key's `scope_path`.

## 6. Indexer worker (Phase A2)

Hook into the existing `version_outbox` pipeline. Each commit produces
a `text_index` event; a worker pulls events, walks the new commit's
tree diff (only paths changed in this commit), reads the new blobs,
chunks them, and upserts rows keyed by `(project_id, content_hash,
chunk_idx)`. The natural-key upsert means re-running an event is a
no-op.

For the initial population of a project that pre-dates the indexer,
add an admin endpoint `POST /ap-fs/admin/reindex` that enqueues every
unique content_hash in the project. Out of scope for v1: tracking
per-scope index freshness; for now `index_status` is derived from
`(SELECT MAX(indexed_commit_id) FROM version_text_index_state WHERE
project_id=$1)` vs the project's HEAD.

## 7. CLI library (Phase B)

### `cli/src/lib/dualFetch.js`

```
dualFetch({apiCtx, hits, localRoot, scope_path}) → hits enriched with
  - remote_content   (from /ap-fs/cat?path=…)
  - local_content    (from fs.readFile(join(localRoot, path)); null if absent)
  - diff_status      'same' | 'differ' | 'local-missing' | 'remote-missing'
```

### `cli/src/lib/localScan.js`

```
localScan({localRoot, scope_path, pattern, flags, trackedPaths}) → hits[]
  - walk localRoot/scope_path with .puppyignore + .gitignore
  - skip any path that IS in trackedPaths (server already handled it)
  - run regex per remaining file
  - emit hits with provenance="local-only"
```

`trackedPaths` is supplied by the caller (CLI), populated from a fresh
`GET /ap-fs/tree?path=<scope>` call. The Set is built once per command
invocation.

## 8. CLI command surface (Phase C)

### `puppyone fs grep` — rewrite

```
Promise.all([
  trackedChannel(),    // indexed → fallback to S3 → dualFetch
  untrackedChannel(),  // local scan, filtered by trackedPaths
]).then(merge)
```

New flags:
- `--remote-only` — skip the untracked channel entirely
- `--local-only` — skip the tracked channel entirely
- `--full-content` — print full file content for each hit's
  remote+local (default: just the hit lines + diff summary)

Default render:
```
notes/client.md  [remote: abc123 · local: differ ⚠]
  42:  TODO: rewrite the intro
  87:  TODO: schedule call
  --- remote vs local (line 42) ---
  - TODO: rewrite the intro
  + TODO: rewrote the intro
```

### `puppyone fs search` — new

Same shape as grep, but `mode` flag controls server query (default
`hybrid`). Local untracked channel runs literal substring on each
query word; no semantic match locally.

## 9. Out of scope (v1)

- Web UI for grep / search (CLI-only by product decision).
- Client-side embeddings (no local semantic search; v1 falls back to
  literal).
- Cross-project federated search (search is per-project, scope-bounded
  by the AP key).
- ES / OpenSearch as the index store; PG-native trigram + tsvector is
  enough until query patterns demonstrate otherwise.
- Per-file freshness tracking; v1 uses a project-scope freshness
  watermark.
- Reindex throttling / fairness; v1 worker handles one project at a
  time per outbox lock.
