## 1. Implementation
- [ ] 1.1 设计并落地数据模型（ADI / AEI / Binding）：定义 Supabase schema、Pydantic schemas、Repository、Service
- [ ] 1.2 新增管理面 API：
  - [ ] 1.2.1 ADI CRUD（按 table_id/json_path/operation_type）
  - [ ] 1.2.2 AEI(MCP) CRUD（生成 api_key、status、name）
  - [ ] 1.2.3 Binding API：把多个 ADI 绑定为 AEI tools（校验 user_id、一致性、tool_name 唯一）
- [ ] 1.3 新增运行面 internal config v2：根据 AEI api_key 返回 bindings（tool 定义在 binding 层）与 ADI 路由信息（供 MCP Server 动态 list_tools/call_tool）
- [ ] 1.3.1 新增 ADI executor internal endpoint：根据 binding/adi 执行具体 operation，并统一做权限/参数校验与审计
- [ ] 1.4 更新 `mcp_service`：
  - [ ] 1.4.1 优先读取 v2 config（不再从 api_key 解析 table/json_path 作为权限边界）
  - [ ] 1.4.2 list_tools 基于 bindings 构建工具列表（tool_name/description/input_schema 以 binding 为准）
  - [ ] 1.4.3 call_tool：tool_name -> binding -> ADI -> 调用后端 ADI executor 执行（多 tool -> 多 Context）
  - [ ] 1.4.4 保留旧 config 回退以兼容 legacy mcp_instance
- [ ] 1.5 代理层兼容：
  - [ ] 1.5.1 新增 v2 独立 proxy 入口：`/api/v2/mcp/server/{api_key}`（v1 保持 legacy 不变）
  - [ ] 1.5.2 文档化 v1/v2 差异与迁移方式

## 2. Validation
- [ ] 2.1 单测：ADI/Binding 校验（权限、tool_name 冲突、operation 输入 schema）
- [ ] 2.2 集成测试：一个 AEI(MCP) 绑定多个 ADI，list_tools 返回正确，call_tool 能正确路由并调用 Internal table API
- [ ] 2.3 回归测试：legacy `mcp_instance` 仍可正常 list_tools/call_tool

## 3. Docs / Migration
- [ ] 3.1 更新/新增文档：如何创建 ADI、如何组合发布到 MCP、如何命名工具、常见错误排查
- [ ] 3.2 迁移计划：给出 legacy mcp_instance -> AEI/Bundle 的迁移脚本与回滚策略（可放到后续 change）


