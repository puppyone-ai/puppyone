# Batch vs Entries - 架构边界分析

## TL;DR

- **Batch**: 模板静态资源 = 原始数据 + 提取规则（用于存储和迁移）
- **Entries**: 运行时动态状态 = 从 Batch 派生的、可 embedding 的数据

## 数据流

```
┌─────────────────────────────────────────────────────────────┐
│ Template Package (Git Repository)                           │
│                                                              │
│  resources/faq-vector-kb.json (Batch format):              │
│  {                                                          │
│    "content": [                                             │
│      {"question": "What is X?", "answer": "X is..."},      │
│      {"question": "How to Y?", "answer": "Y can be..."}    │
│    ],                                                       │
│    "indexing_config": {                                     │
│      "key_path": [{"type": "key", "value": "question"}],   │
│      "value_path": []                                       │
│    }                                                        │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Template Instantiation
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CloudTemplateLoader.processVectorCollection()               │
│                                                              │
│  1. Parse JSON → Batch                                      │
│  2. Validate: isBatch(parsedContent)                        │
│  3. Store Batch.content → block.data.content                │
│  4. Store indexing_config → block.data.indexingList[0]      │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Auto-Rebuild
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ VectorAutoRebuildService.attemptAutoRebuild()               │
│                                                              │
│  Input: Batch {content, indexing_config}                    │
│  Process:                                                    │
│    entries = VectorIndexing.extractEntries(                 │
│      batch.content,          // 原始数据                     │
│      batch.indexing_config   // 提取规则                     │
│    )                                                         │
│  Output: Entries[]                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Entries Generated
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Runtime State (Workflow JSON)                               │
│                                                              │
│  block.data.indexingList[0]: {                              │
│    type: "vector",                                          │
│    entries: [                              ← Entries        │
│      {                                                      │
│        content: "What is X?",              ← 用于 embedding  │
│        metadata: {                                          │
│          id: 0,                                             │
│          retrieval_content: {...}          ← 用于检索返回     │
│        }                                                    │
│      },                                                     │
│      {...}                                                  │
│    ],                                                       │
│    status: "processing",                                    │
│    key_path: [...],                        ← 从 Batch 复制   │
│    value_path: [...],                      ← 从 Batch 复制   │
│    index_name: "",                                          │
│    collection_configs: {}                                   │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Auto-Embedding
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CloudTemplateLoader.callEmbeddingAPI()                      │
│                                                              │
│  Input: entries (from indexingList[0].entries)              │
│  API: POST /api/storage/vector/embed                        │
│  Output: {collection_name, set_name}                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Vectors Stored
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ PuppyStorage Vector Database                                │
│                                                              │
│  collection_user_xxx_model_yyy_set_zzz:                     │
│    vector[0]: [0.123, -0.456, ..., 0.789]  # 1536-dim      │
│    vector[1]: [0.234, -0.567, ..., 0.890]                   │
│    ...                                                      │
└─────────────────────────────────────────────────────────────┘
```

## 详细边界定义

### Batch（静态资源）

**定义**: 模板中的原始数据 + 提取规则

**结构**:

```typescript
interface Batch<T = any, C = any> {
  content: T[];        // 原始业务数据（完整、未处理）
  indexing_config: C;  // 如何从 content 提取 entries 的规则
}
```

**特征**:

- ✅ **静态**: 存储在 Git 仓库的模板文件中
- ✅ **可迁移**: 可以跨环境、跨用户复制
- ✅ **完整**: 包含所有原始数据，不丢失信息
- ✅ **自描述**: 包含提取规则，可重现 entries
- ❌ **不包含 entries**: entries 是派生数据，不存储在 Batch 中

**用途**:

1. 模板存储（Git）
2. 模板分发（跨环境）
3. 工作区实例化（复制到新用户）

**示例**:

```json
{
  "content": [
    {"question": "What is PuppyAgent?", "answer": "PuppyAgent is..."},
    {"question": "How to use?", "answer": "You can use..."}
  ],
  "indexing_config": {
    "key_path": [{"id": "xxx", "type": "key", "value": "question"}],
    "value_path": []
  }
}
```

---

### Entries（运行时状态）

**定义**: 从 Batch 派生的、准备好进行 embedding 的数据

**结构**:

```typescript
interface VectorEntry {
  content: string;      // 提取的文本（用于 embedding）
  metadata: {           // 元数据（用于检索返回）
    id: number;
    retrieval_content: any;
  };
}
```

**特征**:

- ✅ **动态**: 运行时从 Batch 计算生成
- ✅ **派生**: 通过 `indexing_config` 规则从 `content` 提取
- ✅ **格式化**: 已转换为 embedding API 可接受的格式
- ✅ **可重现**: 只要有 Batch，就能重新生成
- ❌ **不可迁移**: 跨环境时应该重新生成，而不是复制

**生成过程**:

```typescript
// VectorIndexing.extractEntries()
entries = batch.content.map((item, index) => ({
  content: getByPath(item, batch.indexing_config.key_path),  // "What is PuppyAgent?"
  metadata: {
    id: index,
    retrieval_content: getByPath(item, batch.indexing_config.value_path)  // 完整的 item
  }
}));
```

**用途**:

1. Embedding 输入（调用 OpenAI API）
2. 前端 UI 显示（indexingList 中）
3. 调试和验证（查看提取结果）

**示例**:

```typescript
[
  {
    content: "What is PuppyAgent?",           // ← 用于 embedding
    metadata: {
      id: 0,
      retrieval_content: {                     // ← 检索时返回
        question: "What is PuppyAgent?",
        answer: "PuppyAgent is..."
      }
    }
  },
  {
    content: "How to use?",
    metadata: {
      id: 1,
      retrieval_content: {
        question: "How to use?",
        answer: "You can use..."
      }
    }
  }
]
```

---

## 为什么不在 Batch 中存储 Entries？

### 问题：如果 Batch 包含 entries，会怎样？

```json
{
  "content": [...],
  "indexing_config": {...},
  "entries": [...]     // ❌ 不应该有这个字段！
}
```

### 原因分析

1. **数据冗余**
   - `entries` 可以从 `content + indexing_config` 完全派生
   - 违反 Single Source of Truth 原则

2. **一致性风险**
   - 如果修改了 `content`，但忘记更新 `entries`？
   - 如果修改了 `indexing_config`，但 `entries` 还是旧的？
   - 引入了数据不一致的可能性

3. **模板维护成本**
   - 每次修改 `content` 都要重新生成 `entries`
   - 需要额外的工具/脚本来保持同步

4. **不符合 "Rule of Three" 经验**
   - 第一次实现：直接存储（简单但有隐患）
   - 第二次发现：数据不一致问题
   - 第三次抽象：只存储源数据和规则，运行时派生

---

## 类比：函数式编程

可以类比为函数式编程的概念：

```typescript
// Batch = 数据 + 转换函数
const batch: Batch = {
  content: rawData,           // 原始数据
  indexing_config: transform  // 转换规则
};

// Entries = 应用转换函数后的结果
const entries = transform(rawData);

// ✅ 好处：只要有 rawData 和 transform，就能重现 entries
// ❌ 反例：如果同时存储 rawData 和 entries，可能不一致
```

---

## 总结表

| 维度 | Batch | Entries |
|------|-------|---------|
| **定义** | 原始数据 + 提取规则 | 派生的、可 embedding 的数据 |
| **存储位置** | 模板文件（Git） | 工作区 JSON（运行时） |
| **生命周期** | 静态、持久 | 动态、可重现 |
| **可迁移性** | ✅ 跨环境迁移 | ❌ 应重新生成 |
| **数据完整性** | ✅ 包含所有原始信息 | ⚠️ 只包含提取后的信息 |
| **一致性** | ✅ Single Source of Truth | ✅ 从 Batch 派生，保证一致 |
| **用途** | 模板存储、分发 | Embedding、UI 显示 |

---

## 实际使用场景

### 场景 1: 模板创作者

```bash
# 1. 创建 Batch 资源
cat > resources/faq-vector-kb.json <<EOF
{
  "content": [
    {"question": "Q1", "answer": "A1"},
    {"question": "Q2", "answer": "A2"}
  ],
  "indexing_config": {
    "key_path": [{"type": "key", "value": "question"}],
    "value_path": []
  }
}
EOF

# 2. Commit 到 Git
git add resources/faq-vector-kb.json
git commit -m "Add FAQ knowledge base (Batch format)"

# ✅ 只存储 Batch，不存储 Entries
```

### 场景 2: 用户实例化模板

```typescript
// 1. 加载 Batch
const batch = loadTemplateResource('faq-vector-kb.json');

// 2. 验证 Batch
if (!isBatch(batch)) {
  throw new Error('Invalid Batch format');
}

// 3. 生成 Entries（运行时）
const entries = VectorIndexing.extractEntries(
  batch.content,
  batch.indexing_config
);

// 4. 调用 Embedding
await callEmbeddingAPI(userId, blockId, entries);

// ✅ Entries 是动态生成的，不从模板复制
```

### 场景 3: 用户修改数据

```typescript
// 用户在 UI 中修改了 content
block.data.content = [
  {"question": "Q1 (modified)", "answer": "A1"},
  {"question": "Q3 (new)", "answer": "A3"}
];

// 用户点击 "重新构建索引"
// ↓ 重新生成 Entries
const newEntries = VectorIndexing.extractEntries(
  block.data.content,          // 新的 content
  block.data.indexingList[0]   // 原有的 indexing_config
);

// ✅ 从最新的 content 重新派生，保证一致性
```

---

## 设计原则

1. **Single Source of Truth**: Batch 是唯一的数据源
2. **Derivable State**: Entries 是可派生状态，不独立存储
3. **Immutability**: 模板中的 Batch 是不可变的
4. **Reproducibility**: 给定相同的 Batch，总能生成相同的 Entries

---

## 未来扩展

### Phase 3.10: 预构建 Entries（可选优化）

在模板构建时可以选择**预生成 Entries**（作为缓存），但仍然保留 Batch 作为源数据：

```json
{
  "content": [...],           // ✅ 源数据
  "indexing_config": {...},   // ✅ 提取规则
  "_prebuilt_entries": [...]  // ⚠️ 可选的缓存（仅用于性能优化）
}
```

**注意**:

- `_prebuilt_entries` 只是性能优化的缓存
- 实例化时仍然应该验证 `_prebuilt_entries` 与 `content + indexing_config` 一致
- 如果不一致，应该警告并重新生成

这样既保留了 Batch 作为 SSOT，又提供了性能优化的可能性。
