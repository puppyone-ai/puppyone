# MCP 代理路由故障复盘（ContextBase Backend）

> 目的：记录本次 MCP 代理路由不可用的排查过程、根因与修复点，便于后续复盘与避免同类问题。

## 背景

- **直连方式可用**：通过 `http://localhost:<mcp_port>/mcp?api_key=...`（例如 `9280`）可以正常访问 MCP Server。
- **代理方式不可用**：通过 API 网关的代理路由（`/api/v1/mcp/server/{api_key}/...`）访问失败。
- **目标**：提供一个统一入口，把请求转发到对应实例端口的 MCP Server，客户端无需知道端口。

## 现象与影响

- **现象**
  - 在后端日志中看到大量：`GET /api/v1/mcp/server/<token>/ 404/502 ...`。
  - Cursor MCP 配置里：
    - 直连（到 `9280/mcp?...`）工作正常。
    - 代理（到 `9090/api/v1/mcp/server/<token>/`）无法建立正常会话。

- **影响**
  - MCP Server 实例实际上已启动，但对客户端而言“像不可用”。
  - 代理路由作为统一入口失效，导致接入体验与部署形态受影响。

## 排查过程（时间线式）

> 下面按“先观察 → 验证假设 → 收敛根因”的顺序记录。

### 1) 确认路由前缀/挂载是否正确

- **检查点**：`src/main.py` 中 `app.include_router(mcp_router, prefix="/api/v1")`，以及 `src/mcp/router.py` 中 `router = APIRouter(prefix="/mcp")`。
- **结论**：代理路由最终路径应为：
  - `/api/v1/mcp/server/{api_key}/...`

### 2) 发现“看似没匹配到路由”的 404

- **现象**：客户端访问的 base URL 常为 `.../server/<api_key>/`，即 `path` 为空或只有 `/`。
- **风险点**：仅定义 `"/server/{api_key}/{path:path}"` 时，某些情况下对“根路径/尾随斜杠”会出现不匹配或行为不一致。
- **处理**：为代理补充根路径路由 `"/server/{api_key}"`，并让 `path` 具备默认值，保证 base URL 不带子路径也能进入代理。

### 3) 发现“把非 JSON 当 JSON 解析”的问题

- **现象**：代理代码中存在 `response.json()` 的调试输出。
- **关键点**：MCP 的 HTTP 交互经常是 **SSE（text/event-stream）** 或非 JSON 响应；强行 `.json()` 会直接抛异常。
- **后果**：异常被 catch 后包装成业务异常/NotFound，导致表象变成 404/不可用。
- **处理**：移除对 `response.json()` 的依赖，避免把协议层响应当 JSON。

### 4) 识别 MCP 协议对 Accept header 的要求（SSE）

- **直连验证**：对 `/mcp` 发起普通 GET 会返回：
  - `406 Not Acceptable: Client must accept text/event-stream`
- **结论**：要建立 MCP 会话，客户端需要带 `Accept: text/event-stream`，并按 MCP 的 session 机制继续交互。
- **处理方向**：代理必须能支持长连接/流式透传（SSE）。

### 5) 关键根因：httpx 受环境代理变量影响，localhost 被“错误走代理”

- **表现**：代理对下游 `http://localhost:<port>/mcp...` 的请求出现异常/502，且在服务端看不到有效的下游响应。
- **根因**：`httpx` 默认 `trust_env=True`，会读取如 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY` 等环境变量。
  - 在某些环境下，这会导致 `localhost` 请求被错误地交给代理，从而返回 502 或连接失败。
- **修复**：在代理的 `httpx.AsyncClient(...)` 中设置：
  - `trust_env=False`

### 6) 启动/重启窗口期：端口刚拉起时短暂不可达

- **现象**：后端 reload / MCP 实例重启后，端口需要一点时间才能接受连接；代理在这个窗口内会报 `ConnectError`。
- **处理**：对下游连接增加轻量重试（短退避、次数有限），提升稳定性。

## 最终根因总结（Root Causes）

1. **路由形态不完整**：仅有 `"/server/{api_key}/{path:path}"`，base URL/尾随斜杠场景不稳。
2. **错误的响应处理**：使用 `response.json()` 假设上游总返回 JSON，遇到 SSE/非 JSON 时会异常。
3. **httpx 环境代理污染（关键）**：`trust_env=True` 导致对 `localhost` 的下游访问被错误走代理，出现 502/连接失败。
4. **协议要求**：MCP 需要 `Accept: text/event-stream` 才能进入正确的交互模式。
5. **时序问题**：实例刚启动/重启的端口短暂不可达，导致瞬时失败。

## 修复内容概览（What changed）

已在 `src/mcp/router.py` 中对代理路由做了以下增强：

- **路由兼容性**
  - 增加 `"/server/{api_key}"` 以覆盖根路径访问。
  - 统一 `path` 默认值，兼容 `.../server/<api_key>`、`.../server/<api_key>/`、`.../server/<api_key>/mcp` 等写法。

- **协议与响应处理**
  - 不再强行 `response.json()`。
  - 根据请求 `Accept` 判断是否需要 SSE（`text/event-stream`）的处理路径。

- **网络稳定性与环境隔离**
  - `httpx.AsyncClient(..., trust_env=False)`，避免 `localhost` 被环境代理污染。
  - 针对下游端口刚启动的情况做短暂重试。

- **健壮性**
  - 仅在可能携带 body 的方法下读取 `request.body()`，并对 `ClientDisconnect` 做兜底。

## 验证方式（How to verify）

- **直连验证**
  - `curl -i "http://localhost:<mcp_port>/mcp?api_key=<token>"` 应能看到 MCP 的协议性响应（如 406/400/200 等，取决于 Accept 与 session）。

- **代理验证**
  - `curl -i "http://localhost:9090/api/v1/mcp/server/<token>/"`
    - 不再出现“代理层 502（空响应）”。
    - 能得到与直连一致的 MCP 协议响应（例如 406：缺少 `Accept: text/event-stream`）。
  - `curl -i -H "accept: text/event-stream" "http://localhost:9090/api/v1/mcp/server/<token>/"`
    - 能进入 SSE 交互路径，并返回 MCP 会话相关状态（例如 400：Missing session ID，属于协议正常行为）。

- **Cursor MCP 配置验证**
  - 代理配置指向：`http://localhost:9090/api/v1/mcp/server/<token>/`
  - 确认能完成 tools 列表获取/调用（视 MCP 客户端实现而定）。

## 经验教训（Lessons learned）

- **代理实现要“协议感知”**：MCP/JSON-RPC over SSE 不是普通 JSON API，不能假设响应可 `.json()`。
- **环境变量是隐形依赖**：HTTP 客户端默认读取代理环境变量会让 localhost 请求出现“玄学 502”。
  - 建议：对服务内“回环/本机”请求一律 `trust_env=False`。
- **路由要覆盖 base URL 形态**：对 `{path:path}` 的代理路由，应显式支持“空 path/尾随斜杠”。
- **启动窗口期要有韧性**：子进程服务启动后端口并非立刻可用，代理层应有少量重试。
- **调试输出要避免改变行为**：调试 `.json()` 这种“带副作用/强假设”的代码，可能把问题放大成错误类型（404/502），误导定位。

## 后续改进建议（Follow-ups）

- **增加自动化测试**
  - 为代理增加集成测试：
    - 无 Accept → 返回 406
    - SSE Accept 但无 session → 返回 400
    - 能透传 `mcp-session-id` 等关键 header

- **明确代理的职责边界**
  - 代理只负责“转发与透传”，不做 JSON 解码、不做协议解析。
  - 对于 SSE：使用 stream 透传；对非 SSE：按需透传。

- **观测性**
  - 用结构化日志记录：下游目标 URL、实例端口、耗时、异常类型（避免敏感 token 泄露）。

---

如需把这份复盘同步到 `openspec/changes/...` 的变更记录体系里，我也可以按你们的 OpenSpec 模板补一个“变更说明 + 测试计划”。
