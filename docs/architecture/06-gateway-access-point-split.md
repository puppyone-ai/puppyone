# 06 — Gateway / Access Point 拆分设计

> 版本: v1.0 | 日期: 2026-04-11

---

## 1. 动机

现有架构中，`access_points` 表承载了三个不同关注点：

1. **第三方账号绑定**（OAuth token、数据库连接串）
2. **同步配置**（方向、触发器、过滤器）
3. **MUT 协议入口**（access_key、scope、权限）

这导致：
- 删除项目/repo → 删 access_point → OAuth 绑定丢失 → 下次需重新授权
- 一张表字段过多（22+ 列），不同 provider 用不同子集
- 用户难以理解 "access point" 同时代表 Gmail 连接和 MUT 入口

---

## 2. 核心设计

拆成两层：

```
┌─────────────────────────────────────────────────┐
│  Gateway（账号绑定层）                            │
│                                                  │
│  职责：第三方平台 ↔ PuppyOne 的账号互通          │
│  生命周期：跟 user/org 走，跨项目复用             │
│  例子：Gmail OAuth、GitHub OAuth、PostgreSQL 连接 │
│                                                  │
│  删项目不影响 gateway                             │
│  新项目可直接复用已有 gateway                     │
└──────────────────┬──────────────────────────────┘
                   │ gateway_id（可选 FK）
                   ▼
┌─────────────────────────────────────────────────┐
│  Access Point（数据流层）                         │
│                                                  │
│  职责：某个数据源 → 某个 MUT repo 的连通配置     │
│  生命周期：跟 project/repo 走                    │
│                                                  │
│  包含：gateway_id、project_id、scope、sync 配置  │
│  暴露：access_key → MUT 协议入口                 │
│                                                  │
│  删 project → 删 access point → gateway 不变     │
└─────────────────────────────────────────────────┘
```

**非第三方类型**（agent / sandbox / mcp / filesystem / direct）不需要 gateway，直接是 access point。

---

## 3. 数据库改动

### 3.1 新建 `gateways` 表

```sql
CREATE TABLE gateways (
    id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id      text NOT NULL REFERENCES organizations(id),
    user_id     uuid NOT NULL,
    provider    text NOT NULL,
    name        text,
    status      text NOT NULL DEFAULT 'active',
    credentials jsonb DEFAULT '{}',
    metadata    jsonb DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gateways_user_provider ON gateways(user_id, provider);
CREATE INDEX idx_gateways_org ON gateways(org_id);
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_gateways
    ON gateways FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `org_id` | 属于哪个组织（跨项目复用的基础） |
| `user_id` | 谁绑定的（一个用户可以有多个同 provider 的 gateway，如两个 Gmail） |
| `provider` | 平台类型：`gmail`、`github`、`notion`、`google_drive`、`database` 等 |
| `credentials` | OAuth token（access_token、refresh_token、expires_at）或数据库连接串 |
| `metadata` | Provider 特有元数据（workspace_name、workspace_id、bot_id 等） |
| `status` | `active`（正常）、`expired`（token 过期）、`revoked`（用户主动断开） |

### 3.2 修改 `access_points` 表

```sql
ALTER TABLE access_points ADD COLUMN gateway_id text REFERENCES gateways(id) ON DELETE SET NULL;
CREATE INDEX idx_access_points_gateway ON access_points(gateway_id);
```

- `gateway_id` 可选：第三方 datasource 类型必填，agent/sandbox/mcp/filesystem/direct 为 NULL
- `ON DELETE SET NULL`：删除 gateway 时，关联的 AP 不被级联删除，而是断开绑定

### 3.3 数据迁移：`oauth_connections` → `gateways`

```sql
INSERT INTO gateways (id, org_id, user_id, provider, name, credentials, metadata)
SELECT
    gen_random_uuid()::text,
    COALESCE(p.default_org_id, (SELECT id FROM organizations LIMIT 1)),
    oc.user_id,
    oc.provider,
    COALESCE(oc.workspace_name, oc.provider),
    jsonb_build_object(
        'access_token', oc.access_token,
        'refresh_token', oc.refresh_token,
        'token_type', oc.token_type,
        'expires_at', oc.expires_at
    ),
    jsonb_build_object(
        'workspace_id', oc.workspace_id,
        'workspace_name', oc.workspace_name,
        'bot_id', oc.bot_id
    ) - 'null'  -- remove null keys
FROM oauth_connections oc
LEFT JOIN profiles p ON p.user_id = oc.user_id;
```

### 3.4 回填 `access_points.gateway_id`

```sql
-- 对于有 credentials_ref 或 user_id 的 datasource AP，关联到对应 gateway
UPDATE access_points ap
SET gateway_id = g.id
FROM gateways g
WHERE ap.provider = g.provider
  AND ap.user_id = g.user_id
  AND ap.provider NOT IN ('agent', 'mcp', 'sandbox', 'filesystem', 'direct');
```

### 3.5 表关系图

```
organizations (1)
    │
    ├── gateways (N)           ← 账号绑定，跨项目
    │   │
    │   │   gateway_id (可选FK)
    │   ▼
    ├── projects (N)
    │   │
    │   ├── access_points (N)  ← 数据流配置，绑定项目
    │   │   ├── sync_state     (1:1, datasource 类型)
    │   │   ├── agent_profiles (1:1, agent 类型)
    │   │   └── access_key     → MUT 协议入口
    │   │
    │   └── mut_commits, mut_scope_state ...
    │
    └── oauth_connections (legacy, 迁移后废弃)
```

---

## 4. 后端代码改动

### 4.1 新建 Gateway 模块

```
backend/src/connectors/gateway/
├── __init__.py
├── router.py          — API 端点
├── service.py         — 业务逻辑
├── repository.py      — Supabase CRUD
└── schemas.py         — Pydantic models
```

**API 端点：**

| Method | Path | 说明 |
|--------|------|------|
| `GET /api/v1/gateways` | 列出当前 org 所有 gateway | 支持 `?provider=gmail` 过滤 |
| `POST /api/v1/gateways` | 手动创建（database 类型） | body: `{provider, name, credentials, metadata}` |
| `GET /api/v1/gateways/{id}` | 获取详情 | |
| `PATCH /api/v1/gateways/{id}` | 更新名称/元数据 | |
| `DELETE /api/v1/gateways/{id}` | 删除（检查关联 AP） | |
| `POST /api/v1/gateways/{id}/refresh-token` | 刷新 OAuth token | |
| `GET /api/v1/gateways/providers` | 可用 provider 列表 | |
| `GET /api/v1/gateways/{provider}/authorize` | 获取 OAuth 授权 URL | |
| `POST /api/v1/gateways/{provider}/callback` | OAuth 回调 → 创建 gateway | |
| `GET /api/v1/gateways/{provider}/status` | OAuth 连接状态 | |

### 4.2 修改 OAuth 流程

```
现在：
  OAuth callback → INSERT INTO oauth_connections → 创建 AP → 开始同步

新设计：
  OAuth callback → INSERT INTO gateways（只存 token）
  用户选项目 + scope → 创建 AP（带 gateway_id）→ 开始同步
```

**改动文件：**
- `connectors/datasource/oauth/router.py` → 迁移到 `connectors/gateway/router.py`
- `connectors/datasource/oauth/repository.py` → 改为写 `gateways` 表
- `connectors/datasource/oauth/models.py` → 更新模型

### 4.3 修改 Access Point 创建

**`connectors/manager/router.py` 的 `create_connection` endpoint：**

```python
# 第三方 datasource 类型：必须指定 gateway_id
if provider in DATASOURCE_PROVIDERS:
    if not payload.gateway_id:
        raise HTTPException(400, "gateway_id required for datasource providers")
    gateway = gateway_repo.get_by_id(payload.gateway_id)
    if not gateway:
        raise HTTPException(404, "Gateway not found")
    # 创建 AP 时写入 gateway_id
    ...

# 非第三方类型：不需要 gateway（agent/sandbox/mcp/filesystem/direct）
else:
    # 创建逻辑不变
    ...
```

**`UnifiedConnectionCreate` schema 新增：**
```python
gateway_id: str | None = Field(None, description="Gateway ID for datasource providers")
```

### 4.4 修改 Sync 执行时的 Credential 获取

**`connectors/datasource/service.py`：**

```python
# 现在
token = oauth_repo.get_by_user_and_provider(user_id, provider)

# 新设计
gateway = gateway_repo.get_by_id(access_point.gateway_id)
token = gateway.credentials.get("access_token")
if gateway.is_token_expired():
    token = gateway_service.refresh_token(gateway.id)
```

### 4.5 `access_point.py` resolve 不变

`_resolve_and_validate` 只查 `access_points` 表。Gateway 的 credentials 只在 sync 执行时读取。MUT 协议操作（clone/push/pull）不涉及 gateway。

---

## 5. CLI 改动

### 5.1 新增 `puppyone gateway` 命令组

```bash
# OAuth 连接
puppyone gateway connect gmail             # 打开浏览器 OAuth → 创建 gateway
puppyone gateway connect github            # 同上
puppyone gateway connect notion            # 同上

# 手动创建（数据库等）
puppyone gateway connect database \
  --set host=db.example.com \
  --set port=5432 \
  --set database=mydb \
  --set user=admin \
  --set password=secret

# 管理
puppyone gateway ls                        # 列出所有 gateway
puppyone gateway info <id>                 # 详情（含 token 状态）
puppyone gateway rm <id>                   # 删除（警告关联的 AP）
puppyone gateway refresh <id>              # 刷新 OAuth token
puppyone gateway providers                 # 可用的 provider 列表
```

### 5.2 修改 `puppyone access add` 流程

```bash
# 第三方数据源：需要指定 gateway（或自动匹配唯一 gateway）
puppyone access add gmail --gateway <gw_id> --scope /inbox
puppyone access add github --gateway <gw_id> --scope /repos --set repo=org/repo
puppyone access add notion --gateway <gw_id> --scope /pages

# 如果只有一个对应 provider 的 gateway，可省略 --gateway
puppyone access add gmail --scope /inbox
# → 自动选择唯一的 gmail gateway
# → 如果有多个，提示用户选择

# 非第三方类型：不需要 gateway（不变）
puppyone access add agent "Research Bot" --scope /data
puppyone access add filesystem /docs
puppyone access add mcp "API" --scope /api
puppyone access add sandbox "Runner"
puppyone access add direct "Default" --scope / --permission rw
```

### 5.3 `puppyone access ls` 输出变化

```bash
$ puppyone access ls
ID          Provider    Gateway         Scope    Perm  Status   Name
──────────  ──────────  ──────────────  ───────  ────  ───────  ──────────
ak_abc123   gmail       My Gmail (#3)   /inbox   read  active   Email Import
ak_not456   notion      Work Notion     /notes   rw    active   Notion Sync
ak_agt012   agent       —               /data    rw    active   Research Bot
ak_fs901    filesystem  —               /docs    rw    active   Local Sync
```

Gateway 列显示关联的 gateway 名称，非第三方类型显示 `—`。

---

## 6. 前端改动

### 6.1 `/settings/connect` → Gateway 管理

| 改前 | 改后 |
|------|------|
| 显示 OAuth 连接列表 + "Connect" 按钮 | 显示 **Gateway 列表** + "Connect" 按钮 |
| 连接 = 创建 OAuth + 创建 AP | 连接 = **只创建 Gateway**（OAuth 授权） |
| 删除连接 = 删 AP + 丢 OAuth | 删除 gateway = 断开账号绑定，不影响已有 AP |

### 6.2 `/projects/{id}/access` → Access Point 管理

| 改前 | 改后 |
|------|------|
| "Add" → 选 provider → OAuth 流程 → 创建 AP | "Add" → 选 provider → **选择已有 Gateway** → 配置 scope → 创建 AP |
| 无 gateway 概念 | 第三方类型显示 gateway 下拉；无 gateway 时引导去 Settings |
| 每个 AP 包含 OAuth 状态 | AP 显示关联 gateway 名称；OAuth 状态在 gateway 层管理 |

### 6.3 创建 AP 弹窗流程

```
1. 选择 provider 类型
   ├── agent / sandbox / mcp / filesystem / direct → 直接配置 scope
   └── gmail / github / notion / database → 进入 Step 2

2. 选择 Gateway
   ├── 已有 gateway → 选择
   └── 无 gateway → "Go to Settings to connect" 按钮

3. 配置 scope + trigger + 权限

4. 创建 AP
```

---

## 7. 与 MUT clone/connect 的衔接

| 场景 | Gateway 层 | Access Point 层 | MUT Client |
|------|-----------|-----------------|------------|
| **A: PuppyOne 导入数据 → 拉到本地** | `puppyone gateway connect notion` | `puppyone access add notion --gateway <id> --scope /notes` → AP 创建，数据同步到 MUT tree | `mut clone <ap_url>`（云端→新本地目录） |
| **B: 本地空目录 → 创建一份新 SoT** | 不需要 gateway | `puppyone access add filesystem --scope /` → AP 创建 | `mut connect <ap_url>`（一步：init + link + push 空树） |
| **C: 本地已有文件 → 接入云端** | 不需要 gateway | `puppyone access add filesystem --scope / [--link <local-path>]` → AP 创建 | `mut connect <ap_url>`（一步：init + link + commit + push）。<br/>或 `puppyone access add filesystem --link <path>` 一键完成 |
| **D: AI Agent** | 不需要 gateway | `puppyone access add agent "Bot" --scope /data` | Agent 内部用 MutEphemeralClient |
| **E: MCP 端点** | 不需要 gateway | `puppyone access add mcp "API" --scope /` | 外部 MCP client 调用 |
| **F: 沙盒** | 不需要 gateway | `puppyone access add sandbox "Runner"` | 沙盒内用 MutEphemeralClient |

> **命令选择速查**：
> - **新建本地工作副本**（云端是真理之源）→ `mut clone <ap_url>`
> - **接入已有本地文件夹**（本地是真理之源 / 双向同步） → `mut connect <ap_url>`
> - 旧版 `mut init` + `mut link access <ap_url>` 仍受支持（mutai ≥ 0.1.6），新代码请直接用 `mut connect`（mutai ≥ 0.1.7）。

---

## 8. 实施步骤

### Phase 1: 数据库 ✅ 已完成
1. ✅ 创建 `gateways` 表 + RLS 策略
2. ✅ `access_points` 加 `gateway_id` 列（nullable）
3. ✅ 迁移 `oauth_connections` 数据到 `gateways`
4. ✅ 回填 `access_points.gateway_id`

**文件**: `supabase/migrations/20260411000000_gateway_access_point_split.sql`

### Phase 2: 后端 Gateway API ✅ 已完成
5. ✅ 创建 `connectors/gateway/` 模块（router/service/repository/schemas）
6. ✅ 注册到 `main.py`
7. ✅ 实现 CRUD + OAuth authorize/callback + providers list + token refresh

**文件**: `backend/src/connectors/gateway/__init__.py`, `router.py`, `service.py`, `repository.py`, `schemas.py`

**API 端点**:
- `GET /api/v1/gateways` — 列出 gateway
- `POST /api/v1/gateways` — 手动创建（database 等）
- `GET /api/v1/gateways/{id}` — 详情
- `PATCH /api/v1/gateways/{id}` — 更新
- `DELETE /api/v1/gateways/{id}` — 删除
- `POST /api/v1/gateways/{id}/refresh-token` — 刷新 token
- `GET /api/v1/gateways/providers` — provider 列表
- `GET /api/v1/gateways/{provider}/authorize` — OAuth 授权 URL
- `POST /api/v1/gateways/{provider}/callback` — OAuth 回调

### Phase 3: AP 创建流程 ✅ 已完成
8. ✅ `UnifiedConnectionCreate` 新增 `gateway_id` 字段
9. ✅ Datasource AP 创建时将 `gateway_id` 写入 `access_points` 表
10. ⏳ Datasource sync 执行时从 gateway 读 credentials（渐进式，当前仍兼容 `oauth_connections` 路径）

**文件**: `backend/src/connectors/manager/router.py`

### Phase 4: CLI ✅ 已完成
11. ✅ 新增 `puppyone gateway` 命令组（`cli/src/commands/gateway.js`）
12. ✅ 修改 `puppyone access add`：datasource 类型支持 `--gateway`，自动检测唯一 gateway
13. ⏳ `puppyone access ls` 显示 gateway 列（待前端对齐后同步更新）

**文件**: `cli/src/commands/gateway.js`（新文件）, `cli/src/commands/access.js`, `cli/bin/puppyone.js`

### Phase 5: 前端 ❌ 待实现（前端开发）

> **以下改动需要前端开发者实现。后端 API 已就绪，前端只需调用新端点。**

#### 5.1 `/settings/connect` → Gateway 管理页面

**当前**：显示 OAuth 连接列表，连接 = 创建 OAuth + 创建 AP。

**需改为**：
- 调用 `GET /api/v1/gateways` 显示 Gateway 列表（按 provider 分组）
- "Connect" 按钮调用 `GET /api/v1/gateways/{provider}/authorize` 获取 OAuth URL → 打开浏览器
- OAuth 回调后调用 `POST /api/v1/gateways/{provider}/callback` 创建 gateway
- 删除按钮调用 `DELETE /api/v1/gateways/{id}`
- 显示 Gateway 状态（active/expired/revoked）、关联的 AP 数量
- "Refresh Token" 按钮调用 `POST /api/v1/gateways/{id}/refresh-token`

**涉及前端文件**：
- `frontend/app/(main)/settings/connect/page.tsx` 或相关组件
- 需要新建 `frontend/lib/gatewayApi.ts`（调用 `/api/v1/gateways` 端点）

#### 5.2 `/projects/{id}/access` → AP 创建弹窗支持选择 Gateway

**当前**：选 provider → 直接创建 AP（OAuth 流程嵌入）。

**需改为**：
- 第三方 provider（gmail/github/notion 等）：
  1. 调用 `GET /api/v1/gateways?provider=xxx` 获取已有 gateway 列表
  2. 如果有 gateway → 下拉选择
  3. 如果没有 → 显示 "Go to Settings → Connect" 引导按钮
  4. 选择 gateway 后配置 scope/trigger → `POST /api/v1/access/` 带 `gateway_id`
- 非第三方 provider（agent/sandbox/mcp/filesystem/direct）：流程不变

**涉及前端文件**：
- `frontend/app/(main)/projects/[projectId]/access/page.tsx`
- 创建 AP 的弹窗/对话框组件

#### 5.3 AP 列表和详情页显示关联 Gateway

**当前**：不显示 gateway 信息。

**需改为**：
- `puppyone access ls` 表格新增 "Gateway" 列
- 显示 `gateway_id` 关联的 gateway 名称（需要 join 查询或前端二次请求）
- AP 详情页显示 Gateway 名称 + 状态 + "View Gateway" 链接

**涉及前端文件**：
- `frontend/app/(main)/projects/[projectId]/access/page.tsx`
- `frontend/components/agent/views/SyncDetailView.tsx` 等详情组件

### Phase 6: 清理 ❌ 待实施（在 Phase 5 完成后）
17. 标记 `oauth_connections` 为 deprecated
18. 后续版本删除 `oauth_connections` 表
19. 移除 `access_points.credentials_ref` 字段
20. Datasource sync 全面切换到从 gateway 读 credentials
18. 后续版本删除 `oauth_connections` 表
19. 移除 `credentials_ref` 字段

---

## 9. 兼容性

- **Phase 1-2 完全向后兼容**：新表新模块，不改现有逻辑
- **Phase 3 渐进式**：`gateway_id` 可选，旧 AP 仍然从 `oauth_connections` 读 token
- **Phase 4-5 可并行**：CLI 和前端可独立开发
- **Phase 6 需要全面迁移后才能执行**

---

## 10. 不需要 Gateway 的类型

| Provider | 需要 Gateway？ | 原因 |
|----------|---------------|------|
| `agent` | 否 | 无外部账号 |
| `sandbox` | 否 | 无外部账号 |
| `mcp` | 否 | 无外部账号 |
| `filesystem` | 否 | 本地文件夹，无 OAuth |
| `direct` | 否 | 直连 MUT |
| `gmail` | **是** | Google OAuth |
| `github` | **是** | GitHub OAuth |
| `notion` | **是** | Notion OAuth |
| `google_drive` | **是** | Google OAuth |
| `google_docs` | **是** | Google OAuth |
| `google_sheets` | **是** | Google OAuth |
| `google_calendar` | **是** | Google OAuth |
| `google_search_console` | **是** | Google OAuth |
| `linear` | **是** | Linear OAuth |
| `airtable` | **是** | Airtable OAuth |
| `database` | **是** | 连接串 = 凭证 |
| `url` | 否 | 无需认证（公开 URL） |
