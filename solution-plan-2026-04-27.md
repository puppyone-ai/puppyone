# 多租户隔离 + 性能 一日彻底修复方案

**日期**：2026-04-27
**目标**：当天闭合 3 Critical + 3 Major 安全洞 + 5 性能瓶颈，并落地 4 层架构基础设施。
**原则**：每条修复都给出根因、代码改动、迁移脚本、测试计划、回滚路径。

---

## 0. 执行顺序与依赖图

```
Step 0 (1h)  ─ Principal + RequestScope + Supabase client 拆分（基础设施）
              ↓
Step 1 (2h)  ─ C-1 / C-2 / C-3 接入 Principal 校验（生产越权立刻闭合）
              ↓
Step 2 (1h)  ─ M-1 visibility / M-2 OAuth state / M-3 Scheduler re-resolve
              ↓
Step 3 (2h)  ─ RLS migration + 启用（物理边界）
              ↓
Step 4 (1.5h)─ P-1 dashboard async / P-3 count 查询 / P-5 inline node info
              ↓
Step 5 (0.5h)─ P-6 token memo / P-7 polling 调整
              ↓
Step 6 (1h)  ─ E2E 越权回归 + 性能基准 + 文档
```

**总预估 9 小时**。Step 0 和 Step 4-5 可由两人并行（架构 vs 性能），缩短到 6h。

---

## Section A · 架构基础设施（Step 0）

### A.1 Unified Principal 模型

**根因**：7 种信任根没有公共抽象，所有下游代码看到的 `who` 类型不一致，每个 endpoint 都要重复判断身份来源。

**新文件 `backend/src/platform/auth/principal.py`**：

```python
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal, Optional

PrincipalType = Literal['user', 'access_key', 'internal', 'anonymous']

@dataclass(frozen=True)
class Principal:
    type: PrincipalType
    user_id: Optional[str] = None
    org_ids: tuple[str, ...] = ()
    access_key_id: Optional[str] = None
    access_key_project_id: Optional[str] = None  # access_key 锁定的 project
    access_key_scope: Optional[dict] = None       # path / mode 等
    internal_caller: Optional[str] = None         # 内部 RPC 调用方标识
    acting_user_id: Optional[str] = None          # 内部 RPC 代行的 user

    @property
    def is_user(self) -> bool:
        return self.type == 'user'

    @property
    def effective_user_id(self) -> Optional[str]:
        """user_id 用于授权决策时的统一入口。
        - user principal: user_id
        - access_key principal: 不暴露 user_id（access key 不代表自然人）
        - internal: acting_user_id（必须显式声明）
        """
        if self.type == 'user':
            return self.user_id
        if self.type == 'internal':
            return self.acting_user_id
        return None

class MissingPrincipalError(RuntimeError): ...
class CrossTenantError(PermissionError): ...
```

**契约**：
- `effective_user_id is None` 时禁止做用户级授权决策。
- `Internal` 类型必须传 `acting_user_id`，否则在 dependency 处直接 reject。
- `AccessKey` 不暴露 user，`access_key_project_id` 锁死操作 scope。

---

### A.2 RequestScope contextvar

**改 `backend/src/utils/request_context.py`**，新增 principal 字段：

```python
from contextvars import ContextVar
from dataclasses import dataclass
from .principal import Principal

@dataclass
class RequestScope:
    request_id: str
    principal: Principal
    trace_id: str
    intent: str = "read"  # 'read' | 'write' | 'privileged'

_scope_var: ContextVar[Optional[RequestScope]] = ContextVar('request_scope', default=None)

def get_scope() -> RequestScope:
    s = _scope_var.get()
    if s is None:
        raise MissingPrincipalError("RequestScope not bound — middleware missed?")
    return s

def set_scope(scope: RequestScope):
    _scope_var.set(scope)

def get_principal() -> Principal:
    return get_scope().principal
```

**新 middleware `backend/src/platform/auth/middleware.py`**：

```python
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from .principal import Principal
from .resolvers import resolve_principal_from_request
from utils.request_context import set_scope, RequestScope

class PrincipalMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 跳过白名单
        if request.url.path in {"/health", "/readiness"} or request.url.path.startswith("/p/"):
            principal = Principal(type='anonymous')
        else:
            principal = await resolve_principal_from_request(request)
        scope = RequestScope(
            request_id=request.headers.get("x-request-id", ""),
            principal=principal,
            trace_id=request.headers.get("x-trace-id", ""),
        )
        set_scope(scope)
        return await call_next(request)
```

**`resolvers.py`**：把 7 种信任根统一收敛：

```python
async def resolve_principal_from_request(request: Request) -> Principal:
    # 1. Internal Secret + acting user
    if (secret := request.headers.get("X-Internal-Secret")):
        if secret != settings.INTERNAL_SECRET:
            raise HTTPException(403, "Invalid internal secret")
        acting = request.headers.get("X-Acting-User-Id")
        if not acting:
            raise HTTPException(400, "Internal calls must declare X-Acting-User-Id")
        return Principal(type='internal', acting_user_id=acting,
                         internal_caller=request.headers.get("X-Internal-Caller", "unknown"))

    # 2. MUT Access Key (URL-bound)
    if "/mut/ap/" in request.url.path:
        # access key 在 router 内部 resolve，middleware 标记为 anonymous，由 router 重写
        return Principal(type='anonymous')

    # 3. Bearer JWT
    if (token := _extract_bearer(request.headers)):
        try:
            user_id = verify_jwt_local(token)  # 已实现
        except InvalidJWTError:
            user_id = await verify_jwt_remote(token)  # JWKS fallback
        org_ids = tuple(await fetch_user_orgs(user_id))  # 缓存 5 分钟
        return Principal(type='user', user_id=user_id, org_ids=org_ids)

    # 4. MCP API Key
    if (mcp_key := request.headers.get("X-MCP-Key")):
        ap = await resolve_mcp_key(mcp_key)
        if ap is None:
            raise HTTPException(401)
        return Principal(type='access_key', access_key_id=ap.id,
                         access_key_project_id=ap.project_id, access_key_scope=ap.scope)

    return Principal(type='anonymous')
```

**`main.py` 注册**：
```python
app.add_middleware(PrincipalMiddleware)
```

---

### A.3 Supabase Client 拆分

**根因**：所有代码都用一把 service-role key，RLS 形同虚设。

**改 `backend/src/infra/supabase/client.py`**：

```python
from supabase import create_client, Client
from settings import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

_system_singleton: Client | None = None

def system_client() -> Client:
    """ONLY for: background jobs, scheduler, internal RPC, migrations.
    Bypasses RLS. Must be paired with explicit tenant filters.
    """
    global _system_singleton
    if _system_singleton is None:
        _system_singleton = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _system_singleton

def user_client(jwt: str) -> Client:
    """Per-request client carrying user JWT.
    Subject to RLS. Use this for ALL user-initiated reads/writes.
    """
    c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    c.postgrest.auth(jwt)
    c.realtime.set_auth(jwt)
    return c

def get_client_for_principal(principal: Principal, jwt: Optional[str] = None) -> Client:
    """Helper：根据 Principal 自动选择正确 client。"""
    if principal.type == 'user' and jwt:
        return user_client(jwt)
    return system_client()
```

**全局搜索替换规则**：
- 用户路径（router → service）：改用 `get_user_client_dep()` dependency，从 request header 取 JWT
- background / scheduler / mut 内部：明确写 `system_client()`

**关键文件改动清单**：
- `connectors/agent/config/repository.py`
- `connectors/datasource/router.py`
- `platform/project/router.py`
- `platform/project/dashboard_router.py`
- `mut_engine/services/*` 全部改 `system_client()`（mut 是内部协议层）
- `internal/router.py` 全部 `system_client()`

---

### A.4 RLS Migration（物理边界）

**新 migration `supabase/migrations/20260427000000_enable_rls.sql`**：

```sql
-- ── projects ────────────────────────────────────────────────────────
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- service_role 完全 bypass（system_client 用）
CREATE POLICY "projects_service_role_all" ON projects
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 用户可读所属 org 的项目
CREATE POLICY "projects_user_select_own_org" ON projects
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- 用户可写自己 org 内、且自己是 member 的私有项目，或 org 公开项目
CREATE POLICY "projects_user_write_in_org" ON projects
  FOR ALL TO authenticated USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      visibility = 'org'
      OR id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- ── agent_profiles ──────────────────────────────────────────────────
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_service_role_all" ON agent_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 用户可读：项目可见 + (visibility='org' 或 自己是 owner)
CREATE POLICY "agents_user_select" ON agent_profiles
  FOR SELECT TO authenticated USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    )
    AND (
      (config->>'visibility')::text = 'org'
      OR (config->>'visibility') IS NULL  -- 默认 org-visible
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "agents_user_write" ON agent_profiles
  FOR ALL TO authenticated USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    created_by = auth.uid()
  );

-- ── access_points ───────────────────────────────────────────────────
ALTER TABLE access_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ap_service_role_all" ON access_points
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "ap_user_select" ON access_points
  FOR SELECT TO authenticated USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "ap_user_write" ON access_points
  FOR INSERT TO authenticated WITH CHECK (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "ap_user_update_delete" ON access_points
  FOR UPDATE TO authenticated USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    )
  );

-- ── mut_commits / mut_branches / mut_tags ───────────────────────────
ALTER TABLE mut_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE mut_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE mut_tags ENABLE ROW LEVEL SECURITY;

-- mut 是内部协议层，仅允许 service_role；user 一律走 mut_engine 接口（接口里做授权）
CREATE POLICY "mut_commits_service_only" ON mut_commits FOR ALL TO service_role USING (true);
CREATE POLICY "mut_branches_service_only" ON mut_branches FOR ALL TO service_role USING (true);
CREATE POLICY "mut_tags_service_only" ON mut_tags FOR ALL TO service_role USING (true);

-- ── audit_logs ─────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_service_only" ON audit_logs FOR ALL TO service_role USING (true);
-- 用户不直接读 audit_logs，通过 admin endpoint

-- ── oauth_states (新表，M-2 用) ─────────────────────────────────────
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  provider TEXT NOT NULL,
  redirect_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oauth_states_service_only" ON oauth_states FOR ALL TO service_role USING (true);
```

**Migration 验证**：
```bash
supabase db reset  # 干净 schema
supabase db push   # 应用所有 migration
psql -f tests/sql/rls_smoke.sql  # 见 Section F
```

---

## Section B · Critical 安全闭合（Step 1）

### B.1 C-1：MUT JWT 不验项目归属

**根因**：`mut_engine/server/auth.py` 的 `_try_jwt()` 验完 JWT 直接给 root rw，绕过项目归属检查。

**改 `backend/src/mut_engine/server/auth.py:64-69`**：

```python
async def _try_jwt(self, request: Request, project_id: str) -> Optional[dict]:
    token = _extract_bearer(request.headers)
    if not token:
        return None
    try:
        user_id = verify_jwt_local(token)
    except InvalidJWTError:
        try:
            user_id = await verify_jwt_remote(token)
        except Exception:
            return None

    # NEW — 强制项目归属校验
    has_access = await verify_project_access(user_id, project_id)
    if not has_access:
        log_warn(f"jwt_user_not_member project={project_id} user={user_id}")
        # 返回 403 而不是 None，避免 fall through 到下一个认证方式
        raise HTTPException(403, "Not a member of this project")

    return {
        "type": "user",
        "user_id": user_id,
        "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
    }
```

**`verify_project_access` 实现**（如已存在则复用）：

```python
# platform/project/access.py
async def verify_project_access(user_id: str, project_id: str) -> bool:
    """单一权威：用户是否能访问项目。"""
    # 5 秒级缓存（contextvar），避免一次请求内重复查
    cache = _project_access_cache_var.get()
    key = (user_id, project_id)
    if key in cache:
        return cache[key]

    sb = system_client()
    proj = sb.table("projects").select("org_id, visibility").eq("id", project_id).single().execute()
    if not proj.data:
        cache[key] = False
        return False

    org_id, visibility = proj.data["org_id"], proj.data.get("visibility", "org")

    is_org_member = sb.table("org_members").select("user_id").eq("org_id", org_id).eq("user_id", user_id).maybe_single().execute()
    if not is_org_member.data:
        cache[key] = False
        return False

    if visibility == "private":
        is_proj_member = sb.table("project_members").select("user_id").eq("project_id", project_id).eq("user_id", user_id).maybe_single().execute()
        cache[key] = bool(is_proj_member.data)
    else:
        cache[key] = True
    return cache[key]
```

**测试**：
```python
# tests/security/test_c1_mut_jwt.py
def test_jwt_user_cannot_access_other_org_project(client, user_a_jwt, project_b_other_org):
    resp = client.get(f"/api/v1/mut/{project_b_other_org}", headers={"Authorization": f"Bearer {user_a_jwt}"})
    assert resp.status_code == 403

def test_jwt_user_can_access_own_project(client, user_a_jwt, project_a):
    resp = client.get(f"/api/v1/mut/{project_a}", headers={"Authorization": f"Bearer {user_a_jwt}"})
    assert resp.status_code == 200
```

---

### B.2 C-2：list_agents 不校验

**根因**：router 只验登录、不验项目归属；service 层假装 RLS 处理但 RLS 没启。

**新 dependency `backend/src/platform/auth/deps.py`**：

```python
from fastapi import Depends, Query, HTTPException
from .principal import Principal
from utils.request_context import get_principal
from platform.project.access import verify_project_access

async def require_project_access(project_id: str = Query(...)) -> str:
    """通用 dependency：当前 principal 必须能访问 project_id。返回 project_id。"""
    p = get_principal()

    if p.type == 'user':
        if not await verify_project_access(p.user_id, project_id):
            raise HTTPException(403, "Not a member of this project")
        return project_id

    if p.type == 'access_key':
        # access key 锁定单个 project，不允许越界
        if p.access_key_project_id != project_id:
            raise HTTPException(403, "Access key not scoped to this project")
        return project_id

    if p.type == 'internal':
        if not p.acting_user_id:
            raise HTTPException(400, "Internal call missing acting user")
        if not await verify_project_access(p.acting_user_id, project_id):
            raise HTTPException(403, "Acting user not a member")
        return project_id

    raise HTTPException(401)
```

**改 `connectors/agent/config/router.py:84-94`**：

```python
@router.get("/")
async def list_agents(
    project_id: str = Depends(require_project_access),
):
    return await service.list_agents(project_id)
```

**同样应用到所有 agent endpoints**：`POST /agents`, `PATCH /agents/{id}`, `DELETE /agents/{id}` —— 都改成依赖 `require_project_access`。

**全局批量审查**：
```bash
grep -rn "project_id: str" backend/src/connectors backend/src/platform | grep -v "Depends(require_project_access)"
```
所有结果都需逐个加上 dependency 或显式说明（如 mut access key 路径）。

---

### B.3 C-3：/internal/* 无 tenant 校验

**根因**：内部服务持 secret 即可任意操作 project，secret 泄露 = 跨租户。

**改 `backend/src/internal/router.py`**：

```python
from platform.auth.deps import require_project_access

@router.get("/nodes/list")
async def internal_list_nodes(
    project_id: str = Depends(require_project_access),  # 内部 acting_user_id 也走同一逻辑
):
    return ops.list_dir(project_id, "")
```

**所有 `/internal/*` endpoint 必须**：
1. 通过 `PrincipalMiddleware` 解析（已有 `X-Internal-Secret` 校验）
2. 通过 `require_project_access` 校验 acting_user_id 与 project_id 的关系
3. 任何 endpoint 涉及 project_id 都不允许跳过此校验

**调用方改造**（mcp_service / cron_service 等）：
```python
# 调用 internal API 时必须带这两个 header
headers = {
    "X-Internal-Secret": settings.INTERNAL_SECRET,
    "X-Acting-User-Id": resolved_user_id,  # 从 access_point.created_by 或 job.user_id 推导
    "X-Internal-Caller": "mcp_service",
}
```

---

## Section C · Major 安全闭合（Step 2）

### C.1 M-1：agent visibility

**根因**：visibility 字段从未在 schema 落地，但代码语义假设它存在。

**Migration `supabase/migrations/20260427000100_agent_visibility.sql`**：

```sql
-- 注：visibility 已存在 config jsonb 中，提升为列以便 RLS 直接用
ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'org'
    CHECK (visibility IN ('org', 'private'));

-- 从 config 回填（兼容历史数据）
UPDATE agent_profiles
  SET visibility = COALESCE((config->>'visibility')::text, 'org')
  WHERE visibility = 'org';

CREATE INDEX idx_agents_visibility_creator ON agent_profiles(visibility, created_by);
```

**改 `connectors/agent/config/repository.py:367-385`**：

```python
async def verify_access(self, user_id: str, agent_id: str) -> bool:
    sb = system_client()
    agent = sb.table("agent_profiles").select("project_id, visibility, created_by").eq("id", agent_id).single().execute()
    if not agent.data:
        return False
    a = agent.data

    # 项目级访问必须先满足
    if not await verify_project_access(user_id, a["project_id"]):
        return False

    # private agent 只有 owner 可见
    if a["visibility"] == 'private' and a["created_by"] != user_id:
        return False
    return True
```

**前端**：在 `AgentManageDialog` 增加 visibility toggle（org / private）。

---

### C.2 M-2：OAuth state CSRF

**根因**：state 客户端生成、服务端不存、callback 不校验。

**Migration**：见 A.4 中的 `oauth_states` 表（已包含）。

**改 `connectors/datasource/oauth/router.py`**：

```python
import secrets

@router.post("/initiate")
async def initiate_oauth(
    request: OAuthInitiateRequest,
    current_user: User = Depends(get_current_user),
):
    state = secrets.token_urlsafe(32)
    sb = system_client()
    sb.table("oauth_states").insert({
        "state": state,
        "user_id": current_user.user_id,
        "provider": request.provider,
        "redirect_uri": request.redirect_uri,
    }).execute()
    return {"state": state, "auth_url": build_auth_url(request.provider, state)}

@router.post("/callback")
async def oauth_callback(
    request: OAuthCallbackRequest,  # 增加 state: str 字段
    current_user: User = Depends(get_current_user),
):
    sb = system_client()
    # 原子取出 + 删除（防重放）
    rec = sb.table("oauth_states").select("*").eq("state", request.state).single().execute()
    if not rec.data:
        raise HTTPException(400, "Invalid or expired state")
    if rec.data["user_id"] != current_user.user_id:
        raise HTTPException(403, "State user mismatch")
    if datetime.fromisoformat(rec.data["expires_at"]) < datetime.utcnow():
        sb.table("oauth_states").delete().eq("state", request.state).execute()
        raise HTTPException(400, "State expired")

    sb.table("oauth_states").delete().eq("state", request.state).execute()  # 一次性
    return await service.handle_callback(
        user_id=current_user.user_id,
        code=request.code,
        provider=rec.data["provider"],
    )
```

**清理任务**（每小时跑）：
```sql
DELETE FROM oauth_states WHERE expires_at < now();
```

---

### C.3 M-3：Scheduler 用 created_by

**根因**：job 持久化 `created_by` 当永久身份，creator 退组后仍跑。

**改 `backend/src/infra/scheduler/jobs/agent_job.py:44-63`**：

```python
async def execute(self):
    project_id = self.job_data["project_id"]
    persisted_user_id = self.job_data.get("created_by")

    # NEW — 执行前重新解析有效 principal
    if persisted_user_id:
        if not await verify_project_access(persisted_user_id, project_id):
            log_error(f"scheduler_principal_invalid job={self.job_id} user={persisted_user_id} project={project_id}")
            await self._mark_failed(reason="principal_invalid")
            await self._notify_org_owner(project_id, persisted_user_id)
            return

    # 正常执行（用 system_client + 显式 user_id）
    principal = Principal(type='internal', acting_user_id=persisted_user_id, internal_caller='scheduler')
    set_scope(RequestScope(request_id=f"job-{self.job_id}", principal=principal, trace_id=""))
    try:
        await self._run_with_principal(principal)
    finally:
        # contextvar 自动清除（任务结束）
        pass
```

**`_notify_org_owner`**：往 `notifications` 表写一条「Job X 因创建者 Y 已离开项目而失败」，前端 UI 展示给 org owner。

---

## Section D · 性能修复（Step 4-5）

### D.1 P-1：dashboard 串行 → 并行

**改 `backend/src/platform/project/dashboard_router.py:95-135`**：

```python
import asyncio
from fastapi.concurrency import run_in_threadpool

@router.get("/{project_id}/dashboard")
async def get_project_dashboard(
    project_id: str = Depends(require_project_access),
):
    # 并行 4 个独立查询
    counts, aps, tools, uploads = await asyncio.gather(
        _compute_node_counts(project_id),       # 见 D.2
        run_in_threadpool(_fetch_access_points_sync, project_id),
        run_in_threadpool(_fetch_tools_sync, project_id),
        run_in_threadpool(_fetch_uploads_sync, project_id),
        return_exceptions=True,
    )

    # 单条失败不影响整体
    return DashboardResponse(
        nodes=counts if not isinstance(counts, Exception) else _empty_counts(),
        access_points=aps if not isinstance(aps, Exception) else [],
        tools=tools if not isinstance(tools, Exception) else [],
        uploads=uploads if not isinstance(uploads, Exception) else [],
        partial_failure=any(isinstance(x, Exception) for x in [counts, aps, tools, uploads]),
    )
```

**Threadpool 容量调优**：FastAPI 默认 40，但 supabase-py 是同步，重 IO 时容易打满。在 `main.py`：

```python
import anyio
# 启动时调大
import asyncio
asyncio.get_event_loop().set_default_executor(ThreadPoolExecutor(max_workers=80))
```

---

### D.2 P-3：去掉 `list_tree(max_depth=-1)`

**根因**：用整树遍历算文件夹/文件数，O(N) 全量节点扫描。

**方案**：mut_engine 增加 count-only API。

**新接口 `backend/src/mut_engine/services/ops.py`**：

```python
async def count_nodes_by_type(project_id: str) -> dict[str, int]:
    """直接 SQL count，不实例化 Node 对象。"""
    sb = system_client()
    res = sb.rpc("mut_count_nodes_by_type", {"p_project_id": project_id}).execute()
    return {row["type"]: row["count"] for row in res.data}
```

**SQL function**（migration `20260427000200_mut_count_fn.sql`）：

```sql
CREATE OR REPLACE FUNCTION mut_count_nodes_by_type(p_project_id UUID)
RETURNS TABLE(type TEXT, count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE WHEN (entry->>'type') = 'folder' THEN 'folder' ELSE 'file' END AS type,
    COUNT(*)::BIGINT AS count
  FROM mut_tree_state, LATERAL jsonb_array_elements(tree) AS entry
  WHERE project_id = p_project_id
  GROUP BY 1;
$$;
```

**改 `dashboard_router.py:138-146`**：

```python
async def _compute_node_counts(project_id: str) -> NodeCounts:
    counts = await ops.count_nodes_by_type(project_id)
    return NodeCounts(folder=counts.get("folder", 0), file=counts.get("file", 0),
                      total=sum(counts.values()))
```

**预期**：4-7 s → 600-900 ms（4 个并行约 200-250 ms 各，最慢的就是结果耗时）。

---

### D.3 P-5：AgentContext 二次 round-trip

**根因**：`/api/v1/agent-config/?project_id=...` 返回 agent 列表，前端再发 `fetchNodeInfoBatch` 拿 node 名称。

**后端改 `connectors/agent/config/router.py`**：在 list 响应里 inline 节点信息。

```python
@router.get("/")
async def list_agents(project_id: str = Depends(require_project_access)):
    agents = await service.list_agents(project_id)
    # 收集所有引用的 node id
    node_ids = {ap["node_id"] for a in agents for ap in (a.get("bash_accesses") or [])}
    if node_ids:
        nodes_map = await ops.batch_resolve_nodes(project_id, list(node_ids))
    else:
        nodes_map = {}
    # inline 到响应
    for a in agents:
        for ap in a.get("bash_accesses") or []:
            node = nodes_map.get(ap["node_id"])
            if node:
                ap["node_name"] = node.name
                ap["node_type"] = node.type
    return agents
```

**前端改 `frontend/contexts/AgentContext.tsx:207-280`**：去掉 `fetchNodeInfoBatch` 调用：

```typescript
// 旧：
const agents = await fetchAgents(projectId);
const nodeInfo = await fetchNodeInfoBatch(projectId, allNodeIds);  // ← 删除
const enriched = agents.map(a => enrichWithNodeInfo(a, nodeInfo));

// 新：
const agents = await fetchAgents(projectId);
// agents 已包含 node_name / node_type
setSavedAgents(agents);
```

---

### D.4 P-6：getAuthToken memoization

**根因**：每次 fetch 都 await session lookup，10 个并发请求 = 10 次 session 查。

**改 `frontend/lib/apiClient.ts:33-77`**：

```typescript
let inflightToken: Promise<string | null> | null = null;

async function getAuthToken(): Promise<string | null> {
  // 同一 microtask burst 内复用
  if (inflightToken) return inflightToken;
  inflightToken = (async () => {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  })();
  // 当前 microtask 队列结束后清除
  queueMicrotask(() => { inflightToken = null; });
  return inflightToken;
}
```

**进阶**（可选，更稳）：订阅 auth 变更 + cache：

```typescript
let cachedToken: string | null = null;
let cacheValidUntil = 0;

getSupabase().auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token ?? null;
  cacheValidUntil = session?.expires_at ? session.expires_at * 1000 : 0;
});

async function getAuthToken(): Promise<string | null> {
  // 提前 60s 过期，避免边界
  if (cachedToken && Date.now() < cacheValidUntil - 60_000) return cachedToken;
  const { data } = await getSupabase().auth.getSession();
  cachedToken = data.session?.access_token ?? null;
  cacheValidUntil = data.session?.expires_at ? data.session.expires_at * 1000 : 0;
  return cachedToken;
}
```

---

### D.5 P-7：30 s 轮询

**根因**：dashboard SWR `refreshInterval: 30000`，配合 4-7 s 后端 = 2 倍每分钟全负载。

**短期改 `frontend/app/(main)/projects/[projectId]/home/page.tsx:118-122`**：

```typescript
useSWR(`/projects/${projectId}/dashboard`, fetcher, {
  refreshInterval: 0,          // 关闭轮询
  revalidateOnFocus: true,     // 切回 tab 时刷新
  revalidateOnReconnect: true, // 重连时刷新
  keepPreviousData: true,
  dedupingInterval: 5000,
});
```

**中期**（独立 PR）：用 Supabase Realtime 订阅 `mut_commits` 表的 INSERT 推送，事件驱动而非轮询。

---

## Section E · 执行清单

### Step 0 文件改动
- [ ] 新建 `backend/src/platform/auth/principal.py`
- [ ] 新建 `backend/src/platform/auth/middleware.py`
- [ ] 新建 `backend/src/platform/auth/resolvers.py`
- [ ] 新建 `backend/src/platform/auth/deps.py`
- [ ] 改 `backend/src/utils/request_context.py`（加 RequestScope / get_principal）
- [ ] 改 `backend/src/infra/supabase/client.py`（拆 user_client / system_client）
- [ ] 改 `backend/src/main.py`（注册 PrincipalMiddleware）

### Step 1 文件改动
- [ ] 改 `backend/src/mut_engine/server/auth.py:64-69` 加 verify_project_access
- [ ] 改 `backend/src/connectors/agent/config/router.py` 全部 endpoint 接 require_project_access
- [ ] 改 `backend/src/internal/router.py` 全部 endpoint 接 require_project_access
- [ ] 调用方改造：`mcp_service` / `cron_service` 加 `X-Acting-User-Id` header
- [ ] 新建 `backend/src/platform/project/access.py`（如已存在则补全 cache）

### Step 2 文件改动
- [ ] migration `supabase/migrations/20260427000100_agent_visibility.sql`
- [ ] 改 `backend/src/connectors/agent/config/repository.py:367-385`
- [ ] 改 `backend/src/connectors/datasource/oauth/router.py`（initiate / callback）
- [ ] 改 `backend/src/infra/scheduler/jobs/agent_job.py:44-63`
- [ ] 前端 `AgentManageDialog` 加 visibility toggle

### Step 3 文件改动
- [ ] migration `supabase/migrations/20260427000000_enable_rls.sql`
- [ ] 全局搜索改造：所有用户路径 supabase 调用换 `user_client(jwt)`
- [ ] 验证 mut/internal/scheduler 全部用 `system_client()`

### Step 4 文件改动
- [ ] 改 `backend/src/platform/project/dashboard_router.py` async + gather
- [ ] migration `supabase/migrations/20260427000200_mut_count_fn.sql`
- [ ] 改 `backend/src/mut_engine/services/ops.py` 加 `count_nodes_by_type`
- [ ] 改 `backend/src/connectors/agent/config/router.py` inline node info
- [ ] 改 `backend/src/connectors/agent/config/service.py` 加 `batch_resolve_nodes`
- [ ] 改 `frontend/contexts/AgentContext.tsx:207-280` 去掉 fetchNodeInfoBatch

### Step 5 文件改动
- [ ] 改 `frontend/lib/apiClient.ts:33-77` token memo
- [ ] 改 `frontend/app/(main)/projects/[projectId]/home/page.tsx:118-122` 关轮询

---

## Section F · 验证方案

### F.1 安全回归测试套件 `backend/tests/security/test_cross_tenant.py`

```python
# 必须全部 403/401，不能 200
def test_c1_jwt_other_project_mut(client, user_a_jwt, project_b):
    assert client.get(f"/api/v1/mut/{project_b}", headers={"Authorization": f"Bearer {user_a_jwt}"}).status_code == 403

def test_c2_list_agents_other_project(client, user_a_jwt, project_b):
    assert client.get(f"/api/v1/agent-config/?project_id={project_b}",
                      headers={"Authorization": f"Bearer {user_a_jwt}"}).status_code == 403

def test_c3_internal_requires_acting_user(client, project_a):
    # 不带 X-Acting-User-Id
    assert client.get(f"/internal/nodes/list?project_id={project_a}",
                      headers={"X-Internal-Secret": INTERNAL_SECRET}).status_code == 400
    # acting_user 无权限
    assert client.get(f"/internal/nodes/list?project_id={project_a}",
                      headers={"X-Internal-Secret": INTERNAL_SECRET,
                               "X-Acting-User-Id": str(USER_C_NO_ACCESS)}).status_code == 403

def test_m1_private_agent_not_visible_to_org_member(client, user_b_jwt, private_agent_owned_by_a):
    # B 是同 org member 但不是 agent 创建者
    assert client.get(f"/api/v1/agent-config/{private_agent_owned_by_a}",
                      headers={"Authorization": f"Bearer {user_b_jwt}"}).status_code == 403

def test_m2_oauth_callback_invalid_state(client, user_a_jwt):
    assert client.post("/api/v1/oauth/callback",
                       json={"code": "x", "state": "fake-state"},
                       headers={"Authorization": f"Bearer {user_a_jwt}"}).status_code == 400

def test_m3_scheduler_skips_when_creator_left(scheduler, agent_job_with_removed_creator):
    result = await scheduler.execute(agent_job_with_removed_creator)
    assert result.status == "principal_invalid"
```

### F.2 RLS smoke test `tests/sql/rls_smoke.sql`

```sql
-- 模拟 user A 的 JWT，应只看到自己 org 的项目
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"user-a-uuid","role":"authenticated"}';
SELECT count(*) FROM projects;  -- 应等于 user A 所在 org 的项目数

-- service_role 可看全部
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT count(*) FROM projects;  -- 全表
```

### F.3 性能基准

```bash
# 修复前
ab -n 50 -c 5 -H "Authorization: Bearer $TOKEN" \
   "http://localhost:8000/api/v1/projects/$PROJ_ID/dashboard"
# 期望 p95: 4000-7000 ms

# 修复后
# 期望 p95: < 800 ms
```

### F.4 监控指标

部署后第一周加监控：
- `cross_tenant_denied_total{reason}` Prometheus counter
- `dashboard_latency_seconds` histogram
- `principal_resolve_failures_total{type}` counter

任何 `cross_tenant_denied_total` 增量 → 立刻告警（可能是绕过尝试）。

---

## Section G · 风险与回滚

| 改动 | 风险 | 缓解 |
|------|------|------|
| RLS 启用 | 用户路径如未切 user_client 会全部 400 / empty result | 灰度：先在 staging 跑全量 e2e；prod 启用前 24h 监控 service_role 调用占比 |
| Supabase client 拆分 | 漏改一处会绕过 RLS 或反过来无法读 | 全局 grep 审查 + lint 规则禁止直接 import `client.supabase` |
| `verify_project_access` cache | 缓存太久 → 离组后仍能访问 | TTL 5 s（contextvar 仅请求内有效）|
| Threadpool 80 workers | 过高内存 | 监控 RSS + 后端 OOM；保守起见 60 |
| OAuth state 表 | 高并发写入 | state 主键索引 + expires_at 索引；每小时清理过期 |
| dashboard count function | jsonb_array_elements 在大 project 慢 | 加 `mut_tree_state(project_id)` 索引；超过阈值降级回 list_tree |

**回滚预案**：每个 PR 独立可 revert；最后一道保险是 `feature flag MULTITENANT_HARDENING_ENABLED` 在 `main.py` 控制 PrincipalMiddleware 启停。

---

## Section H · 文档产出

修复落地后必须更新：
- `backend/docs/security/multi-tenant-isolation.md`：架构图 + 7 种信任根 → Principal 收敛说明
- `backend/docs/security/policy-cookbook.md`：require_project_access 用法、新增 endpoint checklist
- `CONTRIBUTING.md`：新增 endpoint 必须声明 `Depends(require_project_access)` 或显式说明为什么不需要

---

## 总览：今日交付物

| 类别 | 数量 |
|------|------|
| 新建文件 | 5（principal.py / middleware.py / resolvers.py / deps.py / access.py）|
| 修改文件 | 12 后端 + 3 前端 |
| 数据库 migration | 3 个（RLS / agent_visibility / mut_count_fn）|
| 测试套件 | 1 安全回归 + 1 RLS smoke + 1 性能基准 |
| 文档 | 3 篇（isolation / cookbook / contributing 更新）|

**完成定义**：
1. 6 条已知越权（C-1/2/3, M-1/2/3）经回归测试全部 403
2. dashboard p95 < 1 s
3. RLS 在 6 张关键表全部启用，service_role 仅用于 background
4. 监控就位，跨租户拒绝事件可观测
