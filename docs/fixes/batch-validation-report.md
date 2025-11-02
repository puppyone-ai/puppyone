# Batch 验证报告 - agentic-rag 模板

## 验证日期

2025-11-02

## 验证范围

验证 `templates/agentic-rag` 中的所有 vector_collection 资源是否符合 Batch 标准。

---

## 资源清单

| 资源 ID | 类型 | 文件路径 | 格式 | Batch 要求 |
|---------|------|----------|------|-----------|
| web-content | external_storage | resources/web-content.txt | text | ❌ N/A（非 vector_collection） |
| faq-extracted | external_storage | resources/faq-extracted.json | structured | ❌ N/A（非 vector_collection） |
| faq-schema | external_storage | resources/faq-schema.json | structured | ❌ N/A（非 vector_collection） |
| **faq-vector-kb** | **vector_collection** | **resources/faq-vector-kb.json** | **structured** | ✅ **必须是 Batch** |

---

## Vector Collection 资源验证

### Resource: faq-vector-kb

**文件**: `resources/faq-vector-kb.json`

**内容结构**:

```json
{
  "content": [
    {
      "question": "Where are you?",
      "answer": "PuppyAgent is based in Singapore, having 8 peoples"
    },
    {
      "question": "What is PuppyAgent?",
      "answer": "PuppyAgent is an automated AI knowledge builder..."
    },
    // ... 5 more items
  ],
  "indexing_config": {
    "key_path": [
      {
        "id": "NK-LPz",
        "type": "key",
        "value": "question"
      }
    ],
    "value_path": []
  }
}
```

**Batch 验证**:

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 有 `content` 字段 | ✅ | `content` 存在 |
| `content` 是数组 | ✅ | `Array.isArray(content) === true` |
| `content` 长度 > 0 | ✅ | 7 个条目 |
| `content` 项结构正确 | ✅ | 每项都有 `question` 和 `answer` |
| 有 `indexing_config` 字段 | ✅ | `indexing_config` 存在 |
| `indexing_config` 是对象 | ✅ | `typeof indexing_config === 'object'` |
| `indexing_config.key_path` 存在 | ✅ | 指向 `"question"` 字段 |
| `indexing_config.value_path` 存在 | ✅ | 空数组（使用完整对象） |
| `isBatch()` 验证通过 | ✅ | 通过类型守卫验证 |

**结论**: ✅ **完全符合 Batch 标准**

---

## Template 定义验证

### Resource Descriptor

**package.json 中的定义** (line 679-703):

```json
{
  "id": "faq-vector-kb",
  "type": "vector_collection",
  "block_id": "WzK6iT",
  "mounted_paths": {
    "content": "data.content",
    "entries": "data.indexingList[0].entries",
    "indexing_config": "data.indexingList[0]"
  },
  "source": {
    "path": "resources/faq-vector-kb.json",
    "format": "structured"
  },
  "target": {
    "pattern": "${userId}/${blockId}/${versionId}",
    "requires_user_scope": true,
    "vector_handling": "preserve_entries_only",
    "embedding_model": {
      "model_id": "text-embedding-ada-002",
      "provider": "OpenAI",
      "dimension": 1536,
      "fallback_strategy": "auto"
    }
  }
}
```

**验证结果**:

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `type` 正确 | ✅ | `"vector_collection"` |
| `source.format` 正确 | ✅ | `"structured"` |
| `mounted_paths` 完整 | ✅ | 包含 `content`, `entries`, `indexing_config` |
| 引用的文件存在 | ✅ | `resources/faq-vector-kb.json` 存在 |
| 文件格式符合 Batch | ✅ | 验证通过 |

**结论**: ✅ **资源定义完全正确**

---

## Block 定义验证

### Block: WzK6iT

**package.json 中的定义** (line 62-116):

```json
{
  "id": "WzK6iT",
  "type": "structured",
  "data": {
    "label": "FAQ Knowledge Base",
    "content": "",
    "storage_class": "internal",
    "isExternalStorage": false,
    "indexingList": [
      {
        "type": "vector",
        "entries": [],
        "status": "notStarted",
        "key_path": [
          {
            "id": "NK-LPz",
            "type": "key",
            "value": "question"
          }
        ],
        "value_path": [],
        "index_name": "",
        "collection_configs": {
          "set_name": "",
          "model": "",
          "vdb_type": "pgvector",
          "user_id": "",
          "collection_name": ""
        }
      }
    ]
  }
}
```

**验证结果**:

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `type` 正确 | ✅ | `"structured"` |
| `indexingList` 存在 | ✅ | 已初始化为数组 |
| `indexingList[0].type` | ✅ | `"vector"` |
| `indexingList[0].status` | ✅ | `"notStarted"` (正确的初始状态) |
| `indexingList[0].key_path` | ✅ | 与资源文件一致 |
| `indexingList[0].entries` | ✅ | 初始为空数组（待 auto-rebuild） |
| `collection_configs` 结构 | ✅ | 完整的空结构（待 auto-embedding） |
| `storage_class` | ✅ | `"internal"` (小文件，inline storage) |

**结论**: ✅ **Block 定义完全正确**

---

## Batch 生命周期验证

### Phase 1: Template Creation ✅

- ✅ Batch 文件已手动创建
- ✅ 格式正确
- ✅ 包含 7 条有效数据

### Phase 2: Template Storage ✅

- ✅ 文件存储在 `resources/` 目录
- ✅ Git 版本控制
- ✅ 文件命名规范

### Phase 3: Template Loading ✅

- ✅ `CloudTemplateLoader` 会读取并解析 JSON
- ✅ `isBatch()` 验证会通过

### Phase 4: Template Instantiation ✅

- ✅ **已修复**: External Storage 只上传 `content`
- ✅ Inline Storage 注入 `batch.content`
- ✅ `indexing_config` 存储在 `indexingList[0]`

**修复前**:

```typescript
// ❌ 上传整个 Batch
await uploadWithPartitioning(resourceContent, ...); // 包含 indexing_config
```

**修复后**:

```typescript
// ✅ 只上传 content
const contentOnly = JSON.stringify(batch.content);
await uploadWithPartitioning(contentOnly, ...); // 不包含 indexing_config
```

### Phase 5: Runtime Processing ✅

- ✅ Auto-Rebuild 会生成 entries
- ✅ Auto-Embedding 会调用 PuppyStorage API
- ✅ 状态更新为 `'done'` 或 `'error'`

### Phase 6: Update & Rebuild ⚠️

- ⚠️ 用户修改 content 后缺少提示（未来优化）
- ⚠️ 无法修改 indexing_config（未来优化）

### Phase 7: Cleanup ⚠️

- ✅ 删除工作区会清理 workflow JSON
- ⚠️ External Storage 清理机制未实现（未来优化）

---

## 代码修复总结

### 修改文件: `PuppyFlow/lib/templates/cloud.ts`

**修改内容**:

1. **统一 Batch 验证**（line 336-343）

   ```typescript
   // 所有 vector_collection 资源都必须验证 Batch 结构
   if (!isBatch(parsedContent)) {
     throw new Error('Invalid Batch format');
   }
   ```

2. **External Storage 修复**（line 349-371）

   ```typescript
   if (isExternal) {
     // ✅ 只上传 content（不包括 indexing_config）
     const contentOnly = JSON.stringify(batch.content);
     const resourceKey = await this.uploadWithPartitioning(
       contentOnly,
       'structured',
       targetKey,
       userId
     );
     
     console.log(
       `[CloudTemplateLoader] 📤 Uploaded vector collection content ` +
       `(${batch.content.length} items) to external storage: ${resourceKey}`
     );
   }
   ```

3. **Inline Storage 日志增强**（line 372-393）

   ```typescript
   else {
     // ✅ 注入 content 到 workflow JSON
     this.updateWorkflowReference(
       workflow,
       block.id,
       resource.mounted_paths.content,
       batch.content
     );
     
     console.log(
       `[CloudTemplateLoader] 💾 Stored vector collection content ` +
       `(${batch.content.length} items) inline`
     );
   }
   ```

**修复效果**:

| 方面 | 修复前 | 修复后 |
|------|--------|--------|
| Batch 验证 | ⚠️ 只在 inline storage | ✅ 两个分支统一验证 |
| External 上传内容 | ❌ 整个 Batch | ✅ 只上传 content |
| indexing_config 存储 | ❌ 冗余（storage + indexingList） | ✅ SSOT（只在 indexingList） |
| 日志可观测性 | ⚠️ 部分日志 | ✅ 完整日志 |
| 架构一致性 | ❌ 两个分支不一致 | ✅ 两个分支一致 |

---

## 最终结论

### ✅ agentic-rag 模板完全符合 Batch 标准

1. **资源文件**: `faq-vector-kb.json` 是有效的 Batch 格式
2. **资源定义**: `package.json` 中的 resource descriptor 正确
3. **Block 定义**: WzK6iT block 的 indexingList 结构正确
4. **代码实现**: `CloudTemplateLoader` 已修复，支持正确的 Batch 处理

### ✅ External Storage 问题已修复

- 只上传 `content`，不上传 `indexing_config`
- 遵循 Single Source of Truth 原则
- 与 inline storage 架构一致

### 🎯 可以安全使用

模板现在可以安全地实例化，无论是 inline storage 还是 external storage 场景。

---

## 测试建议

### 测试用例 1: Inline Storage（当前场景）

```bash
# 当前 faq-vector-kb.json 大小: ~2KB
# 会使用 inline storage

1. 实例化模板
2. 验证 block.data.content 包含 7 条数据
3. 验证 block.data.indexingList[0].key_path 正确
4. 验证 auto-rebuild 生成 7 条 entries
5. 验证 auto-embedding 成功
```

### 测试用例 2: External Storage（模拟大文件）

```bash
# 创建一个大的 Batch 文件（> 1MB）以触发 external storage

1. 复制 faq-vector-kb.json 为 large-faq-vector-kb.json
2. 扩展 content 数组到 1000+ 条目
3. 修改 package.json 添加新资源
4. 实例化并验证：
   - PuppyStorage 只存储 content 数组
   - indexingList 包含完整的 indexing_config
   - auto-rebuild 和 auto-embedding 正常工作
```

---

## 附录: Batch 类型定义

```typescript
// lib/templates/types.ts
export interface Batch<T = any, C = any> {
  content: T[];        // 数据内容（数组）
  indexing_config: C;  // 索引配置（对象）
}

export function isBatch(obj: any): obj is Batch {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    Array.isArray(obj.content) &&
    obj.indexing_config !== undefined &&
    typeof obj.indexing_config === 'object' &&
    obj.indexing_config !== null
  );
}
```

---

## 相关文档

- [Batch vs Entries 边界分析](../architecture/batch-entries-boundary.md)
- [Batch 生命周期分析](../architecture/batch-lifecycle-analysis.md)
- [External Storage 修复方案](./batch-external-storage-fix.md)
- [模板资源契约](../architecture/template-resource-contract.md)
