# context-publish Specification

## Purpose
TBD - created by archiving change add-public-json-publish. Update Purpose after archive.
## Requirements
### Requirement: Publish 实体（子 JSON 公开只读链接）
系统 SHALL 支持创建一个 Publish 实体，用于将某个 `table_id + json_path`（JSON Pointer）发布为一个可公开访问的只读链接。

#### Scenario: 创建 Publish（成功）
- **GIVEN** 当前用户已登录
- **AND** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户创建 Publish 并提供 `table_id` 与 `json_path`
- **THEN** 系统生成一个不可猜测的 `publish_key`
- **AND** 当请求未提供 `expires_at` 时，系统默认设置 `expires_at = now() + 7 days`
- **AND** 系统持久化保存 Publish 记录（至少包含 `user_id/table_id/json_path/publish_key/status/created_at`）
- **AND** 系统返回 publish 记录及其可访问 URL

#### Scenario: 创建 Publish（无权限/不存在）
- **GIVEN** 当前用户已登录
- **AND** 目标 `table_id` 不存在或当前用户无权限访问
- **WHEN** 用户创建 Publish 并提供该 `table_id`
- **THEN** 系统返回 NOT_FOUND（与 table 权限校验保持一致的错误语义）

### Requirement: 公开读取 published JSON subtree（curl 友好）
系统 SHALL 提供一个无需登录的公开读取端点，通过 `publish_key` 返回对应 `table_id + json_path` 的 raw JSON。

#### Scenario: 通过 publish_key 获取 raw JSON（成功）
- **GIVEN** 存在 enabled 的 Publish 记录，且其 `publish_key` 为 `k1`
- **WHEN** 客户端请求公开读取端点并提供 `publish_key=k1`
- **THEN** 系统返回 HTTP 200
- **AND** 响应 `Content-Type` 为 `application/json`
- **AND** 响应 body 为该 Publish 指向的 JSON 子树的完整数据（raw JSON）

#### Scenario: publish 被禁用或过期时不可访问
- **GIVEN** 存在 Publish 记录 `publish_key=k1` 但其状态为 disabled，或已过期
- **WHEN** 客户端请求公开读取端点并提供 `publish_key=k1`
- **THEN** 系统返回 NOT_FOUND（不暴露资源存在性）

#### Scenario: json_path 不存在时返回 NOT_FOUND
- **GIVEN** 存在 enabled 的 Publish 记录 `publish_key=k1`
- **AND** 该记录指向的 `json_path` 在当前 table.data 中不存在
- **WHEN** 客户端请求公开读取端点并提供 `publish_key=k1`
- **THEN** 系统返回 NOT_FOUND

### Requirement: Publish 管理端点（创建/列出/撤销）
系统 SHALL 提供需要登录的管理端点，用于用户管理自己创建的 Publish 记录（至少包含创建、列出、禁用/撤销与删除）。

#### Scenario: 列出当前用户的 Publish 记录
- **GIVEN** 当前用户已登录
- **WHEN** 用户请求 Publish 列表
- **THEN** 系统仅返回 `user_id` 归属于该用户的 Publish 记录

#### Scenario: 禁用 Publish 后公开读取立即失效
- **GIVEN** 当前用户已登录
- **AND** 当前用户创建了 `publish_key=k1` 的 Publish
- **WHEN** 用户将该 Publish 的状态更新为 disabled
- **THEN** 后续对 `publish_key=k1` 的公开读取请求 SHALL 返回 NOT_FOUND

### Requirement: publish_key 生成规则（短链接）
系统 SHALL 为每个 Publish 生成一个不可猜测的短链接 key，并保证其全局唯一。

#### Scenario: publish_key 长度与唯一性
- **WHEN** 系统创建 Publish
- **THEN** `publish_key` SHALL 为长度固定为 16 的高熵随机 token
- **AND** 系统 SHALL 保证 `publish_key` 全局唯一（冲突时重试生成）

### Requirement: 公开读取缓存（减少数据库查询）
系统 SHALL 在公开读取端点使用缓存来避免每次请求都查询数据库，同时保证 revoke/disable/expiry 的语义正确。

#### Scenario: revoke/disable/update 后缓存失效
- **GIVEN** 系统对 `publish_key=k1` 的 publish 记录使用缓存
- **WHEN** owner 将 `publish_key=k1` 对应的 publish 禁用、删除或更新 `expires_at`
- **THEN** 系统 SHALL 使 `publish_key=k1` 的缓存立即失效
- **AND** 后续公开读取请求对 `publish_key=k1` 的行为 SHALL 与最新记录一致

