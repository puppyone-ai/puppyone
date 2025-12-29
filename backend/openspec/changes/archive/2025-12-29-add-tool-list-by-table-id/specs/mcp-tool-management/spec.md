## ADDED Requirements

### Requirement: 按 table_id 查询 Tool 列表
系统 SHALL 支持按 `table_id` 查询当前用户在该 table 下的所有 Tool 实体。

#### Scenario: 查询某个 table_id 下的 Tool 列表（成功）
- **GIVEN** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户请求 `GET /tools/by-table/{table_id}`
- **THEN** 系统返回该用户在此 `table_id` 下的 Tool 列表（可能为空）

#### Scenario: 查询某个 table_id 下的 Tool 列表（无权限/不存在）
- **GIVEN** 目标 `table_id` 不存在或当前用户无权限访问
- **WHEN** 用户请求 `GET /tools/by-table/{table_id}`
- **THEN** 系统返回 NOT_FOUND（与 table 权限校验保持一致的错误语义）


