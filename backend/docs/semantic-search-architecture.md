# 语义检索架构设计（面向结构化 JSONB + Agent 友好分发）

> 范围：仅讨论架构与开发设计，不绑定具体技术选型（向量库/模型/队列/数据库实现均可替换）。
>
> 背景对齐：当前系统以 `table.data (jsonb)` 托管结构化数据，ETL 将上传文件 OCR/清洗后挂载进 `table.data`；对外分发以 **AEI/ADI** 思路演进：MCP v2 是 AEI，Tool 是可组合的 ADI 能力载体。

---

## 0. 设计目标与约束

### 0.1 目标
- **结构化管理为真相**：用户数据的 canonical 形态仍然是 `table.data(jsonb)`（结构化可解释、可审计）。
- **语义检索高效可扩展**：提供语义检索能力，支持“冷数据为主、热数据少量高频”的访问模式，降低全量向量化成本。
- **Agent 友好分发**：让 Agent 能以“证据驱动”的方式工作：先语义召回证据，再用结构化接口取证、裁剪、更新。
- **可演进**：允许从“简单、最终一致、可重建”逐步演进到“增量更新、版本化、混合检索与重排”。

### 0.2 约束与现状（来自当前实现）
- ETL 完成后会把结果挂载到 `table.data` 的某个 `json_path` 下；挂载 key 形如 `filename + hash`（代码里称 `mount_key`）。
- 结构化检索主要依赖 JSON Pointer + JMESPath（`query_data` 工具）。
- 追加写入可能来自 Agent（通过 MCP Tool / API）写回 `table.data`。

---

## 1. 核心结论：不要“对 JSONB 直接 embedding”，要做“派生索引层”

### 1.1 为什么 `table.data(jsonb)` 不适合作为 embedding 的直接载体
`table.data` 作为 canonical 数据非常合适，但直接拿它做语义检索会带来结构冲突：
- **缺少稳定的语义单元**：embedding 需要 chunk（段落/记录/小节）；JSON 树没有天然 chunk 边界。
- **更新粒度与一致性困难**：当前写入方式常见是“读出整段 JSON → 修改 → 整段写回”，难以精确识别哪些 chunk 失效。
- **检索必须可回指**：语义命中必须能定位回结构化事实，否则无法形成证据链，也难做权限与审计。

### 1.2 正确范式：Canonical + Derived Index
将系统分为两层：
- **Canonical Layer（结构化真相）**：`table.data(jsonb)`，用于精确查询/更新/导出。
- **Derived Index Layer（派生索引）**：从 Canonical（或 OCR markdown）派生的 `Document/Chunk/Embedding` 索引，可丢弃、可重建，用于语义召回。

> 语义检索永远不应该成为唯一真相；它是“加速与召回”的索引层。

---

## 2. 数据模型抽象（与技术无关）

### 2.1 Context / Document / Chunk 的定义

#### Context（分发单位）
- **定义**：`Context = (table_id, json_path)` 对应 `table.data` 的一个子树。
- **来源**：你们 AEI/ADI 文档已定义：被分发的 Context 是 `data` 的子 JSON（由 `json_path` 定位）。

#### Document（索引与冷热管理的基本单位）
- **定义**：一个 Context 下可独立管理的“文档对象”，用于聚合 chunk、管理版本与重建边界。
- **推荐标识**：
  - `document_id = (table_id, json_path, document_key)`
  - 其中 `document_key` 建议直接复用当前 ETL 挂载的 key：`mount_key`

> 重要澄清：`mount_key` **不是**数据库表字段；它是写入 `table.data` 的 key（同时保存在任务 metadata 里）。因此它恰好是“文档级 key”的天然候选，并且能被结构化接口直接回指。

#### Chunk（最小语义检索单元）
- **定义**：Document 内部的可检索片段，大小控制在 embedding 友好范围。
- **标识**：
  - `chunk_id = (document_id, chunk_index)` 或 `chunk_hash`
  - 必须携带可回指信息：`pointer = (table_id, json_path, document_key, relative_pointer)`

### 2.2 Evidence（对 Agent 友好的检索返回）
语义检索不直接返回大 JSON，而返回 Evidence 列表（证据驱动）：
- `score`：相似度/相关度
- `snippet`：命中的 chunk 文本（短）
- `pointer`：可回指到结构化数据的位置（用于取证）
- `metadata`：文件名、时间、来源、字段权重、版本等（可选）

---

## 3. 从 JSON 到 Chunk：分块与渲染策略（结构优先）

### 3.1 原则：先结构切分，再文本渲染
不要直接把整段 JSON stringify 做 embedding。建议 pipeline：
1) **结构切分**：识别 “record / section / leaf” 三类边界
2) **字段选择**：选择对语义有用的字段（可配置）
3) **文本渲染**：把 `path + field + value` 渲染为稳定文本
4) **必要时二次切分**：过长则再做 token/字符级切分（带 overlap）

### 3.2 三种常用切分粒度
- **Record-based（推荐默认）**：`List[Dict]` 按元素切（每条记录一个 chunk）
- **Section-based**：一个小对象（Dict）作为一个 chunk（带字段名）
- **Leaf-based（兜底）**：遍历叶子节点，将 `(path, key, value)` 变成短句

### 3.3 渲染格式建议（可回溯、可控噪声）
建议渲染出“扁平但带路径”的文本，例如：
- `path=/items/0; name=...; qty=...; price=...`
- 或多行 key-value（便于模型理解字段语义）

> 关键：**字段名要显式出现**，否则模型难以稳定理解结构化含义。

---

## 4. 存储层设计（不绑定实现，但要求能力）

### 4.1 Canonical Store（现有）
- `table.data(jsonb)`：存放结构化内容
- 访问方式：JSON Pointer（定位子树）+ JMESPath（结构化查询）+ CRUD（create/update/delete element）

### 4.2 Derived Index Store（新增概念表/集合）
不指定具体数据库，但需要支持：
- **按 scope 过滤**：至少能按 `table_id`、可选 `json_path`、可选 `document_key` 过滤
- **ANN 向量检索**：topK 近邻查询
- **可重建/幂等 upsert**：同一 `chunk_id` 可覆盖写入

推荐的逻辑字段（概念，不绑定实现）：
- `table_id`, `json_path`
- `document_key`（= mount_key 或等价）
- `chunk_id / chunk_index`
- `chunk_text`
- `embedding`（vector）
- `source_fingerprint`（用于判断是否需要重建；可来自 canonical 子树 hash / 文档版本）
- `updated_at`

### 4.3 Index State / 冷热管理（强烈建议）
为实现“冷数据为主、热数据少量高频”，需要一个轻量状态层：
- `document_state`：
  - `status`: `ready | stale | indexing | failed | disabled`
  - `last_indexed_at`
  - `hotness`：访问热度（近期访问次数/时间衰减）
  - `priority`：人工置顶/业务优先级（可选）

> 这样语义检索可以做到：优先检索 ready 的热数据；冷数据缺索引时按需构建或后台慢慢补齐。

---

## 5. ETL 层与追加写入：如何触发索引（最终一致 + 可演进）

### 5.1 两类写入来源
- **ETL 写入**：文件上传 → OCR/清洗 → 挂载进 `table.data`（已有）
- **Agent 追加写入**：通过 Tool/API 对 `table.data` 做 create/update/delete（已有）

### 5.2 推荐的一致性策略（从简单到复杂）

#### Phase 1：文档级最终一致（推荐先落地）
触发规则：
- 当 `table.data` 在 `(table_id, json_path, document_key)` 维度发生变化时：
  - 将对应 `document_state.status` 标记为 `stale`
  - 异步 enqueue `index_document(document_id)` 重建 chunk+embedding

特点：
- 实现简单，适配冷数据（大多不重建）
- 代价：一次更新可能重建整个 Document（但 Document 已经比整表小）

#### Phase 2：局部增量重建（后续优化）
当 update/delete 可明确给出 `relative_pointer/keys` 时：
- 只重建受影响的 record/section 的 chunks
- 其余 chunk 保持不变

#### Phase 3：版本化（可审计/可回滚/可并发）
引入 `document_version`：
- Canonical 每次写入产生新版本（或至少更新 version counter）
- Index 记录 `indexed_version`，查询时优先使用最新版本

### 5.3 在现有实现里的插入点建议
当前 ETL “挂载成功”是一个明确的边界：当 worker 完成 `create_context_data / update_context_data` 后，enqueue “索引任务”即可。
追加写入同理：在 Tool/API 执行写入后，标记 stale 并 enqueue。

---

## 6. 语义检索层：高效接口设计（证据优先、可回指、可组合）

### 6.1 语义检索接口的职责边界

语义检索层的责任是：**把“用户问题”映射为一组可回指的 Evidence**，让上层（Agent/应用）再用结构化工具取证与裁剪。

- **语义检索 SHOULD 做**
  - 输入自然语言 query，返回 topK Evidence（含 score、snippet、pointer）
  - 支持 scope 限定：`table_id` 必选；可选限定到某个 `json_path`（Context）或若干 `document_key`
  - 支持结构化过滤（metadata filter）：例如按来源/时间/类型/标签过滤
  - 允许混合策略：在结构化过滤后做向量召回（减少噪声）

- **语义检索 SHOULD NOT 做**
  - 直接返回整段 `table.data`（会导致上下文淹没、难审计、成本高）
  - 以语义结果替代 canonical truth（必须可回指到 JSON）

### 6.2 “高效且可演进”的 API/Tool 形态（概念）

建议把语义检索能力作为一种 ADI（Tool）暴露，这样天然继承你们现有的：
- **权限边界**：Tool 绑定了 `table_id + json_path`
- **分发方式**：MCP v2 可组合多个 Tool（AEI）对外发布
- **灰度开关**：Tool binding status 可启/停

#### 6.2.1 语义检索请求（概念字段）
- `query`（必填）：自然语言问题
- `top_k`（默认 10）：返回 Evidence 数量
- `scope`（可选）
  - `json_path`（默认取 Tool.json_path）：限定在 Context 子树内检索
  - `document_keys`（可选）：限定在若干文档内检索（例如只搜热文档）
- `filters`（可选）：结构化过滤条件（基于 index metadata）
- `options`（可选）
  - `min_score`：最小阈值
  - `include_snippet`：是否返回 snippet（默认 true）
  - `include_pointer`：是否返回 pointer（默认 true）
  - `include_metadata`：是否返回 metadata（默认 true）
  - `rerank`：是否对 topN 做精排（可选，Phase 2+）

#### 6.2.2 语义检索响应（Evidence List）
- `evidences: Evidence[]`
  - `score`
  - `snippet`
  - `pointer`
    - `table_id`
    - `json_path`
    - `document_key`
    - `relative_pointer`（指向 document 内部对象/字段）
    - `chunk_id`
  - `metadata`（可选：filename、created_at、source、tags、document_version、indexed_at…）
- `debug`（可选）：命中 scope、命中文档数量、是否触发 lazy indexing 等（仅内部/调试）

### 6.3 语义检索的执行管线（不绑定实现）

#### 6.3.1 基础版本（Phase 1）
1) **Scope 解析**：从 Tool/table/json_path 确定检索范围
2) **候选文档选择**：
   - 优先选择 `document_state.status=ready` 的文档
   - 可按 `hotness/priority` 做预算控制（例如先搜 top M 个热文档）
3) **向量召回**：topK chunk 召回
4) **返回 Evidence**：直接返回 `snippet + pointer`（不回表、不扩展上下文）

#### 6.3.2 进阶：混合检索 + 精排（Phase 2）
在向量召回之外增加两步：
- **混合召回**：关键词/结构化过滤 与 向量召回合并（提升精确性与可控性）
- **精排（rerank）**：对 topN Evidence 做更昂贵但更准的排序（减少幻觉与噪声）

> 这一层的关键不是技术，而是“接口留好扩展点”：请求里允许 `filters`、`rerank`，响应里允许带 `debug` 和更丰富的 metadata。

### 6.4 高效性：围绕“冷数据为主”的访问模式做预算控制

语义检索的成本主要来自两件事：**索引构建（embedding）** 与 **在线召回（向量检索）**。你的业务特征是“冷数据多、热数据少”，因此建议：

- **按需索引（lazy indexing）**
  - 查询命中范围内若存在 `stale/missing` 文档：先用 ready 文档回答；同时后台补齐索引
  - 若 ready 文档不足且用户明确需要全库：允许触发“慢路径”（后台任务 + 轮询/回调）

- **热度驱动的索引预算**
  - 热文档：保证 `ready`，并允许更细粒度 chunk、更频繁更新
  - 冷文档：允许粗粒度 chunk、较低更新频率，甚至仅在第一次被问到时才索引

- **缓存与限流**
  - query embedding 可缓存（短 TTL）
  - 限制 top_k、限制 scope 内候选文档数，避免“全量向量扫库”

---

## 7. Agent 友好分发：如何把语义检索接入 ADI/AEI

### 7.1 你们现有的分发抽象怎么复用
根据 `docs/refactor/context_exposure_refactor.md` 的方向：
- **ADI（Agent Data Interface）**：对某个 Context 的一种可调用能力（query/create/update/...）
- **AEI（Agent Exposure Interface）**：把多个 ADI 组合后对外发布（目前是 MCP v2）

语义检索最自然的落点是：**新增一种 ADI（Tool type）**，例如：
- `semantic_query`（语义检索返回 Evidence）
- （可选）`fetch_evidence`（按 pointer 批量取证：结构化裁剪后的 JSON）

这样 MCP v2 的组合能力不变：同一 MCP 实例可以同时挂载：
- 结构化工具：`query_data/create/update/delete/get_data_schema/...`
- 语义工具：`semantic_query`

### 7.2 推荐的 Agent 工作流（证据驱动闭环）
1) `semantic_query`：返回 topK Evidence（小、快、可回指）
2) `query_data` 或 `get_context_data`：按 Evidence.pointer 精确取证（只取必要字段/记录）
3) （可选）`update/create`：把 Agent 追踪到的新发现追加回 `table.data`
4) 写入后触发 `document_state=stale`，后台重建索引（最终一致）

> 这一闭环的核心价值：**语义召回负责“找可能相关”，结构化接口负责“取准确事实”**，避免把语义检索当数据库。

### 7.3 “分发结果的规范化”：Evidence 必须可审计
为了避免 Agent 生成不可验证结论，建议对外约束：
- 语义工具返回必须包含 `pointer`
- 上层回答如需要引用，应携带 `pointer`（或可再解析成用户可理解的引用：文件名/路径）

---

## 8. 冷热数据策略：让索引成本与价值匹配

### 8.1 热度的定义（可选但建议）
`hotness` 可由以下事件累积并衰减：
- 语义检索命中某 document
- 结构化查询/预览访问某 document
- Agent/用户手动置顶

### 8.2 建议的索引策略
- **热文档**
  - 保持 `ready`
  - 更细粒度 chunk（提升召回）
  - 更新后优先重建（更短的重建 SLA）
- **冷文档**
  - 允许长时间 `stale` 或 `missing`
  - 只有在被查询/被命中时才重建（lazy）
  - 定期低优先级批处理补齐（避免“永远没有索引”）

### 8.3 “追加写入”的索引策略
Agent 追踪市场并不断追加时，通常产生的是**小而频繁的变更**：
- 建议将追加内容组织为独立 Document（新的 `document_key`），避免把热更新写进一个巨大的旧文档里导致反复重建大块索引。

---

## 9. 演进路线（从你们当前系统最小改动开始）

### Phase 1：最小可用（2 个新能力）
- **派生索引层**：能保存 `Document/Chunk/Embedding` 与 `document_state`
- **语义检索 Tool**：`semantic_query`（输入 query，输出 Evidence）

写入触发：
- ETL mount 成功后标记 stale + enqueue index_document
- Tool 写入（create/update/delete）后标记 stale + enqueue index_document

### Phase 2：混合检索与精排
- 增加结构化过滤与关键词通道
- 增加 rerank（topN 精排）
- 增加按需取证的批量接口（pointer batch fetch）

### Phase 3：版本化与增量
- 引入 `document_version` 或 `source_fingerprint`
- 支持局部增量重建（按 record/section）
- 支持回滚与审计（索引与 canonical 的版本对齐）

---

## 10. FAQ：关于 `mount_key`“看不到字段、是否没用”

### 10.1 现状：它在哪里？
在当前实现中：
- `mount_key` 由 API 侧在 `/etl/upload_and_submit` 生成并写入 `ETLTask.metadata`
- worker mount 时把它作为 `elements[0].key` 写进 `table.data`（即 `data[json_path][mount_key] = ...`）

因此它确实**不会出现在 table 表的列里**，但它在 `table.data` 里就是“文档 key”。

### 10.2 为什么它对语义检索很关键？
语义检索要解决的不是“全库相似度”本身，而是“相似度命中后怎么回到 canonical truth”：
- `document_key=mount_key` 能把 Evidence 稳定回指到 `table.data` 的一个子树
- 它也是冷热管理、按文档重建索引的自然边界

### 10.3 建议的规范化（可选）
为了让 document 元信息更稳定（尤其是 LLM-mode 输出可能不含 filename），建议约定：
- 每个 document 的 canonical JSON 内部都包含最小元信息（如 `filename/source/created_at`），或在 `document_state` 里保存这些元信息供检索返回引用。

---

## 11. 可观测性与风险控制（架构要求）

### 11.1 指标（至少需要能回答“慢在哪里/贵在哪里/不准在哪里”）
- **索引构建**
  - `index_job_latency`（从 stale 到 ready 的延迟）
  - `index_job_fail_rate`（失败率与错误分布）
  - `chunks_per_document`、`embedding_tokens_total`
- **在线检索**
  - `semantic_query_latency`
  - `candidate_documents_count`（scope 内参与检索的文档数）
  - `evidence_clickthrough`（Evidence 被取证/被引用的比例，衡量质量）
- **冷热**
  - `hot_documents_ratio`
  - `lazy_index_triggered_count`

### 11.2 风险与缓解
- **索引漂移（canonical 更新但索引未更新）**
  - 缓解：document_state + stale 标记 + 后台重建；必要时查询路径可提示 “索引可能过期”
- **大规模 scope 导致成本失控**
  - 缓解：候选文档预算（先热后冷）、top_k 限制、慢路径机制
- **不可审计回答**
  - 缓解：对外契约强制返回 pointer；上层回答必须引用 pointer 或可解释引用（文件名/路径）

---

## 12. 端到端数据流（对齐你们现有系统）

### 12.1 文件上传 → ETL → 挂载 → 建索引
1) 用户 `upload_and_submit`
2) ETL worker 产出结构化结果，并挂载到 `table.data` 指定 `json_path`
3) 生成/确定 `document_key`（当前即 mount_key），标记 `document_state=stale`
4) enqueue `index_document(document_id)` → chunk → embedding → upsert index → `document_state=ready`

### 12.2 Agent 查询（问答）
1) Agent 调用 `semantic_query`（Tool）
2) 后端在 scope 内召回 Evidence（优先热文档）
3) Agent 选择 Evidence.pointer，调用 `query_data`/`get_context_data` 精确取证
4) Agent 基于证据生成回答（可审计）

### 12.3 Agent 追加写入（追踪市场并写回）
1) Agent 调用 `create/update`（Tool）把新发现追加进某个 Document（或新建 Document）
2) 后端标记该 Document 为 stale，并 enqueue index
3) 后续语义检索可逐步命中新追加内容（最终一致）



