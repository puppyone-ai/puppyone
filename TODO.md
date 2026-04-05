# PuppyOne & MUT 待办清单

> 更新日期：2026-04-05

---

## 一、已知 Bug（需修复）

### 高优先级

- [x] ~~Content write 不更新 root_hash~~ — 已修复：handlers.py 现在在 push/rollback 时计算并存储 root_hash
- [x] ~~Content rollback 不恢复文件内容~~ — 已修复：rollback 现在计算 new_root_hash 并调用 set_root_hash()
- [ ] **Direct provider AP clone 失败** — `provider: "direct"` 的 AP clone 返回 JSON parse error（`_invoke` 不支持 direct provider）
- [ ] **Filesystem AP clone 通过统一 API 创建后失败** — bootstrap 创建的 AP clone 报 "Expecting value"
- [ ] **MUT push 成功但新 AP clone 返回空** — scope_state 表未初始化，clone 的 list_scope_files 找不到 scope_hash
- [ ] **Project member role 不执行** — 系统只检查 org_members 不检查 project_members 的 role
- [ ] **org_members 表 RLS 缺 service_role 策略** — 导致服务端无法操作 org_members（需 SQL）
- [ ] **content write 的 .json 后缀** — 非 JSON 文件被自动加 `.json` 后缀，需评估
- [ ] **auth/config 端点 500** — Railway 缺 `SUPABASE_ANON_KEY` 环境变量

### 低优先级

- [ ] HASH_LEN=16（64 位）碰撞风险 — 长期需升级到 32

---

## 二、未深度测试的功能

- [ ] WebSocket 通知 — push 后 WebSocket 推送验证
- [ ] MCP 端点全流程
- [ ] OAuth 连接（GitHub/Google/Notion）— 需浏览器
- [ ] Agent SSE 对话 — 需 Anthropic API key
- [ ] 搜索/向量索引 — 需 Turbopuffer
- [ ] OCR 文件上传 — 需 MineRU/Reducto

---

## 三、设计文档要求但未实现

### MUT CLI
- [ ] `mut daemon` — 后台 watch + 自动 commit/push/pull
- [ ] 移除 `mut init`（设计要求必须通过 clone 创建）
- [ ] Config 清理 — 移除 project/agent_id/scope 字段

### PuppyOne CLI — 整体未开发
- [ ] `puppyone login/logout/whoami`
- [ ] `puppyone project create/list/use`
- [ ] `puppyone access add/ls/info/rm/pause/resume/trigger/key/refresh/logs`
- [ ] `puppyone chat`
- [ ] `puppyone status`
- [ ] `--json` 输出模式

---

## 四、已完成

### 2026-04-04
- [x] Supabase 环境错配排查 + main branch 回滚
- [x] Access Point 端点修复 + null safety
- [x] MUT 协议全通
- [x] Content Factory 演示案例
- [x] 代码质量重构（ruff + SonarQube 96 文件）
- [x] Tables/Tools/Members/Publish bug 修复
- [x] E2E 测试 4 套 292 tests
- [x] MUT CLI: ls/cat/--json/glob/.mutignore/安全加固/重试

### 2026-04-05
- [x] Content root_hash 同步修复（handlers.py + admin.py fallback）
- [x] Deep 测试套件（multi-user/AP revoke/sync write/scope/unified AP/versioning）
- [x] 5 套 E2E 330 tests 100%
- [x] MUT 单元测试 392 + CLI stress 47 = 439 tests 100%
