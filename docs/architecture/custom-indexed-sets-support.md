# Custom Indexed Sets 支持分析

## 关键发现：当前实现 vs 改进方案

### ❌ 当前实现（不是 Runtime Resolution）

**当前实现**：Edge **必须**存储完整的 `collection_configs`，Runtime 直接从 Edge 读取。

```python
# SearchConfigParser.parse() - 当前实现
data_sources = self.edge_configs.get("data_source", [])  # ← 直接从 Edge 读取
# data_sources 必须包含完整的 collection_configs
extra_configs = [{
    "data_source": data_sources,  # ← 直接传递，没有查找逻辑
    ...
}]

# VectorRetrievalStrategy.search() - 当前实现
collection_configs = data_source.get("index_item", {}).get("collection_configs", {})
# ← 直接从 Edge 的 data_source 读取，不查找 Block
```

**问题**：

- ❌ Edge 必须存储完整的 `collection_configs`（冗余）
- ❌ 需要手动同步（`syncVectorCollectionConfigsToEdges()`）
- ❌ 违反 Single Source of Truth

---

### ✅ 改进方案（Runtime Resolution）

**改进方案**：Edge 只存储 `index_name`，Runtime 根据 `index_name` 从 Block 查找。

```python
# SearchConfigParser.parse() - 改进方案
data_sources = self.edge_configs.get("data_source", [])  # [{id: "WzK6iT", index_item: {index_name: "collection_1"}}]

# ✅ Runtime Resolution: 根据 index_name 查找
for ds in data_sources:
    requested_index_name = ds["index_item"]["index_name"]  # "collection_1"
    
    # 从 block_configs 查找
    indexing_list = self.block_configs[ds["id"]]["indexingList"]
    for item in indexing_list:
        if item["index_name"] == requested_index_name:
            collection_configs = item["collection_configs"]  # ← 找到！
            break
```

**优势**：

- ✅ Edge 只存储 `index_name`（标识符）
- ✅ Runtime 自动查找，无需同步
- ✅ Single Source of Truth（Block 是唯一数据源）

---

## 问题

按照 Runtime Resolution 方案重构后，是否还能支持**每次 retrieve 时自定义 indexed sets**？

## 答案：✅ 完全支持

---

## 当前实现

### 1. Retrieve Edge Type 定义

```typescript
export type RetrievingEdgeJsonType = {
  type: 'search';
  data: {
    data_source: {
      id: string;                    // Block ID
      label: string;
      index_item: {
        index_name: string;          // ✅ 关键：用户选择的 indexed set 标识符
        collection_configs: {...};   // ❌ 冗余存储
      };
    }[];
  };
};
```

### 2. 用户选择流程（Retrieving.tsx）

```typescript
// 用户从下拉菜单选择一个 Block 的 indexed set
const addNodeLabel = (option: {
  nodeId: string;
  nodeLabel: string;
  indexItem: IndexingItem;  // ← 用户选择的 indexed set
}) => {
  const simplifiedIndexItem: SimplifiedIndexItem = {
    index_name: option.indexItem.index_name,           // ✅ 保留标识符
    collection_configs: option.indexItem.collection_configs,  // ❌ 冗余存储
  };
  
  const newItem = {
    id: option.nodeId,
    label: option.nodeLabel,
    index_item: simplifiedIndexItem,
  };
  
  // 添加到 dataSource
  updateDataSourceInParent([...dataSource, newItem]);
};
```

### 3. 支持场景

**场景 A：一个 Block 有多个 indexed sets**

```typescript
// Block WzK6iT 有两个 indexed sets
block.data.indexingList = [
  {
    index_name: "collection_1",
    status: "done",
    collection_configs: { collection_name: "collection_1", ... }
  },
  {
    index_name: "collection_2",
    status: "done",
    collection_configs: { collection_name: "collection_2", ... }
  }
];

// 用户可以选择任意一个
edge.data.data_source = [{
  id: "WzK6iT",
  index_item: {
    index_name: "collection_1",  // ← 用户选择第一个
    collection_configs: {...}     // ← 冗余存储
  }
}];
```

---

## Runtime Resolution 方案

### 1. 改进后的 Edge Type

```typescript
export type RetrievingEdgeJsonType = {
  type: 'search';
  data: {
    data_source: {
      id: string;
      label: string;
      index_item: {
        index_name: string;          // ✅ 保留：标识用户选择的 indexed set
        // ✅ collection_configs 移除：运行时从 Block 查找
      };
    }[];
  };
};
```

### 2. 用户选择流程（保持不变）

```typescript
// ✅ 完全相同的用户交互
const addNodeLabel = (option: {
  nodeId: string;
  nodeLabel: string;
  indexItem: IndexingItem;
}) => {
  const simplifiedIndexItem: SimplifiedIndexItem = {
    index_name: option.indexItem.index_name,  // ✅ 只存储标识符
    // ✅ 不再存储 collection_configs
  };
  
  const newItem = {
    id: option.nodeId,
    label: option.nodeLabel,
    index_item: simplifiedIndexItem,
  };
  
  updateDataSourceInParent([...dataSource, newItem]);
};
```

### 3. Runtime Resolution（关键实现）

```python
# SearchConfigParser.parse()
def parse(self, variable_replace_field: str = "query"):
    data_sources = self.edge_configs.get("data_source", [])
    
    enriched_data_sources = []
    for ds in data_sources:
        ds_id = ds.get("id")  # "WzK6iT"
        requested_index_name = ds.get("index_item", {}).get("index_name")  # "collection_1"
        
        # ✅ 从 block_configs 获取完整的 indexingList
        ds_block_config = self.block_configs.get(ds_id, {})
        indexing_list = ds_block_config.get("indexingList", [])
        
        # ✅ 根据 index_name 查找用户选择的 indexed set
        selected_index_item = None
        if requested_index_name:
            for item in indexing_list:
                if item.get("index_name") == requested_index_name:
                    selected_index_item = item  # ← 找到用户选择的！
                    break
        
        # ✅ 提取对应的 collection_configs
        collection_configs = selected_index_item.get("collection_configs", {}) if selected_index_item else {}
        
        # ✅ 动态构建完整的 index_item
        enriched_ds = {
            "id": ds_id,
            "label": ds.get("label"),
            "index_item": {
                "index_name": requested_index_name,
                "collection_configs": collection_configs  # ← 运行时查找并填充
            }
        }
        enriched_data_sources.append(enriched_ds)
    
    return ParsedEdgeParams(
        extra_configs=[{"data_source": enriched_data_sources}],
        ...
    )
```

---

## 对比：支持情况

| 场景 | 当前方案 | Runtime Resolution |
|------|---------|-------------------|
| **单个 indexed set** | ✅ 支持 | ✅ 支持 |
| **多个 indexed sets（选择其一）** | ✅ 支持 | ✅ 支持（通过 index_name 查找） |
| **自定义 collection_configs** | ❌ 不支持（只能使用 Block 中的） | ❌ 不支持（但这是预期的，因为 Block 是 Single Source of Truth） |
| **每次 retrieve 选择不同 indexed set** | ✅ 支持 | ✅ 支持（完全相同） |

---

## 实例：多个 indexed sets

### 场景

Block `WzK6iT` 有 3 个 indexed sets：

- `collection_1`: 技术文档（model: text-embedding-ada-002）
- `collection_2`: 学术论文（model: text-embedding-3-large）
- `collection_3`: 新闻文章（model: text-embedding-ada-002）

### 用户操作

**Retrieve Edge 1**：选择 `collection_1`（技术文档）

```json
{
  "id": "WzK6iT",
  "index_item": {
    "index_name": "collection_1"  // ← 用户选择
  }
}
```

**Retrieve Edge 2**：选择 `collection_2`（学术论文）

```json
{
  "id": "WzK6iT",
  "index_item": {
    "index_name": "collection_2"  // ← 用户选择不同的
  }
}
```

### Runtime Resolution

**Edge 1 执行时**：

```python
# 查找 "collection_1"
for item in indexing_list:
    if item["index_name"] == "collection_1":
        collection_configs = item["collection_configs"]  # ← 技术文档的配置
        break
```

**Edge 2 执行时**：

```python
# 查找 "collection_2"
for item in indexing_list:
    if item["index_name"] == "collection_2":
        collection_configs = item["collection_configs"]  # ← 学术论文的配置
        break
```

**结果**：

- ✅ Edge 1 使用 `collection_1` 的配置（技术文档）
- ✅ Edge 2 使用 `collection_2` 的配置（学术论文）
- ✅ 每次 retrieve 可以选择不同的 indexed set

---

## 结论

### ✅ Runtime Resolution 方案完全支持 custom indexed sets

1. **用户选择机制不变**：
   - 前端 UI 仍然允许用户选择不同的 `indexItem`
   - Edge 存储 `index_name` 作为标识符

2. **Runtime 查找机制**：
   - `SearchConfigParser` 根据 `index_name` 从 Block 的 `indexingList` 查找
   - 支持多个 indexed sets 的场景
   - 每次 retrieve 可以独立选择不同的 indexed set

3. **优势**：
   - ✅ 无需同步 `collection_configs`（运行时自动查找）
   - ✅ Single Source of Truth（Block 是唯一数据源）
   - ✅ 自动更新（Block 更新后自动反映）

### ⚠️ 不支持：自定义覆盖 collection_configs

**问题**：用户能否在 Edge 中覆盖 Block 的 `collection_configs`？

**答案**：不支持，也不应该支持。

**理由**：

- `collection_configs` 描述的是"向量集合的状态"（已索引，使用哪个模型等）
- 这是 Block 的元数据，不应该在 Edge 中被覆盖
- 如果需要不同的配置，应该创建新的 indexed set（新的 `collection_name`）

**如果需要自定义**：

1. 在 Block 中创建新的 indexed set（新的 `indexingList` 项）
2. 在 Edge 中选择新的 `index_name`

---

## 代码修改点

### 前端修改（简化）

```typescript
// buildRetrievingNodeJson() 或 addNodeLabel()
const simplifiedIndexItem: SimplifiedIndexItem = {
  index_name: option.indexItem.index_name,  // ✅ 保留
  // ❌ collection_configs 移除
};
```

### 后端修改（增强）

```python
# SearchConfigParser.parse()
# ✅ 添加根据 index_name 查找的逻辑
requested_index_name = ds.get("index_item", {}).get("index_name")
indexing_list = block_configs[ds_id]["indexingList"]

# 查找匹配的 indexed set
for item in indexing_list:
    if item["index_name"] == requested_index_name:
        collection_configs = item["collection_configs"]
        break
```

---

**总结**：Runtime Resolution 方案**完全支持** custom indexed sets，同时消除了数据同步的复杂性。
