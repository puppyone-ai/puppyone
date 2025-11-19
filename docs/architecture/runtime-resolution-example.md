# Runtime Resolution 方案实例说明

## 场景：Agentic RAG Template

### 角色定义

- **Block WzK6iT**: Vector Collection Block（知识库）
- **Edge 3YAeP8**: Vector Search Edge（检索边）

---

## Retrieve Edge Type 定义

### 当前类型定义

```typescript
export type RetrievingEdgeJsonType = {
  type: 'search';
  data: {
    search_type: 'vector';
    top_k: number;
    inputs: { [key: string]: string };
    threshold: number;
    extra_configs: {...};
    query_id: { [key: string]: string };
    data_source: {
      id: string;              // Block ID 引用
      label: string;
      index_item: {
        index_name: string;    // ✅ 关键：标识符（用于查找）
        collection_configs: {   // ❌ 冗余存储（需要移除）
          set_name: string;
          model: string;
          vdb_type: string;
          user_id: string;
          collection_name: string;
        };
      };
    }[];
    outputs: { [key: string]: string };
  };
};
```

### 关键点：`index_item.index_name`

- **用途**：标识 Block 的 `indexingList` 中哪个 indexed set 被选中
- **场景**：一个 Block 可能有多个 `indexingList` 项（多个 indexed sets）
- **自定义支持**：用户选择不同的 `indexItem` 来决定使用哪个 indexed set

---

## 方案对比

### ❌ 当前方案（需要同步）

#### 1. 模板定义

```json
{
  "blocks": {
    "WzK6iT": {
      "type": "structured",
      "data": {
        "indexingList": [
          {
            "index_name": "collection_1",
            "status": "done",
            "collection_configs": {
              "collection_name": "collection_1",
              "set_name": "set_1",
              "model": "text-embedding-ada-002"
            }
          },
          {
            "index_name": "collection_2",
            "status": "done",
            "collection_configs": {
              "collection_name": "collection_2",
              "set_name": "set_2",
              "model": "text-embedding-ada-002"
            }
          }
        ]
      }
    }
  },
  "edges": {
    "3YAeP8": {
      "type": "search",
      "data": {
        "data_source": [{
          "id": "WzK6iT",
          "index_item": {
            "index_name": "collection_1",  // ← 用户选择的 indexed set
            "collection_configs": {        // ← 冗余存储，需要同步
              "collection_name": "collection_1",
              "set_name": "set_1",
              "model": "text-embedding-ada-002"
            }
          }
        }]
      }
    }
  }
}
```

#### 2. 模板实例化后（需要手动同步）

```typescript
// CloudTemplateLoader.processVectorCollection()
// ✅ 更新 Block
block.data.indexingList[0].collection_configs = {
  collection_name: "collection_WzK6iT_1730457600000",
  model: "text-embedding-ada-002",
  vdb_type: "pgvector",
  user_id: "local-user",
  set_name: "collection_WzK6iT_1730457600000"
}

// ⚠️ 必须手动同步到 Edge
edge.data.data_source[0].index_item.collection_configs = {
  collection_name: "collection_WzK6iT_1730457600000",  // ← 重复！
  model: "text-embedding-ada-002",
  vdb_type: "pgvector",
  user_id: "local-user",
  set_name: "collection_WzK6iT_1730457600000"
}
```

**问题**：
- ❌ 数据冗余（存储两次）
- ❌ 同步脆弱（任何更新都需要手动同步）
- ❌ 违反 Single Source of Truth

---

### ✅ 改进方案（Runtime Resolution）

#### 1. 模板定义（简化）

```json
{
  "blocks": {
    "WzK6iT": {
      "type": "structured",
      "data": {
        "indexingList": [{
          "collection_configs": {}  // ← 空，等待填充
        }]
      }
    }
  },
  "edges": {
    "3YAeP8": {
      "type": "search",
      "data": {
        "data_source": [{
          "id": "WzK6iT",
          "label": "Knowledge Base"
          // ✅ 不再存储 index_item.collection_configs！
        }]
      }
    }
  }
}
```

#### 2. 模板实例化后（只更新 Block）

```typescript
// CloudTemplateLoader.processVectorCollection()
// ✅ 只更新 Block（Single Source of Truth）
block.data.indexingList[0].collection_configs = {
  collection_name: "collection_WzK6iT_1730457600000",
  model: "text-embedding-ada-002",
  vdb_type: "pgvector",
  user_id: "local-user",
  set_name: "collection_WzK6iT_1730457600000"
}

// ✅ Edge 保持不变（只存储引用）
// edge.data.data_source[0] = { id: "WzK6iT", label: "Knowledge Base" }
// 无需同步！
```

---

## Runtime 执行流程

### Step 1: Edge 执行开始

```python
# PuppyEngine/Server/Env.py
async def _execute_single_edge(self, edge_id: str, executor: EdgeExecutor):
    # 1. 准备 Block Configs
    block_configs = self._prepare_block_configs(edge_id)
    # → 调用 EdgeConfigParser
```

### Step 2: 准备 Block Configs（关键改进）

```python
# PuppyEngine/Server/Env.py
def _prepare_block_configs(self, edge_id: str) -> Dict[str, Any]:
    """准备 Block 配置，包括 data_source blocks"""
    block_configs = {}
    
    # 1. 提取 input blocks（query block）
    input_block_ids = self.planner.edge_to_inputs_mapping.get(edge_id, set())
    for block_id in input_block_ids:
        block = self.blocks.get(block_id)
        block_configs[block_id] = {
            "label": block.label,
            "content": normalize_block_content(block),
            "looped": block.data.get("looped", False),
        }
    
    # 2. ✅ NEW: 提取 data_source blocks（vector collection blocks）
    edge_config = self.edges.get(edge_id, {}).get("data", {})
    if edge_config.get("search_type") == "vector":
        data_sources = edge_config.get("data_source", [])
        
        for ds in data_sources:
            ds_block_id = ds.get("id")  # "WzK6iT"
            if ds_block_id not in block_configs:  # 避免重复
                block = self.blocks.get(ds_block_id)  # 获取 Block WzK6iT
                
                            # ✅ 提取完整的 indexingList（支持多个 indexed sets）
                indexing_list = block.data.get("indexingList", [])
                
                block_configs[ds_block_id] = {
                    "label": block.label,
                    "indexingList": indexing_list  # ← 保留所有 indexed sets（支持 custom 选择）
                }
    
    return block_configs

def _extract_collection_configs(self, block: BaseBlock) -> Dict[str, Any]:
    """从 Vector Collection Block 提取 collection_configs"""
    indexing_list = block.data.get("indexingList", [])
    if indexing_list and len(indexing_list) > 0:
        return indexing_list[0].get("collection_configs", {})
    return {}
```

**执行结果**：
```python
block_configs = {
    "Lm-PbX": {  # Query block
        "label": "Text1",
        "content": "What is RAG?",
        "looped": False
    },
    "WzK6iT": {  # ✅ Vector Collection Block
        "label": "Knowledge Base",
        "indexingList": [  # ← 保留所有 indexed sets
            {
                "index_name": "collection_1",
                "status": "done",
                "collection_configs": {
                    "collection_name": "collection_1",
                    "set_name": "set_1",
                    "model": "text-embedding-ada-002",
                    "vdb_type": "pgvector",
                    "user_id": "local-user"
                }
            },
            {
                "index_name": "collection_2",
                "status": "done",
                "collection_configs": {
                    "collection_name": "collection_2",
                    "set_name": "set_2",
                    "model": "text-embedding-ada-002",
                    "vdb_type": "pgvector",
                    "user_id": "local-user"
                }
            }
        ]
    }
}
```

### Step 3: SearchConfigParser 解析（关键改进）

```python
# PuppyEngine/ModularEdges/EdgeConfigParser.py
class SearchConfigParser(EdgeConfigParser):
    def parse(self, variable_replace_field: str = "query"):
        # 原始配置
        edge_configs = self.edge_configs
        data_sources = edge_configs.get("data_source", [])
        # data_sources = [{"id": "WzK6iT", "label": "Knowledge Base"}]
        
        # ✅ Runtime Resolution: 从 block_configs 查找对应的 indexed set
        enriched_data_sources = []
        for ds in data_sources:
            ds_id = ds.get("id")  # "WzK6iT"
            requested_index_name = ds.get("index_item", {}).get("index_name")  # "collection_1"
            
            # 从 block_configs 获取 indexingList
            ds_block_config = self.block_configs.get(ds_id, {})
            indexing_list = ds_block_config.get("indexingList", [])
            
            # ✅ 根据 index_name 查找对应的 indexed set（支持 custom 选择）
            selected_index_item = None
            if requested_index_name:
                # 查找匹配的 indexed set
                for item in indexing_list:
                    if item.get("index_name") == requested_index_name:
                        selected_index_item = item
                        break
            
            # Fallback: 如果没有指定或找不到，使用第一个 done 状态的
            if not selected_index_item:
                for item in indexing_list:
                    if item.get("status") == "done":
                        selected_index_item = item
                        break
            
            # 提取 collection_configs
            collection_configs = selected_index_item.get("collection_configs", {}) if selected_index_item else {}
            
            # ✅ 动态构建完整的 index_item
            enriched_ds = {
                "id": ds_id,
                "label": ds.get("label"),
                "index_item": {
                    "index_name": requested_index_name or collection_configs.get("collection_name", ""),
                    "collection_configs": collection_configs  # ← 运行时查找并填充！
                }
            }
            enriched_data_sources.append(enriched_ds)
        
        # 构建 extra_configs（传递给 Edge 执行）
        extra_configs = [{
            **original_extra_configs,
            "data_source": enriched_data_sources,  # ← 使用填充后的版本
            "top_k": edge_configs.get("top_k", 10)
        }]
        
        return ParsedEdgeParams(
            init_configs=[...],
            extra_configs=extra_configs,
            is_loop=False
        )
```

**执行结果**：
```python
extra_configs = [{
    "threshold": 0.7,
    "top_k": 3,
    "data_source": [{
        "id": "WzK6iT",
        "label": "Knowledge Base",
        "index_item": {  # ✅ 运行时构建（根据 index_name 查找）
            "index_name": "collection_1",  # ← 用户选择的 indexed set
            "collection_configs": {  # ← 从 Block 的 indexingList 中查找
                "collection_name": "collection_1",
                "set_name": "set_1",
                "model": "text-embedding-ada-002",
                "vdb_type": "pgvector",
                "user_id": "local-user"
            }
        }
    }]
}]
```

**Custom Indexed Sets 支持**：
- ✅ 用户可以选择 Block 的任意 `indexingList` 项
- ✅ Edge 存储 `index_name` 作为标识符
- ✅ Runtime 根据 `index_name` 从 Block 的 `indexingList` 查找对应的 `collection_configs`
- ✅ 支持一个 Block 有多个 indexed sets 的场景

### Step 4: VectorRetrievalStrategy 执行（无需修改）

```python
# PuppyEngine/ModularEdges/SearchEdge/vector_search.py
class VectorRetrievalStrategy(BaseRetriever):
    def search(self) -> List[Tuple[str, float]]:
        # extra_configs 已经包含完整的 collection_configs
        data_sources = self.extra_configs.get("data_source", [])
        
        for data_source in data_sources:
            # ✅ 直接使用（数据已经通过 runtime resolution 填充）
            collection_configs = data_source.get("index_item", {}).get("collection_configs", {})
            
            search_result = StorageClient.execute(
                collection_name=collection_configs.get("collection_name", ""),
                search_configs={
                    "query": self.query,
                    "model": collection_configs.get("model", "text-embedding-ada-002"),
                    "vdb_type": collection_configs.get("vdb_type", "pgvector"),
                    "user_id": collection_configs.get("user_id", ""),
                    "set_name": collection_configs.get("set_name", ""),
                    "top_k": self.top_k,
                    "threshold": self.threshold,
                }
            )
```

---

## 数据流对比

### ❌ 当前方案数据流

```
Template Definition
  ↓
Instance (Block updated)
  ↓
Manual Sync (Edge updated)  ← ⚠️ 脆弱步骤
  ↓
Runtime (Edge uses copied data)
```

**问题**：任何一步失败都会导致数据不一致

---

### ✅ 改进方案数据流

```
Template Definition (Edge只存储引用)
  ↓
Instance (Block updated only)
  ↓
Runtime _prepare_block_configs (提取 Block 数据)
  ↓
Runtime SearchConfigParser (动态填充 Edge)
  ↓
Runtime VectorRetrievalStrategy (执行搜索)
```

**优势**：Block 是唯一数据源，运行时自动推导

---

## 代码修改量

### PuppyEngine 修改

1. **`Env._prepare_block_configs()`** (+15 lines)
   - 提取 `data_source` blocks 的 `collection_configs`

2. **`Env._extract_collection_configs()`** (+8 lines)
   - 辅助方法：从 Block 提取 `collection_configs`

3. **`SearchConfigParser.parse()`** (+12 lines)
   - Runtime resolution：从 `block_configs` 填充 `data_source`

**总计**：~35 lines

### PuppyFlow 修改

1. **`useEdgeNodeBackEndJsonBuilder.ts`** (-10 lines)
   - 移除 `index_item.collection_configs` 的构建逻辑
   - ✅ 保留 `index_item.index_name`（用于标识选择的 indexed set）

2. **`buildRetrievingNodeJson()`** (修改)
   - 只存储 `index_name`，不存储 `collection_configs`
   ```typescript
   index_item: {
     index_name: option.indexItem.index_name  // ✅ 保留
     // collection_configs 移除（运行时填充）
   }
   ```

3. **`cloud.ts`** (-50 lines)
   - 移除 `syncVectorCollectionConfigsToEdges()` 方法

**总计**：-60 lines（代码减少！）

---

## 优势总结

1. ✅ **Single Source of Truth**：Block 是唯一数据源
2. ✅ **利用现有机制**：复用 `_prepare_block_configs()` 架构
3. ✅ **零同步逻辑**：无需手动同步，运行时自动推导
4. ✅ **自动更新**：Block 更新后自动反映到 Edge 执行
5. ✅ **代码减少**：减少 ~60 lines 同步代码
6. ✅ **职责清晰**：
   - Block：数据 + 元数据（`collection_configs`）
   - Edge：执行配置 + 引用关系（`id`）
   - Runtime：解析和填充（职责分离）

---

## 向后兼容性

### Edge Schema 演进

```typescript
// 旧版本（包含完整 collection_configs）
interface OldEdgeDataSource {
  id: string;
  label: string;
  index_item: {
    index_name: string;
    collection_configs: {...};  // ← 冗余存储
  };
}

// 新版本（只存储标识符，运行时查找）
interface NewEdgeDataSource {
  id: string;
  label: string;
  index_item: {
    index_name: string;  // ✅ 保留：标识用户选择的 indexed set
    // ✅ collection_configs 移除：运行时从 Block 的 indexingList 查找
  };
}
```

**兼容策略**：
```python
# SearchConfigParser 支持两种格式
index_item = ds.get("index_item", {})
if "collection_configs" in index_item and index_item["collection_configs"]:
    # 旧版本：直接使用存储的 collection_configs
    collection_configs = index_item["collection_configs"]
else:
    # 新版本：根据 index_name 从 block_configs 查找
    requested_index_name = index_item.get("index_name")
    ds_block_config = self.block_configs.get(ds["id"], {})
    indexing_list = ds_block_config.get("indexingList", [])
    
    # 查找匹配的 indexed set
    collection_configs = {}
    if requested_index_name:
        for item in indexing_list:
            if item.get("index_name") == requested_index_name:
                collection_configs = item.get("collection_configs", {})
                break
```

---

## 实施建议

### Phase 3.9（可选）：Runtime Resolution 重构

**优先级**：中等（当前同步方案可用，但这是更优雅的长期方案）

**工作量**：2-3 小时

**步骤**：
1. ✅ 修改 `Env._prepare_block_configs()` 提取 `data_source` blocks
2. ✅ 修改 `SearchConfigParser.parse()` 实现 runtime resolution
3. ✅ 更新前端 builder 移除 `collection_configs` 构建
4. ✅ 移除 `syncVectorCollectionConfigsToEdges()` 方法
5. ✅ 添加向后兼容性支持

**测试**：
- 验证 agentic-rag template 正常工作
- 验证旧版本 workflow 仍然兼容
- 验证 Block 更新后 Edge 自动反映

---

这个方案的核心思想：**配置推导而非配置同步**，利用现有的架构模式实现 Single Source of Truth。

