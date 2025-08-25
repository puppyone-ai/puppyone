### **统一 Block 存储方案为外部存储**

#### 1. 背景 (Background)

当前系统中，Block（节点）存在两种存储方案：

*   **内部存储 (Internal Storage):** Block 的内容（`content`）直接以文本形式存储在工作流（Workflow）的 JSON 定义中。这主要用于用户手动创建的 Block。
*   **外部存储 (External Storage):** Block 的内容存储在外部存储服务中，通过 `resource_key` 进行关联和访问。这主要用于作为运行结果的输出 Block。

这种混合存储模式导致了以下核心问题：
当一个使用外部存储的 Block（例如，某个流程的输出）被用作另一个流程的输入时，即使用户在前端编辑器中修改了其 `content`，后端引擎在执行时仍然会通过 `resource_key` 拉取原始的、未经修改的内容，导致 **“所见非所得”** 的数据不一致问题。

#### 2. 目标 (Objective)

为解决数据不一致问题并统一架构，本次需求的目标是：

*   **将所有 Block 的内容存储方式统一为外部存储 (External Storage)。**
*   确保在任何情况下（包括手动编辑、流程运行），前端编辑器中的内容与后端引擎执行时使用的内容完全一致。

#### 3. 需求详述 (Requirements)

1.  **存储逻辑统一**:
    *   所有 Block（无论是用户新建的，还是作为运行结果生成的）都应默认使用外部存储方案。
    *   当一个 Block 被创建或加载时，其 `content` 应与一个 `resource_key` 关联。

2.  **编辑器内容实时同步 (Debounced Sync)**:
    *   当用户在前端的 Block 文本编辑器中修改 `content` 时，需要将变更后的内容同步到外部存储服务。
    *   此同步操作必须实现 **防抖 (Debounce)** 机制。即，在用户停止输入一段指定时间后（例如：2秒），再发起同步请求，以避免因频繁修改而产生大量无效的 API 调用。
    *   **关键点**: 同步操作应 **覆盖 (Overwrite)** `resource_key` 所指向的现有版本/区块（Chunk），**而不是创建新的版本 (Version)**。

3.  **运行前强制同步 (Pre-run Sync)**:
    *   当用户点击 "Run" (运行单个节点) 或 "Test Run" (运行整个工作流) 时，必须在任务提交到后端引擎 **之前**，触发一次强制同步。
    *   此操作应确保所有在本次运行中涉及的、且内容已被修改的 Block，都将其最新的 `content` 同步到外部存储。
    *   这一步是保证流程执行时效性的关键，可以覆盖那些因用户编辑后立即点击运行而尚未触发防抖同步的场景。

#### 4. 验收标准 (Acceptance Criteria)

*   **AC1:** 创建一个新 Block，检查其是否自动关联了 `resource_key` 并使用外部存储。
*   **AC2:** 编辑任意一个 Block 的内容，停止编辑 2-3 秒后，刷新页面，Block 的内容应为最后编辑的版本，证明防抖同步成功。
*   **AC3:** 在网络请求中观察，确认在连续输入时没有产生 API 请求，仅在停止输入后才发送一次同步请求。
*   **AC4:** 快速修改一个 Block 的内容，然后 **立即** 点击 "Run" 或 "Test Run"。检查运行日志或结果，确认后端引擎使用的是 **修改后** 的最新内容。
*   **AC5:** 通过后台或直接检查外部存储服务，确认内容同步操作是在原有 `resource_key` 上进行更新，没有创建新的 `resource_key` 或版本。
*   **AC6:** 旧的、使用内部存储的存量工作流在加载后，其 Block 应能被平滑地迁移至外部存储方案（例如，在首次编辑并同步时）。

#### 5. 非目标范围 (Out of Scope)

*   **不要移除内部存储的后端逻辑代码**。保留相关代码，仅在当前业务逻辑中停用，以便未来可能根据新需求重新启用。
*   本次需求不涉及对外部存储服务版本管理（Versioning）机制的修改。
*   本次需求不涉及大的 UI/UX 变动，对用户而言，此改动应是无感的，仅表现为行为的正确性修复。

#### 6. 技术要点与注意事项 (Technical Notes)

*   **防抖时间**: 建议设置为 2-3 秒，需在前端实现。
*   **错误处理**: 需要考虑内容同步失败时的处理机制。例如，UI 上应有明确的提示（如“保存失败，请重试”），并提供重试机制，以防止数据丢失。
*   **状态管理**: 前端应有明确的状态来标识 Block 内容的保存状态（例如：`editing`, `saving`, `saved`, `error`），以提供清晰的用户反馈。
*   **性能考量**: "运行前强制同步" 步骤需要高效完成，避免因为同步多个 Block 而导致用户感到明显的延迟。可以考虑并发请求或只同步真正被修改过的 (dirty) Block。


---

### 变更说明：统一外部存储、多分片、运行前同步

#### 1) 用户编辑 block 的防抖同步
- **JsonBlock（structured）**：在用户编辑后 2s 防抖触发同步，设置 `savingStatus`，将内容写入外部存储，类型为 `structured`。
```290:336:PuppyFlow/app/components/workflow/blockNode/JsonNodeNew.tsx
// 防抖保存 external storage（2s），structured
useEffect(() => {
  ...
  const timer = setTimeout(async () => {
    try {
      setNodes(prev =>
        prev.map(n =>
          n.id === id
            ? { ...n, data: { ...n.data, savingStatus: 'saving' } }
            : n
        )
      );
      await syncBlockContent({
        node,
        content:
          typeof currentContent === 'string'
            ? currentContent
            : JSON.stringify(currentContent ?? []),
        getUserId: fetchUserId as any,
        getAuthHeaders,
        setNodes: setNodes as any,
        contentType: 'structured',
      });
    } catch (e) {
      setNodes(prev =>
        prev.map(n =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  savingStatus: 'error',
                  saveError: (e as Error)?.message || String(e),
                },
              }
            : n
        )
      );
    }
  }, 2000);
```

- **TextBlock（text）**：同样在 2s 防抖后调用统一的同步函数，类型为 `text`。
```244:291:PuppyFlow/app/components/workflow/blockNode/TextBlockNode.tsx
// 防抖保存 external storage（2s）
useEffect(() => {
  ...
  const timer = setTimeout(async () => {
    try {
      setNodes(prev =>
        prev.map(n =>
          n.id === id
            ? { ...n, data: { ...n.data, savingStatus: 'saving' } }
            : n
        )
      );
      await syncBlockContent({
        node,
        content: currentContent,
        getUserId: fetchUserId as any,
        getAuthHeaders,
        setNodes: setNodes as any,
        contentType: 'text',
      });
    } catch (e) {
      setNodes(prev =>
        prev.map(n =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  savingStatus: 'error',
                  saveError: (e as Error)?.message || String(e),
                },
              }
            : n
        )
      );
    }
  }, 2000);
```

- 两类节点在编辑时都会标记 `dirty: true` 并设置 `savingStatus: 'editing'`，以便 UI 状态反馈。
```271:291:PuppyFlow/app/components/workflow/blockNode/JsonNodeNew.tsx
... data: {
  ...node.data,
  content: newValue,
  dirty: true,
  savingStatus: 'editing',
},

223:241:PuppyFlow/app/components/workflow/blockNode/TextBlockNode.tsx
... data: {
  ...node.data,
  content: newValue,
  dirty: true,
  savingStatus: 'editing',
},
```

#### 2) 运行前同步（Pre-run Sync）
- 在单边运行前，对与该边关联的源/目标 block 节点（`text/structured`）执行一次强制同步，保证刚改动未防抖完成的内容也能被后端使用。
```375:389:PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor.ts
// Pre-run sync for involved block nodes (sources and targets) without requiring global getNodes
async function preRunSyncInvolvedNodes( ... ) { ... }
```
- 在执行函数起始处调用：
```1119:1124:PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor.ts
context.clearAll();

// 运行前同步当前边涉及的 block 节点（只依赖 source/target 列表与 getNode）
await preRunSyncInvolvedNodes(parentId, context);
```
- 顶部工具栏的“Test Run”也在全局层面触发一次“运行前同步所有 dirty 节点”，以防止遗漏（见 staged-changes 中的 `TestRunBotton.tsx` edits）。

#### 3) 与后端一致的分块策略
- 新增 `externalStorage.ts` 提供统一的外部存储同步工具；支持多分片上传，并最终覆盖 `manifest.json` 为本次同步的完整分片列表。
- 结构化内容（JSON block）：
  - 使用 JSONL 行粒度聚合，严格保证“单行（一个 JSON 对象）不被拆分到多个 chunk”；
  - 按约 1MB 上限装箱；若单行本身超过 1MB，整行作为单独 chunk。
```80:136:PuppyFlow/app/components/workflow/utils/externalStorage.ts
function buildChunkDescriptors(...){
  if (contentType === 'structured') {
    // Split by JSON Lines with size constraint to avoid breaking objects across chunks
    const lines = (() => { ... })();

    const parts: Uint8Array[] = [];
    let buffer: string[] = [];
    let bufferBytes = 0;
    for (const line of lines) {
      const lineBytes = encodeUtf8(line);
      const lineSize = lineBytes.byteLength;
      if (lineSize > DEFAULT_CHUNK_SIZE) {
        if (bufferBytes > 0) {
          parts.push(encodeUtf8(buffer.join('')));
          buffer = [];
          bufferBytes = 0;
        }
        parts.push(lineBytes); // oversized single line as its own chunk
        continue;
      }
      if (bufferBytes + lineSize > DEFAULT_CHUNK_SIZE && bufferBytes > 0) {
        parts.push(encodeUtf8(buffer.join('')));
        buffer = [];
        bufferBytes = 0;
      }
      buffer.push(line);
      bufferBytes += lineSize;
    }
    if (bufferBytes > 0) {
      parts.push(encodeUtf8(buffer.join('')));
    }

    return parts.map((part, i) => ({
      name: `chunk_${String(i).padStart(6, '0')}.jsonl`,
      mime: 'application/jsonl',
      bytes: part,
      index: i,
    }));
  }
```
- 文本内容（Text block）：按字节每约 1MB 切分为 `chunk_000000.txt`、`chunk_000001.txt` 等。
```137:146:PuppyFlow/app/components/workflow/utils/externalStorage.ts
// text
const bytes = encodeUtf8(content);
const parts = splitBytes(bytes);
return parts.map((part, i) => ({
  name: `chunk_${String(i).padStart(6, '0')}.txt`,
  mime: 'text/plain; charset=utf-8',
  bytes: part,
  index: i,
}));
```
- 上传与 manifest 覆盖：
```366:386:PuppyFlow/app/components/workflow/utils/externalStorage.ts
// Build chunk descriptors and upload sequentially
const descriptors = buildChunkDescriptors(content, contentType);
const uploaded = await uploadChunkList(
  node.id,
  versionId,
  descriptors,
  getAuthHeaders
);

// Build manifest and overwrite (full list of chunks)
const manifest = {
  version: '1.0',
  block_id: node.id,
  version_id: versionId,
  updated_at: new Date().toISOString(),
  status: 'completed',
  chunks: uploaded,
} as const;

await overwriteManifest(node.id, versionId, manifest, getAuthHeaders);
```
- 与后端分块策略保持一致（1MB 级别、JSONL 不跨行）：
```254:273:PuppyEngine/Persistence/ExternalStorageStrategy.py
if content_type == 'structured':
    # Use StreamingJSONHandler for structured data
    chunk_index = 0
    if isinstance(content, list):
        for chunk_data in self.json_handler.split_to_jsonl(content):
            yield f\"chunk_{chunk_index:06d}.jsonl\", chunk_data
            chunk_index += 1
    else:
        # Single object as JSONL
        chunk_data = json.dumps(content, ensure_ascii=False).encode('utf-8') + b'\\n'
        yield \"chunk_000000.jsonl\", chunk_data

elif content_type == 'text':
    # Text content chunking
    text_bytes = content.encode('utf-8')
    chunk_index = 0
    for i in range(0, len(text_bytes), self.chunk_size):
        chunk = text_bytes[i:i + self.chunk_size]
        yield f\"chunk_{chunk_index:06d}.txt\", chunk
        chunk_index += 1
```

### 效果与收益
- 防抖同步确保编辑后的内容与外部存储保持一致，避免“所见非所得”。
- 运行前同步兜底，保证立即运行也使用最新内容。
- 分块策略与后端一致：
  - JSONL 按行聚合，单行不被拆分；长文本按 1MB 分段；
  - 前端写入的分片命名、MIME 与后端读取完全对齐；
  - 最终以覆盖 `manifest.json` 的方式提交，运行时仅消费 manifest 中声明的分片，避免历史残留影响结果。