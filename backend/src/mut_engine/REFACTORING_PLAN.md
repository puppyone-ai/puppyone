# mut_engine — Refactoring & Quality Optimization Plan

## Current State

- **23 files, 4,091 LOC**
- **Ruff (ALL rules): 852 issues** (many auto-fixable style issues + real problems)
- Structure is sound but has accumulated technical debt from rapid iteration

---

## Phase 1: Critical Fixes (safety & stability)

> Impact: HIGH | Risk: LOW | Effort: 1-2 hours

### 1.1 S3 Storage Backend — Thread Pool Exhaustion

**File**: `server/backends/s3_storage.py`

`_run_async()` creates a **new ThreadPoolExecutor per call**. Under concurrent pushes this will exhaust system threads and cause timeouts.

```python
# BAD: new pool per call
def _run_async(coro):
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(...).result(timeout=30)
```

**Fix**: Module-level executor with bounded pool.

```python
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4)

def _run_async(coro):
    def _run(): return asyncio.run(coro)
    return _EXECUTOR.submit(_run).result(timeout=30)
```

### 1.2 Auth — Silent Security Event Swallowing

**File**: `server/auth.py`

4 bare `except Exception:` blocks silently return `None` on auth failures. A JWT parsing error and an expired token look identical to "no token provided".

**Fix**: Log security events, distinguish error types.

```python
# BAD
except Exception:
    return None

# GOOD
except jwt.ExpiredSignatureError:
    log_warning(f"[Auth] Expired JWT for project {project_id}")
    raise HTTPException(401, "Token expired")
except Exception as e:
    log_error(f"[Auth] Unexpected auth error: {e}")
    return None
```

### 1.3 Error Handling — Bare `except Exception` Audit

**53 instances** of `BLE001` (blind exception catching). Each needs review:

| Action | Count | Description |
|--------|-------|-------------|
| Keep (best-effort) | ~15 | Hooks, audit logs — failure is acceptable |
| Add logging | ~20 | Currently silent — add `log_error()` |
| Make specific | ~10 | Catch specific exceptions (ValueError, KeyError, etc.) |
| Remove | ~8 | Unnecessary catch-all around safe code |

---

## Phase 2: Architecture Refactor (maintainability)

> Impact: MEDIUM | Risk: MEDIUM | Effort: 3-4 hours

### 2.1 Split `content_router.py` (607 lines → 4 modules)

Current god-class handles 15+ endpoints with mixed concerns.

```
content_router.py (607 lines)
  ↓ split into:
  routers/
    content_read.py     ← ls, cat, stat, tree, search (~150 lines)
    content_write.py    ← write, mkdir, mv, rm (~150 lines)
    content_history.py  ← versions, diff, rollback (~100 lines)
```

### 2.2 Extract Duplicated Patterns

**a) Router exception handling** — identical try/except in 12 endpoints:

```python
# Extract to decorator
def mut_endpoint(handler_fn):
    async def wrapper(*args, **kwargs):
        try:
            return await handler_fn(*args, **kwargs)
        except HTTPException:
            raise
        except PermissionDenied as e:
            raise HTTPException(403, str(e))
        except LockError as e:
            raise HTTPException(409, str(e))
        except Exception as e:
            log_error(f"[MUT] {handler_fn.__name__} failed: {e}")
            raise HTTPException(500, f"Failed: {e}")
    return wrapper
```

**b) Path cleaning** — `path.strip("/")` repeated 10+ times in content_router:

```python
# Extract to dependency
def clean_path(path: str = "") -> str:
    return path.strip("/")
```

**c) Async wrappers in supabase_history.py** — 16 identical `async def` wrappers:

```python
# Replace 16 methods with __getattr__ pattern or auto-wrap decorator
def _async_wrap(sync_fn):
    async def wrapper(*args, **kwargs):
        return await asyncio.to_thread(sync_fn, *args, **kwargs)
    return wrapper
```

### 2.3 Eliminate Code Duplication in `ops.py`

`move()` and delete variants share the same typed-splice → commit pattern:

```python
# Extract common pattern
def _clone_modify_push(self, project_id, scope, modifier_fn, message, who):
    files = self._clone_scope_files(project_id, scope)
    modified = modifier_fn(files)
    return self._push_scope_files(project_id, scope, modified, message, who)
```

---

## Phase 3: Performance (scalability)

> Impact: MEDIUM | Risk: LOW | Effort: 2-3 hours

### 3.1 Database Query Optimization

**Post-commit hooks** fetch ALL connections then filter in Python:

```python
# BAD: O(n) in app
resp = client.table("connections").select("*").eq("project_id", pid).execute()
for row in resp.data:
    if path_matches(row["path"], deleted_paths): ...

# GOOD: Filter in DB
resp = client.table("connections").select("*") \
    .eq("project_id", pid) \
    .neq("path", None) \
    .execute()
# + further filter with JSONB operators for scope.path
```

**`revoke_by_scope()`** in auth.py — same pattern.

**`find_by_path_prefix()`** in supabase_scope.py — loads all scopes into memory.

### 3.2 Supabase Response Handling

Replace fragile `resp and hasattr(resp, 'data') and resp.data` pattern with unified helper:

```python
def _extract(resp) -> list | dict | None:
    """Safely extract data from any Supabase response."""
    if resp is None:
        return None
    data = getattr(resp, 'data', None)
    return data
```

Apply across all 20+ call sites in backends/.

### 3.3 Repo Manager Cache

Add TTL-based cache invalidation:

```python
class MutRepoManager:
    CACHE_TTL = 300  # 5 minutes

    def get_repo(self, project_id):
        entry = self._cache.get(project_id)
        if entry and time.time() - entry.created_at < self.CACHE_TTL:
            return entry.repo
        # ... create new
```

---

## Phase 4: Ruff Auto-fix (style & consistency)

> Impact: LOW | Risk: LOW | Effort: 30 min

### 4.1 Auto-fixable Rules (apply with `ruff check --fix`)

| Rule | Count | Description |
|------|-------|-------------|
| I001 | 17 | Unsorted imports |
| UP007 | 29 | Use `X \| Y` for type unions |
| UP006 | 11 | Use `list` instead of `List` |
| D212 | 23 | Docstring formatting |
| D204 | 25 | Blank line after class docstring |
| COM812 | 28 | Trailing comma |
| Q000 | 11 | Quote style |

**Total auto-fixable: ~200+ issues**

### 4.2 Manual Rules (selective application)

| Rule | Count | Action |
|------|-------|--------|
| B904 | 34 | Add `from err` to re-raised exceptions — apply selectively |
| E501 | 29 | Line too long — fix where readability improves |
| EM102 | 12 | f-string in exception — keep as-is (readability > style) |
| PLR0913 | 20 | Too many args — refactor where it makes sense (dataclass params) |
| D102/D103 | 82 | Missing docstrings — add only to public API |

### 4.3 Ruff Config

Add to `pyproject.toml`:

```toml
[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B", "SIM", "RUF"]
ignore = [
    "E501",    # line too long (handled by formatter)
    "B008",    # Depends() in defaults (FastAPI pattern)
    "ANN101",  # self type annotation
    "D107",    # missing __init__ docstring
]

[tool.ruff.lint.per-file-ignores]
"tests/*" = ["S101", "D"]  # allow assert, skip docstrings in tests
```

---

## Phase 5: Security Hardening

> Impact: HIGH | Risk: LOW | Effort: 1-2 hours

### 5.1 Path Traversal Prevention

No validation that paths don't contain `..` or absolute paths:

```python
def validate_path(path: str) -> str:
    clean = path.strip("/")
    if ".." in clean.split("/") or clean.startswith("/"):
        raise ValueError(f"Invalid path: {path}")
    return clean
```

Apply as middleware/validator on all content endpoints.

### 5.2 Content Size Limits

No maximum file size check on push:

```python
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_TREE_DEPTH = 20
MAX_FILES_PER_PUSH = 1000
```

### 5.3 Input Validation

Missing on query parameters:

```python
@router.get("/{project_id}/ls")
async def list_dir(
    project_id: str,
    path: str = "",
    max_depth: int = Query(default=1, ge=0, le=10),
    limit: int = Query(default=100, ge=1, le=1000),
):
```

---

## Execution Order

| Phase | What | Effort | Priority |
|-------|------|--------|----------|
| **4.1** | Ruff auto-fix + config | 30 min | Do first (clean baseline) |
| **1.1** | S3 thread pool fix | 15 min | Critical |
| **1.2** | Auth security logging | 30 min | Critical |
| **1.3** | Exception audit | 1 hr | Important |
| **5.1-5.3** | Security hardening | 1.5 hr | Important |
| **2.2** | Extract patterns | 1.5 hr | Quality |
| **3.1-3.2** | DB query + response handling | 1.5 hr | Performance |
| **2.1** | Split content_router | 2 hr | Architecture |
| **2.3** | ops.py dedup | 1 hr | Quality |
| **3.3** | Cache TTL | 30 min | Improvement |
| **4.2** | Manual lint fixes | 1 hr | Polish |

**Total estimated: ~11 hours**
