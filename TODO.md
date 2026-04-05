# PuppyOne & MUT 待办清单

> 更新日期：2026-04-05

---

## 一、已知 Bug（需修复）

### 高优先级

- [ ] **Content write 不更新 root_hash** — content write API 创建的 commit 没有 root_hash，导致 diff/version-content/pull-version 无法正常工作。需要让 content write 在每次写入后同步更新 projects.mut_root_hash 和 mut_commits.root_hash
- [ ] **Content rollback 不恢复文件内容** — rollback 创建了新版本号但实际文件内容未回滚到目标版本的 Merkle tree 状态
- [ ] **POST /api/v1/access/ 创建非 filesystem 类型** — agent/sandbox 通过统一 API 创建成功 ✅，但通过 API 创建的 filesystem AP clone 报 "Expecting value" JSON parse error
- [ ] **Direct provider AP clone 失败** — `provider: "direct"` 的 AP 创建成功但 clone 返回 JSON parse error（`_invoke` 可能不支持 direct provider）
- [ ] **MUT push 成功但 clone 返回空** — 新创建的 AP push 后 clone 返回空文件列表。push 更新了 scope_hash 但 clone 读 list_scope_files 找不到。可能是 scope_state 表未初始化
- [ ] **Project member role 不执行** — 添加 viewer/editor 后，系统只检查 org_members 不检查 project_members 的 role，所以 viewer 也能写
- [ ] **content write 的 .json 后缀** — 非 JSON 文件被自动加 `.json` 后缀（`hello.md` → `hello.md.json`），需评估是否为预期行为
- [ ] **auth/config 端点 500** — Railway 缺 `SUPABASE_ANON_KEY` 环境变量（运维配置）

### 低优先级

- [ ] HASH_LEN=16（64 位）碰撞风险 — 保持不变避免破坏兼容，长期需升级到 32

---

## 二、未深度测试的功能

### 需要代码测试
- [ ] Datasource 实际同步 — 验证 URL sync 数据是否真正写入 MUT tree
- [ ] WebSocket 通知 — push 后 WebSocket 推送验证
- [ ] 定时 Sync Trigger — cron 定时执行验证
- [ ] 多用户权限边界 — editor 不能改设置、viewer 不能写
- [ ] AP revoke 后拒绝访问 — revoked_at 检查
- [ ] AP scope.exclude 多层嵌套
- [ ] MCP 端点全流程（目前跳过）

### 需要外部服务/浏览器
- [ ] OAuth 连接（GitHub/Google/Notion）— 需浏览器授权
- [ ] Agent SSE 对话 — 需 Anthropic API key
- [ ] 搜索/向量索引 — 需 Turbopuffer 配置
- [ ] OCR 文件上传 — 需 MineRU/Reducto 配置

---

## 三、设计文档要求但未实现

### MUT CLI（03-cli.md）
- [ ] `mut daemon` — 后台 watch + 自动 commit/push/pull（filesystem provider 核心需求）
- [ ] 移除 `mut init`（设计要求必须通过 clone 创建）
- [ ] Config 清理 — 移除 project/agent_id/scope 字段（MUT 不应知道平台概念）

### PuppyOne CLI（03-cli.md）— 整体未开发
- [ ] `puppyone login/logout/whoami` — 控制平面认证
- [ ] `puppyone project create/list/use` — 项目管理
- [ ] `puppyone access add/ls/info/rm/pause/resume/trigger/key/refresh/logs` — AP 统一管理
- [ ] `puppyone chat` — Agent 聊天
- [ ] `puppyone status` — 项目总览
- [ ] `--json` 输出模式

---

## 四、代码质量

- [ ] content_write.py `.json` 后缀逻辑重新评估
- [ ] connectors/manager/router.py 统一创建 API 各 provider 分支测试
- [ ] E2E 测试中 5 个 skip 转为 pass（修复 root_hash 同步后）

---

## 五、已完成（2026-04-04）

- [x] Supabase 环境错配排查 + main branch 回滚
- [x] Access Point 端点 try/except + revoked_at 列
- [x] MUT 协议全通（clone/push/pull/negotiate/rollback/pull-version/merge）
- [x] Content Factory 演示案例（20 文件 + run_demo.py）
- [x] 代码质量重构（ruff + SonarQube 修复 96 文件）
- [x] Tables 创建持久化修复
- [x] Tools by-project 方法名修复（审查后改回）
- [x] Project Members fallback 查询
- [x] AP 创建 scope 解析修复
- [x] Context Publish table_id int→str 修复
- [x] Table creator 直接访问权限
- [x] E2E 测试 4 套 292 tests 100%
- [x] MUT CLI: mut ls / mut cat / --json / .mutignore glob / status 输出 / 安全加固 / 重试增强
- [x] MUT 测试 439 tests 100%
