## MODIFIED Requirements

### Requirement: ETL 规则引擎执行
系统 SHALL 提供规则引擎/后处理组件负责将 OCR 产物（markdown）转换为结构化 JSON，且允许按规则跳过 LLM 或选择不同算法。

#### Scenario: postprocess_mode=llm 时的 LLM 转换
- **GIVEN** `postprocess_mode="llm"`
- **WHEN** 规则引擎应用规则
- **THEN** 应构造完整 prompt:
  - 包含 JSON Schema
  - 包含 Markdown 内容（或分块后的聚合内容）
  - 添加明确的输出格式要求
- **AND** 应调用 LLM 服务的文本模型
- **AND** 使用规则的 system_prompt（如果有）
- **AND** 指定 response_format="json_object"

#### Scenario: postprocess_mode=skip 时的直接 Markdown 输出
- **GIVEN** `postprocess_mode="skip"`
- **WHEN** 执行后处理阶段
- **THEN** 系统应跳过 LLM 调用
- **AND** 应产出一个用于直接挂载的稳定 JSON 结构:
  - 顶层 key 为源文件 base name（去除扩展名）
  - value 为对象，且仅包含：
    - `filename`: 原始文件名（含扩展名）
    - `content`: markdown 内容（string）
- **AND** 该输出 JSON SHALL NOT 包含 task/user/project 标识或任何 S3 key 指针等元信息

### Requirement: ETL 规则支持跳过后处理（Skip LLM）
系统 SHALL 支持在用户自定义 ETL 规则中配置“跳过大模型后处理阶段”，使得任务仅产出 OCR 结果的稳定 JSON 包装，而不调用 LLM。

#### Scenario: 规则声明跳过后处理
- **WHEN** 用户创建/更新 ETL 规则
- **THEN** 规则应支持配置 `postprocess_mode`
- **AND** `postprocess_mode` 至少支持：
  - `llm`（默认：执行后处理）
  - `skip`（跳过后处理）

#### Scenario: 跳过后处理时不调用 LLM 且输出可直接挂载
- **GIVEN** 规则的 `postprocess_mode="skip"`
- **WHEN** 后处理阶段执行
- **THEN** 系统不应调用任何 LLM 模型
- **AND** 应产出一个用于直接挂载的稳定 JSON 结构:
  - 顶层 key 为源文件 base name（去除扩展名）
  - value 为对象，且仅包含：
    - `filename`: 原始文件名（含扩展名）
    - `content`: markdown 内容（string）
- **AND** 输出 JSON SHALL NOT 包含 markdown_s3_key、provider_task_id 或 metadata 等元信息字段
- **AND** 系统 MAY 在任务 metadata 等内部字段中保留可重试所需的指针与元信息

### Requirement: 全局默认 ETL 规则
系统 SHALL 提供一个全局默认 ETL 规则，以降低用户门槛，避免用户必须先创建自定义规则才能提交任务。

#### Scenario: 全局默认规则可被使用
- **WHEN** 用户提交 ETL 任务但未提供 `rule_id`
- **THEN** 系统应自动选择全局默认规则用于该任务
- **AND** 全局默认规则应默认 `postprocess_mode="skip"`
- **AND** 该任务的结果应为可直接挂载的稳定 JSON 结构（顶层 key 为文件 base name，value 为 `{filename, content}`），且不调用 LLM

#### Scenario: 全局默认规则的可发现性
- **WHEN** 用户调用 `GET /api/v1/etl/rules`
- **THEN** 响应应包含全局默认规则（明确标识为 system/global）
- **AND** 用户无需创建任何规则即可发现并理解默认行为

