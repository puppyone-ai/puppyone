## ADDED Requirements
### Requirement: ADI 作为可复用的数据操作单元
系统 SHALL 提供 ADI（Agent Data Interface）抽象，使“对某个 Context 的一种操作”可以作为独立实体被创建、配置与复用，而不依赖 MCP Server。

#### Scenario: 创建一个 ADI（以 query_data 为例）
- **GIVEN** 用户拥有 `table_id=1` 的访问权限
- **WHEN** 用户创建一个 ADI，指定 `table_id=1`、`json_path="/foo/bar"`、`operation_type="query_data"`
- **THEN** 系统持久化该 ADI 实体
- **AND** 该 ADI 记录其目标 Context（table_id/json_path）与操作类型

#### Scenario: ADI 的操作语义与输入输出契约
- **GIVEN** 已存在一个 ADI：`operation_type="create"`
- **WHEN** 调用该 ADI 对应的执行入口
- **THEN** 系统 MUST 复用既有的 Table Context 操作语义（dict/list 挂载点规则、JMESPath 查询等）
- **AND** 输入输出 MUST 与该 operation_type 的 schema 契约一致

#### Scenario: ADI 权限边界
- **GIVEN** ADI 归属用户 A
- **WHEN** 用户 B 尝试读取或绑定该 ADI
- **THEN** 系统 MUST 拒绝该请求（403 或等价的权限错误）

### Requirement: ADI 支持标准操作集合（阶段 1）
系统 SHALL 至少支持下列 operation_type（与现有 MCP tools 对齐）：
`get_data_schema`、`get_all_data`、`query_data`、`create`、`update`、`delete`、`preview`、`select`。

#### Scenario: 预览/选择类操作的可选配置
- **GIVEN** 创建一个 `operation_type="preview"` 的 ADI
- **WHEN** 用户为该 ADI 配置 `preview_keys`
- **THEN** ADI 执行时仅返回预览字段（与现有 preview/select 行为一致）

### Requirement: ADI 粒度为“一种操作=一个实体”（阶段 1）
系统 SHALL 将 ADI 的建模粒度固定为“一种操作=一个 ADI 实体”，以便在组合发布时以操作为单位进行权限、命名与治理。

#### Scenario: 同一 Context 的不同操作对应不同 ADI
- **GIVEN** 同一个 Context（`table_id=1`、`json_path="/foo"`）
- **WHEN** 用户分别创建 `operation_type="query_data"` 与 `operation_type="create"` 两个 ADI
- **THEN** 系统分别持久化两个不同的 ADI 实体


