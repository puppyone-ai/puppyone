# 大型Context自动分块与混合搜索设计方案

## 1. 概述

### 1.1 问题背景

当前系统通过 `context_table.data` (JSONB字段) 存储用户解析的任意数据，并通过MCP Server Tools以 `(table_id, json_path)` 的方式暴露给Agent。

**核心问题**：当某个JSON子节点的字符数超过10K时，直接返回给Agent会导致：
- 超出Agent的上下文窗口限制
- 无法进行语义搜索，只能全量返回
- 检索效率低下

### 1.2 设计目标

1. **自动分块**：当用户创建Search类型的Tool时，自动检测大于10K的字符串节点并进行分块
2. **混合搜索**：结合向量搜索（语义）+ BM25搜索（关键词）提供高质量的检索结果
3. **智能返回**：返回相关chunks的同时提供json_path元数据，让Agent能调用其他工具获取完整内容
4. **增量更新**：底层数据变化时自动重新分块
5. **工具共存**：语义Search与结构化query_data工具互补，不冲突

---

## 2. 核心设计决策

基于需求调研，确定以下设计决策：

| 维度 | 选择 | 理由 |
|------|------|------|
| **触发时机** | Search Tool创建时（懒加载） | 节省存储，避免为未使用的数据生成embeddings |
| **Chunk大小** | 1000字符 | 平衡语义完整性与检索精度（约250 tokens） |
| **搜索类型** | 混合搜索（Vector + BM25） | 结合语义理解和精确关键词匹配 |
| **返回格式** | Chunks + json_path元数据 | Agent可按需获取完整内容，节省上下文 |
| **更新策略** | 数据变化时总是重新生成 | 保证数据一致性，避免过期chunks |
| **分块范围** | 仅字符串内容 >10K | 专注文本内容，结构化数据保持原样 |
| **工具关系** | 语义Search与query_data共存 | 提供互补的检索方式 |

---

## 3. 数据模型设计

### 3.1 Chunk元数据表 (chunks table)

```sql
CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,

    -- 关联信息
    table_id INTEGER NOT NULL REFERENCES context_table(id) ON DELETE CASCADE,
    json_pointer VARCHAR(1024) NOT NULL,  -- JSON Pointer路径 (RFC 6901)

    -- Chunk信息
    chunk_index INTEGER NOT NULL,  -- 当前chunk在该节点中的序号（从0开始）
    total_chunks INTEGER NOT NULL,  -- 该节点总共的chunk数量

    -- 内容
    chunk_text TEXT NOT NULL,  -- chunk的文本内容
    char_start INTEGER NOT NULL,  -- 在原始字符串中的起始位置
    char_end INTEGER NOT NULL,  -- 在原始字符串中的结束位置

    -- Turbopuffer同步
    turbopuffer_namespace VARCHAR(255) NOT NULL,  -- Turbopuffer命名空间
    turbopuffer_doc_id VARCHAR(255) NOT NULL UNIQUE,  -- Turbopuffer文档ID

    -- 版本控制
    content_hash VARCHAR(64) NOT NULL,  -- 原始完整内容的SHA256哈希
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 索引
    INDEX idx_table_json_pointer (table_id, json_pointer),
    INDEX idx_content_hash (content_hash),
    INDEX idx_turbopuffer_namespace (turbopuffer_namespace)
);
```

**设计说明**：
- `content_hash`: 用于检测原始内容是否变化，决定是否需要重新chunk
- `chunk_index/total_chunks`: 让Agent了解chunk的上下文位置
- `char_start/char_end`: 用于在返回结果中标注chunk在完整文本中的位置
- `turbopuffer_doc_id`: 唯一标识，格式为 `{table_id}:{json_pointer_encoded}:chunk_{chunk_index}`

### 3.2 Search Tool配置扩展

扩展现有的tool表，添加搜索配置字段：

```python
# src/tool/schemas.py

class SearchToolConfig(BaseModel):
    """Search工具的配置"""

    # 搜索参数
    top_k: int = Field(default=5, ge=1, le=20, description="返回的top结果数量")
    enable_hybrid: bool = Field(default=True, description="是否启用混合搜索")
    vector_weight: float = Field(default=0.7, ge=0, le=1, description="向量搜索权重")
    bm25_weight: float = Field(default=0.3, ge=0, le=1, description="BM25搜索权重")

    # Chunk参数
    chunk_threshold: int = Field(default=10000, description="触发分块的字符数阈值")
    chunk_size: int = Field(default=1000, description="目标chunk大小（字符数）")
    chunk_overlap: int = Field(default=100, description="chunk之间的重叠字符数")

    # 返回格式控制
    include_metadata: bool = Field(default=True, description="是否包含元数据")
    max_chunk_preview: int = Field(default=200, description="返回结果中chunk预览的最大字符数")


class ToolCreate(BaseModel):
    """创建Tool的请求模型"""

    project_id: int
    name: str
    description: str
    tool_type: Literal["query_data", "get_all_data", "create", "update", "delete", "search"]
    table_id: int
    json_pointer: str = ""

    # Search工具专用配置
    search_config: Optional[SearchToolConfig] = None
```

### 3.3 Turbopuffer文档结构

```python
# src/turbopuffer/schemas.py

class ChunkDocument(BaseModel):
    """Turbopuffer中存储的chunk文档结构"""

    # 必填字段
    id: str  # turbopuffer_doc_id
    vector: List[float]  # 1536维embedding向量

    # 属性字段（用于过滤和元数据）
    attributes: Dict[str, Any] = {
        # 核心标识
        "table_id": int,
        "json_pointer": str,
        "chunk_index": int,
        "total_chunks": int,

        # 内容
        "content": str,  # chunk的完整文本（用于BM25搜索）
        "char_start": int,
        "char_end": int,

        # 上下文信息
        "parent_node_type": str,  # 父节点类型: "string", "array_item", "object_field"
        "content_hash": str,  # 用于版本控制

        # 时间戳
        "created_at": str,  # ISO 8601格式
    }
```

**Turbopuffer命名空间组织**：
- 格式: `project_{project_id}_table_{table_id}`
- 理由:
  - 按project和table隔离，便于权限控制
  - 删除table时可直接删除整个namespace
  - 避免单个namespace过大

---

## 4. 分块算法设计

### 4.1 文本分块策略

```python
# src/chunking/service.py

class ChunkingService:
    """负责文本分块的服务"""

    def chunk_text(
        self,
        text: str,
        chunk_size: int = 1000,
        overlap: int = 100
    ) -> List[ChunkSegment]:
        """
        将长文本分块，保持语义连贯性

        策略:
        1. 优先按段落边界分割（\n\n）
        2. 其次按句子边界分割（. ! ? \n）
        3. 最后按单词边界分割
        4. 添加overlap以保持上下文连贯性

        Args:
            text: 原始文本
            chunk_size: 目标chunk大小（字符数）
            overlap: chunk间重叠字符数

        Returns:
            ChunkSegment列表，包含text、char_start、char_end
        """

        chunks = []
        current_pos = 0

        while current_pos < len(text):
            # 计算chunk结束位置
            chunk_end = min(current_pos + chunk_size, len(text))

            # 如果不是最后一块，尝试在边界处截断
            if chunk_end < len(text):
                # 查找最近的段落边界
                paragraph_boundary = text.rfind('\n\n', current_pos, chunk_end)
                if paragraph_boundary > current_pos:
                    chunk_end = paragraph_boundary + 2
                else:
                    # 查找最近的句子边界
                    sentence_boundaries = [
                        text.rfind('. ', current_pos, chunk_end),
                        text.rfind('! ', current_pos, chunk_end),
                        text.rfind('? ', current_pos, chunk_end),
                        text.rfind('\n', current_pos, chunk_end),
                    ]
                    sentence_boundary = max(sentence_boundaries)
                    if sentence_boundary > current_pos:
                        chunk_end = sentence_boundary + 1
                    else:
                        # 查找最近的空格
                        space_boundary = text.rfind(' ', current_pos, chunk_end)
                        if space_boundary > current_pos:
                            chunk_end = space_boundary + 1

            # 提取chunk
            chunk_text = text[current_pos:chunk_end].strip()
            if chunk_text:
                chunks.append(ChunkSegment(
                    text=chunk_text,
                    char_start=current_pos,
                    char_end=chunk_end
                ))

            # 移动位置，考虑overlap
            current_pos = chunk_end - overlap if chunk_end < len(text) else chunk_end

        return chunks
```

### 4.2 JSON树遍历与内容提取

```python
class ChunkingService:

    def extract_large_strings(
        self,
        data: Any,
        current_path: str = "",
        threshold: int = 10000
    ) -> List[LargeStringNode]:
        """
        遍历JSON树，找出所有超过阈值的字符串节点

        Returns:
            LargeStringNode列表，包含json_pointer和content
        """

        large_strings = []

        def traverse(obj: Any, path: str):
            if isinstance(obj, str):
                if len(obj) >= threshold:
                    large_strings.append(LargeStringNode(
                        json_pointer=path,
                        content=obj,
                        node_type="string"
                    ))

            elif isinstance(obj, dict):
                for key, value in obj.items():
                    new_path = f"{path}/{key}"
                    traverse(value, new_path)

            elif isinstance(obj, list):
                for index, item in enumerate(obj):
                    new_path = f"{path}/{index}"
                    traverse(item, new_path)

        traverse(data, current_path or "")
        return large_strings
```

---

## 5. 混合搜索实现

### 5.1 搜索服务架构

```python
# src/search/service.py

class HybridSearchService:
    """混合搜索服务：结合向量搜索和BM25搜索"""

    def __init__(
        self,
        turbopuffer_service: TurbopufferSearchService,
        embedding_service: EmbeddingService
    ):
        self.turbopuffer = turbopuffer_service
        self.embedding = embedding_service

    async def search(
        self,
        namespace: str,
        query: str,
        *,
        table_id: int,
        json_pointer: str = "",
        top_k: int = 5,
        vector_weight: float = 0.7,
        bm25_weight: float = 0.3,
        filters: Optional[Dict[str, Any]] = None
    ) -> HybridSearchResult:
        """
        执行混合搜索

        流程:
        1. 生成query的embedding
        2. 执行multi_query（向量ANN + BM25）
        3. 应用Reciprocal Rank Fusion合并结果
        4. 构建返回结果（chunks + metadata）
        """

        # 1. 生成query embedding
        query_vector = await self.embedding.generate_embeddings([query])
        query_vector = query_vector[0]

        # 2. 构建过滤条件
        base_filters = {"table_id": ["Eq", table_id]}
        if json_pointer:
            base_filters["json_pointer"] = ["Eq", json_pointer]
        if filters:
            base_filters.update(filters)

        # 3. 执行multi-query
        response = await self.turbopuffer.multi_query(
            namespace=namespace,
            queries=[
                # 向量搜索
                {
                    "rank_by": ("vector", "ANN", query_vector),
                    "top_k": top_k * 2,  # 获取更多候选
                    "filters": base_filters,
                },
                # BM25全文搜索
                {
                    "rank_by": ("content", "BM25", query),
                    "top_k": top_k * 2,
                    "filters": base_filters,
                },
            ]
        )

        # 4. Reciprocal Rank Fusion
        fused_results = self._reciprocal_rank_fusion(
            result_lists=response.results,
            vector_weight=vector_weight,
            bm25_weight=bm25_weight,
            k=60  # RRF常数
        )

        # 5. 获取top_k结果
        top_results = fused_results[:top_k]

        # 6. 从数据库加载chunk元数据（补充信息）
        chunk_ids = [r.id for r in top_results]
        chunks_metadata = await self._load_chunks_metadata(chunk_ids)

        # 7. 构建返回结果
        search_results = []
        for result in top_results:
            metadata = chunks_metadata.get(result.turbopuffer_doc_id)
            if metadata:
                search_results.append(SearchResultItem(
                    chunk_text=result.attributes["content"],
                    score=result.score,
                    json_pointer=result.attributes["json_pointer"],
                    chunk_index=result.attributes["chunk_index"],
                    total_chunks=result.attributes["total_chunks"],
                    char_start=result.attributes["char_start"],
                    char_end=result.attributes["char_end"],
                    table_id=result.attributes["table_id"],
                ))

        return HybridSearchResult(
            query=query,
            results=search_results,
            total_results=len(search_results)
        )

    def _reciprocal_rank_fusion(
        self,
        result_lists: List[List[TurbopufferRow]],
        vector_weight: float,
        bm25_weight: float,
        k: int = 60
    ) -> List[TurbopufferRow]:
        """
        Reciprocal Rank Fusion算法

        RRF公式: score(d) = Σ weight_i / (k + rank_i(d))

        参数:
            result_lists: [vector_results, bm25_results]
            vector_weight: 向量搜索权重
            bm25_weight: BM25搜索权重
            k: RRF常数（通常为60）
        """

        scores: Dict[str, float] = {}
        doc_map: Dict[str, TurbopufferRow] = {}
        weights = [vector_weight, bm25_weight]

        for weight, results in zip(weights, result_lists):
            for rank, doc in enumerate(results, start=1):
                doc_id = doc.id
                doc_map[doc_id] = doc

                # RRF公式
                rrf_score = weight / (k + rank)
                scores[doc_id] = scores.get(doc_id, 0.0) + rrf_score

        # 按分数排序
        sorted_ids = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        # 返回排序后的文档，附加融合分数
        results = []
        for doc_id, score in sorted_ids:
            doc = doc_map[doc_id]
            doc.score = score  # 设置融合后的分数
            results.append(doc)

        return results
```

### 5.2 返回数据结构

```python
# src/search/schemas.py

class SearchResultItem(BaseModel):
    """单个搜索结果"""

    # Chunk内容
    chunk_text: str = Field(..., description="chunk的文本内容")
    score: float = Field(..., description="混合搜索评分")

    # 位置信息
    json_pointer: str = Field(..., description="完整内容的JSON指针路径")
    chunk_index: int = Field(..., description="当前chunk在该节点中的序号")
    total_chunks: int = Field(..., description="该节点总共的chunk数量")
    char_start: int = Field(..., description="chunk在原始文本中的起始位置")
    char_end: int = Field(..., description="chunk在原始文本中的结束位置")

    # 引用信息
    table_id: int = Field(..., description="所属table的ID")

    # Agent使用提示
    @property
    def context_hint(self) -> str:
        """生成给Agent的上下文提示"""
        return (
            f"这是第 {self.chunk_index + 1}/{self.total_chunks} 段内容。"
            f"如需查看完整内容，请使用 get_all_data 工具，参数: "
            f"table_id={self.table_id}, json_pointer='{self.json_pointer}'"
        )


class HybridSearchResult(BaseModel):
    """混合搜索结果"""

    query: str = Field(..., description="搜索查询")
    results: List[SearchResultItem] = Field(..., description="搜索结果列表")
    total_results: int = Field(..., description="结果总数")

    # 可选：搜索性能指标
    search_time_ms: Optional[float] = None
    vector_results_count: Optional[int] = None
    bm25_results_count: Optional[int] = None
```

---

## 6. Search Tool工作流程

### 6.1 Tool创建流程

```
用户创建Search Tool
       ↓
检查table_id的data中是否有 >10K 的字符串节点
       ↓
    [否] → 创建Tool记录，标记为"无需分块"
       ↓
    [是]
       ↓
遍历JSON树，提取所有大字符串节点
       ↓
对每个节点:
  1. 计算content_hash
  2. 检查是否已有相同hash的chunks
  3. 如有则跳过，如无则执行分块
       ↓
对每个chunk:
  1. 生成embedding（批量，batch_size=100）
  2. 写入chunks表
  3. 上传到Turbopuffer
       ↓
创建Tool记录，关联namespace
       ↓
返回Tool创建成功
```

### 6.2 Search执行流程

```
Agent调用Search Tool
       ↓
验证权限（project_id, table_id）
       ↓
检查Tool配置:
  - namespace
  - search_config
       ↓
执行HybridSearchService.search()
  1. 生成query embedding
  2. 执行multi-query (Vector + BM25)
  3. Reciprocal Rank Fusion
  4. 加载chunk metadata
       ↓
构建返回结果:
  - chunks列表
  - 每个chunk带有json_pointer和上下文提示
       ↓
返回给Agent
       ↓
Agent根据需要调用get_all_data获取完整内容
```

### 6.3 数据更新检测与重新分块

```
context_table.data 发生更新
       ↓
触发器/事件监听
       ↓
查找关联的Search Tools
       ↓
对每个Tool:
  1. 提取当前的大字符串节点
  2. 计算新的content_hash
  3. 与chunks表中的hash对比
       ↓
    [hash相同] → 跳过
       ↓
    [hash不同]
       ↓
  1. 删除旧chunks（DB + Turbopuffer）
  2. 重新分块
  3. 生成新embeddings
  4. 写入DB和Turbopuffer
       ↓
更新Tool的updated_at时间戳
```

---

## 7. 数据库Schema变更

### 7.1 新增chunks表

见 [3.1 Chunk元数据表](#31-chunk元数据表-chunks-table)

### 7.2 扩展tool表

```sql
-- 在现有tool表中添加字段
ALTER TABLE tool ADD COLUMN search_config JSONB DEFAULT NULL;
ALTER TABLE tool ADD COLUMN turbopuffer_namespace VARCHAR(255) DEFAULT NULL;

-- 添加索引
CREATE INDEX idx_tool_turbopuffer_namespace ON tool(turbopuffer_namespace);
```

### 7.3 数据库触发器（可选）

```sql
-- 监听context_table.data的更新，触发重新分块
CREATE OR REPLACE FUNCTION notify_data_update()
RETURNS TRIGGER AS $$
BEGIN
    -- 通知应用层data发生了变化
    PERFORM pg_notify('context_data_changed',
        json_build_object(
            'table_id', NEW.id,
            'updated_at', NEW.updated_at
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER context_data_update_trigger
AFTER UPDATE OF data ON context_table
FOR EACH ROW
WHEN (OLD.data IS DISTINCT FROM NEW.data)
EXECUTE FUNCTION notify_data_update();
```

---

## 8. API设计

### 8.1 创建Search Tool

**Endpoint**: `POST /api/v1/tools/search`

**Request**:
```json
{
    "project_id": 123,
    "table_id": 456,
    "name": "search_knowledge_base",
    "description": "搜索AI技术知识库",
    "json_pointer": "/articles",
    "search_config": {
        "top_k": 5,
        "chunk_size": 1000,
        "chunk_overlap": 100,
        "vector_weight": 0.7,
        "bm25_weight": 0.3
    }
}
```

**Response**:
```json
{
    "tool_id": 789,
    "name": "search_knowledge_base",
    "status": "ready",
    "chunks_created": 45,
    "namespace": "project_123_table_456",
    "large_nodes_detected": [
        {
            "json_pointer": "/articles/0/content",
            "char_count": 15234,
            "chunks_count": 16
        },
        {
            "json_pointer": "/articles/1/content",
            "char_count": 12456,
            "chunks_count": 13
        }
    ]
}
```

### 8.2 执行Search

**MCP Tool调用**: `search_knowledge_base`

**Input**:
```json
{
    "query": "transformer模型的注意力机制是如何工作的？",
    "top_k": 5
}
```

**Output**:
```json
{
    "query": "transformer模型的注意力机制是如何工作的？",
    "total_results": 5,
    "results": [
        {
            "chunk_text": "Transformer的核心创新是自注意力机制（Self-Attention）...",
            "score": 0.87,
            "json_pointer": "/articles/0/content",
            "chunk_index": 2,
            "total_chunks": 16,
            "char_start": 2000,
            "char_end": 3000,
            "table_id": 456,
            "context_hint": "这是第 3/16 段内容。如需查看完整内容，请使用 get_all_data 工具，参数: table_id=456, json_pointer='/articles/0/content'"
        }
    ]
}
```

### 8.3 内部管理API

**查看Tool的chunks状态**: `GET /internal/tools/{tool_id}/chunks/stats`

**强制重新分块**: `POST /internal/tools/{tool_id}/chunks/rebuild`

**删除Tool的chunks**: `DELETE /internal/tools/{tool_id}/chunks`

---

## 9. 核心服务实现

### 9.1 文件结构

```
src/
├── chunking/
│   ├── __init__.py
│   ├── service.py          # ChunkingService: 文本分块逻辑
│   ├── schemas.py          # Chunk相关的数据模型
│   └── repository.py       # Chunk数据库操作
│
├── search/
│   ├── __init__.py
│   ├── service.py          # HybridSearchService: 混合搜索服务
│   ├── schemas.py          # Search请求/响应模型
│   └── router.py           # Search API路由
│
├── tool/
│   ├── service.py          # 扩展ToolService，支持search类型
│   ├── search_tool.py      # Search Tool的创建和管理逻辑
│   └── schemas.py          # 扩展Tool schemas
│
└── mcp/
    └── search_tool.py      # Search Tool的MCP集成
```

### 9.2 依赖注入

```python
# src/search/dependencies.py

from functools import lru_cache
from src.search.service import HybridSearchService
from src.turbopuffer.service import TurbopufferSearchService
from src.llm.embedding_service import EmbeddingService

@lru_cache()
def get_hybrid_search_service() -> HybridSearchService:
    """获取混合搜索服务实例"""
    turbopuffer_service = TurbopufferSearchService()
    embedding_service = EmbeddingService()
    return HybridSearchService(
        turbopuffer_service=turbopuffer_service,
        embedding_service=embedding_service
    )
```

---

## 10. 关键技术细节

### 10.1 Embedding批量生成优化

```python
# 分批生成embeddings以避免超时和内存问题
async def generate_embeddings_batch(
    texts: List[str],
    batch_size: int = 100
) -> List[List[float]]:
    """批量生成embeddings"""

    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        embeddings = await embedding_service.generate_embeddings(batch)
        all_embeddings.extend(embeddings)

        # 添加短暂延迟以避免速率限制
        await asyncio.sleep(0.1)

    return all_embeddings
```

### 10.2 Turbopuffer批量上传

```python
async def upload_chunks_to_turbopuffer(
    namespace: str,
    chunks: List[ChunkWithEmbedding]
) -> TurbopufferWriteResponse:
    """批量上传chunks到Turbopuffer"""

    rows = []
    for chunk in chunks:
        rows.append({
            "id": chunk.turbopuffer_doc_id,
            "vector": chunk.embedding,
            "attributes": {
                "table_id": chunk.table_id,
                "json_pointer": chunk.json_pointer,
                "chunk_index": chunk.chunk_index,
                "total_chunks": chunk.total_chunks,
                "content": chunk.chunk_text,
                "char_start": chunk.char_start,
                "char_end": chunk.char_end,
                "content_hash": chunk.content_hash,
                "created_at": chunk.created_at.isoformat(),
            }
        })

    return await turbopuffer_service.upsert_rows(
        namespace=namespace,
        rows=rows
    )
```

### 10.3 内容哈希计算

```python
import hashlib

def compute_content_hash(content: str) -> str:
    """计算内容的SHA256哈希"""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()
```

### 10.4 JSON Pointer编码

```python
import urllib.parse

def encode_json_pointer_for_id(json_pointer: str) -> str:
    """
    将JSON Pointer编码为适合用作ID的格式

    示例:
        "/articles/0/content" -> "articles_0_content"
        "" -> "root"
    """
    if not json_pointer:
        return "root"

    # 移除开头的 /
    pointer = json_pointer.lstrip('/')

    # 替换 / 为 _
    encoded = pointer.replace('/', '_')

    # URL编码特殊字符
    encoded = urllib.parse.quote(encoded, safe='_')

    return encoded


def generate_turbopuffer_doc_id(
    table_id: int,
    json_pointer: str,
    chunk_index: int
) -> str:
    """生成Turbopuffer文档ID"""
    encoded_pointer = encode_json_pointer_for_id(json_pointer)
    return f"{table_id}:{encoded_pointer}:chunk_{chunk_index}"
```

---

## 11. 边缘情况处理

### 11.1 并发创建处理

**场景**: 多个用户同时为同一个table创建Search Tool

**解决方案**:
```python
# 使用数据库锁防止重复分块
async def ensure_chunks_for_node(
    table_id: int,
    json_pointer: str,
    content: str
) -> List[Chunk]:
    """确保节点已分块，使用锁防止并发重复创建"""

    content_hash = compute_content_hash(content)

    # 尝试获取已存在的chunks
    existing_chunks = await chunk_repo.get_by_hash(
        table_id=table_id,
        json_pointer=json_pointer,
        content_hash=content_hash
    )

    if existing_chunks:
        return existing_chunks

    # 使用数据库行锁
    async with db.transaction():
        # 再次检查（double-check locking）
        existing_chunks = await chunk_repo.get_by_hash(
            table_id=table_id,
            json_pointer=json_pointer,
            content_hash=content_hash
        )

        if existing_chunks:
            return existing_chunks

        # 创建新chunks
        chunks = await create_chunks(table_id, json_pointer, content)
        return chunks
```

### 11.2 部分失败处理

**场景**: embedding生成成功但Turbopuffer上传失败

**解决方案**:
```python
async def create_chunks_with_retry(
    chunks_data: List[ChunkData]
) -> ChunkCreationResult:
    """创建chunks，支持部分重试"""

    db_chunks = []
    failed_chunks = []

    # 1. 先写入数据库
    try:
        db_chunks = await chunk_repo.bulk_create(chunks_data)
    except Exception as e:
        logger.error(f"Failed to save chunks to DB: {e}")
        raise

    # 2. 上传到Turbopuffer（允许部分失败）
    try:
        await upload_chunks_to_turbopuffer(namespace, db_chunks)
    except Exception as e:
        logger.error(f"Failed to upload to Turbopuffer: {e}")

        # 标记为需要重试
        await chunk_repo.mark_needs_sync(
            chunk_ids=[c.id for c in db_chunks]
        )

        # 可以选择：
        # - 异步重试队列
        # - 返回部分成功状态
        # - 回滚数据库操作

        raise

    return ChunkCreationResult(
        created=db_chunks,
        failed=failed_chunks
    )
```

### 11.3 数据删除同步

**场景**: 删除table时需要同步删除chunks

**解决方案**:
```python
# 使用数据库级联删除 + Turbopuffer清理
async def delete_table_cascade(table_id: int):
    """删除table及其关联资源"""

    # 1. 查找所有关联的Search Tools
    tools = await tool_repo.find_search_tools_by_table(table_id)

    # 2. 删除Turbopuffer namespaces
    for tool in tools:
        if tool.turbopuffer_namespace:
            try:
                await turbopuffer_service.delete_namespace(
                    tool.turbopuffer_namespace
                )
            except Exception as e:
                logger.error(f"Failed to delete namespace: {e}")
                # 继续执行，不阻塞

    # 3. 删除数据库记录（级联删除chunks）
    await table_repo.delete(table_id)
```

### 11.4 超大节点处理

**场景**: 单个字符串节点超过1MB（生成大量chunks）

**解决方案**:
```python
# 设置最大chunk数量限制
MAX_CHUNKS_PER_NODE = 500
MAX_CONTENT_SIZE = 500_000  # 500KB

async def validate_and_chunk_content(content: str) -> List[Chunk]:
    """验证内容大小并分块"""

    if len(content) > MAX_CONTENT_SIZE:
        raise ValueError(
            f"Content size ({len(content)}) exceeds maximum "
            f"allowed size ({MAX_CONTENT_SIZE})"
        )

    chunks = chunking_service.chunk_text(content)

    if len(chunks) > MAX_CHUNKS_PER_NODE:
        raise ValueError(
            f"Content would generate {len(chunks)} chunks, "
            f"exceeding maximum ({MAX_CHUNKS_PER_NODE})"
        )

    return chunks
```

---

## 12. 性能优化策略

### 12.1 缓存策略

```python
# 缓存namespace元数据
from functools import lru_cache
from cachetools import TTLCache

# Tool配置缓存（5分钟）
tool_config_cache = TTLCache(maxsize=1000, ttl=300)

# Embedding缓存（相同文本复用embedding）
embedding_cache = TTLCache(maxsize=10000, ttl=3600)

async def get_cached_embedding(text: str) -> List[float]:
    """获取或生成embedding，带缓存"""
    cache_key = hashlib.md5(text.encode()).hexdigest()

    if cache_key in embedding_cache:
        return embedding_cache[cache_key]

    embedding = await embedding_service.generate_embeddings([text])
    embedding_cache[cache_key] = embedding[0]

    return embedding[0]
```

### 12.2 异步任务队列

```python
# 使用Celery/RQ处理耗时的分块任务
from celery import Celery

celery_app = Celery('chunking_tasks')

@celery_app.task
def create_chunks_async(table_id: int, json_pointer: str, content: str):
    """异步创建chunks"""
    # 执行分块、embedding生成、上传
    pass

# 在Tool创建时提交任务
async def create_search_tool(tool_data: SearchToolCreate):
    # 创建Tool记录（状态=pending）
    tool = await tool_repo.create(tool_data, status="pending")

    # 异步处理大节点
    for node in large_nodes:
        create_chunks_async.delay(
            table_id=tool.table_id,
            json_pointer=node.json_pointer,
            content=node.content
        )

    return tool
```

### 12.3 数据库查询优化

```python
# 使用复合索引加速查询
"""
CREATE INDEX idx_chunks_table_pointer_hash
ON chunks(table_id, json_pointer, content_hash);

CREATE INDEX idx_chunks_turbopuffer_doc
ON chunks(turbopuffer_doc_id);
"""

# 批量加载chunk元数据
async def load_chunks_metadata(
    turbopuffer_doc_ids: List[str]
) -> Dict[str, Chunk]:
    """批量加载chunk元数据"""
    chunks = await chunk_repo.find_by_turbopuffer_ids(turbopuffer_doc_ids)
    return {c.turbopuffer_doc_id: c for c in chunks}
```

---

## 13. 监控与可观测性

### 13.1 关键指标

```python
# Prometheus指标
from prometheus_client import Counter, Histogram, Gauge

# Chunking指标
chunks_created_total = Counter(
    'chunks_created_total',
    'Total chunks created',
    ['table_id']
)

chunking_duration_seconds = Histogram(
    'chunking_duration_seconds',
    'Time spent chunking content',
    buckets=[0.1, 0.5, 1.0, 5.0, 10.0, 30.0]
)

# Search指标
search_requests_total = Counter(
    'search_requests_total',
    'Total search requests',
    ['tool_id', 'status']
)

search_duration_seconds = Histogram(
    'search_duration_seconds',
    'Search query duration',
    buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 2.0]
)

search_results_count = Histogram(
    'search_results_count',
    'Number of results returned',
    buckets=[0, 1, 5, 10, 20, 50]
)

# Turbopuffer指标
turbopuffer_upload_errors = Counter(
    'turbopuffer_upload_errors_total',
    'Turbopuffer upload errors'
)

# 当前chunks数量
active_chunks_gauge = Gauge(
    'active_chunks_total',
    'Total number of active chunks in database'
)
```

### 13.2 日志记录

```python
import structlog

logger = structlog.get_logger(__name__)

# 结构化日志
logger.info(
    "chunks_created",
    table_id=table_id,
    json_pointer=json_pointer,
    chunks_count=len(chunks),
    content_size=len(content),
    duration_seconds=duration
)

logger.error(
    "turbopuffer_upload_failed",
    namespace=namespace,
    chunks_count=len(chunks),
    error=str(e),
    exc_info=True
)
```

---

## 14. 测试策略

### 14.1 单元测试

```python
# tests/chunking/test_service.py

import pytest
from src.chunking.service import ChunkingService

def test_chunk_text_basic():
    """测试基本文本分块"""
    service = ChunkingService()
    text = "A" * 5000  # 5000字符
    chunks = service.chunk_text(text, chunk_size=1000, overlap=100)

    assert len(chunks) == 6  # 5000 / (1000-100) ≈ 5.5 → 6 chunks
    assert chunks[0].char_start == 0
    assert chunks[-1].char_end == 5000


def test_chunk_text_preserves_boundaries():
    """测试分块边界保持"""
    service = ChunkingService()
    text = "Sentence one. Sentence two.\n\nParagraph two."
    chunks = service.chunk_text(text, chunk_size=20, overlap=5)

    # 验证在句子边界处分割
    for chunk in chunks:
        assert not chunk.text.startswith(' ')
        assert chunk.text.strip() == chunk.text


# tests/search/test_service.py

@pytest.mark.asyncio
async def test_hybrid_search():
    """测试混合搜索"""
    # Mock dependencies
    turbopuffer_service = Mock(TurbopufferSearchService)
    embedding_service = Mock(EmbeddingService)

    service = HybridSearchService(turbopuffer_service, embedding_service)

    # 执行搜索
    result = await service.search(
        namespace="test_ns",
        query="test query",
        table_id=1,
        top_k=5
    )

    assert result.total_results <= 5
    assert all(r.score >= 0 for r in result.results)
```

### 14.2 集成测试

```python
# tests/e2e/test_search_tool_e2e.py

@pytest.mark.e2e
async def test_create_search_tool_with_large_content():
    """端到端测试：创建Search Tool并执行搜索"""

    # 1. 创建table with large content
    table = await create_test_table(data={
        "article": {
            "content": "A" * 15000  # 15KB content
        }
    })

    # 2. 创建Search Tool
    tool = await create_search_tool(
        table_id=table.id,
        json_pointer="/article"
    )

    # 3. 验证chunks已创建
    chunks = await get_chunks(table_id=table.id)
    assert len(chunks) > 0

    # 4. 执行搜索
    results = await execute_search(
        tool_id=tool.id,
        query="test query"
    )

    assert results.total_results > 0
    assert all(r.json_pointer == "/article/content" for r in results.results)
```

### 14.3 性能测试

```python
# tests/performance/test_chunking_performance.py

import time

def test_chunking_performance_large_content():
    """测试大内容分块性能"""
    service = ChunkingService()

    # 生成1MB内容
    content = "A" * 1_000_000

    start = time.time()
    chunks = service.chunk_text(content, chunk_size=1000, overlap=100)
    duration = time.time() - start

    # 应在1秒内完成
    assert duration < 1.0
    assert len(chunks) > 0


@pytest.mark.asyncio
async def test_embedding_batch_performance():
    """测试批量embedding生成性能"""
    service = EmbeddingService()

    # 100个chunks
    texts = ["Sample text " * 100] * 100

    start = time.time()
    embeddings = await service.generate_embeddings_batch(texts)
    duration = time.time() - start

    # 记录性能数据
    print(f"Generated {len(embeddings)} embeddings in {duration:.2f}s")
    assert len(embeddings) == 100
```

---

## 15. 部署与运维

### 15.1 配置管理

```python
# src/search/config.py

from pydantic_settings import BaseSettings

class SearchConfig(BaseSettings):
    """Search服务配置"""

    # Chunking配置
    default_chunk_size: int = 1000
    default_chunk_overlap: int = 100
    max_chunks_per_node: int = 500
    max_content_size: int = 500_000

    # Search配置
    default_top_k: int = 5
    max_top_k: int = 20
    default_vector_weight: float = 0.7
    default_bm25_weight: float = 0.3

    # 性能配置
    embedding_batch_size: int = 100
    turbopuffer_batch_size: int = 1000

    # 缓存配置
    enable_embedding_cache: bool = True
    embedding_cache_ttl: int = 3600
    tool_config_cache_ttl: int = 300

    class Config:
        env_prefix = "SEARCH_"


search_config = SearchConfig()
```

### 15.2 数据库迁移

```python
# alembic/versions/xxx_add_chunks_table.py

from alembic import op
import sqlalchemy as sa

def upgrade():
    # 创建chunks表
    op.create_table(
        'chunks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('table_id', sa.Integer(), nullable=False),
        sa.Column('json_pointer', sa.String(1024), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('total_chunks', sa.Integer(), nullable=False),
        sa.Column('chunk_text', sa.Text(), nullable=False),
        sa.Column('char_start', sa.Integer(), nullable=False),
        sa.Column('char_end', sa.Integer(), nullable=False),
        sa.Column('turbopuffer_namespace', sa.String(255), nullable=False),
        sa.Column('turbopuffer_doc_id', sa.String(255), nullable=False),
        sa.Column('content_hash', sa.String(64), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['table_id'], ['context_table.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('turbopuffer_doc_id')
    )

    # 创建索引
    op.create_index('idx_table_json_pointer', 'chunks', ['table_id', 'json_pointer'])
    op.create_index('idx_content_hash', 'chunks', ['content_hash'])
    op.create_index('idx_turbopuffer_namespace', 'chunks', ['turbopuffer_namespace'])

    # 扩展tool表
    op.add_column('tool', sa.Column('search_config', sa.JSON(), nullable=True))
    op.add_column('tool', sa.Column('turbopuffer_namespace', sa.String(255), nullable=True))
    op.create_index('idx_tool_turbopuffer_namespace', 'tool', ['turbopuffer_namespace'])


def downgrade():
    op.drop_index('idx_tool_turbopuffer_namespace', 'tool')
    op.drop_column('tool', 'turbopuffer_namespace')
    op.drop_column('tool', 'search_config')

    op.drop_index('idx_turbopuffer_namespace', 'chunks')
    op.drop_index('idx_content_hash', 'chunks')
    op.drop_index('idx_table_json_pointer', 'chunks')
    op.drop_table('chunks')
```

### 15.3 运维脚本

```python
# scripts/rebuild_all_chunks.py

"""重建所有Search Tools的chunks"""

import asyncio
from src.tool.service import ToolService
from src.chunking.service import ChunkingService

async def rebuild_all_chunks():
    tool_service = ToolService()
    chunking_service = ChunkingService()

    # 获取所有Search Tools
    search_tools = await tool_service.find_all_search_tools()

    for tool in search_tools:
        print(f"Rebuilding chunks for tool {tool.id}...")

        try:
            # 删除旧chunks
            await chunking_service.delete_chunks(tool.id)

            # 重新创建
            await chunking_service.create_chunks_for_tool(tool.id)

            print(f"✓ Tool {tool.id} rebuilt successfully")
        except Exception as e:
            print(f"✗ Tool {tool.id} failed: {e}")


if __name__ == "__main__":
    asyncio.run(rebuild_all_chunks())
```

---

## 16. 实施路线图

### Phase 1: 核心基础设施（2周）
- [x] 创建chunks表和迁移
- [x] 实现ChunkingService（文本分块逻辑）
- [x] 实现Chunk Repository（数据库操作）
- [x] 单元测试

### Phase 2: Turbopuffer集成（1周）
- [ ] 实现批量embedding生成
- [ ] 实现Turbopuffer批量上传
- [ ] 实现namespace管理
- [ ] 集成测试

### Phase 3: 混合搜索服务（2周）
- [ ] 实现HybridSearchService
- [ ] 实现Reciprocal Rank Fusion
- [ ] 实现搜索结果构建
- [ ] 性能测试

### Phase 4: Search Tool集成（2周）
- [ ] 扩展Tool模型和API
- [ ] 实现Search Tool创建流程
- [ ] 实现MCP Tool集成
- [ ] 端到端测试
