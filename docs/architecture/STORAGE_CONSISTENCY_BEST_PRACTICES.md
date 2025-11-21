# Storage Consistency Best Practices

> **SSOT for storage_class and external_metadata management across three write operations**
>
> Date: 2025-01-30
> Status: Recommendation (Pending implementation)

---

## Executive Summary

**三处写操作识别**：
1. **Workspace实例化** (Template Instantiation) - `CloudTemplateLoader`
2. **前端运行时更新** (Frontend Runtime) - `dynamicStorageStrategy.ts`
3. **后端计算结果更新** (Backend Computation) - `BlockUpdateService`

**当前问题**：
- ❌ 阈值不一致：Template使用1MB，Runtime和Backend使用1KB
- ⚠️ metadata清理不一致：Template删除，Runtime保留，Backend忽略

**推荐方案**：
- ✅ **Option A: 统一阈值到1MB** (推荐)
- ✅ **Option B: 统一metadata管理策略**

---

## Part 1: 阈值一致性 (Storage Threshold Alignment)

### 当前状态

| 位置 | 代码 | 阈值 | 单位 |
|------|------|------|------|
| Template | `CloudTemplateLoader.ts` | `STORAGE_THRESHOLD = 1024 * 1024` | bytes |
| Frontend | `dynamicStorageStrategy.ts` | `CONTENT_LENGTH_THRESHOLD = 1024` | chars |
| Backend | `HybridStoragePolicy.py` | `threshold = 1024` | chars |

### 问题分析

**场景示例**：
```typescript
// 1. Template instantiation: 10KB content
const content = "x".repeat(10_000); // 10KB

// Template判断 (1MB阈值):
10_000 < 1_048_576  → storage_class = 'internal' ✅

// 用户编辑后，Frontend判断 (1KB阈值):
10_000 > 1_024  → 触发switchToExternal ⚠️

// 结果：不必要的storage升级
```

**影响**：
- ❌ 模板中inline的资源，用户首次编辑后被升级为external
- ❌ 增加不必要的网络请求和存储成本
- ❌ 用户体验不一致（同样内容在不同阶段表现不同）

### 🎯 推荐方案 A1: 统一阈值到1MB

**原因**：
1. **性能优化**：1KB太小，导致过多小资源被上传
2. **网络友好**：减少请求数，inline更高效
3. **符合STORAGE_SPEC.md**：文档明确定义为1MB
4. **与partitioning对齐**：Part size是1MB，阈值应该一致

**实施步骤**：

#### Step 1: 更新Frontend阈值

```typescript
// PuppyFlow/app/components/workflow/utils/dynamicStorageStrategy.ts

// OLD:
// let CONTENT_LENGTH_THRESHOLD = STORAGE_PART_SIZE_DEFAULT; // 1024

// NEW:
export let CONTENT_LENGTH_THRESHOLD = 1024 * 1024; // 1MB = 1,048,576 bytes

// 更新注释：
/**
 * 内容长度阈值：与后端STORAGE_THRESHOLD保持一致
 * - < 1MB: internal storage (inline in JSON)
 * - >= 1MB: external storage (partitioned upload)
 */
```

#### Step 2: 更新Backend阈值

```python
# PuppyEngine/Server/HybridStoragePolicy.py

# OLD:
# self.threshold = threshold or int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))

# NEW:
self.threshold = threshold or int(os.getenv("STORAGE_THRESHOLD", str(1024 * 1024)))

# 更新注释：
"""
Unified storage threshold: 1MB = 1,048,576 bytes
This threshold must match:
- Frontend: dynamicStorageStrategy.CONTENT_LENGTH_THRESHOLD
- Backend instantiation: CloudTemplateLoader.STORAGE_THRESHOLD
"""
```

#### Step 3: 环境变量对齐

```bash
# .env (统一命名)
STORAGE_THRESHOLD=1048576  # 1MB in bytes

# 移除旧的:
# STORAGE_CHUNK_SIZE=1024  ← 废弃
# STORAGE_PART_SIZE=1024   ← 仅用于partitioning，不影响阈值判断
```

**验证**：
```typescript
// Test case
const content = "x".repeat(10_000); // 10KB

// All three locations should agree:
CloudTemplateLoader:     10_000 < 1_048_576  → internal ✅
dynamicStorageStrategy: 10_000 < 1_048_576  → internal ✅
HybridStoragePolicy:    10_000 < 1_048_576  → internal ✅
```

### Alternative: 方案 A2: 统一阈值到1KB

**原因**（如果你更倾向保守）：
- Frontend和Backend已经都是1KB
- 只需修改Template instantiation
- 更快触发external storage，减少JSON体积

**实施步骤**：
```typescript
// PuppyFlow/lib/templates/cloud.ts
const STORAGE_THRESHOLD = 1024; // 从 1024 * 1024 降到 1024
```

**不推荐原因**：
- ❌ 违反STORAGE_SPEC.md的设计
- ❌ 大量小资源被external化，增加网络开销
- ❌ Part size是1MB，阈值是1KB，不匹配

---

## Part 2: external_metadata管理一致性

### 当前状态

| 场景 | storage_class | external_metadata处理 | 位置 |
|------|---------------|----------------------|------|
| Template → internal | `internal` | ✅ `delete` | `CloudTemplateLoader` |
| Runtime → internal | `internal` | ⚠️ **保留** | `switchToInternal()` |
| Backend → internal | `internal` | ⚠️ **忽略** | `BlockUpdateService` |

### 问题分析

**场景1：Runtime保留metadata**
```typescript
// 用户编辑：1MB → 500KB（变小）
switchToInternal(nodeId, content, setNodes);

// 结果：
block.data.storage_class = 'internal';  // ✅ 权威标记
block.data.external_metadata = { resource_key: "..." };  // ⚠️ 残留

// 原因：保留resource_key，如果内容再变大可以重用
```

**场景2：Backend忽略metadata**
```python
# Edge计算输出：短内容
_handle_internal_storage_update(block, content, v1_results)

# 结果：
block.storage_class = 'internal'  # ✅ 权威标记
# block.data['external_metadata'] 不管理  # ⚠️ 如果之前有，会残留
```

### 🎯 推荐方案 B: 统一metadata管理策略

**核心原则**：
> **storage_class是权威标记，external_metadata是数据引用**
> 
> - `storage_class = 'external'` + `has resource_key` → 加载external resource
> - `storage_class = 'internal'` → 忽略metadata（即使存在）
> - metadata可以保留用于重用，但必须明确注释

**方案B1: 明确注释保留原因（推荐）**

```typescript
// dynamicStorageStrategy.ts
export function switchToInternal(nodeId, content, setNodes) {
  setNodes(prev =>
    prev.map(node =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              content,
              storage_class: 'internal',  // ← SSOT: Authoritative flag
              isExternalStorage: false,
              
              // Intentionally preserve external_metadata for resource_key reuse.
              // Frontend will ignore it (checks storage_class first).
              // If content grows again, switchToExternal can reuse the key.
              // external_metadata: undefined,  ← DO NOT uncomment (breaks reuse)
              
              dirty: false,
              savingStatus: 'saved',
            },
          }
        : node
    )
  );
}
```

```python
# BlockUpdateService.py
def _handle_internal_storage_update(self, block, content, v1_results):
    """Handle block update with internal storage"""
    
    # Force internal storage for short content
    block.storage_class = 'internal'  # ← SSOT: Authoritative flag
    
    # Intentionally preserve external_metadata for resource_key reuse.
    # Backend will ignore it (checks storage_class first).
    # If computation output grows later, external strategy can reuse the key.
    # block.data.pop('external_metadata', None)  ← DO NOT do this (breaks reuse)
    
    block.is_persisted = True
    v1_results[block.id] = content
```

**方案B2: 完全清理metadata（简单但失去重用）**

```typescript
// dynamicStorageStrategy.ts
export function switchToInternal(nodeId, content, setNodes) {
  setNodes(prev =>
    prev.map(node =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              content,
              storage_class: 'internal',
              isExternalStorage: false,
              external_metadata: undefined,  // ← 完全清理
              dirty: false,
              savingStatus: 'saved',
            },
          }
        : node
    )
  );
}
```

```python
# BlockUpdateService.py
def _handle_internal_storage_update(self, block, content, v1_results):
    block.storage_class = 'internal'
    
    # Clear external_metadata for consistency
    if 'external_metadata' in block.data:
        del block.data['external_metadata']  # ← 完全清理
    
    block.is_persisted = True
    v1_results[block.id] = content
```

**权衡**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **B1: 保留metadata** | • 重用resource_key（性能优化）<br>• 避免频繁创建新资源 | • 数据冗余<br>• 语义不清晰 |
| **B2: 清理metadata** | • 数据清洁<br>• 语义明确 | • 失去重用优化<br>• 频繁切换时创建新资源 |

**推荐**：**方案B1（保留 + 明确注释）**

原因：
- ✅ 性能优化有实际价值（频繁编辑时）
- ✅ Frontend/Backend判断逻辑正确（只看storage_class）
- ✅ 通过注释明确设计意图
- ✅ 与Template instantiation的"删除旧metadata"不冲突（那是无效metadata）

---

## Part 3: 完整的一致性规范

### 规范表

| 操作 | storage_class | external_metadata | resource上传 | 备注 |
|------|---------------|-------------------|-------------|------|
| **Template → internal** | `internal` | `delete` | No | 旧metadata无效，必须清理 |
| **Template → external** | `external` | 设置新key | Yes | 上传到user namespace |
| **Runtime → internal** | `internal` | **保留** | No | 重用optimization |
| **Runtime → external** | `external` | 重用或新建 | Yes | 优先重用existing key |
| **Backend → internal** | `internal` | **保留** | No | 重用optimization |
| **Backend → external** | `external` | 设置新key | Yes | 持久化到storage |

### 判断流程图

```
┌──────────────────────────┐
│  Content Size Check      │
│  size >= THRESHOLD?      │  ← THRESHOLD统一为1MB
└────────┬─────────────────┘
         │
    ┌────┴────┐
    │         │
   Yes       No
    │         │
    ▼         ▼
┌─────────┐ ┌──────────┐
│External │ │ Internal │
│Storage  │ │ Storage  │
└────┬────┘ └─────┬────┘
     │            │
     ▼            ▼
┌─────────────┐ ┌───────────────────┐
│Set:         │ │Set:               │
│• class=ext  │ │• class=internal   │
│• metadata=  │ │• metadata=(keep)  │← Runtime/Backend保留
│  {key}      │ │                   │← Template删除
│• Upload     │ │• Inline content   │
└─────────────┘ └───────────────────┘
```

### 验证清单

在实施后，验证以下场景：

#### ✅ Scenario 1: Small content (<1MB) 全程一致
```
Template:  10KB content  → internal ✅
Frontend:  Edit to 20KB  → internal ✅ (不升级)
Backend:   Edge output 30KB → internal ✅
```

#### ✅ Scenario 2: Large content (>1MB) 全程一致
```
Template:  2MB content   → external ✅
Frontend:  Edit to 3MB   → external ✅ (保持)
Backend:   Edge output 4MB → external ✅
```

#### ✅ Scenario 3: Template旧metadata清理
```
Template export: block有external_metadata (来自旧workspace)
Instantiation:   size < 1MB → storage_class='internal'
                 external_metadata被删除 ✅
Frontend render: 不尝试加载external resource ✅
```

#### ✅ Scenario 4: Runtime重用optimization
```
Initial:   2MB → external (resource_key: "user1/block1/v1")
Edit down: 500KB → internal (保留metadata)
Edit up:   2MB → external (重用 "user1/block1/v1") ✅
```

---

## Part 4: 实施路径

### Phase 1: 阈值对齐（必须）

**优先级**：🔴 High

1. [ ] 更新Frontend `CONTENT_LENGTH_THRESHOLD = 1024 * 1024`
2. [ ] 更新Backend `HybridStoragePolicy.threshold = 1024 * 1024`
3. [ ] 统一环境变量命名为 `STORAGE_THRESHOLD`
4. [ ] 更新 `STORAGE_SPEC.md` 确认1MB阈值
5. [ ] 运行测试：验证三处判断一致性

**预期效果**：
- ✅ 消除不必要的storage升级
- ✅ 减少网络请求
- ✅ 行为可预测

### Phase 2: metadata管理明确化（推荐）

**优先级**：🟡 Medium

1. [ ] 在 `switchToInternal` 添加注释说明保留原因
2. [ ] 在 `BlockUpdateService._handle_internal_storage_update` 添加注释
3. [ ] 在 `CloudTemplateLoader.processExternalStorage` 确认删除逻辑
4. [ ] 更新本文档到docs/architecture/

**预期效果**：
- ✅ 设计意图明确
- ✅ 避免未来误修改
- ✅ 新开发者理解正确

### Phase 3: 端到端测试（验证）

**优先级**：🟢 Low

1. [ ] 创建测试用例：10KB, 100KB, 2MB, 10MB内容
2. [ ] 验证Template → Frontend → Backend全流程
3. [ ] 验证metadata重用optimization
4. [ ] 性能测试：对比保留vs清理metadata

---

## Part 5: 常见问题

### Q1: 为什么Template instantiation要删除metadata？

**A**: Template中的`external_metadata`来自**模板作者的workspace**，包含旧的`resource_key`（如`template-author-uid/block1/v1`）。这些key在**用户的namespace**中无效，必须删除，否则前端会尝试加载不存在的资源。

### Q2: 为什么Runtime可以保留metadata？

**A**: Runtime中的metadata是**当前workspace**生成的，`resource_key`有效（如`current-user-uid/block1/v1`）。当内容变小切换到internal时，保留key允许将来重用，避免创建新资源。

### Q3: 如果前端和后端阈值不一致会怎样？

**A**: 
```
Template:  10KB → internal (1MB阈值)
Frontend:  首次编辑 → 触发upgrade to external (1KB阈值) ⚠️
Backend:   再次计算 → 保持external (1KB阈值)

结果：不必要的external storage，增加网络开销
```

### Q4: 1MB阈值会不会太大？

**A**: 
- ✅ 符合现代网络环境（1MB在现代带宽下传输很快）
- ✅ 减少请求数（inline更高效）
- ✅ 与partitioning对齐（part size = 1MB）
- ⚠️ 如果担心JSON过大，可以降到100KB，但必须**三处统一**

### Q5: metadata保留会占用多少存储？

**A**: 
```typescript
external_metadata: {
  resource_key: "user-id/block-id/version-id",  // ~50 bytes
  content_type: "text",                         // ~10 bytes
  chunked: true,                                // ~5 bytes
  uploaded_at: "2025-01-30T...",               // ~30 bytes
  version_id: "uuid"                            // ~40 bytes
}
// Total: ~135 bytes per block

// 影响：即使1000个blocks，也只有135KB metadata
// 相比重用optimization的性能收益，可以忽略
```

---

## Part 6: 设计原则总结

### 核心原则

1. **Single Source of Truth (SSOT)**
   - `storage_class` 是权威标记，决定行为
   - `external_metadata` 是数据引用，不影响判断

2. **Threshold Alignment**
   - 三处写操作必须使用相同阈值
   - 推荐1MB，符合STORAGE_SPEC.md

3. **Metadata Management**
   - Template: 删除旧metadata（无效）
   - Runtime: 保留metadata（重用）
   - Backend: 保留metadata（重用）

4. **Forward Compatibility**
   - Frontend只看`storage_class`判断
   - Backend只看`storage_class`判断
   - 即使metadata不一致，也不会影响正确性

### 验证方法

```typescript
// Test helper
function verifyStorageConsistency(content: string) {
  const size = Buffer.byteLength(content, 'utf-8');
  
  const templateDecision = size >= TEMPLATE_THRESHOLD ? 'external' : 'internal';
  const frontendDecision = size >= FRONTEND_THRESHOLD ? 'external' : 'internal';
  const backendDecision = size >= BACKEND_THRESHOLD ? 'external' : 'internal';
  
  if (templateDecision !== frontendDecision || frontendDecision !== backendDecision) {
    console.error('❌ Threshold mismatch!', {
      size,
      templateDecision,
      frontendDecision,
      backendDecision,
    });
    return false;
  }
  
  console.log('✅ Consistent:', templateDecision);
  return true;
}
```

---

## References

- [STORAGE_SPEC.md](../lib/storage/STORAGE_SPEC.md) - Storage & Partitioning Protocol
- [template-resource-contract.md](./template-resource-contract.md) - Template Resource Contract
- [CloudTemplateLoader](../../PuppyFlow/lib/templates/cloud.ts) - Template Instantiation
- [dynamicStorageStrategy.ts](../../PuppyFlow/app/components/workflow/utils/dynamicStorageStrategy.ts) - Frontend Runtime
- [BlockUpdateService.py](../../PuppyEngine/Server/BlockUpdateService.py) - Backend Computation

---

**Last Updated**: 2025-01-30
**Version**: 1.0
**Status**: Recommendation (需要团队评审和实施)

