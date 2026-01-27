# Folder Search 功能设计与实现

> **版本**: v1.0  
> **日期**: 2026-01-27  
> **作者**: PuppyOne Team

## 1. 功能概述

### 1.1 背景

系统重构后采用以 folder 为中心的架构，支持嵌套的 folder 结构。原有的 turbopuffer vector search 仅支持对单个 JSON 节点进行搜索。本次开发扩展了搜索能力，**支持对整个 folder 内的所有文档进行语义搜索**。

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| **跨文件搜索** | 支持搜索 folder 下所有 JSON 和 Markdown 文件 |
| **文件路径追踪** | 搜索结果包含完整的文件路径信息，方便 Agent 定位 |
| **成本优化** | Turbopuffer 仅存储 metadata，`chunk_text` 存储在 PostgreSQL |
| **异步索引** | 支持大量文件的后台异步索引，带进度追踪 |
| **兼容性** | 与原有的单节点 JSON 搜索共存，通过节点类型自动判断 |

### 1.3 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer (tool/router.py)               │
│  create_search_tool_async() → 判断 node.type → 选择索引策略     │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
    ┌─────────────────────┐         ┌─────────────────────┐
    │  JSON Node Search   │         │   Folder Search     │
    │  (原有逻辑)         │         │   (新增逻辑)        │
    │  namespace:         │         │  namespace:         │
    │  project_X_node_Y   │         │  project_X_folder_Y │
    └─────────────────────┘         └─────────────────────┘
                │                               │
                └───────────────┬───────────────┘
                                ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                      SearchService                          │
    │  - index_scope() / index_folder()                          │
    │  - search_scope() / search_folder()                        │
    └─────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
    ┌─────────────────────┐         ┌─────────────────────┐
    │   Turbopuffer       │         │    PostgreSQL       │
    │   (vectors +        │         │    (chunk_text +    │
    │    metadata)        │         │     file info)      │
    └─────────────────────┘         └─────────────────────┘
```

---

## 2. 数据模型

### 2.1 Namespace 命名规则

| 搜索类型 | Namespace 格式 | 示例 |
|---------|---------------|------|
| 单节点 JSON 搜索 | `project_{project_id}_node_{node_id}` | `project_abc123_node_xyz789` |
| Folder 搜索 | `project_{project_id}_folder_{folder_node_id}` | `project_abc123_folder_folder001` |

### 2.2 Turbopuffer 文档结构

Folder 搜索的文档包含扩展的 metadata：

```python
{
    "id": "file-abc123_0_hash123",  # build_folder_doc_id() 生成
    "vector": [0.1, 0.2, ...],       # 4096 维 embedding
    
    # 基础 metadata
    "json_pointer": "/config/auth",
    "chunk_index": 0,
    "total_chunks": 3,
    "content_hash": "sha256...",
    "chunk_id": 123,
    
    # 文件路径信息 (Folder Search 专用)
    "file_node_id": "file-abc123",
    "file_id_path": "/folder-001/file-abc123",
    "file_name": "config.json",
    "file_type": "json"
}
```

### 2.3 数据库扩展

`search_index_task` 表新增字段：

```sql
ALTER TABLE public.search_index_task ADD COLUMN IF NOT EXISTS 
  folder_node_id TEXT NULL;
ALTER TABLE public.search_index_task ADD COLUMN IF NOT EXISTS 
  total_files INTEGER NULL;
ALTER TABLE public.search_index_task ADD COLUMN IF NOT EXISTS 
  indexed_files INTEGER NULL;

-- 索引
CREATE INDEX IF NOT EXISTS idx_search_index_task_folder_node_id
ON public.search_index_task (folder_node_id)
WHERE folder_node_id IS NOT NULL;
```

---

## 3. 核心实现

### 3.1 文件结构

```
src/
├── search/
│   ├── service.py          # 核心搜索逻辑
│   │   ├── build_folder_namespace()      # 构建 folder namespace
│   │   ├── build_folder_doc_id()         # 构建文档 ID
│   │   ├── index_folder()                # folder 索引入口
│   │   ├── _index_file_node()            # 单文件索引
│   │   └── search_folder()               # folder 搜索
│   └── index_task.py       # 索引任务模型
│
├── content_node/
│   └── service.py          # 新增 list_indexable_descendants()
│
└── tool/
    └── router.py           # API 路由，判断 node 类型
```

### 3.2 关键代码

#### 3.2.1 Namespace 构建

```python
# src/search/service.py

@staticmethod
def build_folder_namespace(*, project_id: str, folder_node_id: str) -> str:
    """构建 folder 搜索的 namespace"""
    return f"project_{project_id}_folder_{folder_node_id}"

@staticmethod
def build_folder_doc_id(
    *, file_node_id: str, json_pointer: str, content_hash: str, chunk_index: int
) -> str:
    """构建 folder 搜索的文档 ID"""
    pointer_encoded = (json_pointer or "/").replace("/", "_")
    hash_short = content_hash[:8] if content_hash else "nohash"
    return f"{file_node_id[:12]}_{pointer_encoded}_{hash_short}_{chunk_index}"
```

#### 3.2.2 Folder 索引流程

```python
async def index_folder(
    self,
    *,
    project_id: str,
    folder_node_id: str,
    progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
) -> FolderIndexStats:
    """
    索引整个 folder 下的所有可索引文件
    
    流程:
    1. 获取 folder 下所有可索引子节点 (json, markdown)
    2. 遍历每个文件，调用 _index_file_node()
    3. 通过 progress_callback 报告进度
    """
    
    # 获取可索引的子节点
    indexable_nodes = self.content_node_service.list_indexable_descendants(
        project_id, folder_node_id, indexable_types=["json", "markdown"]
    )
    
    namespace = self.build_folder_namespace(
        project_id=project_id, folder_node_id=folder_node_id
    )
    
    stats = FolderIndexStats(
        total_files=len(indexable_nodes),
        indexed_files=0,
        total_chunks=0,
        namespace=namespace,
    )
    
    for i, node in enumerate(indexable_nodes):
        # 索引单个文件
        file_stats = await self._index_file_node(
            node=node,
            namespace=namespace,
            project_id=project_id,
        )
        
        stats.indexed_files += 1
        stats.total_chunks += file_stats.chunks_created
        
        # 报告进度
        if progress_callback:
            await progress_callback(stats.indexed_files, stats.total_files)
    
    return stats
```

#### 3.2.3 Folder 搜索

```python
async def search_folder(
    self,
    *,
    project_id: str,
    folder_node_id: str,
    query: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """
    在 folder 范围内进行语义搜索
    
    返回结果包含:
    - chunk_text: 从 PostgreSQL 回填
    - file_node_id, file_id_path, file_name, file_type
    - json_pointer, chunk_index, total_chunks
    - score/distance
    """
    
    namespace = self.build_folder_namespace(
        project_id=project_id, folder_node_id=folder_node_id
    )
    
    # 生成查询向量
    query_vector = await self.embedding_service.generate_embedding(query)
    
    # Turbopuffer 向量搜索
    response = await self.turbopuffer_service.query(
        namespace,
        rank_by=("vector", "ANN", query_vector),
        top_k=top_k,
        include_attributes=True,
    )
    
    # 回填 chunk_text (从 PostgreSQL)
    results = []
    for row in response.rows:
        attrs = row.attributes or {}
        chunk_id = attrs.get("chunk_id")
        
        # 从数据库获取 chunk_text
        chunk_text = await self._get_chunk_text_from_db(chunk_id)
        
        results.append({
            "chunk_text": chunk_text,
            "score": row.score,
            "distance": row.distance,
            "file_node_id": attrs.get("file_node_id"),
            "file_id_path": attrs.get("file_id_path"),
            "file_name": attrs.get("file_name"),
            "file_type": attrs.get("file_type"),
            "json_pointer": attrs.get("json_pointer"),
            "chunk_index": attrs.get("chunk_index"),
            "total_chunks": attrs.get("total_chunks"),
        })
    
    return results
```

### 3.3 API 路由判断

```python
# src/tool/router.py

@router.post("/search")
async def create_search_tool_async(payload: CreateSearchToolRequest):
    # 获取目标节点
    node = content_node_service.get_node(payload.project_id, payload.node_id)
    
    # 判断是 folder 还是单节点
    is_folder_search = (node.type == "folder")
    
    if is_folder_search:
        # Folder 搜索：创建后台任务
        task = SearchIndexTaskUpsert(
            tool_id=str(tool.id),
            folder_node_id=payload.node_id,
            status="pending",
        )
        # 启动异步索引
        asyncio.create_task(_run_folder_search_indexing_background(...))
    else:
        # 单节点搜索：使用原有逻辑
        asyncio.create_task(_run_search_indexing_background(...))
```

---

## 4. 搜索结果格式

### 4.1 API 响应示例

```json
{
  "query": "authentication JWT token",
  "total_results": 3,
  "results": [
    {
      "chunk_text": "The configuration contains API endpoints for user authentication...",
      "score": 0.19,
      "file_node_id": "file-data-68abc",
      "file_id_path": "/folder-001/file-data-68abc",
      "file_name": "config.json",
      "file_type": "json",
      "json_pointer": "/config/auth",
      "chunk_index": 0,
      "total_chunks": 2
    },
    {
      "chunk_text": "Remember to update the JWT secret when deploying...",
      "score": 0.38,
      "file_node_id": "file-notes-7cd",
      "file_id_path": "/folder-001/file-notes-7cd",
      "file_name": "notes.md",
      "file_type": "markdown",
      "json_pointer": "/",
      "chunk_index": 0,
      "total_chunks": 1
    }
  ]
}
```

### 4.2 Agent 使用指南

搜索结果提供了足够的信息让 Agent 定位文件：

```python
# Agent 可以根据搜索结果获取完整内容
result = search_results[0]

# 方式1: 通过 file_node_id 获取完整文件
full_content = await get_node_content(result["file_node_id"])

# 方式2: 通过 file_id_path 导航到文件
file_path = result["file_id_path"]  # "/folder-001/file-data-68abc"

# 方式3: 通过 json_pointer 定位具体内容
pointer = result["json_pointer"]  # "/config/auth"
```

---

## 5. 索引任务状态追踪

### 5.1 状态流转

```
pending → indexing → ready
              ↓
            error
```

### 5.2 查询索引状态

```python
GET /api/tools/search/{tool_id}/status

{
  "tool_id": "abc123",
  "status": "indexing",
  "folder_node_id": "folder-001",
  "total_files": 10,
  "indexed_files": 3,
  "progress": 0.3
}
```

---

## 6. E2E 测试验证

### 6.1 运行测试

```bash
cd /Volumes/Portable/puppy-agents-workspace/PuppyContext/backend
uv run pytest tests/e2e/folder_search/test_folder_search_e2e.py -v -s
```

### 6.2 测试数据

测试创建了以下模拟数据：

| 文件 | 类型 | Chunks |
|------|------|--------|
| readme.md | markdown | 2 |
| data.json | json | 2 |
| notes.md | markdown | 1 |

### 6.3 测试验证点

| 测试查询 | 预期命中 | 实际结果 |
|---------|---------|---------|
| "authentication login JWT" | data.json /config/auth | ✅ |
| "semantic search embedding model" | notes.md | ✅ |
| "project overview features" | readme.md | ✅ |
| "PostgreSQL database connection" | data.json /config/database | ✅ |

### 6.4 查看测试数据

测试数据保留在 Turbopuffer，可以通过以下方式查看：

```python
from src.turbopuffer.service import TurbopufferSearchService
import asyncio

# 替换为实际的 namespace
namespace = "e2e-folder-search-20260127-125742-6d936ea9"

svc = TurbopufferSearchService()
result = asyncio.run(svc.query(
    namespace,
    rank_by=("id", "asc"),
    top_k=10,
    include_attributes=True,
))

for r in result.rows:
    print(f"ID: {r.id}")
    print(f"  File: {r.attributes.get('file_name')}")
    print(f"  Path: {r.attributes.get('file_id_path')}")
    print(f"  Pointer: {r.attributes.get('json_pointer')}")
    print()
```

---

## 7. 配置说明

### 7.1 环境变量

```bash
# Turbopuffer
TURBOPUFFER_API_KEY=tpuf_xxx
TURBOPUFFER_REGION="gcp-us-central1"

# Embedding
DEFAULT_EMBEDDING_MODEL=openrouter/qwen/qwen3-embedding-8b
EMBEDDING_DIMENSIONS=4096
EMBEDDING_BATCH_SIZE=20

# Chunking
CHUNK_SIZE_CHARS=1024
CHUNK_OVERLAP_CHARS=200
CHUNK_THRESHOLD_CHARS=10000
```

### 7.2 支持的文件类型

| 文件类型 | type 值 | 内容来源 |
|---------|---------|---------|
| JSON | `json` | `node.content` 字段 |
| Markdown | `markdown` | S3 存储 (`node.s3_key`) |

---

## 8. 注意事项

### 8.1 成本优化

- **Turbopuffer 只存储 metadata**：`chunk_text` 存储在 PostgreSQL 的 `chunks` 表中
- **按需索引**：只有创建 search tool 时才会触发索引
- **增量更新**：通过 `content_hash` 检测内容变化，避免重复索引

### 8.2 性能考虑

- **大 folder 异步处理**：通过后台任务处理，避免 API 超时
- **进度追踪**：`search_index_task` 表记录 `total_files` 和 `indexed_files`
- **批量 embedding**：使用 `generate_embeddings_batch()` 批量生成向量

### 8.3 错误处理

- 索引失败时，任务状态设为 `error`，记录错误信息
- 单个文件索引失败不影响其他文件
- 支持重试机制

---

## 9. 后续规划

- [ ] 支持更多文件类型（PDF、Images with OCR）
- [ ] 混合搜索（Vector + BM25）
- [ ] 增量索引（文件变更时只更新变更部分）
- [ ] 索引任务取消和重试 UI
