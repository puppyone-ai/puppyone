# Turbopuffer 开发者使用指南

## 目录
- [简介](#简介)
- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [数据写入](#数据写入)
- [向量搜索](#向量搜索)
- [全文搜索](#全文搜索)
- [混合搜索](#混合搜索)
- [高级特性](#高级特性)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

---

## 简介

Turbopuffer 是一款高性能搜索引擎服务，专为 RAG（检索增强生成）应用而设计。它结合了以下核心能力：

- **向量搜索**：基于 ANN（近似最近邻）的语义相似度搜索
- **全文搜索**：基于 BM25 算法的传统文本搜索
- **混合搜索**：结合向量和全文搜索的优势，提供更精准的检索结果
- **高性能**：p50 延迟仅 8ms，支持亿级文档规模
- **对象存储**：使所有数据都易于搜索和管理

### 适用场景

- RAG 知识库检索
- 语义搜索应用
- 文档管理系统
- 推荐系统
- 问答系统

---

## 快速开始

### 安装

使用 pip 或 uv 安装 Turbopuffer SDK：

```bash
# 使用 pip
pip install turbopuffer

# 使用 uv
uv pip install turbopuffer
```

### 配置

1. **获取 API Key**：访问 [Turbopuffer Dashboard](https://turbopuffer.com/dashboard) 创建 API token

2. **设置环境变量**：
```bash
export TURBOPUFFER_API_KEY="tpuf_A1..."
```

推荐使用 `python-dotenv` 管理环境变量：
```bash
pip install python-dotenv
```

在项目根目录创建 `.env` 文件：
```
TURBOPUFFER_API_KEY=tpuf_A1...
```

### 基础示例

```python
import os
from turbopuffer import Turbopuffer

# 初始化客户端
tpuf = Turbopuffer(
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    region="gcp-us-central1"  # 选择合适的区域
)

# 创建命名空间
ns = tpuf.namespace("my-rag-knowledge-base")

# 写入文档
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': [0.1, 0.2, 0.3],  # 文档的向量表示
            'text': 'Python 是一门流行的编程语言',
            'category': 'programming',
        }
    ],
    distance_metric='cosine_distance'
)

# 查询
result = ns.query(
    rank_by=("vector", "ANN", [0.1, 0.2, 0.3]),
    top_k=10,
    include_attributes=['text', 'category']
)

print(result.rows)
```

---

## 核心概念

### 1. Namespace（命名空间）

Namespace 是文档的隔离集合，类似于数据库中的表。每个 namespace：
- 独立存储文档
- 拥有独立的索引
- 支持独立的 schema 配置
- 命名规则：`[A-Za-z0-9-_.]{1,128}`

**最佳实践**：为不同的业务场景创建独立的 namespace，而不是使用过滤器。

### 2. Document（文档）

每个文档包含：
- **id**：唯一标识符（必需），支持 uint64、UUID 或字符串（最多 64 字节）
- **vector**：向量表示（可选），用于语义搜索
- **attributes**：自定义属性，用于过滤、排序和返回

### 3. Distance Metric（距离度量）

支持两种距离计算方式：
- **cosine_distance**：余弦距离 = 1 - 余弦相似度，范围 [0, 2]，越小越相似
- **euclidean_squared**：欧几里得平方距离，越小越相似

### 4. Schema（模式）

Turbopuffer 自动推断属性类型，但以下情况需要手动指定：
- UUID 类型
- 日期时间类型
- 启用全文搜索
- 禁用属性索引

---

## 数据写入

### 基本写入操作

#### 行式写入（Row-based）

适合小批量或结构不规则的数据：

```python
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': [0.1, 0.2, 0.3],
            'title': 'Python 教程',
            'content': 'Python 是一门易学的编程语言',
            'tags': ['python', 'tutorial'],
            'views': 1000,
            'published': True
        },
        {
            'id': 2,
            'vector': [0.4, 0.5, 0.6],
            'title': 'JavaScript 指南',
            'content': 'JavaScript 用于 Web 开发',
            'tags': ['javascript', 'web'],
            'views': 1500,
            'published': True
        }
    ],
    distance_metric='cosine_distance'
)
```

#### 列式写入（Column-based）

**推荐用于大批量数据**，性能更优：

```python
ns.write(
    upsert_columns={
        'id': [1, 2, 3, 4],
        'vector': [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
            [0.7, 0.8, 0.9],
            [1.0, 1.1, 1.2]
        ],
        'title': ['文档1', '文档2', '文档3', '文档4'],
        'content': ['内容1', '内容2', '内容3', '内容4'],
        'tags': [['tag1'], ['tag2'], ['tag1', 'tag2'], []],
        'score': [100, 200, None, 300]  # None 表示该属性为空
    },
    distance_metric='cosine_distance'
)
```

### Schema 配置

#### UUID 类型

```python
ns.write(
    upsert_rows=[
        {
            'id': "769c134d-07b8-4225-954a-b6cc5ffc320c",
            'vector': [0.1, 0.2],
            'permissions': [
                'ee1f7c89-a3aa-43c1-8941-c987ee03e7bc',
                '95cdf8be-98a9-4061-8eeb-2702b6bbcb9e'
            ]
        }
    ],
    distance_metric='cosine_distance',
    schema={
        'id': 'uuid',  # 指定 ID 为 UUID 类型
        'permissions': {
            'type': '[]uuid'  # UUID 数组
        }
    }
)
```

#### 启用全文搜索

```python
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': [0.1, 0.2],
            'title': 'Python 编程基础',
            'content': 'Python 是一门强大的编程语言'
        }
    ],
    distance_metric='cosine_distance',
    schema={
        'content': {
            'type': 'string',
            'full_text_search': True  # 启用 BM25 全文搜索
        }
    }
)
```

#### 高级全文搜索配置

```python
ns.write(
    upsert_rows=[...],
    distance_metric='cosine_distance',
    schema={
        'title': {
            'type': 'string',
            'full_text_search': {
                'language': 'english',        # 语言（支持多种语言）
                'stemming': True,             # 启用词干提取
                'remove_stopwords': True,     # 移除停用词
                'case_sensitive': False,      # 大小写不敏感
                'ascii_folding': False,       # ASCII 折叠
                'k1': 1.2,                    # BM25 参数：词频饱和度
                'b': 0.75                     # BM25 参数：文档长度归一化
            }
        }
    }
)
```

#### 禁用索引（节省 50% 成本）

```python
ns.write(
    upsert_rows=[...],
    distance_metric='cosine_distance',
    schema={
        'large_text_field': {
            'type': 'string',
            'filterable': False  # 不可过滤，但可返回
        }
    }
)
```

### 更新和删除操作

#### 更新文档（Patch）

只更新指定字段，其他字段保持不变：

```python
# 只更新 title 和 views 字段
ns.write(
    patch_rows=[
        {'id': 1, 'title': '新标题', 'views': 2000},
        {'id': 2, 'views': 3000}
    ]
)
```

#### 删除文档

```python
# 按 ID 删除
ns.write(deletes=[1, 2, 3])

# 按过滤条件删除
ns.write(
    delete_by_filter=('And', [
        ('published', 'Eq', False),
        ('views', 'Lt', 100)
    ])
)
```

#### 条件写入

只在满足条件时才执行写入：

```python
# 只在版本号更高时才更新
ns.write(
    upsert_rows=[
        {
            'id': 101,
            'vector': [0.2, 0.8],
            'title': '更新后的文档',
            'version': 3
        }
    ],
    upsert_condition=('version', 'Lt', {'$ref_new': 'version'}),
    distance_metric='cosine_distance'
)
```

### 向量生成示例

```python
import os
from typing import List
import openai

def generate_embedding(text: str) -> List[float]:
    """使用 OpenAI 生成文本向量"""
    if not os.getenv("OPENAI_API_KEY"):
        raise ValueError("请设置 OPENAI_API_KEY 环境变量")
    
    response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding

# 使用示例
documents = [
    "Python 是一门编程语言",
    "JavaScript 用于 Web 开发",
    "机器学习是人工智能的子领域"
]

ns.write(
    upsert_rows=[
        {
            'id': i,
            'vector': generate_embedding(doc),
            'content': doc
        }
        for i, doc in enumerate(documents, start=1)
    ],
    distance_metric='cosine_distance'
)
```

---

## 向量搜索

向量搜索通过 ANN（近似最近邻）算法找到语义上最相似的文档。

### 基础向量搜索

```python
import turbopuffer
import os

tpuf = turbopuffer.Turbopuffer(
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    region="gcp-us-central1"
)

ns = tpuf.namespace('my-vectors')

# 查询最相似的文档
query_vector = [0.1, 0.2, 0.3]  # 通常由查询文本生成

result = ns.query(
    rank_by=("vector", "ANN", query_vector),
    top_k=10,
    include_attributes=['content', 'title']
)

for row in result.rows:
    print(f"ID: {row.id}, 距离: {row['$dist']}, 内容: {row.content}")
```

### 向量搜索 + 过滤器

结合向量搜索和精确过滤，提供更精准的结果：

```python
from datetime import datetime

result = ns.query(
    rank_by=("vector", "ANN", query_vector),
    top_k=10,
    filters=('And', (
        ('category', 'Eq', 'programming'),
        ('published', 'Eq', True),
        ('views', 'Gte', 100),
        ('created_at', 'Gte', datetime(2024, 1, 1))
    )),
    include_attributes=['title', 'content', 'views']
)
```

### 复杂过滤条件

```python
result = ns.query(
    rank_by=("vector", "ANN", query_vector),
    top_k=10,
    filters=('And', (
        ('id', 'In', [1, 2, 3, 4, 5]),
        ('tags', 'ContainsAny', ['python', 'javascript']),
        ('Or', [
            ('priority', 'Eq', 'high'),
            ('views', 'Gt', 1000)
        ])
    )),
    include_attributes=True  # 返回所有属性
)
```

### 支持的过滤操作符

#### 相等性操作
- `Eq`：等于
- `NotEq`：不等于
- `In`：在列表中
- `NotIn`：不在列表中

#### 比较操作
- `Lt`：小于
- `Lte`：小于等于
- `Gt`：大于
- `Gte`：大于等于

#### 数组操作
- `Contains`：数组包含某值
- `NotContains`：数组不包含某值
- `ContainsAny`：数组包含任意值
- `NotContainsAny`：数组不包含任意值

#### 字符串操作
- `Glob`：Unix 风格通配符匹配
- `NotGlob`、`IGlob`、`NotIGlob`：通配符变体
- `Regex`：正则表达式匹配（需在 schema 中启用）

#### 逻辑操作
- `And`：且
- `Or`：或
- `Not`：非

---

## 全文搜索

全文搜索使用 BM25 算法对文本内容进行排序，适合关键词检索。

### 基础全文搜索

```python
import turbopuffer
import os

tpuf = turbopuffer.Turbopuffer(
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    region="gcp-us-central1"
)

ns = tpuf.namespace('my-documents')

# 1. 写入文档时启用全文搜索
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'content': 'turbopuffer 是一个快速的搜索引擎'
        },
        {
            'id': 2,
            'content': 'turbopuffer 支持向量搜索和全文搜索'
        }
    ],
    schema={
        'content': {
            'type': 'string',
            'full_text_search': True
        }
    }
)

# 2. 执行 BM25 搜索
result = ns.query(
    rank_by=('content', 'BM25', 'turbopuffer 搜索'),
    top_k=10,
    include_attributes=['content']
)

for row in result.rows:
    print(f"ID: {row.id}, 分数: {row['$dist']}, 内容: {row.content}")
```

### 多字段全文搜索

对多个字段进行加权搜索：

```python
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'title': 'Python 编程入门',
            'content': '学习 Python 基础知识',
            'tags': ['python', 'programming', 'beginner']
        }
    ],
    schema={
        'title': {
            'type': 'string',
            'full_text_search': {
                'language': 'english',
                'stemming': True,
                'remove_stopwords': True
            }
        },
        'content': {
            'type': 'string',
            'full_text_search': True
        },
        'tags': {
            'type': '[]string',
            'full_text_search': {
                'stemming': False,
                'case_sensitive': True
            }
        }
    }
)

# 多字段加权搜索：title 权重 x3，tags 权重 x2，content 权重 x1
result = ns.query(
    rank_by=('Sum', (
        ('Product', 3, ('title', 'BM25', 'python beginner')),
        ('Product', 2, ('tags', 'BM25', 'python beginner')),
        ('content', 'BM25', 'python beginner')
    )),
    top_k=10,
    include_attributes=['title', 'content', 'tags']
)
```

### 全文搜索 + 过滤

```python
from datetime import datetime

result = ns.query(
    rank_by=('content', 'BM25', 'python tutorial'),
    filters=('And', (
        ('published', 'Eq', True),
        ('language', 'Eq', 'zh'),
        ('created_at', 'Gte', datetime(2024, 1, 1))
    )),
    top_k=10,
    include_attributes=['title', 'content']
)
```

### 短语匹配

```python
# 匹配包含所有 token 的文档（不要求顺序）
result = ns.query(
    rank_by=('content', 'BM25', 'quick fox'),
    filters=('content', 'ContainsAllTokens', 'quick fox'),
    top_k=10,
    include_attributes=['content']
)

# 匹配精确短语（要求顺序和相邻）
result = ns.query(
    rank_by=('content', 'BM25', 'quick brown fox'),
    filters=('content', 'ContainsTokenSequence', 'quick brown fox'),
    top_k=10,
    include_attributes=['content']
)
```

### 前缀搜索（输入建议）

适用于搜索框的自动补全：

```python
# 搜索以 "pyth" 开头的词
result = ns.query(
    rank_by=('title', 'BM25', 'programming pyth', {'last_as_prefix': True}),
    top_k=10,
    include_attributes=['title']
)
```

---

## 混合搜索

混合搜索结合向量搜索和全文搜索，通常能提供最佳的检索效果。

### 完整混合搜索流程

```python
import turbopuffer
import os
from typing import List

tpuf = turbopuffer.Turbopuffer(
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    region="gcp-us-central1"
)

ns = tpuf.namespace('hybrid-search-demo')

# 1. 写入文档（同时支持向量和全文搜索）
def openai_embedding(text: str) -> List[float]:
    """使用 OpenAI 生成向量"""
    import openai
    response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding

ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': openai_embedding('快速冷食早餐：燕麦加牛奶'),
            'content': '快速冷食早餐：燕麦加牛奶',
        },
        {
            'id': 2,
            'vector': openai_embedding('奇亚籽布丁是一种冷早餐'),
            'content': '奇亚籽布丁是一种冷早餐',
        },
        {
            'id': 3,
            'vector': openai_embedding('隔夜燕麦：冷藏一夜的美味早餐'),
            'content': '隔夜燕麦：冷藏一夜的美味早餐',
        },
        {
            'id': 4,
            'vector': openai_embedding('热燕麦粥是快速健康的早餐'),
            'content': '热燕麦粥是快速健康的早餐',
        }
    ],
    distance_metric="cosine_distance",
    schema={
        "content": {
            "type": "string",
            "full_text_search": True
        }
    }
)

# 2. 使用 multi_query 同时执行向量搜索和全文搜索
query_text = "快速冷早餐推荐"

response = ns.multi_query(
    queries=[
        {
            # 向量搜索
            "rank_by": ("vector", "ANN", openai_embedding(query_text)),
            "top_k": 10,
            "include_attributes": ["content"],
        },
        {
            # 全文搜索
            "rank_by": ("content", "BM25", query_text),
            "top_k": 10,
            "include_attributes": ["content"],
        }
    ]
)

vector_results = response.results[0].rows
fts_results = response.results[1].rows

print("向量搜索结果:", [row.id for row in vector_results])
print("全文搜索结果:", [row.id for row in fts_results])

# 3. 结果融合（Reciprocal Rank Fusion）
def reciprocal_rank_fusion(result_lists, k=60):
    """基于排名的结果融合"""
    scores = {}
    all_results = {}
    
    for results in result_lists:
        for rank, item in enumerate(results, start=1):
            scores[item.id] = scores.get(item.id, 0) + 1.0 / (k + rank)
            all_results[item.id] = item
    
    # 按分数排序
    fused = [
        (all_results[doc_id], score)
        for doc_id, score in sorted(
            scores.items(),
            key=lambda x: x[1],
            reverse=True
        )
    ]
    
    return fused

fused_results = reciprocal_rank_fusion([vector_results, fts_results])

print("\n融合后的结果:")
for item, score in fused_results:
    print(f"ID: {item.id}, 分数: {score:.4f}, 内容: {item.content}")

# 4. 重排序（可选，使用 Cohere Rerank）
def cohere_rerank(results, query, top_n=None):
    """使用 Cohere Rerank API 进行重排序"""
    try:
        import cohere
        co = cohere.Client(os.getenv("COHERE_API_KEY"))
        
        documents = [r[0].content for r in results]
        reranked = co.rerank(
            query=query,
            documents=documents,
            top_n=top_n or len(documents)
        )
        
        reranked_results = []
        for r in reranked.results:
            original_item = results[r.index][0]
            reranked_results.append((original_item, r.relevance_score))
        
        return reranked_results
    except ImportError:
        print("未安装 cohere，跳过重排序")
        return results

# 执行重排序
final_results = cohere_rerank(fused_results, query_text, top_n=5)

print("\n重排序后的最终结果:")
for item, score in final_results:
    print(f"ID: {item.id}, 相关性分数: {score:.4f}, 内容: {item.content}")
```

### 混合搜索最佳实践

1. **向量搜索**擅长：
   - 语义理解
   - 同义词匹配
   - 跨语言检索
   - 概念相似性

2. **全文搜索**擅长：
   - 精确关键词匹配
   - 专有名词搜索
   - 缩写和代码检索
   - 短文档搜索

3. **融合策略**：
   - **RRF（Reciprocal Rank Fusion）**：简单有效，基于排名位置
   - **加权融合**：根据场景调整向量和全文权重
   - **重排序**：使用 Cohere、Jina 等重排序模型进一步优化

4. **何时使用混合搜索**：
   - 用户查询既包含概念又包含关键词
   - 需要高召回率和高准确率
   - RAG 应用的检索阶段

---

## 高级特性

### 1. 聚合查询

#### 计数统计

```python
# 统计符合条件的文档数量
result = ns.query(
    aggregate_by={'total_count': ('Count',)},
    filters=('category', 'Eq', 'programming')
)

print(f"总计: {result.aggregations['total_count']} 篇文档")
```

#### 求和统计

```python
# 计算总浏览量
result = ns.query(
    aggregate_by={'total_views': ('Sum', 'views')},
    filters=('published', 'Eq', True)
)

print(f"总浏览量: {result.aggregations['total_views']}")
```

#### 分组聚合

```python
# 按类别统计文档数量
result = ns.query(
    aggregate_by={'count_by_category': ('Count',)},
    group_by=['category', 'language']
)

for group in result.aggregation_groups:
    print(f"{group.category} ({group.language}): {group.count_by_category}")
```

### 2. 属性排序

不使用向量或 BM25，直接按属性排序：

```python
# 按时间倒序获取最新文档
result = ns.query(
    rank_by=('created_at', 'desc'),
    filters=('published', 'Eq', True),
    top_k=100,
    include_attributes=['title', 'created_at']
)

# 按浏览量升序
result = ns.query(
    rank_by=('views', 'asc'),
    top_k=10,
    include_attributes=['title', 'views']
)
```

### 3. 分页查询

```python
from turbopuffer.types import Filter
from typing import List

# 按 ID 分页
last_id = None

while True:
    filters: List[Filter] = [('category', 'Eq', 'programming')]
    
    if last_id is not None:
        filters.append(('id', 'Gt', last_id))
    
    result = ns.query(
        rank_by=('id', 'asc'),
        top_k=1000,
        filters=('And', filters),
        include_attributes=['title']
    )
    
    # 处理结果
    for row in result.rows:
        print(row.title)
    
    # 检查是否还有更多数据
    if len(result.rows) < 1000:
        break
    
    last_id = result.rows[-1].id
```

### 4. 结果多样性（Diversification）

限制相同属性值的结果数量：

```python
# 每个类别最多返回 5 个结果
result = ns.query(
    rank_by=("vector", "ANN", query_vector),
    filters=('published', 'Eq', True),
    limit={
        "per": {
            "attributes": ["category"],
            "limit": 5
        },
        "total": 50
    },
    include_attributes=['title', 'category']
)
```

### 5. 异步操作

对于高并发场景，使用异步客户端：

```python
import asyncio
from turbopuffer import AsyncTurbopuffer

async def search_documents():
    tpuf = AsyncTurbopuffer(
        api_key=os.getenv("TURBOPUFFER_API_KEY"),
        region="gcp-us-central1"
    )
    
    ns = tpuf.namespace("my-namespace")
    
    # 异步查询
    result = await ns.query(
        rank_by=("vector", "ANN", query_vector),
        top_k=10,
        include_attributes=['content']
    )
    
    return result.rows

# 运行异步函数
results = asyncio.run(search_documents())
```

### 6. 批量操作

```python
# 大批量写入（推荐使用列式格式）
batch_size = 10000

for i in range(0, len(all_documents), batch_size):
    batch = all_documents[i:i + batch_size]
    
    ns.write(
        upsert_columns={
            'id': [doc['id'] for doc in batch],
            'vector': [doc['vector'] for doc in batch],
            'content': [doc['content'] for doc in batch]
        },
        distance_metric='cosine_distance'
    )
```

### 7. 命名空间管理

```python
# 列出所有命名空间
namespaces = list(tpuf.namespaces(prefix="my-project-"))

for ns_info in namespaces:
    print(ns_info.id)

# 获取命名空间元数据
metadata = ns.metadata()
print(f"文档数量: {metadata.approx_row_count}")
print(f"向量维度: {metadata.dimensions}")

# 删除命名空间
ns.delete()
```

### 8. 一致性级别

```python
# 强一致性（默认）- 包含所有已写入的数据
result = ns.query(
    rank_by=("vector", "ANN", query_vector),
    top_k=10,
    consistency={'level': 'strong'}
)

# 最终一致性 - 更高吞吐量，可能有最多 60 秒的延迟
result = ns.query(
    rank_by=("vector", "ANN", query_vector),
    top_k=10,
    consistency={'level': 'eventual'}
)
```

---

## 最佳实践

### 1. RAG 系统集成

完整的 RAG 检索流程示例：

```python
import os
from typing import List, Dict
from turbopuffer import Turbopuffer
import openai

class RAGRetriever:
    def __init__(self, namespace: str):
        self.tpuf = Turbopuffer(
            api_key=os.getenv("TURBOPUFFER_API_KEY"),
            region="gcp-us-central1"
        )
        self.ns = self.tpuf.namespace(namespace)
    
    def add_documents(self, documents: List[Dict]):
        """添加文档到知识库"""
        rows = []
        for doc in documents:
            rows.append({
                'id': doc['id'],
                'vector': self._generate_embedding(doc['content']),
                'content': doc['content'],
                'title': doc.get('title', ''),
                'metadata': doc.get('metadata', {})
            })
        
        self.ns.write(
            upsert_rows=rows,
            distance_metric='cosine_distance',
            schema={
                'content': {
                    'type': 'string',
                    'full_text_search': True
                }
            }
        )
    
    def retrieve(
        self,
        query: str,
        top_k: int = 10,
        use_hybrid: bool = True,
        filters: dict = None
    ) -> List[Dict]:
        """检索相关文档"""
        query_vector = self._generate_embedding(query)
        
        if use_hybrid:
            # 混合搜索
            response = self.ns.multi_query(
                queries=[
                    {
                        "rank_by": ("vector", "ANN", query_vector),
                        "top_k": top_k * 2,
                        "filters": filters,
                        "include_attributes": ["content", "title"],
                    },
                    {
                        "rank_by": ("content", "BM25", query),
                        "top_k": top_k * 2,
                        "filters": filters,
                        "include_attributes": ["content", "title"],
                    }
                ]
            )
            
            # 结果融合
            results = self._fuse_results(
                response.results[0].rows,
                response.results[1].rows,
                top_k
            )
        else:
            # 仅向量搜索
            result = self.ns.query(
                rank_by=("vector", "ANN", query_vector),
                top_k=top_k,
                filters=filters,
                include_attributes=["content", "title"]
            )
            results = result.rows
        
        return [
            {
                'id': row.id,
                'content': row.content,
                'title': row.title,
                'score': row.get('$dist', 0)
            }
            for row in results[:top_k]
        ]
    
    def _generate_embedding(self, text: str) -> List[float]:
        """生成文本向量"""
        response = openai.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding
    
    def _fuse_results(self, vector_results, fts_results, top_k):
        """RRF 融合"""
        scores = {}
        all_results = {}
        
        for results in [vector_results, fts_results]:
            for rank, item in enumerate(results, start=1):
                scores[item.id] = scores.get(item.id, 0) + 1.0 / (60 + rank)
                all_results[item.id] = item
        
        sorted_ids = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return [all_results[doc_id] for doc_id, _ in sorted_ids[:top_k]]

# 使用示例
retriever = RAGRetriever("knowledge-base")

# 添加文档
retriever.add_documents([
    {
        'id': 1,
        'content': 'Python 是一门易学的编程语言',
        'title': 'Python 简介'
    },
    {
        'id': 2,
        'content': 'FastAPI 是一个现代化的 Web 框架',
        'title': 'FastAPI 教程'
    }
])

# 检索
results = retriever.retrieve(
    query="如何学习 Python",
    top_k=5,
    use_hybrid=True
)

for doc in results:
    print(f"标题: {doc['title']}")
    print(f"内容: {doc['content']}")
    print(f"分数: {doc['score']}\n")
```

### 2. 性能优化

#### 写入优化
```python
# ✅ 好：使用列式格式批量写入
ns.write(
    upsert_columns={...},  # 10000 行
    distance_metric='cosine_distance'
)

# ❌ 差：逐条写入
for doc in documents:
    ns.write(upsert_rows=[doc], ...)
```

#### 查询优化
```python
# ✅ 好：只返回需要的属性
result = ns.query(
    rank_by=(...),
    top_k=10,
    include_attributes=['title', 'summary']  # 只返回需要的字段
)

# ❌ 差：返回所有属性（包括大字段）
result = ns.query(
    rank_by=(...),
    top_k=10,
    include_attributes=True
)
```

#### 使用 Namespace 分区
```python
# ✅ 好：按租户/类别创建独立的 namespace
user_ns = tpuf.namespace(f"user-{user_id}-docs")

# ❌ 差：所有数据在一个 namespace，依赖过滤
result = ns.query(filters=('user_id', 'Eq', user_id), ...)
```

### 3. 错误处理

```python
import turbopuffer

try:
    result = ns.query(
        rank_by=("vector", "ANN", query_vector),
        top_k=10
    )
except turbopuffer.APIConnectionError as e:
    print(f"网络连接失败: {e}")
except turbopuffer.RateLimitError as e:
    print(f"请求频率过高，请稍后重试: {e}")
except turbopuffer.AuthenticationError as e:
    print(f"认证失败，请检查 API Key: {e}")
except turbopuffer.APIStatusError as e:
    print(f"API 错误 {e.status_code}: {e.response}")
except turbopuffer.APIError as e:
    print(f"未知错误: {e}")
```

### 4. 环境配置

```python
# 开发环境
dev_tpuf = Turbopuffer(
    api_key=os.getenv("TURBOPUFFER_DEV_API_KEY"),
    region="gcp-us-central1",
    timeout=30.0  # 30 秒超时
)

# 生产环境
prod_tpuf = Turbopuffer(
    api_key=os.getenv("TURBOPUFFER_PROD_API_KEY"),
    region="gcp-us-central1",
    max_retries=5,  # 增加重试次数
    timeout=60.0    # 60 秒超时
)
```

### 5. 向量维度选择

```python
# 根据场景选择合适的向量维度
models = {
    'text-embedding-3-small': 1536,    # 平衡性能和效果
    'text-embedding-3-large': 3072,    # 最佳效果，但成本更高
    'text-embedding-ada-002': 1536,    # 旧版本
}

# 小型应用：使用 384 或 768 维
# 大型应用：使用 1536 维
# 高精度需求：使用 3072 维
```

---

## 常见问题

### Q1: 如何选择距离度量？

**A**: 
- **cosine_distance**：适用于大多数场景，对向量长度不敏感
- **euclidean_squared**：适用于向量长度有意义的场景

大多数 embedding 模型（如 OpenAI）推荐使用 `cosine_distance`。

### Q2: 向量搜索和全文搜索如何选择？

**A**:
- **向量搜索**：用户查询是自然语言，需要语义理解
- **全文搜索**：用户查询是关键词，需要精确匹配
- **混合搜索**：追求最佳效果，适合 RAG 应用

### Q3: 如何优化检索延迟？

**A**:
1. 使用列式格式批量写入
2. 只返回必要的属性
3. 优先使用 namespace 分区而非过滤器
4. 考虑使用最终一致性
5. 启用缓存预热（warm cache）

### Q4: namespace 和过滤器的使用场景？

**A**:
- **Namespace**：隔离不同租户、业务或数据集
- **过滤器**：同一数据集内的条件筛选

如果某个属性的值很少变化且用于频繁过滤，考虑创建独立的 namespace。

### Q5: 如何处理大规模数据写入？

**A**:
```python
# 1. 使用列式格式
# 2. 分批写入（每批 5000-10000 条）
# 3. 禁用写入反压（初次加载时）
ns.write(
    upsert_columns={...},
    distance_metric='cosine_distance',
    disable_backpressure=True  # 初次加载时使用
)

# 4. 写入后等待索引完成
while True:
    metadata = ns.metadata()
    if metadata.unindexed_bytes < 1_000_000:  # 小于 1MB
        break
    time.sleep(5)
```

### Q6: 如何更新已有文档的向量？

**A**:
```python
# 使用 upsert_rows 重新写入相同 ID 的文档
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': new_vector,
            'content': new_content
        }
    ],
    distance_metric='cosine_distance'
)
```

### Q7: 支持哪些语言的全文搜索？

**A**: Turbopuffer 支持多种语言的全文搜索，包括：
- English, Chinese, Japanese, Korean
- German, French, Spanish, Italian
- 等等

在 schema 中配置：
```python
schema={
    'content': {
        'type': 'string',
        'full_text_search': {
            'language': 'chinese'  # 或 'english', 'japanese' 等
        }
    }
}
```

### Q8: 如何实现多语言检索？

**A**:
```python
# 方案 1：使用多语言 embedding 模型
# 方案 2：为每种语言创建独立的 namespace
# 方案 3：在文档中添加 language 属性并过滤

result = ns.query(
    rank_by=("vector", "ANN", query_vector),
    filters=('language', 'Eq', 'zh'),
    top_k=10
)
```

### Q9: 计费是如何工作的？

**A**:
- **存储**：按存储的字节数计费
- **写入**：按写入的字节数计费
- **查询**：按处理和返回的字节数计费
- **不可过滤属性**：50% 折扣
- **批量写入**：最高 50% 折扣

参考：https://turbopuffer.com/pricing

### Q10: 如何备份数据？

**A**:
```python
# 使用 copy_from_namespace 创建备份
backup_ns = tpuf.namespace("backup-2024-01")

backup_ns.write(
    copy_from_namespace="production-namespace"
)

# 跨区域备份
backup_ns.write(
    copy_from_namespace={
        "source_namespace": "production",
        "source_region": "gcp-us-central1"
    }
)
```

---

## 总结

Turbopuffer 是一个强大的搜索引擎服务，特别适合 RAG 应用。关键要点：

1. **选择合适的搜索方式**：向量搜索用于语义理解，全文搜索用于关键词匹配，混合搜索效果最佳
2. **优化数据写入**：使用列式格式批量写入，配置合适的 schema
3. **灵活使用过滤**：结合 namespace 分区和过滤器，平衡性能和灵活性
4. **关注性能**：只返回必要的属性，使用缓存预热，考虑一致性级别
5. **完善错误处理**：捕获各种异常，确保系统稳定性

通过本指南，你应该能够快速在 Python 项目中集成 Turbopuffer，实现高效的 RAG 检索系统。

如有更多问题，请参考：
- 官方文档：https://turbopuffer.com/docs
- API 参考：https://turbopuffer.com/docs/query
- 社区支持：https://join.slack.com/t/turbopuffer-community
