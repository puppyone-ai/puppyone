# MUT Engine 实现方案 v2

> 日期：2026-04-18
> 状态：Draft
> 依赖文档：`mut-bug-checklist.md`、`mut-scope-concurrency.md`、`06-gateway-access-point-split.md`

---

## 一、核心问题

当前 MUT Engine 的并发控制**基本不工作**。37 个待修项中，大部分不是独立 bug 而是同一个架构缺陷的不同表现：

```
根因：push 流程用进程内互斥锁保护，但每个 HTTP 请求创建独立的 ServerRepo 实例
       → 锁永远不会互相阻塞
       → 所有并发保护形同虚设
       → scope_hash 无条件覆盖、graft 无保护、root_hash 不一致……
       → 这些都是同一个问题的下游症状
```

逐个修 bug 会产生 37 个独立补丁，互相冲突且难以维护。正确做法是**从底层重建并发控制**，上层 bug 自然消失。

---

## 二、设计原则

| 原则                     | 说明                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| **数据库即锁**     | 不用进程内锁（不跨实例），用 PostgreSQL 行级 CAS（跨实例、跨容器）                        |
| **乐观优先**       | 并行计算合并，只在最后一步 CAS 提交时串行化（毫秒级）                                     |
| **单一写入路径**   | 所有 push（Content API / MUT 协议 / Agent / Sandbox / Scheduler）走同一个 `handle_push` |
| **单一读取数据源** | 所有读操作从 `root_hash` 导航，不从 `scope_hash` 读                                   |
| **fail closed**    | 任何查找失败（scope / auth / S3）→ 拒绝，不 fallback 到全权限                            |
| **异常必须传播**   | S3 写入失败 → push 失败。不允许"CAS 成功但 blob 不在 S3"                                 |

---

## 三、改动方案

### Phase 0：基础设施（不改行为，为后续铺路）

**目标**：让后续 Phase 能安全执行，不影响现有功能。

#### 0.1 S3 异常传播（P0-2 + P3-1）

| 文件                                      | 改动                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `backends/s3_storage.py` `put()`      | 移除 bare except，改为 re-raise `StorageWriteError`                      |
| `backends/s3_storage.py` `get()`      | 只 catch `ClientError(404)` → `ObjectNotFoundError`；其他异常原样抛出 |
| `backends/s3_storage.py` `exists()`   | 同上                                                                       |
| `mut/server/graft.py` `_safe_flatten` | 移除 bare except → 让 S3 异常传播（P0-5）                                 |

**为什么先做**：后续 CAS 流程依赖"写入失败 = push 失败"的语义。如果 put 吞异常，CAS 会在 blob 丢失的情况下"成功"。

#### 0.2 单一写入路径抽取（P0-3）

| 文件                                      | 改动                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `services/ops.py`                       | 新增 `push_and_finalize(project_id, commit_result)` — 调 `run_post_push_hook` |
| `connectors/agent/service.py`           | `push()` 后调 `push_and_finalize()` 替代裸 push                                |
| `connectors/agent/sandbox_session.py`   | 同上                                                                               |
| `connectors/sandbox_endpoint/router.py` | 同上                                                                               |

```python
# services/ops.py
async def push_and_finalize(self, project_id: str, push_result: dict) -> dict:
    """统一的 push 后处理。所有 push 调用方必须走这里。"""
    run_post_push_hook(project_id, self._repo_manager, push_result)
    return push_result
```

**为什么先做**：Phase 1 改完 push 流程后，所有调用方自动受益。如果不统一路径，Phase 1 的改动只对 MUT 协议端口生效，Agent/Sandbox 仍然绕过。

#### 0.3 EphemeralClient 消费 merge 结果（P0-4）

| 文件                             | 改动                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `services/ephemeral_client.py` | push 成功后，如果 response 含 `merged_changes` → 执行 `pull()` 刷新 `_files` |

```python
# push 成功后
if push_result.get("merged"):
    self.pull()  # 刷新 _files 到 merge 后的状态
```

**为什么先做**：长 session 的 Agent（多轮对话复用同一个 client）目前会在 merge 后的下次 push 丢文件。这是数据安全问题。

---

### Phase 1：CAS 并发控制（核心）

**目标**：用 PostgreSQL CAS 替代进程内锁，解决所有并发数据安全问题。

**一次性解决**：P0-1、4.1、4.2（A/B/C）、4.3（A）、4.4、S1-S4/S6-S7 场景。

#### 1.1 ServerRepo 改造

| 文件                | 改动                                                                                    | 说明                     |
| ------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| `server_repo.py`  | 移除 `_scope_locks` + `acquire_lock()` + `release_lock()`                         | 不再用进程内锁           |
| `server_repo.py`  | 新增 `cas_update_scope(scope_path, old_hash, new_hash, head_commit_id)`               | 调用 DB RPC              |
| `server_repo.py`  | 新增 `cas_update_root_hash(old_root, new_root)`                                       | 调用 DB RPC              |
| `server_repo.py`  | `list_scope_files(scope)` 改为从 `root_hash` 导航到子树                             | 不再从 `scope_hash` 读 |
| `repo_manager.py` | `get_server_repo()` 改为 per-request 创建（但底层 ObjectStore / HistoryManager 共享） | 消除实例级状态           |

#### 1.2 handle_push CAS 重试循环

| 文件                                       | 改动                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| `mut/server/handlers.py` `handle_push` | 移除 `acquire_lock` / `release_lock`，改为 CAS 重试循环 |

```python
def handle_push(repo, auth, body):
    scope = auth["_scope"]
    if scope.get("mode") == "r":
        raise PermissionDenied("scope is read-only")

    req = PushRequest.from_dict(body)
    _store_incoming_objects(repo.store, req.objects)

    for attempt in range(MAX_CAS_RETRIES + 1):
        result = _push_attempt(repo, scope, auth, req)
        if result is not None:
            return result
    raise LockError("push failed after max retries")

def _push_attempt(repo, scope, auth, req):
    # 1. 读当前状态（不持锁）
    old_scope_hash = repo.get_scope_hash(scope["path"])
    old_head = repo.get_scope_head_commit_id(scope["path"])
    our_files = repo.list_scope_files(scope)  # ← 从 root_hash 导航

    # 2. 三方合并（不持锁，可并行）
    their_files = _flatten_tree_to_bytes(repo.store, req.snapshots[-1]["root"])
    merged_files, conflicts = _resolve_conflicts(...)

    # 3. 构建新树 + 计算 hash
    _apply_merged_files(repo, scope, our_files, merged_files)
    new_scope_hash = repo.build_scope_tree(scope)
    new_commit_id = _compute_commit_id(scope["path"], new_scope_hash, who)

    # 4. CAS 提交（原子 DB 操作，几毫秒）
    success = repo.cas_update_scope(
        scope["path"], old_scope_hash, new_scope_hash, new_commit_id)
    if not success:
        return None  # CAS 失败 → 重试

    # 5. 记录历史 + 嫁接
    repo.record_history(new_commit_id, ...)
    _graft_to_root(repo, scope["path"], new_scope_hash)  # CAS 保护的嫁接

    # 6. 构建响应（含 merged_changes）
    return PushResponse(
        status="ok",
        commit_id=new_commit_id,
        merged_changes=_compute_merged_changes(our_files, merged_files, their_files),
        ...
    ).to_dict()
```

#### 1.3 handle_rollback CAS 化（P0-1）

| 文件                                                                  | 改动                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| `mut/server/handlers.py` `handle_rollback`                        | 用 CAS 循环替代直接 `set_scope_hash`；完成后调 graft |
| `protocol_router.py` / `access_point.py` / `content_history.py` | rollback 成功后调 `run_post_push_hook`               |

#### 1.4 Graft CAS 保护（4.3A + 4.3B）

| 文件                    | 改动                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `mut/server/graft.py` | `graft_subtree` 改为 `graft_or_merge_subtree`：CAS 读旧 root → 插入子树 → CAS 写新 root |
| `hooks.py`            | 调用新的 `graft_or_merge_subtree`；移除 bare except（P2-10）                                |

```python
def graft_or_merge_subtree(repo, scope_path, new_scope_hash):
    for attempt in range(MAX_GRAFT_RETRIES):
        old_root = repo.get_root_hash()
        # 读当前子树 hash
        current_subtree = _navigate_subtree(repo.store, old_root, scope_path)
        # 如果子树没变（快速路径，绝大多数情况）
        new_root = _build_grafted_root(repo.store, old_root, scope_path, new_scope_hash)
        if repo.cas_update_root_hash(old_root, new_root):
            return  # 成功
    log_error(f"graft failed after {MAX_GRAFT_RETRIES} retries")
```

---

### Phase 2：安全加固

**目标**：关闭所有 P1 安全漏洞。每项独立，可并行开发。

#### 2.1 Scope fallback fail-closed（P1-2）

| 文件                                  | 改动                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| `server/auth.py` `_resolve_scope` | 查找失败 →`raise PermissionDenied` 而非 fallback 到全权限 |
| `routers/access_point.py`           | scope 解析失败 → 403                                        |

#### 2.2 审计路由权限（P1-3）

| 文件                        | 改动                                                  |
| --------------------------- | ----------------------------------------------------- |
| `routers/audit_router.py` | `_ensure_project_access` 改为调用标准的项目成员检查 |

#### 2.3 文件大小限制（P1-4）

| 文件                         | 改动                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `server/validation.py`     | 新增 `validate_content_size(content: bytes)`                    |
| `routers/content_write.py` | write / bulk-write 端点调 `validate_content_size`               |
| `mut/server/handlers.py`   | push 中对每个 blob 检查 size（在 `_store_incoming_objects` 中） |

#### 2.4 validate_path 全覆盖（P1-5）

| 文件                         | 改动                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `services/ops.py`          | `delete` / `move` / `restore` / `bulk_write` 内部调 `validate_path` |
| `routers/content_write.py` | move 端点：先 validate 再执行（不是先执行再 validate）                        |

#### 2.5 Access Key status check（P1-6）

| 文件                                   | 改动                             |
| -------------------------------------- | -------------------------------- |
| `server/auth.py` `_try_access_key` | 增加 `status == 'active'` 检查 |

#### 2.6 SKIP_AUTH 环境保护（P1-7）

| 文件               | 改动                                                   |
| ------------------ | ------------------------------------------------------ |
| `server/auth.py` | `SKIP_AUTH` 只在 `ENV in ("local", "test")` 时生效 |

#### 2.7 user_identity 强制检查（P1-8）

| 文件                                             | 改动                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `server/auth.py` + `routers/access_point.py` | 如果 AP 配置了 `user_identity`：缺 `X-Mut-User` header → 403；值不匹配 → 403 |

#### 2.8 scope path 安全（P2-8）

| 文件                                     | 改动                                               |
| ---------------------------------------- | -------------------------------------------------- |
| `mut/core/scope.py` `normalize_path` | 增加 `posixpath.normpath` + 拒绝含 `..` 的路径 |

---

### Phase 3：健壮性

**目标**：提升性能和错误处理。每项独立。

#### 3.1 S3 缓存线程安全（P2-1）

| 文件                       | 改动                                 |
| -------------------------- | ------------------------------------ |
| `backends/s3_storage.py` | `get()` 读缓存也加 `_cache_lock` |

#### 3.2 Event loop 复用（P2-2）

| 文件                       | 改动                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `backends/s3_storage.py` | `_run_async` 改为共享一个持久 event loop thread（或直接用同步 boto3） |

**推荐方案**：直接用 `boto3` 同步 API（`_s3_sync = boto3.client('s3')`），去掉 async bridge。MUT handler 已经在 `asyncio.to_thread` 中运行，不需要内部再起 event loop。

#### 3.3 post-push hook 异步化（P2-3）

| 文件                                                 | 改动                                                   |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `routers/protocol_router.py` + `access_point.py` | `run_post_push_hook` 包在 `asyncio.to_thread()` 中 |

**注意**：Phase 1 完成后，graft 已在 push 流程内部同步执行。post-push hook 的其他部分（审计日志等）可异步化。

#### 3.4 tree_reader 路径导航（P2-5 + P2-13）

| 文件                                          | 改动                                                              |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `services/tree_reader.py` `_resolve_blob` | 按路径段逐层导航 tree（O(depth)），不展平整棵树（O(n)）           |
| `services/ops.py`                           | 新增 `cat(project_id, path)` → 一次导航返回 content + metadata |

#### 3.5 错误码细化（P2-9）

| 文件                           | 改动                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `routers/content_history.py` | 区分 `ValueError` → 400、`ObjectNotFoundError` → 404、`StorageError` → 500 |

#### 3.6 hook 异常日志（P2-10）

| 文件                                        | 改动                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `services/ops.py` + `services/hooks.py` | `except Exception: pass` → `except Exception as e: log_error(...)` |

#### 3.7 scope_hash fallback 修复（P2-12）

| 文件                      | 改动                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `server/server_repo.py` | `_scope_hash_from_history` 用 `WHERE scope_path = ?` 过滤，不限 10 条 |

#### 3.8 legacy soft-delete 空文件检查（P2-7）

| 文件                | 改动                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| `services/ops.py` | 删除树内软删除路径；恢复统一走版本历史 |

---

### Phase 4：已知端点 Bug

#### 4.1 DELETE `/content/{pid}/rm` 500

**排查方向**：`ops.delete()` 在 commit_id 迁移后，写入 commit 时可能仍用旧格式。检查 `_make_client().push()` 是否正确传递 `base_commit_id`。

#### 4.2 GET `/content/{pid}/diff` 500

**排查方向**：`admin.compute_diff()` 用 `commit_id` 查 `get_entry`，但 `get_entry` 可能期望不同的参数名。检查 `supabase_history.get_entry()` 的查询字段名。

---

## 四、实施顺序与依赖

```
Phase 0（基础设施）     ← 无依赖，可立即开始
  0.1 S3 异常传播       ← 阻塞 Phase 1（CAS 依赖写入可靠性）
  0.2 单一写入路径      ← 阻塞 Phase 1（所有 push 走同一路径）
  0.3 EphemeralClient   ← 独立

Phase 1（CAS 并发控制）  ← 依赖 0.1 + 0.2
  1.1 ServerRepo 改造   ← 阻塞 1.2/1.3/1.4
  1.2 handle_push CAS   ← 核心
  1.3 handle_rollback   ← 依赖 1.1
  1.4 Graft CAS         ← 依赖 1.1

Phase 2（安全）          ← 与 Phase 1 并行
  2.1-2.8 各项独立      ← 可分配给不同开发者

Phase 3（健壮性）        ← Phase 1 完成后
  3.1-3.8 各项独立      ← 可分配给不同开发者

Phase 4（端点 Bug）      ← Phase 1 完成后可能自动修复
```

```
时间线估算：
  Phase 0: 1 天
  Phase 1: 2-3 天（核心，需仔细测试）
  Phase 2: 1-2 天（8 项独立改动）
  Phase 3: 2-3 天（8 项独立改动）
  Phase 4: 0.5 天（可能被 Phase 1 连带修复）
  总计: 7-10 天
```

---

## 五、测试策略

### Phase 0 测试

| 测试                         | 验证                                                   |
| ---------------------------- | ------------------------------------------------------ |
| S3 put 失败 → push 500      | mock S3 unavailable → 确认 push 返回 500 而非静默成功 |
| Agent push → root_hash 更新 | Agent push 后 root scope clone 能看到                  |
| EphemeralClient merge        | 两 agent 交替 push 10 轮 → 不丢文件                   |

### Phase 1 测试

| 测试                       | 验证                                                 |
| -------------------------- | ---------------------------------------------------- |
| 同 scope 改不同文件        | A 改 a.md + B 改 b.md → 两文件都在                  |
| 同 scope 改同文件          | A 改 readme + B 改 readme → 三方合并                |
| 不同 scope 并发            | docs/ push + src/ push → 互不阻塞                   |
| 嵌套 scope                 | root 改 config + docs/ push → 两边都保留            |
| 子写父读                   | docs/ push → root clone → 看到新文件               |
| CAS 风暴（压力测试）       | 10 client 同时 push 同 scope → 全部成功，无数据丢失 |
| Rollback CAS               | rollback 后 root_hash 正确、其他 scope 可见          |
| push 响应含 merged_changes | 合并发生时返回变更清单                               |

### Phase 2 测试

每个 P1 项对应一个安全测试（已有 5 个在 `test_bug_fixes.py` 中）。

### 回归测试

所有改动完成后，运行完整 E2E 8 套（当前 359+ tests）+ MUT 单元测试（426 tests）。

---

## 六、风险与回退

| 风险                     | 缓解                                           |
| ------------------------ | ---------------------------------------------- |
| CAS 实现引入新 bug       | 先在 staging 跑完整 E2E，再上 production       |
| 性能退化（CAS 重试过多） | 监控 push 延迟 P99；MAX_CAS_RETRIES=3 限制重试 |
| S3 异常传播导致误拒绝    | 区分 transient（重试）和 permanent（拒绝）错误 |
| 旧客户端不兼容           | 协议 v2 gate 已在位；旧客户端得到明确升级提示  |

**回退策略**：每个 Phase 独立分支，通过 PR 合并。如果某个 Phase 出问题，revert 该 PR 即可。Phase 间没有数据格式变更（commit_id 迁移已在 04-17 完成），回退不会导致数据损坏。

---

## 七、改动文件汇总

| Phase | 文件                                                                      | 改动类型                      |
| ----- | ------------------------------------------------------------------------- | ----------------------------- |
| 0.1   | `backends/s3_storage.py`                                                | 重构（异常处理）              |
| 0.1   | `mut/server/graft.py`                                                   | 重构（异常处理）              |
| 0.2   | `services/ops.py`                                                       | 新增 `push_and_finalize`    |
| 0.2   | `connectors/agent/service.py`                                           | 调用路径修改                  |
| 0.2   | `connectors/agent/sandbox_session.py`                                   | 调用路径修改                  |
| 0.2   | `connectors/sandbox_endpoint/router.py`                                 | 调用路径修改                  |
| 0.3   | `services/ephemeral_client.py`                                          | merge 后 pull                 |
| 1.1   | `server/server_repo.py`                                                 | 重构（移除锁，新增 CAS 方法） |
| 1.1   | `server/repo_manager.py`                                                | 重构（per-request 创建）      |
| 1.2   | `mut/server/handlers.py`                                                | 重写 handle_push              |
| 1.3   | `mut/server/handlers.py`                                                | 重写 handle_rollback          |
| 1.4   | `mut/server/graft.py`                                                   | 新增 CAS graft                |
| 1.4   | `services/hooks.py`                                                     | 调用新 graft                  |
| 2.1   | `server/auth.py`                                                        | scope fallback                |
| 2.2   | `routers/audit_router.py`                                               | 权限检查                      |
| 2.3   | `server/validation.py` + `routers/content_write.py` + `handlers.py` | 大小限制                      |
| 2.4   | `services/ops.py` + `routers/content_write.py`                        | validate_path                 |
| 2.5   | `server/auth.py`                                                        | status check                  |
| 2.6   | `server/auth.py`                                                        | SKIP_AUTH                     |
| 2.7   | `server/auth.py` + `routers/access_point.py`                          | user_identity                 |
| 2.8   | `mut/core/scope.py`                                                     | path 安全                     |
| 3.1   | `backends/s3_storage.py`                                                | 缓存线程安全                  |
| 3.2   | `backends/s3_storage.py`                                                | event loop / 同步 S3          |
| 3.3   | `routers/protocol_router.py` + `access_point.py`                      | async hook                    |
| 3.4   | `services/tree_reader.py` + `services/ops.py`                         | 路径导航                      |
| 3.5   | `routers/content_history.py`                                            | 错误码                        |
| 3.6   | `services/ops.py` + `services/hooks.py`                               | 异常日志                      |
| 3.7   | `server/server_repo.py`                                                 | scope fallback 修复           |
| 3.8   | `services/ops.py`                                                       | legacy soft-delete 清理       |
| 4.1   | 排查 `ops.delete`                                                       | bug fix                       |
| 4.2   | 排查 `admin.compute_diff`                                               | bug fix                       |

**总计**：~25 个文件，4 个 Phase，每个 Phase 一个 PR。
