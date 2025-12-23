## ADDED Requirements

### Requirement: Submit 支持声明挂载目标并在任务完成后自动挂载

系统 SHALL 允许客户端在提交 ETL 任务时声明可选的挂载目标（`table_id` + `json_path`），并在任务完成后自动将任务输出挂载到目标 Table 的 data 字段中，从而使前端不需要显式调用 mount 端点。

#### Scenario: Submit 未提供挂载目标则为每个文件自动创建 Table 并挂载
- **WHEN** 用户发送 `POST /api/v1/etl/submit`
- **AND** 请求未提供 `table_id` 与 `json_path`
- **THEN** 系统应在 `project_id` 下为该文件创建一个新的 Table
- **AND** Table 名称 SHOULD 使用短 hash（例如 8～12 位）以避免冲突
- **AND** 将任务输出 JSON 挂载到该新 Table 的默认路径
- **AND** 任务完成后，用户可通过 `GET /api/v1/etl/tasks/{task_id}` 获取任务状态与结果

#### Scenario: Submit 提供挂载目标则完成后挂载到指定路径
- **WHEN** 用户发送 `POST /api/v1/etl/submit`
- **AND** 请求提供 `table_id` 与 `json_path`
- **THEN** 系统应校验用户对该 Table 有访问权限
- **AND** 当任务进入 `completed` 后，系统应将输出 JSON 挂载到 `table_id` 的 `json_path` 下
- **AND** 挂载的 key 为原始文件名 + hash 后缀（用于避免多文件冲突）
- **AND** 挂载的 value 为任务输出 JSON（dict）

#### Scenario: Submit 声明挂载但目标 Table 不存在或无权限
- **WHEN** 用户发送 `POST /api/v1/etl/submit`
- **AND** 请求提供的 `table_id` 不存在，或用户无权限访问
- **THEN** 系统应返回 404（或等价的“不可见”错误）

### Requirement: 提供 upload_and_submit 一体化接口（文件/文件夹统一）

系统 SHALL 提供新的 `POST /api/v1/etl/upload_and_submit` 接口，用于在一次调用中完成“上传原始文件到 S3”与“提交 ETL 任务”，并支持单文件与多文件（文件夹）两种形态。

#### Scenario: 单文件 upload_and_submit 成功
- **WHEN** 用户发送 `POST /api/v1/etl/upload_and_submit`（单文件）
- **AND** 提供 `project_id`、文件内容，以及可选 `rule_id`、可选 `table_id/json_path`
- **THEN** 系统应上传文件到用户的 raw 前缀
- **AND** 系统应创建并返回一个 ETL `task_id`
- **AND** 用户可使用 `GET /api/v1/etl/tasks/{task_id}` 轮询任务状态

#### Scenario: 多文件（文件夹）upload_and_submit 成功并创建多个任务
- **WHEN** 用户发送 `POST /api/v1/etl/upload_and_submit`（多文件/文件夹）
- **AND** 提供 `project_id`、多份文件内容（可包含相对路径），以及可选 `rule_id`、可选 `table_id/json_path`
- **THEN** 系统应为每个文件上传到 raw 前缀并创建对应的 ETL 任务
- **AND** 响应应返回每个文件对应的 `task_id` 列表与必要的映射信息
- **AND** 轮询机制不变：客户端按 task_id 查询状态

#### Scenario: upload 失败则任务状态为 failed（待确认 task_id 语义）
- **WHEN** 用户调用 `POST /api/v1/etl/upload_and_submit`
- **AND** upload 阶段失败（例如文件大小超限、S3 不可用）
- **THEN** 系统应创建并返回一个 ETL `task_id`
- **AND** 该任务状态应为 `failed`
- **AND** 客户端仍可用 `GET /api/v1/etl/tasks/{task_id}` 轮询（保持机制一致）

### Requirement: 文件夹导入能力归并到 ETL 控制面

系统 SHALL 将文件夹导入/多文件解析的对外入口收敛到 ETL 模块，并使用 `upload_and_submit` 作为唯一对外入口。

#### Scenario: 不保留 project import-folder 旧入口
- **WHEN** 客户端调用旧接口（例如 `/api/v1/projects/{project_id}/import-folder`）
- **THEN** 系统应返回 404

## MODIFIED Requirements

### Requirement: ETL结果挂载到Table

系统 SHALL 支持将成功完成的 ETL 任务结果挂载到 Table 的 data 字段中；该挂载能力应通过 `submit` 的可选挂载声明自动完成；前端不需要且不应依赖显式 mount 端点。

#### Scenario: 自动挂载（submit 声明挂载）
- **WHEN** 用户在 `POST /api/v1/etl/submit` 中提供 `table_id` 与 `json_path`
- **THEN** 系统应在任务完成后自动将输出 JSON 挂载到目标路径

#### Scenario: mount 端点不再对外提供
- **WHEN** 客户端调用 `POST /api/v1/etl/tasks/{task_id}/mount`
- **THEN** 系统应返回 404


