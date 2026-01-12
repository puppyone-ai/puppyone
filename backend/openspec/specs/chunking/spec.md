# chunking Specification

## Purpose
TBD - created by archiving change add-chunking-core. Update Purpose after archive.
## Requirements
### Requirement: Chunk 实体与 `chunks` 持久化表
系统 SHALL 提供 `Chunk` 实体，并在数据库中提供 `chunks` 表用于持久化大文本分块结果与元数据。

#### Scenario: `chunks` 表的最小字段集
- **WHEN** 系统创建 `chunks` 表
- **THEN** 表至少包含以下字段（或等价表达）：
  - `id`：主键
  - `table_id`：关联 Context 表的主键
  - `json_pointer`：RFC6901 JSON Pointer，用于定位到具体字符串节点
  - `chunk_index`：0-based 序号
  - `total_chunks`：该节点的 chunk 总数
  - `chunk_text`：该 chunk 的文本内容
  - `char_start/char_end`：该 chunk 在原始完整字符串中的字符区间
  - `content_hash`：原始完整字符串的 SHA256
  - `created_at/updated_at`：时间戳
- **AND** `table_id` SHALL 具有外键约束，指向 `context_table(id)`

#### Scenario: `chunks` 的唯一约束与索引
- **GIVEN** 系统需要支持幂等 chunking 与按节点快速查询
- **WHEN** 创建 `chunks` 表约束与索引
- **THEN** 系统 SHALL 至少提供以下约束/索引（或等价表达）：
  - `UNIQUE(table_id, json_pointer, content_hash, chunk_index)`，避免同版本重复 chunk
  - `INDEX(table_id, json_pointer)`，用于按节点查询
  - `INDEX(content_hash)`，用于按版本/去重查询

### Requirement: Chunking 配置项
系统 SHALL 支持以配置项控制 chunking 行为。

#### Scenario: 默认 chunking 配置
- **WHEN** 未显式提供 chunking 配置
- **THEN** 系统 SHALL 使用默认值：
  - `chunk_threshold_chars=10000`
  - `chunk_size_chars=1000`
  - `chunk_overlap_chars=100`

#### Scenario: 安全阈值保护
- **WHEN** 系统对某个字符串节点执行 chunking
- **THEN** 系统 SHALL 应用安全阈值保护以避免资源耗尽：
  - `MAX_CONTENT_SIZE_CHARS`（超出则拒绝或降级）
  - `MAX_CHUNKS_PER_NODE`（生成数量超限则拒绝或降级）

### Requirement: JSON 树遍历与大字符串提取
系统 SHALL 支持遍历任意 JSON 数据结构，并提取超过阈值的字符串节点，产出可用于持久化的 `json_pointer + content` 列表。

#### Scenario: 提取超过阈值的字符串节点（成功）
- **GIVEN** 输入为一个包含 dict/list/string 的 JSON 值
- **WHEN** 系统执行“大字符串提取”，并提供阈值 `chunk_threshold_chars`
- **THEN** 系统返回所有 `len(string) >= chunk_threshold_chars` 的节点
- **AND** 每个节点包含其 `json_pointer`（RFC6901）与 `content`

### Requirement: 文本分块算法（字符级）
系统 SHALL 支持将单个长字符串分割为带有位置区间的 chunk 序列，并支持 overlap 以保持上下文连贯性。

#### Scenario: 生成 chunk segments（基本）
- **GIVEN** 输入 `text` 长度大于 `chunk_size_chars`
- **WHEN** 系统以 `chunk_size_chars` 与 `chunk_overlap_chars` 执行分块
- **THEN** 系统返回一个有序的 chunk 列表
- **AND** 每个 chunk 包含 `chunk_text` 与 `char_start/char_end`
- **AND** chunk 的 `char_start/char_end` SHALL 能在原始 `text` 上无歧义定位

### Requirement: 幂等生成与持久化 chunks
系统 SHALL 提供一个幂等入口，用于对某个 `(table_id, json_pointer)` 的字符串内容生成并持久化 chunks。

#### Scenario: content_hash 不变时复用已有 chunks
- **GIVEN** 数据库中已存在某个 `(table_id, json_pointer, content_hash)` 的 chunks 版本
- **WHEN** 再次对同一 `content`（因此 `content_hash` 相同）执行 ensure
- **THEN** 系统 SHALL 不创建重复 chunks
- **AND** 返回已存在的 chunks（或等价的“已就绪”结果）

#### Scenario: content_hash 变化时创建新版本 chunks
- **GIVEN** 数据库中存在旧的 `(table_id, json_pointer, old_hash)` chunks
- **WHEN** 对更新后的内容执行 ensure，且计算得到 `new_hash != old_hash`
- **THEN** 系统 SHALL 生成并持久化新版本 chunks（以 `new_hash` 标识）
- **AND** 系统 MAY 保留旧版本以便审计/回滚（具体清理策略不在本阶段要求内）

