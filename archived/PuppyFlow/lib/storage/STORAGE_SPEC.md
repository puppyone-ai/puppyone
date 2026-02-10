# Storage & Partitioning Protocol v1.1

> **SSOT for Storage Strategy + Partitioning Implementation**  
> Alignment: PuppyFlow (TypeScript) ↔ PuppyEngine (Python)

---

## Part 1: Storage Strategy (When to Partition)

### Decision Rule

```typescript
IF content.length >= STORAGE_THRESHOLD:
  → Use external storage (partition + upload)
  → Set storage_class = 'external'
ELSE:
  → Use inline storage (embed in JSON)
  → Set storage_class = 'internal'
```

### Storage Threshold

- **STORAGE_THRESHOLD**: 1MB (1,048,576 bytes)
- **Decision Timing**:
  - Template instantiation: Backend decides initial storage_class
  - User editing: Frontend may upgrade to external dynamically

### Implementation Contexts

| Context | Location | Decision Timing |
|---------|----------|-----------------|
| **Template Instantiation** | `CloudTemplateLoader` (Backend) | One-time at instantiation |
| **User Editing** | `dynamicStorageStrategy.ts` (Frontend) | Runtime, on content change |
| **Backend Computation** | `BlockUpdateService` + `HybridStoragePolicy` (Backend) | After workflow execution |

### Critical Consistency Requirement

**⚠️ The storage threshold MUST be identical across all three write operations:**

| Write Operation | File | Variable | Required Value |
|----------------|------|----------|----------------|
| **Template Instantiation** | `lib/templates/cloud.ts` | `STORAGE_THRESHOLD` | 1,048,576 bytes (1MB) |
| **Frontend Runtime** | `utils/dynamicStorageStrategy.ts` | `CONTENT_LENGTH_THRESHOLD` | 1,048,576 bytes (1MB) |
| **Backend Computation** | `Server/HybridStoragePolicy.py` | `threshold` | 1,048,576 bytes (1MB) |

**Why Consistency Matters:**
- Same content must receive same `storage_class` regardless of entry point
- Prevents unnecessary storage upgrades (e.g., 10KB inline → external on first edit)
- Ensures predictable behavior and optimal resource usage
- Eliminates confusion and debugging overhead

**Why 1MB (not 1KB):**

1. **Threshold = Part Size alignment**
   - Prevents creating external storage for content that produces only single part
   - Example: 2KB content with 1KB threshold → external storage with 1 part (wasteful)
   - Example: 2KB content with 1MB threshold → inline storage (efficient)

2. **Network efficiency**
   - 1KB threshold: 80% of content externalized, massive request overhead
   - 1MB threshold: Only truly large content externalized
   - Comparison: 1MB in 1 request vs 1000× 1KB requests

3. **Production standards**
   - AWS S3 Multipart: 5MB minimum
   - Azure Blob Blocks: 4MB default
   - Google Cloud Storage: 8MB recommended
   - PuppyAgent: 1MB (optimized for LLM output sizes)

4. **Real-world LLM content distribution**
   - 90% of content <1MB → inline (fast, no network)
   - 8% of content 1-10MB → 1-10 parts (reasonable)
   - 2% of content >10MB → many parts (justified)

**Environment Variable:**
- `STORAGE_THRESHOLD=1048576` (optional override, must be set consistently if used)

**Verification:**
See automated tests in:
- `lib/templates/__tests__/storage-threshold-consistency.test.ts`
- `PuppyEngine/Server/test_storage_consistency.py`

**Documentation:**
- Detailed analysis: `docs/architecture/STORAGE_CONSISTENCY_BEST_PRACTICES.md`
- Manual testing guide: `docs/testing/storage-threshold-e2e.md`

### Storage Class Field

Every block with potential external storage must have:

```typescript
block.data.storage_class: 'internal' | 'external'
```

---

## Part 2: Partitioning Rules (How to Partition)

**Applies when**: `storage_class === 'external'`

### Part Format Specifications

- **Part size**: 1MB (1,048,576 bytes)
- **Structured format**: `.jsonl` (one JSON object per line)
- **Text format**: `.txt` (UTF-8)
- **Binary format**: `.bin` (raw bytes)
- **Naming pattern**: `part_000000.ext`, `part_000001.ext`, ...

### Partitioning Rules by Format

#### Structured

1. Parse JSON array
2. Split by records, respect size limit
3. Never split single object
4. If object > 1MB, dedicated part

#### Text

1. Split by bytes
2. May split mid-word

## Backend Match

Python (`ExternalStorageStrategy.py` line 313-317):

```python
part_size = 1024 * 1024
for i in range(0, len(text_bytes), self.part_size):
    part = text_bytes[i:i + self.part_size]
    yield f"part_{part_index:06d}.txt", part
```

TypeScript (must match):

```typescript
PART_SIZE = 1024 * 1024
partName = `part_${index.toString().padStart(6, '0')}.txt`
```

## Example

Input (structured):

```json
[{"id": 1, "data": "..."}, {"id": 2, "data": "..."}]
```

Output:

```text
part_000000.jsonl:
{"id": 1, "data": "..."}
{"id": 2, "data": "..."}
```

Both PuppyEngine and PuppyFlow must produce identical parts for same input.

## Verification

Same input → Same number of parts → Same naming → Compatible format

---

## Complete Workflow

### Template Instantiation (Backend)

```typescript
// CloudTemplateLoader
async processResource(resource: ResourceDescriptor, userId: string) {
  const content = await readResourceFile(resource.source.path);
  
  // Step 1: Decide storage strategy
  const contentSize = Buffer.byteLength(content, 'utf-8');
  const useExternal = contentSize >= STORAGE_THRESHOLD;
  
  if (useExternal) {
    // Step 2: Partition and upload
    const parts = PartitioningService.partitionContent(content, resource.source.format);
    for (const part of parts) {
      await uploadPart(part, userId, blockId, versionId);
    }
    
    block.data.storage_class = 'external';
    block.data.external_metadata = { resource_key: `${userId}/${blockId}/${versionId}` };
  } else {
    // Inline storage
    block.data.content = content;
    block.data.storage_class = 'internal';
  }
}
```

### User Editing (Frontend)

```typescript
// dynamicStorageStrategy.ts (existing)
export function determineStorageClass(content: string): StorageClass {
  const contentLength = content?.length || 0;
  return contentLength >= CONTENT_LENGTH_THRESHOLD ? 'external' : 'internal';
}

// Called on content change
async function handleContentChange(newContent: string) {
  const targetClass = determineStorageClass(newContent);
  
  if (targetClass === 'external' && currentClass === 'internal') {
    // Upgrade: inline → external
    await switchToExternal(node, newContent, contentType, getUserId, setNodes);
  }
  // Note: Downgrade (external → inline) not supported
}
```

---

## Inference Rules (No Explicit Strategy Required)

**Design Decision**: The `InstantiationTarget` interface does NOT have a `strategy` field. Storage class is inferred from context.

### Default Inference Logic

```typescript
function inferStorageProcessing(desc: ResourceDescriptor, content: string) {
  // 1. File type → external, no partitioning
  //    (Files are always binary and uploaded as-is, regardless of size)
  if (desc.type === 'file') {
    if (desc.source.format !== 'binary') {
      throw new Error(`Invalid combination: type='file' must use format='binary', got '${desc.source.format}'`);
    }
    return 'external_no_partition';  // Upload as-is, don't split
  }
  
  // 2. Vector collection → structured only + special handling
  //    (Requires extracting entries for indexing, not just storage)
  if (desc.type === 'vector_collection') {
    if (desc.source.format !== 'structured') {
      throw new Error(`Invalid combination: type='vector_collection' must use format='structured', got '${desc.source.format}'`);
    }
    
    // Verify content is array (required for key_path extraction)
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error(`vector_collection requires array content for key_path extraction`);
    }
    
    // Size-based storage decision (same as external_storage)
    const contentSize = Buffer.byteLength(content, 'utf-8');
    
    return {
      storage: contentSize >= STORAGE_THRESHOLD ? 'external_with_partition' : 'inline',
      // Additional: extract entries for vector indexing
      vectorEntries: VectorIndexing.extractEntries(parsed, desc.indexing_config),
      // Additional: create pending indexing entry
      pendingEntry: VectorIndexing.createPendingEntry(desc.indexing_config)
    };
  }
  
  // 3. external_storage → size-based decision only
  //    (Simple data storage, no special indexing)
  const contentSize = Buffer.byteLength(content, 'utf-8');
  
  if (contentSize >= STORAGE_THRESHOLD) {
    return 'external_with_partition';  // Upload + partition
  } else {
    return 'inline';  // Embed in JSON (storage_class='internal')
  }
}
```

### Rationale

1. **DRY Principle**: `ResourceType` + `source.format` already contain sufficient information
2. **Consistency**: Template instantiation and user editing follow the same rules
3. **Simplicity**: Template authors don't need to think about storage strategy
4. **Alignment**: Unified with frontend's `dynamicStorageStrategy.ts`

### Special Handling for vector_collection

`vector_collection` is **NOT just storage** - it requires indexing preparation:

```typescript
// Unlike external_storage (pure data storage):
external_storage:
  → Read content
  → Decide inline/external based on size
  → Upload if external
  → Done

// vector_collection requires additional steps:
vector_collection:
  → Read content (must be structured array)
  → Decide inline/external based on size
  → Upload if external
  → Extract entries (using VectorIndexing.extractEntries with key_path)  ← Additional
  → Create pending entry (VectorIndexing.createPendingEntry)            ← Additional
  → Set indexingList[].status = 'pending'                               ← Additional
  → User triggers embedding later (not during instantiation)
```

**Why the difference?**

- `external_storage`: Content is the end goal (just store it)
- `vector_collection`: Content is the input for indexing (store + prepare for embedding)

**Constraints**:

1. Format must be `'structured'` (need to parse JSON)
2. Content must be an array (required for key_path extraction)
3. Must have `indexing_config` with `key_path` and `value_path`

### Inference Table

**Note**: `ResourceType` is business type, `storage_class` (inline/external) is determined at runtime based on content size.

| ResourceType | source.format | Content Size | → storage_class | Partitioning | Additional Processing |
|--------------|---------------|--------------|-----------------|--------------|----------------------|
| `external_storage` | `text` | < 1MB | `internal` (inline) | No | None |
| `external_storage` | `text` | ≥ 1MB | `external` | Yes | None |
| `external_storage` | `structured` | < 1MB | `internal` (inline) | No | None |
| `external_storage` | `structured` | ≥ 1MB | `external` | Yes | None |
| `file` | `binary` | any size | `external` | No (as-is) | None |
| `vector_collection` | `structured` | < 1MB | `internal` (inline) | No | ✅ Extract entries + create pending entry |
| `vector_collection` | `structured` | ≥ 1MB | `external` | Yes | ✅ Extract entries + create pending entry |

**Key Insights**:

1. **`external_storage`**: General data storage
   - Supports: `text`, `structured`
   - storage_class: Determined by content size
   - Use case: Any text or JSON data that can be partitioned

2. **`file`**: File resource (documents, PDFs, images)
   - Supports: **Only `binary`** (e.g., PDF, PNG, MP4)
   - storage_class: Always `external` (uploaded as-is, never partitioned)
   - Use case: Files that must be preserved as binary artifacts
   - Note: If you have text content, use `external_storage` instead!

3. **`vector_collection`**: Vector indexing (NOT just storage!)
   - Supports: **Only `structured`** (must be JSON array for key_path extraction)
   - storage_class: Determined by content size (same as external_storage)
   - **Special processing**:
     - Extract entries using `VectorIndexing.extractEntries(content, indexing_config)`
     - Create pending entry using `VectorIndexing.createPendingEntry(indexing_config)`
     - Set `indexingList[].status = 'pending'` (user embeds later)
   - Use case: Data that needs vector search (FAQ, knowledge base)
   - **Different from external_storage**: Requires indexing preparation, not just storage

**Important**:

- NO `'inline'` ResourceType (inline is a storage_class state!)
- NO `file + text` combination (use `external_storage` for text content)
- NO manual override (storage class is ALWAYS inferred automatically)

---

## Version History

- **v1.1** (2025-01-25):
  - Semantic separation: "chunks" → "entries" (vector indexing) and "parts" (storage partitioning)
  - Renamed ChunkingService → PartitioningService
  - Updated naming: chunk_000000 → part_000000
  - Updated terminology throughout for clarity
  - Added inference rules, removed strategy field from contract
- **v1.0** (2025-01-25): Initial unified protocol (merged STORAGE_STRATEGY + PARTITIONING)
