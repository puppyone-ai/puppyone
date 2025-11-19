
╔══════════════════════════════════════════════════════════════╗
║      语义解离工程Scope - 深度确认版 (基于代码实际检查)      ║
╚══════════════════════════════════════════════════════════════╝

## 🔍 检查方法

本次分析基于:
1. ✅ 实际grep搜索全工程
2. ✅ 逐文件阅读关键代码
3. ✅ 区分3类chunks的上下文
4. ✅ 确认依赖关系和调用链

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 Part 1: Vector Indexing (chunks → entries)

### 1.1 核心Type定义 ⭐️⭐️⭐️ CRITICAL

**PuppyFlow/lib/indexing/vector-indexing.ts**
```typescript
// 需要改动:
export interface VectorChunk {           → VectorEntry
  content: string;
  metadata: { id: number; retrieval_content: any; };
}

static extractChunks(...): VectorChunk[] → extractEntries(...): VectorEntry[]
createPendingEntry() { chunks: [], ... } → { entries: [], ... }
```
影响: ~110行，5处interface/方法名修改
依赖: 被所有frontend indexing组件依赖

---

**PuppyFlow/app/components/workflow/blockNode/JsonNodeNew.tsx**
```typescript
// Line 68:
export interface VectorIndexingItem extends BaseIndexingItem {
  type: 'vector';
  key_path: PathSegment[];
  value_path: PathSegment[];
  chunks: any[];              → entries: any[];
  status: VectorIndexingStatus;
  // ...
}

// Line 541:
chunks: [],                   → entries: [],

// 多处引用 (newItem as VectorIndexingItem).chunks
```
影响: 1个interface定义 + ~10处引用
依赖: 被UI组件和hooks依赖

---

### 1.2 Frontend Indexing逻辑 ⭐️⭐️⭐️ CRITICAL

**PuppyFlow/app/components/workflow/blockNode/hooks/useIndexingUtils.ts**
```typescript
// Line 85-86:
// 准备 chunks 数据              → 准备 entries 数据
const chunks = [];              → const entries = [];

// Line 88-89:
// 处理每个数据源，生成 chunks    → 生成 entries
for (let i = 0; i < dataSource.length; i++) {

// Line 126:
(newItem as VectorIndexingItem).chunks = chunks;
                                → .entries = entries;

// Line 135:
chunks: (newItem as VectorIndexingItem).chunks,
                                → entries: ...entries,

// Line 143:
if (!payloadData.chunks || payloadData.chunks.length === 0)
                                → ...entries...
```
影响: ~15处chunks引用，核心embedding逻辑
依赖: 被所有indexing UI组件调用

---

**PuppyFlow/app/components/workflow/blockNode/utils/manifestPoller.ts**
```typescript
// Line 95:
chunks: [],                     → entries: [],
```
影响: 1处
作用: Polling时的初始状态

---

### 1.3 UI组件 ⭐️⭐️ HIGH

**PuppyFlow/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeIndexingAddMenu.tsx**
```typescript
// Line 205:
chunks: [],                     → entries: [],
```
影响: 1处
作用: 添加索引时的初始状态

**PuppyFlow/app/components/workflow/components/IndexingMenu.tsx**
```typescript
// Line 169:
chunks: [],                     → entries: [],
```
影响: 1处
作用: IndexingMenu中的初始状态

---

### 1.4 Template定义 ⭐️⭐️⭐️ CRITICAL

**PuppyFlow/templates/agentic-rag/package.json**
```json
// Line 670:
"mounted_paths": {
  "content": "data.content",
  "chunks": "data.indexingList[0].chunks",    → "entries": "data.indexingList[0].entries",
  "indexing_config": "data.indexingList[0]"
}
```
影响: 1处，但影响template contract
依赖: CloudTemplateLoader会读取这个字段

---

### 1.5 文档 ⭐️⭐️ HIGH

**PuppyFlow/lib/storage/CHUNKING_SPEC.md**
```markdown
// 多处提到vector indexing chunks:
Line 184: (Requires extracting chunks for indexing, not just storage)
Line 201: // Additional: extract chunks for vector indexing
Line 292: Extract chunks using `VectorIndexing.extractChunks(content, indexing_config)`
```
影响: ~10处文本描述
术语: "vector indexing chunks" → "vector indexing entries"

**docs/architecture/template-resource-contract.md**
```markdown
// 多处vector相关的chunks描述
```
影响: ~20处文本替换

**docs/implementation/template-contract-mvp.md**
```markdown
// Phase 1.5相关描述
```
影响: ~10处文本替换

---

### 1.6 测试脚本 ⭐️ LOW (可删除)

**PuppyFlow/scripts/test-vector-indexing.ts**
影响: ~20行 (临时文件，删除即可)

**PuppyFlow/scripts/test-phase1-5.ts**
影响: ~10行 (临时文件，删除即可)

---

### Part 1 小计

| 类别 | 文件数 | 关键改动点 | 风险等级 |
|------|--------|-----------|---------|
| Type定义 | 2 | interface + method名 | 🔴 HIGH |
| Core逻辑 | 2 | embedding flow | 🔴 HIGH |
| UI组件 | 2 | 初始化状态 | 🟡 MEDIUM |
| Template | 1 | mounted_paths | 🔴 HIGH |
| 文档 | 3 | 文本描述 | 🟢 LOW |
| 测试 | 2 | 临时脚本 | 🟢 LOW |
| **总计** | **12** | **~50处改动** | **🔴 CRITICAL** |

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 Part 2: Storage Partitioning (chunk → part)

### 2.1 核心Service ⭐️⭐️⭐️ CRITICAL

**PuppyFlow/lib/storage/chunking.ts** → **partitioning.ts** (文件重命名)
```typescript
// Line 8:
export const CHUNK_SIZE = 1024 * 1024;    → PART_SIZE = 1024 * 1024;

// Line 10-15:
export interface ChunkDescriptor {        → PartDescriptor {
  name: string;     // "chunk_000000.jsonl" → "part_000000.jsonl"
  mime: string;
  bytes: Uint8Array;
  index: number;
}

// Line 17-28:
export class ChunkingService {            → PartitioningService {
  static chunk(...)                       → static partition(...)
  static chunkStructured(...)             → static partitionStructured(...)
  static chunkText(...)                   → static partitionText(...)
  private static makeChunk(...)           → makePart(...)
}

// Line 11:
name: string;  // "chunk_000000.jsonl"   → "part_000000.jsonl"

// 所有chunk_命名
f"chunk_{index:06d}.{ext}"                → f"part_{index:06d}.{ext}"
```
影响: 整个文件，~120行
命名: chunk → part (方法名、变量名、文件名)
文件重命名: chunking.ts → partitioning.ts

---

### 2.2 Backend Storage ⭐️⭐️⭐️ CRITICAL

**PuppyEngine/Persistence/ExternalStorageStrategy.py**
```python
# Line 33:
self.chunk_size = int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))
                                → STORAGE_PART_SIZE

# Line 285-327:
def _create_chunk_generator(...)          → _create_part_generator(...)
async def generate_chunks():              → generate_parts():

# Line 299, 308, 316, 324:
yield f"chunk_{chunk_index:06d}.jsonl"   → f"part_{part_index:06d}.jsonl"
yield f"chunk_{chunk_index:06d}.txt"     → f"part_{part_index:06d}.txt"
yield f"chunk_{chunk_index:06d}.bin"     → f"part_{part_index:06d}.bin"

# Line 314:
for i in range(0, len(text_bytes), self.chunk_size):
                                → self.part_size
    chunk = text_bytes[i:i + self.chunk_size]
                                → self.part_size

# 变量名:
chunk_index → part_index
chunk → part
chunk_data → part_data
```
影响: ~50行，核心生成逻辑
风险: 🚨 已存储的chunk_*.文件命名兼容性

---

**PuppyEngine/clients/streaming_json_handler.py**
```python
# Line 28:
self.chunk_size = int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))
                                → STORAGE_PART_SIZE

# Line 32-72: split_to_jsonl方法
current_chunk = StringIO()                → current_part = StringIO()
chunk大小计算逻辑                          → part大小计算
yield current_chunk.getvalue()            → yield current_part.getvalue()

# Line 51-63: chunk相关注释
"如果单个对象就超过chunk大小"              → "part大小"
"先yield当前chunk"                        → "当前part"

# Line 96-107: parse_jsonl_chunk
def parse_jsonl_chunk(self, chunk: bytes) → parse_jsonl_part(self, part: bytes)

# Line 137-155: add_jsonl_chunk / add_array_chunk
def add_jsonl_chunk(...)                  → add_jsonl_part(...)
def add_array_chunk(...)                  → add_array_part(...)

# Line 197-214: streaming upload
chunk_num = 0                             → part_num = 0
chunk_name = f"data_chunk_{chunk_num:04d}.jsonl"
                                → f"data_part_{part_num:04d}.jsonl"
chunk_key, chunk_data                     → part_key, part_data
upload_chunk, update_manifest_with_chunk  → upload_part, ...with_part

# Line 241-263: streaming download
processed_chunks = set()                  → processed_parts = set()
for chunk_info in manifest.get('chunks', []):
                                → .get('parts', [])
chunk_data = await ...download_chunk(...) → ...download_part(...)
add_jsonl_chunk(chunk_data)               → add_jsonl_part(part_data)

# Line 309-327: 测试代码
chunks = list(...)                        → parts = list(...)
for i, chunk in enumerate(chunks):        → for i, part in enumerate(parts):
```
影响: ~65行，大量chunk命名
风险: 🚨 API命名变更，影响PuppyStorage交互

---

**PuppyEngine/Server/EventFactory.py**
```python
# Line 24-26:
# Broadcast storage threshold to align FE/BE chunking decisions
storage_threshold_bytes = int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))
                                → STORAGE_PART_SIZE
# 注释: "chunking decisions" → "partitioning decisions"
```
影响: 2行环境变量引用 + 注释

---

### 2.3 Frontend Storage ⭐️⭐️ HIGH

**PuppyFlow/app/components/workflow/utils/dynamicStorageStrategy.ts**
```typescript
// Line 68-72:
if (Array.isArray(parsed)) {
  const chunks: Array<{ ... }> = [];      → const parts: Array<{ ... }> = [];

// Line 172-176:
function chunkTextContent(...)            → partitionTextContent(...)
const chunks: Array<{ ... }> = [];        → const parts: Array<{ ... }> = [];

// Line 340:
chunks: [],                               → parts: [],

// Line 379:
const chunks = chunkContent(content, contentType);
                                → const parts = partitionContent(...);

// Line 380:
const uploaded = await uploadChunkList(node.id, versionId, chunks);
                                → uploadPartList(..., parts);

// Line 425:
chunks: uploaded,                         → parts: uploaded,
chunk_strategy: 'dynamic_1024_chars',     → part_strategy: '...',

// Line 517:
chunks: [],                               → parts: [],

// Line 584-587:
async function uploadChunkList(...)       → uploadPartList(...)
chunks: Array<{ name, mime, bytes, index }>
                                → parts: Array<...>

// Line 753-769: orphan cleanup
const chunksToDelete = oldChunkNames.filter(...)
                                → partsToDelete = oldPartNames.filter(...)
const deletePromises = chunksToDelete.map(async (chunkName: string) => {
                                → partsToDelete.map(async (partName: string) => {
  // 删除主chunk文件                       → // 删除主part文件
```
影响: ~30行，函数名 + 变量名 + manifest字段
风险: 🟡 manifest结构变更

---

**PuppyFlow/app/components/workflow/utils/externalStorage.ts**
```typescript
// Line 204:
chunks: [],                               → parts: [],

// Line 367:
chunks: [],                               → parts: [],
```
影响: 2处manifest初始化

---

**PuppyFlow/app/components/workflow/Workflow.tsx**
```typescript
// 可能的chunk引用 (需要确认上下文)
```
影响: 待确认，~5行

---

### 2.4 Protocol文档 ⭐️⭐️⭐️ CRITICAL

**PuppyFlow/lib/storage/CHUNKING_SPEC.md** → **STORAGE_SPEC.md** (文件重命名)
```markdown
# 标题:
Storage & Chunking Protocol v1.0          → Storage & Partitioning Protocol v1.0

# Part 1 标题:
Part 1: Storage Strategy (When to Chunk)  → (When to Partition)

# Part 2 标题:
Part 2: Chunking Rules (How to Chunk)     → Partitioning Rules (How to Partition)

# SSOT说明:
SSOT for Storage Strategy + Chunking      → + Partitioning

# 术语替换 (~100处):
chunk(s) → part(s)
chunking → partitioning
chunk_size → part_size
CHUNK_SIZE → PART_SIZE
chunk_000000.txt → part_000000.txt
ChunkingService → PartitioningService
chunkContent() → partitionContent()

# 特殊保留:
"Chunk Edge" → 保持不变 (workflow context)
```
影响: ~150处文本 + 文件重命名
风险: 🔴 Protocol SSOT，必须精确

---

### 2.5 其他文档 ⭐️⭐️ HIGH

**docs/architecture/template-resource-contract.md**
```markdown
# Storage相关描述:
"storage chunks" → "storage parts"
"chunking logic" → "partitioning logic"
"ChunkingService" → "PartitioningService"
```
影响: ~30处

**docs/implementation/template-contract-mvp.md**
```markdown
# Phase 1.5 描述:
"ChunkingService" → "PartitioningService"
"chunking.ts" → "partitioning.ts"
"CHUNKING_SPEC.md" → "STORAGE_SPEC.md"
```
影响: ~20处

**docs/internal/BLOCK_SYNC_GUIDE.md**
```markdown
# 可能的storage chunk描述
```
影响: 待确认

---

### 2.6 环境变量 ⭐️⭐️ HIGH

**PuppyFlow/.env.example**
**PuppyEngine/.env.example**
```bash
STORAGE_CHUNK_SIZE=1024                   → STORAGE_PART_SIZE=1024
```
影响: 2个文件，环境变量重命名
风险: 🚨 配置兼容性

---

### 2.7 测试文件 ⭐️ LOW

**PuppyFlow/scripts/test-chunking.ts** → **test-partitioning.ts**
影响: 整个文件重命名 + 内部改动 (临时文件，可删除)

---

### Part 2 小计

| 类别 | 文件数 | 关键改动点 | 风险等级 |
|------|--------|-----------|---------|
| Frontend Service | 1 | 整个文件重命名 | 🔴 HIGH |
| Backend Storage | 3 | 生成逻辑+API | 🔴 CRITICAL |
| Frontend Integration | 3 | manifest+upload | 🟡 MEDIUM |
| Protocol文档 | 1 | SSOT重命名 | 🔴 CRITICAL |
| 其他文档 | 3 | 描述性文本 | 🟢 LOW |
| 环境变量 | 2 | 配置项 | 🟡 MEDIUM |
| 测试 | 1 | 临时脚本 | 🟢 LOW |
| **总计** | **14** | **~400处改动** | **🔴 CRITICAL** |

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 Part 3: Workflow Chunk Edge (保持不变)

### 明确不改的文件 ✅

**PuppyEngine/ModularEdges/ChunkEdge/** (11个文件)
- chunker.py
- auto_chunk.py
- base_chunk.py
- character_chunk.py
- length_chunk.py
- llm_chunk.py
- Rechunker.py
- simple_chunk.py
- special_chunk.py
- advanced_chunk.py
- __init__.py
✅ 完全不动 - 这是workflow edge逻辑

**PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/** (6个文件)
- ChunkingByLength.tsx
- ChunkingByCharacter.tsx
- ChunkingAuto.tsx
- hook/edgeNodeJsonBuilders.ts
- hook/hookhistory/useEdgeNodeBackEndJsonBuilder.ts
- JsonSchema/BackEndJsonSchema/EdgeNodeJsonSchema/chunking-by-length-edge.schema.json
✅ 完全不动 - 用户可见的chunk edge

**PuppyEngine/TestKit/**
- chunking.json
- loop_chunk.json
✅ 完全不动 - workflow测试

**Frontend workflow execution**
- 所有用户可见的"chunk"术语
✅ 完全不动 - 用户概念

### Part 3 小计

| 类别 | 文件数 | 改动 | 风险 |
|------|--------|------|------|
| Backend Edge | 11 | ❌ 0处 | ✅ NONE |
| Frontend Edge | 6 | ❌ 0处 | ✅ NONE |
| Test Data | 2 | ❌ 0处 | ✅ NONE |
| **总计** | **19** | **0处** | **✅ NONE** |

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📊 总体统计 (基于实际代码检查)

### 改动文件统计

| 分类 | 文件数 | 代码行数 | 工作量估算 |
|------|--------|----------|-----------|
| **Part 1: Vector (entries)** | 12 | ~300行 | 2-3h |
| **Part 2: Storage (parts)** | 14 | ~700行 | 4-5h |
| **Part 3: Workflow (不变)** | 19 | 0行 | 0h |
| **总计 (改动)** | **26** | **~1000行** | **6-8h** |

### 改动类型统计

| 改动类型 | 数量 | 示例 |
|---------|------|------|
| Interface/Type定义 | 3 | VectorChunk→VectorEntry, ChunkDescriptor→PartDescriptor |
| 方法名 | 12 | extractChunks()→extractEntries(), chunk()→partition() |
| 变量名 | ~100 | chunks→entries/parts, chunk_data→part_data |
| 文件名 | ~200 | chunk_000000.txt→part_000000.txt |
| 文件重命名 | 2 | chunking.ts→partitioning.ts, CHUNKING_SPEC.md→STORAGE_SPEC.md |
| 环境变量 | 1 | STORAGE_CHUNK_SIZE→STORAGE_PART_SIZE |
| 文档文本 | ~200 | 描述性文本替换 |
| **总计** | **~520** | |

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🚨 高风险点详细分析

### 🔴 风险1: Manifest结构变更
**位置**: dynamicStorageStrategy.ts, externalStorage.ts
**问题**: manifest.json中存储的是`chunks: []`数组
**影响**: 
- 新代码写入`parts: []`
- 旧数据读取`chunks: []`
- 读写不匹配导致数据丢失

**解决方案**:
```typescript
// 读取时兼容旧字段
const items = manifest.parts || manifest.chunks || [];

// 写入时使用新字段
manifest.parts = [...];
```

---

### 🔴 风险2: 已存储文件命名
**位置**: ExternalStorageStrategy.py, streaming_json_handler.py
**问题**: S3/Local中已存储的文件名是`chunk_000000.*`
**影响**: 
- 新代码生成`part_000000.*`
- 旧文件`chunk_000000.*`无法读取
- 404 Not Found

**解决方案**:
```python
# 读取时尝试两种命名
try:
    data = await storage_client.download(f"part_{index:06d}.txt")
except NotFound:
    data = await storage_client.download(f"chunk_{index:06d}.txt")  # fallback
```

---

### 🔴 风险3: Frontend中区分Vector vs Workflow chunks
**位置**: JsonNodeNew.tsx, useIndexingUtils.ts
**问题**: 
- `VectorIndexingItem.chunks` → 改为 `entries`
- 但可能有workflow chunk的引用
**影响**: 误改workflow chunk导致功能损坏

**解决方案**:
```typescript
// 搜索时精确匹配上下文
grep -B 5 -A 5 "\.chunks" *.tsx

// 确认是indexingList相关才改
if (line.includes("indexingList") && line.includes("chunks")) {
  // 改为entries
}
```

---

### 🟡 风险4: 环境变量重命名
**位置**: .env.example, EventFactory.py, ExternalStorageStrategy.py
**问题**: `STORAGE_CHUNK_SIZE` → `STORAGE_PART_SIZE`
**影响**: 
- 旧环境配置失效
- 默认值可能不同

**解决方案**:
```python
# 读取时fallback到旧名称
part_size = int(os.getenv("STORAGE_PART_SIZE") or os.getenv("STORAGE_CHUNK_SIZE") or "1024")
```

---

### 🟡 风险5: PuppyStorage API变更
**位置**: streaming_json_handler.py
**问题**: 
- `upload_chunk()` → `upload_part()`
- `download_chunk()` → `download_part()`
- `update_manifest_with_chunk()` → `update_manifest_with_part()`

**影响**: PuppyStorage service需要同步更新API

**解决方案**: 
1. Phase 1: PuppyStorage添加新API (upload_part等)，保留旧API
2. Phase 2: PuppyEngine切换到新API
3. Phase 3: PuppyStorage删除旧API (deprecation period)

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## ✅ 详细执行计划

### Phase 0: 准备工作 (15min)
- [ ] 创建feature branch: `feature/semantic-separation-chunks`
- [ ] Backup关键文件
- [ ] 创建兼容性测试checklist

### Phase 1: 核心API层 (2-3h)

#### 1.1 Vector Indexing
- [ ] PuppyFlow/lib/indexing/vector-indexing.ts
  - VectorChunk → VectorEntry
  - extractChunks → extractEntries
  - createPendingEntry中的chunks字段
- [ ] PuppyFlow/lib/templates/types.ts (如果有相关定义)
- [ ] 验证: TypeScript编译通过

#### 1.2 Storage Partitioning
- [ ] PuppyFlow/lib/storage/chunking.ts → partitioning.ts
  - CHUNK_SIZE → PART_SIZE
  - ChunkDescriptor → PartDescriptor
  - ChunkingService → PartitioningService
  - 所有方法名: chunk → partition
  - 文件名模板: chunk_000000 → part_000000
- [ ] 验证: TypeScript编译通过

#### 1.3 Backend Storage
- [ ] PuppyEngine/Persistence/ExternalStorageStrategy.py
  - chunk_size → part_size
  - _create_chunk_generator → _create_part_generator
  - 文件名生成逻辑
  - 添加fallback兼容性代码
- [ ] PuppyEngine/clients/streaming_json_handler.py
  - 所有chunk相关方法和变量
  - 添加manifest兼容性代码
- [ ] PuppyEngine/Server/EventFactory.py
  - STORAGE_CHUNK_SIZE引用
- [ ] 验证: Python语法检查

---

### Phase 2: Contract + 文档层 (1h)

#### 2.1 Protocol文档
- [ ] PuppyFlow/lib/storage/CHUNKING_SPEC.md → STORAGE_SPEC.md
  - 标题更新
  - 所有chunking → partitioning
  - 所有chunk → part (storage context)
  - 保留"Chunk Edge"不变
  
#### 2.2 Template定义
- [ ] PuppyFlow/templates/agentic-rag/package.json
  - mounted_paths.chunks → entries

#### 2.3 架构文档
- [ ] docs/architecture/template-resource-contract.md
  - Vector相关: chunks → entries
  - Storage相关: chunks → parts
- [ ] docs/implementation/template-contract-mvp.md
  - Phase 1.5描述更新
  
#### 2.4 验证
- [ ] 文档术语一致性检查
- [ ] Markdown linter通过

---

### Phase 3: Frontend集成层 (2-3h)

#### 3.1 Type定义
- [ ] PuppyFlow/app/components/workflow/blockNode/JsonNodeNew.tsx
  - VectorIndexingItem.chunks → entries
  - 所有相关引用

#### 3.2 Core逻辑
- [ ] PuppyFlow/app/components/workflow/blockNode/hooks/useIndexingUtils.ts
  - const chunks = [] → const entries = []
  - 所有chunks变量和引用 (确认是vector indexing context)
  - embedding请求payload

#### 3.3 UI组件
- [ ] PuppyFlow/app/components/workflow/blockNode/JsonNodeTopSettingBar/NodeIndexingAddMenu.tsx
  - chunks: [] → entries: []
- [ ] PuppyFlow/app/components/workflow/components/IndexingMenu.tsx
  - chunks: [] → entries: []
- [ ] PuppyFlow/app/components/workflow/blockNode/utils/manifestPoller.ts
  - chunks: [] → entries: []

#### 3.4 Storage Integration
- [ ] PuppyFlow/app/components/workflow/utils/dynamicStorageStrategy.ts
  - const chunks → const parts
  - chunkContent → partitionContent
  - uploadChunkList → uploadPartList
  - manifest.chunks → manifest.parts (添加兼容性)
- [ ] PuppyFlow/app/components/workflow/utils/externalStorage.ts
  - chunks: [] → parts: []
- [ ] PuppyFlow/app/components/workflow/Workflow.tsx
  - 确认并更新storage chunk引用

#### 3.5 验证
- [ ] TypeScript编译通过
- [ ] ESLint通过
- [ ] Frontend启动无错误

---

### Phase 4: 环境配置 (15min)
- [ ] PuppyFlow/.env.example
  - STORAGE_CHUNK_SIZE → STORAGE_PART_SIZE
- [ ] PuppyEngine/.env.example
  - STORAGE_CHUNK_SIZE → STORAGE_PART_SIZE
- [ ] 更新部署文档说明

---

### Phase 5: 清理和验证 (30min)
- [ ] 删除临时测试脚本
  - PuppyFlow/scripts/test-chunking.ts
  - PuppyFlow/scripts/test-vector-indexing.ts
  - PuppyFlow/scripts/test-phase1-5.ts
- [ ] 全局搜索验证
  - grep "VectorChunk[^A-Z]" → 应该0结果 (除注释)
  - grep "extractChunks" → 应该0结果 (除注释)
  - grep "ChunkingService" → 应该0结果 (除注释)
  - grep "chunk_[0-9]" → 只在workflow edge context
- [ ] 确认workflow chunk edge未受影响
  - ModularEdges/ChunkEdge/* 完全不变
  - Frontend ChunkingBy*.tsx 完全不变

---

### Phase 6: 兼容性测试 (1-2h)
- [ ] 旧manifest读取测试 (chunks → parts兼容)
- [ ] 旧文件名读取测试 (chunk_*.txt → part_*.txt fallback)
- [ ] 旧环境变量兼容测试 (STORAGE_CHUNK_SIZE fallback)
- [ ] Template instantiation测试
- [ ] Vector indexing测试
- [ ] Storage upload/download测试
- [ ] Workflow chunk edge测试 (确认未损坏)

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🔍 验证Checklist

### 编译验证
- [ ] TypeScript编译无错误
- [ ] Python语法检查通过
- [ ] ESLint无错误

### 功能验证
- [ ] Template instantiation正常
  - [ ] Agentic RAG template (有vector entries)
  - [ ] SEO Blog template
  - [ ] File Load template
  - [ ] Getting Started template
- [ ] Vector indexing正常工作
  - [ ] 创建新索引
  - [ ] Embedding正常
  - [ ] entries字段正确保存
- [ ] Storage upload/download正常
  - [ ] Text内容 > 1MB (partitioning)
  - [ ] Structured内容 > 1MB (partitioning)
  - [ ] 文件上传
  - [ ] manifest.parts正确
- [ ] Frontend UI显示正确
  - [ ] Indexing menu显示entries
  - [ ] Storage状态正确
- [ ] Workflow chunk edge未受影响
  - [ ] ChunkingByLength正常
  - [ ] ChunkingByCharacter正常
  - [ ] ChunkingAuto正常

### 兼容性验证
- [ ] 旧template能否加载
- [ ] 已存储的chunk_*.文件能否读取
- [ ] 旧环境变量STORAGE_CHUNK_SIZE是否生效
- [ ] 旧manifest.chunks能否读取

### 文档验证
- [ ] 所有文档术语一致
- [ ] Protocol SSOT正确
- [ ] 架构图/表格更新
- [ ] 代码注释清晰

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📝 关键决策记录

### 决策1: entries vs batches (Vector Indexing)
**选择**: entries
**理由**:
- 标准数据库/搜索术语
- 单复数清晰 (entry / entries)
- 强调"可被索引"的特性
- 与向量DB概念契合

### 决策2: parts vs segments (Storage)
**选择**: parts
**理由**:
- 对齐S3 multipart upload术语
- 强调"物理分割"的特性
- 避免与semantic segment混淆
- 工业标准

### 决策3: chunk (Workflow Edge)
**选择**: 保持不变
**理由**:
- 用户可见概念
- 已有大量文档和培训材料
- 不影响底层实现
- 无需迁移用户workflows

### 决策4: 兼容性策略
**选择**: 双向兼容 (读旧写新)
**理由**:
- 渐进式迁移
- 降低部署风险
- 保护已有数据
- 留出deprecation period

---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📊 工作量最终估算

| Phase | 任务 | 时间 |
|-------|------|------|
| Phase 0 | 准备工作 | 15min |
| Phase 1 | 核心API层 | 2-3h |
| Phase 2 | Contract+文档 | 1h |
| Phase 3 | Frontend集成 | 2-3h |
| Phase 4 | 环境配置 | 15min |
| Phase 5 | 清理验证 | 30min |
| Phase 6 | 兼容性测试 | 1-2h |
| **总计** | | **7-10h** |

**关键路径**: Phase 1 → Phase 3 (核心API + Frontend集成)
**并行机会**: Phase 2文档可以与Phase 3并行

---

