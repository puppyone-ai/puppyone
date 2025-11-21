
╔══════════════════════════════════════════════════════════════╗
║      语义解离工程Scope分析 - chunks→entries/parts           ║
╚══════════════════════════════════════════════════════════════╝

## 📊 总体影响

发现文件总数: ~40个
影响代码行数: 估计 ~2000行
主要改动: TypeScript (前端) + Python (后端) + 文档

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 Part 1: Vector Indexing (chunks → entries)

### 影响范围: Template系统 + Frontend Workflow

### 1.1 核心基础设施 (高优先级)

**PuppyFlow/lib/indexing/vector-indexing.ts** ⭐️⭐️⭐️
- VectorChunk interface → VectorEntry
- extractChunks() → extractEntries()
- createPendingEntry() 中的 chunks: [] → entries: []
- 注释更新
影响: ~110行，核心API变更

**PuppyFlow/lib/storage/CHUNKING_SPEC.md** ⭐️⭐️⭐️
- 所有"chunks for indexing" → "entries"
- VectorChunk → VectorEntry
- 推断逻辑中的vectorChunks → vectorEntries
- 表格和说明更新
影响: ~50处文本替换

### 1.2 Template定义 (高优先级)

**PuppyFlow/templates/agentic-rag/package.json** ⭐️⭐️⭐️
- mounted_paths.chunks → mounted_paths.entries
- 影响template contract
影响: 1-2处关键字段

**docs/architecture/template-resource-contract.md** ⭐️⭐️
- 所有vector相关的chunks → entries
- 架构说明更新
影响: ~20处文本替换

**docs/implementation/template-contract-mvp.md** ⭐️⭐️
- Phase 1.5相关描述更新
影响: ~10处文本替换

### 1.3 Frontend Workflow (中等优先级)

**PuppyFlow/app/components/workflow/blockNode/hooks/useIndexingUtils.ts** ⭐️⭐️
- 处理chunks数据的逻辑 → entries
- const chunks = [] → const entries = []
- 注释和变量名更新
影响: ~50-100行

**PuppyFlow/app/components/workflow/blockNode/JsonNodeNew.tsx** ⭐️
- VectorIndexingItem.chunks → entries
- UI显示逻辑
影响: ~20行

**PuppyFlow/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeIndexingAddMenu.tsx** ⭐️
- chunks相关UI
影响: ~10行

**PuppyFlow/app/components/workflow/components/IndexingMenu.tsx** ⭐️
- chunks显示
影响: ~10行

**PuppyFlow/app/components/workflow/blockNode/utils/manifestPoller.ts** ⭐️
- chunks polling
影响: ~5行

**PuppyFlow/app/components/workflow/utils/externalStorage.ts** ⭐️
- chunks引用（可能）
影响: 待确认

### 1.4 测试文件 (低优先级，可删除)

**PuppyFlow/scripts/test-vector-indexing.ts**
- extractChunks测试 → extractEntries
影响: ~20行（临时测试文件）

**PuppyFlow/scripts/test-phase1-5.ts**
- 集成测试中的chunks
影响: ~10行（临时测试文件）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 Part 2: Storage Partitioning (chunk → part)

### 影响范围: Template系统 + Storage Infrastructure

### 2.1 核心基础设施 (高优先级)

**PuppyFlow/lib/storage/chunking.ts** ⭐️⭐️⭐️
→ 重命名为: PuppyFlow/lib/storage/partitioning.ts
- ChunkingService → PartitioningService
- chunkContent() → partitionContent()
- ChunkDescriptor → PartDescriptor
- chunk_000000 → part_000000
影响: ~100行，全文件重写

**PuppyFlow/lib/storage/CHUNKING_SPEC.md** ⭐️⭐️⭐️
→ 重命名为: PuppyFlow/lib/storage/STORAGE_SPEC.md
- 所有"chunk"(storage context) → "part"
- "Chunking Protocol" → "Storage & Partitioning Protocol"
- chunk_size → part_size
影响: ~100处文本替换 + 文件重命名

### 2.2 Backend Storage (高优先级)

**PuppyEngine/Persistence/ExternalStorageStrategy.py** ⭐️⭐️⭐️
- chunk_size → part_size
- _create_chunk_generator() → _create_part_generator()
- generate_chunks() → generate_parts()
- "chunk_000000" → "part_000000"
- 命名格式更新
影响: ~50行

**PuppyStorage/storage/local.py** ⭐️⭐️
- chunk命名相关
影响: ~10行（如果有）

### 2.3 Frontend Storage (中等优先级)

**PuppyFlow/app/components/workflow/utils/dynamicStorageStrategy.ts** ⭐️⭐️
- CHUNK_SIZE → PART_SIZE (可能)
- chunkContent调用 → partitionContent
- 注释更新
影响: ~20行

**PuppyFlow/app/components/workflow/Workflow.tsx** ⭐️
- storage chunk引用
影响: ~5行

### 2.4 文档 (中等优先级)

**docs/architecture/template-resource-contract.md** ⭐️⭐️
- storage chunks → parts
- chunking → partitioning
影响: ~30处

**docs/implementation/template-contract-mvp.md** ⭐️
- chunking相关描述
影响: ~20处

**docs/internal/BLOCK_SYNC_GUIDE.md** ⭐️
- chunk相关说明
影响: 待确认

### 2.5 测试文件 (低优先级)

**PuppyFlow/scripts/test-chunking.ts**
→ 重命名为: test-partitioning.ts
影响: ~30行 + 文件重命名

**PuppyStorage/test_tools/*.py** (多个)
- chunk相关测试
影响: 待确认，可能不需要改

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 Part 3: Workflow Chunk Edge (保持不变)

### 明确不改的范围

**PuppyEngine/ModularEdges/ChunkEdge/** (整个目录)
- chunker.py
- auto_chunk.py
- Rechunker.py
- length_chunk.py
✅ 保持不变 - 这是workflow edge的chunk，用户可见

**PuppyEngine/TestKit/chunking.json**
✅ 保持不变 - workflow测试

**PuppyEngine/TestKit/loop_chunk.json**
✅ 保持不变 - workflow测试

**Frontend workflow execution中的chunk edge**
✅ 保持不变 - 用户可见概念

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📋 改动优先级矩阵

### P0 (必须改，否则API不一致)
1. vector-indexing.ts (VectorChunk → VectorEntry)
2. chunking.ts → partitioning.ts (ChunkingService → PartitioningService)
3. CHUNKING_SPEC.md → STORAGE_SPEC.md
4. ExternalStorageStrategy.py (后端chunk命名)

### P1 (高优先级，影响template contract)
5. templates/*/package.json (mounted_paths.chunks)
6. template-resource-contract.md (架构文档)
7. template-contract-mvp.md (实施文档)

### P2 (中等优先级，影响frontend功能)
8. useIndexingUtils.ts (前端indexing逻辑)
9. JsonNodeNew.tsx (UI显示)
10. dynamicStorageStrategy.ts (前端storage)
11. 其他frontend workflow组件

### P3 (低优先级，临时文件/测试)
12. test-*.ts (测试脚本，可删除)
13. PuppyStorage测试工具
14. 内部文档

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🔄 执行建议

### 阶段1: 核心API层 (2-3小时)
- vector-indexing.ts: VectorChunk → VectorEntry
- chunking.ts → partitioning.ts
- STORAGE_SPEC.md更新
- ExternalStorageStrategy.py更新

验证点: TypeScript编译通过

### 阶段2: Contract层 (1小时)
- template package.json
- 架构文档
- MVP文档

验证点: Template定义一致

### 阶段3: Frontend集成 (2-3小时)
- useIndexingUtils.ts
- JsonNodeNew.tsx
- 其他workflow组件

验证点: Frontend编译通过，UI正常

### 阶段4: 清理测试 (0.5小时)
- 删除临时测试脚本
- 验证不影响workflow chunk edge

验证点: 所有测试通过

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## ⚠️ 风险点

### 高风险
1. **Frontend workflow中的.chunks引用**
   - 需要仔细区分是vector chunks还是workflow chunks
   - 可能误改workflow chunk edge

2. **Backend命名格式**
   - chunk_000000 → part_000000
   - 需要确保与已存储数据兼容

### 中风险
3. **跨服务通信**
   - PuppyFlow ↔ PuppyEngine ↔ PuppyStorage
   - 需要同步更新API

4. **Template向后兼容**
   - 旧template可能还用chunks
   - 需要migration策略

### 低风险
5. **测试文件**
   - 大多数是临时文件，可直接删除

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📊 工作量估算

| 类别 | 文件数 | 代码行数 | 工作量 |
|------|--------|----------|--------|
| 核心API | 4 | ~300 | 2-3h |
| Template/Doc | 6 | ~200 | 1-2h |
| Frontend | 10 | ~300 | 2-3h |
| Backend | 2 | ~100 | 1h |
| 测试清理 | 5+ | ~100 | 0.5h |
| **总计** | **~30** | **~1000** | **6-9h** |

不包括: workflow chunk edge相关文件（~10个文件保持不变）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## ✅ 验证清单

改动完成后需要验证:

### 编译验证
- [ ] TypeScript编译无错误
- [ ] Python代码无语法错误

### 功能验证
- [ ] Template instantiation正常
- [ ] Vector indexing正常工作
- [ ] Storage upload/download正常
- [ ] Frontend UI显示正确
- [ ] Workflow chunk edge未受影响

### 文档验证
- [ ] 所有文档术语一致
- [ ] 架构图/表格更新
- [ ] 代码注释清晰

### 兼容性验证
- [ ] 旧template是否需要migration
- [ ] 已存储的chunk_*.文件是否需要rename
- [ ] API版本兼容性

