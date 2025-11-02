# Batch External Storage 问题修复方案

## 问题描述

### 当前实现的问题

在 `cloud.ts:340-385` 中，Batch 的 external storage 处理存在架构不一致：

```typescript
// External Storage 分支
if (isExternal) {
  const resourceKey = await this.uploadWithPartitioning(
    resourceContent,  // ❌ 上传整个 Batch JSON {content, indexing_config}
    resource.source.format,
    targetKey,
    userId
  );
  
  // ✅ 设置了 external_metadata
  block.data.external_metadata = { resource_key: resourceKey };
  block.data.storage_class = 'external';
  
  // ❌ 但是没有设置 block.data.content（前端需要用这个显示）
  // ❌ 没有验证 Batch 结构
}
else {
  // Inline Storage 分支
  // ✅ 验证 Batch 结构
  if (!isBatch(parsedContent)) {
    throw new Error('Invalid Batch format');
  }
  
  // ✅ 只注入 content（不包括 indexing_config）
  const batch = parsedContent as Batch;
  this.updateWorkflowReference(
    workflow,
    block.id,
    resource.mounted_paths.content,
    batch.content  // ✅ 只存储 content 数组
  );
  
  block.data.storage_class = 'internal';
}

// 然后无论哪个分支，都会：
// ✅ 从 batch.indexing_config 生成 indexingList
const batch = parsedContent as Batch;
if (this.config.enableAutoRebuild && batch.content.length > 0) {
  // 使用 batch.content 和 batch.indexing_config
}
```

### 架构不一致性

| 方面 | Inline Storage | External Storage | 问题 |
|------|----------------|------------------|------|
| 上传内容 | N/A（不上传） | 整个 Batch JSON | ❌ 包含冗余的 indexing_config |
| block.data.content | ✅ 设置为 batch.content | ❌ 未设置 | ❌ 前端无法访问 |
| Batch 验证 | ✅ isBatch() | ❌ 未验证 | ❌ 可能运行时失败 |
| indexing_config 存储 | ✅ 只在 indexingList 中 | ⚠️ 同时在 storage 和 indexingList | ❌ 数据冗余 |

---

## 问题影响

### 1. 前端显示问题

```typescript
// 前端组件需要显示 content
const content = block.data.content;  // ❌ External storage 时为空

// 前端需要从 external storage 下载
const response = await fetch(`/api/storage/download/${block.data.external_metadata.resource_key}`);
const data = await response.json();  // ❓ 得到的是整个 Batch {content, indexing_config}

// ❓ 前端是否知道要取 data.content？
```

### 2. 重建索引问题

```typescript
// 用户修改了 content 后想重建索引
const content = block.data.content;  // ❌ External storage 时为空

// 需要从 external storage 获取
// ❓ 但是下载的是 Batch，需要解析 batch.content
```

### 3. indexing_config 冗余问题

```typescript
// Storage 中存储的 Batch
{
  "content": [...],
  "indexing_config": {...}  // ❌ 冗余：已经在 block.data.indexingList[0] 中
}

// block.data.indexingList[0]
{
  "key_path": [...],      // ✅ 从 batch.indexing_config 复制
  "value_path": [...],    // ✅ 从 batch.indexing_config 复制
  // ...
}

// ❌ 问题：两处存储相同信息，可能不一致
```

---

## 修复方案

### 方案 A: 只上传 content（推荐）

**原则**: External storage 应该只存储 data（content），不存储 metadata（indexing_config）

```typescript
if (isExternal) {
  // 1. 验证 Batch 结构
  if (!isBatch(parsedContent)) {
    throw new Error(
      `vector_collection resource ${resource.id} must be a valid Batch`
    );
  }
  
  const batch = parsedContent as Batch;
  
  // 2. 只上传 content 部分（不包括 indexing_config）
  const contentOnly = JSON.stringify(batch.content);
  const resourceKey = await this.uploadWithPartitioning(
    contentOnly,  // ✅ 只上传 content
    'structured',
    targetKey,
    userId
  );
  
  // 3. 设置 external storage metadata
  block.data.external_metadata = {
    resource_key: resourceKey
  };
  block.data.storage_class = 'external';
  block.data.isExternalStorage = true;
  
  // 4. 不设置 block.data.content（因为是 external）
  // 前端知道：如果 storage_class === 'external'，需要从 PuppyStorage 下载
  
  // 5. indexing_config 仍然存储在 indexingList 中
  // （后续代码会处理）
}
```

**优点**:

- ✅ Single Source of Truth：indexing_config 只在 indexingList 中
- ✅ 减少存储空间（不存储 indexing_config）
- ✅ 与 inline storage 架构一致（都只存储 content）

**缺点**:

- ⚠️ 前端需要知道：external storage 时，下载的是 content 数组，不是 Batch

---

### 方案 B: 上传完整 Batch，但前端解析（兼容性方案）

**原则**: 保持当前上传逻辑，但明确前端解析规则

```typescript
if (isExternal) {
  // 1. 验证 Batch 结构
  if (!isBatch(parsedContent)) {
    throw new Error('Invalid Batch format');
  }
  
  const batch = parsedContent as Batch;
  
  // 2. 上传完整的 Batch JSON（包括 indexing_config）
  const resourceKey = await this.uploadWithPartitioning(
    resourceContent,  // ✅ 完整的 Batch
    resource.source.format,
    targetKey,
    userId
  );
  
  // 3. 设置 external storage metadata + 标记为 Batch 格式
  block.data.external_metadata = {
    resource_key: resourceKey,
    format: 'batch'  // ✅ 标记：下载后需要解析 batch.content
  };
  block.data.storage_class = 'external';
  block.data.isExternalStorage = true;
}
```

**前端适配**:

```typescript
// 前端下载 external vector collection
async function loadExternalVectorCollection(block: Block) {
  const resourceKey = block.data.external_metadata.resource_key;
  const response = await fetch(`/api/storage/download/${resourceKey}`);
  const data = await response.json();
  
  // ✅ 检查是否为 Batch 格式
  if (block.data.external_metadata.format === 'batch') {
    // 解析 Batch，只使用 content
    return data.content;  // ✅ 返回数组
  } else {
    // 旧格式：直接返回
    return data;
  }
}
```

**优点**:

- ✅ 向后兼容（已有的 external storage 不受影响）
- ✅ Batch 完整性（可以验证 indexing_config 一致性）

**缺点**:

- ❌ 数据冗余（storage 和 indexingList 都存储 indexing_config）
- ❌ 前端需要额外的解析逻辑

---

## 推荐方案：方案 A（只上传 content）

### 实现步骤

#### Step 1: 修改 `processVectorCollection()`

```typescript
// cloud.ts:340-385
if (isExternal) {
  // Validate Batch structure (same as inline storage)
  if (!isBatch(parsedContent)) {
    throw new Error(
      `vector_collection resource ${resource.id} must be a valid Batch: ` +
      `{content: array, indexing_config: object}. ` +
      `Got: ${JSON.stringify(parsedContent).substring(0, 200)}`
    );
  }

  const batch = parsedContent as Batch;

  // Upload ONLY content (not indexing_config)
  const contentOnly = JSON.stringify(batch.content);
  const resourceKey = await this.uploadWithPartitioning(
    contentOnly,
    'structured',
    targetKey,
    userId
  );

  // Set external storage metadata
  if (!block.data.external_metadata) {
    block.data.external_metadata = {};
  }
  block.data.external_metadata.resource_key = resourceKey;
  block.data.storage_class = 'external';
  block.data.isExternalStorage = true;

  console.log(
    `[CloudTemplateLoader] Uploaded vector collection content (${batch.content.length} items) to external storage: ${resourceKey}`
  );
} else {
  // Inline storage: same as before
  if (resource.mounted_paths?.content) {
    if (!isBatch(parsedContent)) {
      throw new Error(
        `vector_collection resource ${resource.id} must be a valid Batch`
      );
    }

    const batch = parsedContent as Batch;

    this.updateWorkflowReference(
      workflow,
      block.id,
      resource.mounted_paths.content,
      batch.content
    );
  }
  block.data.storage_class = 'internal';
  block.data.isExternalStorage = false;

  if (block.data.external_metadata) {
    delete block.data.external_metadata;
  }
}

// indexing_config processing (same for both branches)
// ... 后续代码不变 ...
```

#### Step 2: 前端适配（确认现有逻辑）

检查前端是否已经正确处理 external storage 的 vector collection：

```typescript
// 前端应该已经有类似的逻辑
if (block.data.storage_class === 'external') {
  // 从 PuppyStorage 下载
  const content = await downloadFromStorage(block.data.external_metadata.resource_key);
  // content 应该是数组（因为我们只上传了 content）
} else {
  // 从 block.data.content 读取
  const content = block.data.content;
}
```

#### Step 3: 添加测试

```typescript
// test: external storage vector collection
test('processVectorCollection with external storage', async () => {
  const batch: Batch = {
    content: [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' }
    ],
    indexing_config: {
      key_path: [{ type: 'key', value: 'question' }],
      value_path: []
    }
  };

  // Mock large file (> 1MB to trigger external storage)
  const resourceContent = JSON.stringify(batch);
  const isExternal = true;

  await loader.processVectorCollection(
    resource,
    resourceContent,
    batch,
    isExternal,
    userId,
    workspaceId,
    block,
    workflow,
    models
  );

  // Assert: uploaded only content
  expect(mockUpload).toHaveBeenCalledWith(
    JSON.stringify(batch.content),  // ✅ Only content
    'structured',
    expect.any(String),
    userId
  );

  // Assert: external_metadata set
  expect(block.data.external_metadata).toBeDefined();
  expect(block.data.storage_class).toBe('external');

  // Assert: indexingList has indexing_config
  expect(block.data.indexingList[0].key_path).toEqual(batch.indexing_config.key_path);
});
```

---

## 迁移计划

### Phase 1: 修复新实例（立即）

- ✅ 修改 `processVectorCollection()` 实现方案 A
- ✅ 确保前端兼容（验证现有逻辑）
- ✅ 添加测试

### Phase 2: 兼容旧数据（可选）

如果已经有用户使用了 external storage 的 vector collection：

```typescript
// 添加兼容性处理
async function loadExternalVectorCollection(block: Block) {
  const resourceKey = block.data.external_metadata.resource_key;
  const response = await fetch(`/api/storage/download/${resourceKey}`);
  const data = await response.json();
  
  // 兼容性检查：如果是 Batch 格式（旧数据）
  if (isBatch(data)) {
    console.warn('[Compatibility] Detected old Batch format in external storage');
    return data.content;  // 解析 Batch
  }
  
  // 新格式：直接是 content 数组
  return data;
}
```

### Phase 3: 数据迁移（长期）

如果需要迁移旧的 external storage：

```typescript
// 迁移脚本：重新上传只包含 content 的文件
async function migrateOldExternalBatches() {
  const workspaces = await getAllWorkspaces();
  
  for (const workspace of workspaces) {
    const blocks = getVectorCollectionBlocks(workspace);
    
    for (const block of blocks) {
      if (block.data.storage_class === 'external') {
        // 下载旧的 Batch
        const oldData = await downloadFromStorage(
          block.data.external_metadata.resource_key
        );
        
        // 检查是否为 Batch 格式
        if (isBatch(oldData)) {
          console.log(`Migrating block ${block.id}...`);
          
          // 重新上传只包含 content
          const newKey = await uploadToStorage(
            JSON.stringify(oldData.content),
            block.data.external_metadata.resource_key
          );
          
          // 更新 resource_key
          block.data.external_metadata.resource_key = newKey;
          
          await saveWorkspace(workspace);
        }
      }
    }
  }
}
```

---

## 总结

### 当前问题

❌ External storage 上传完整 Batch（包括冗余的 indexing_config）
❌ 未设置 `block.data.content`（可能影响前端）
❌ 未验证 Batch 结构
❌ 与 inline storage 架构不一致

### 修复后

✅ External storage 只上传 content（与 inline storage 一致）
✅ indexing_config 只存储在 indexingList 中（SSOT）
✅ Batch 结构验证（两个分支一致）
✅ 减少存储空间和数据冗余

### 优先级

🔴 **High**: 立即修复（防止未来的数据不一致问题）
🟢 **Low**: 迁移旧数据（如果有的话）
