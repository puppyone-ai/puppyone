/*
动态存储策略工具 - 基于内容长度自动切换 internal/external storage

核心设计：
- 短内容（<1024字符）使用 internal storage，数据直接存储在JSON中
- 长内容（>=1024字符）使用 external storage，通过resource_key引用外部存储
- 支持动态切换，当内容长度跨越阈值时自动转换存储模式
*/

import {
  NodeLike,
  NodesGetter,
  NodesSetter,
  syncBlockContent,
  ContentType,
} from './externalStorage';

// 内容长度阈值和分块大小：默认来自环境变量，可在运行期由后端事件覆盖
let STORAGE_CHUNK_SIZE_DEFAULT = parseInt(
  process.env.NEXT_PUBLIC_STORAGE_CHUNK_SIZE || '1024',
  10
);

// 使用 let 导出以便在运行期调整，保持与后端 TASK_STARTED 的 storage_threshold_bytes 一致
export let CONTENT_LENGTH_THRESHOLD = STORAGE_CHUNK_SIZE_DEFAULT;
export let CHUNK_SIZE = STORAGE_CHUNK_SIZE_DEFAULT;

// 从后端运行时信号更新分块/阈值（单位：字节/字符，前后端保持一致的度量）
export function setStorageChunkSize(bytes: number) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return;
  const value = Math.floor(n);
  CONTENT_LENGTH_THRESHOLD = value;
  CHUNK_SIZE = value;
}

// 清理配置
export const CLEANUP_CONFIG = {
  // 是否启用自动清理
  enabled: true,
  // 清理失败时是否阻塞主流程（false = 异步清理）
  blockOnFailure: false,
  // 清理超时时间（毫秒）
  timeoutMs: 10000,
};

export type StorageClass = 'internal' | 'external';

/**
 * 根据内容长度判断应该使用哪种存储策略
 */
export function determineStorageClass(content: string): StorageClass {
  const contentLength = content?.length || 0;
  return contentLength >= CONTENT_LENGTH_THRESHOLD ? 'external' : 'internal';
}

/**
 * 将内容按照CHUNK_SIZE进行分块
 * 与阈值保持一致的分块策略
 */
function chunkContent(
  content: string,
  contentType: ContentType
): Array<{ name: string; mime: string; bytes: Uint8Array; index: number }> {
  const encoder = new TextEncoder();

  if (contentType === 'structured') {
    // 对于结构化内容，尝试按JSON对象分块，但不超过CHUNK_SIZE
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        const chunks: Array<{
          name: string;
          mime: string;
          bytes: Uint8Array;
          index: number;
        }> = [];
        let currentChunk: any[] = [];
        let currentSize = 0;
        let chunkIndex = 0;

        for (const item of parsed) {
          const itemStr = JSON.stringify(item) + '\n';
          const itemSize = encoder.encode(itemStr).length;

          // 如果单个item就超过CHUNK_SIZE，单独成块
          if (itemSize > CHUNK_SIZE) {
            // 先保存当前chunk（如果有内容）
            if (currentChunk.length > 0) {
              const chunkContent =
                currentChunk.map(obj => JSON.stringify(obj)).join('\n') + '\n';
              chunks.push({
                name: `chunk_${String(chunkIndex).padStart(6, '0')}.jsonl`,
                mime: 'application/jsonl',
                bytes: encoder.encode(chunkContent),
                index: chunkIndex,
              });
              chunkIndex++;
              currentChunk = [];
              currentSize = 0;
            }

            // 大item单独成块
            chunks.push({
              name: `chunk_${String(chunkIndex).padStart(6, '0')}.jsonl`,
              mime: 'application/jsonl',
              bytes: encoder.encode(itemStr),
              index: chunkIndex,
            });
            chunkIndex++;
            continue;
          }

          // 检查加入当前item是否会超过CHUNK_SIZE
          if (currentSize + itemSize > CHUNK_SIZE && currentChunk.length > 0) {
            // 保存当前chunk
            const chunkContent =
              currentChunk.map(obj => JSON.stringify(obj)).join('\n') + '\n';
            chunks.push({
              name: `chunk_${String(chunkIndex).padStart(6, '0')}.jsonl`,
              mime: 'application/jsonl',
              bytes: encoder.encode(chunkContent),
              index: chunkIndex,
            });
            chunkIndex++;
            currentChunk = [];
            currentSize = 0;
          }

          currentChunk.push(item);
          currentSize += itemSize;
        }

        // 保存最后一个chunk
        if (currentChunk.length > 0) {
          const chunkContent =
            currentChunk.map(obj => JSON.stringify(obj)).join('\n') + '\n';
          chunks.push({
            name: `chunk_${String(chunkIndex).padStart(6, '0')}.jsonl`,
            mime: 'application/jsonl',
            bytes: encoder.encode(chunkContent),
            index: chunkIndex,
          });
        }

        return chunks;
      } else {
        // 单个对象，直接转换
        const jsonStr = JSON.stringify(parsed) + '\n';
        return [
          {
            name: `chunk_000000.jsonl`,
            mime: 'application/jsonl',
            bytes: encoder.encode(jsonStr),
            index: 0,
          },
        ];
      }
    } catch {
      // JSON解析失败，按文本处理
      return chunkTextContent(content, encoder);
    }
  }

  // 文本内容按字符分块
  return chunkTextContent(content, encoder);
}

/**
 * 按字符数分块文本内容
 */
function chunkTextContent(
  content: string,
  encoder: TextEncoder
): Array<{ name: string; mime: string; bytes: Uint8Array; index: number }> {
  const chunks: Array<{
    name: string;
    mime: string;
    bytes: Uint8Array;
    index: number;
  }> = [];

  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    const chunkText = content.slice(i, i + CHUNK_SIZE);
    const chunkIndex = Math.floor(i / CHUNK_SIZE);

    chunks.push({
      name: `chunk_${String(chunkIndex).padStart(6, '0')}.txt`,
      mime: 'text/plain; charset=utf-8',
      bytes: encoder.encode(chunkText),
      index: chunkIndex,
    });
  }

  return chunks;
}

/**
 * 检查节点是否需要切换存储模式
 */
export function needsStorageSwitch(
  node: NodeLike,
  content: string
): {
  needsSwitch: boolean;
  currentClass: StorageClass;
  targetClass: StorageClass;
} {
  const currentClass: StorageClass = node?.data?.storage_class || 'internal';
  const targetClass = determineStorageClass(content);

  return {
    needsSwitch: currentClass !== targetClass,
    currentClass,
    targetClass,
  };
}

/**
 * 将节点从 external 切换回 internal storage
 * 清理外部存储相关的元数据，但保留resource_key用于将来可能的重用
 */
export function switchToInternal(
  nodeId: string,
  content: string,
  setNodes: NodesSetter
): void {
  setNodes(prev =>
    prev.map(node =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              content, // 将内容直接存储在data中
              storage_class: 'internal',
              isExternalStorage: false,
              // 保留external_metadata以便将来重用，但标记为internal
              // external_metadata: undefined, // 不清理，保留resource_key
              dirty: false,
              savingStatus: 'saved',
            },
          }
        : node
    )
  );
}

/**
 * 将节点从 internal 切换到 external storage
 * 会触发同步到外部存储系统，使用改进的分块和resource_key管理
 */
export async function switchToExternal(
  node: NodeLike,
  content: string,
  contentType: ContentType,
  getUserId: () => Promise<string>,
  setNodes: NodesSetter
): Promise<void> {
  // 标记为正在切换状态
  setNodes(prev =>
    prev.map(n =>
      n.id === node.id
        ? {
            ...n,
            data: {
              ...n.data,
              savingStatus: 'switching_to_external',
            },
          }
        : n
    )
  );

  try {
    // 使用改进的同步函数，确保resource_key一致性和正确分块
    await syncBlockContentWithConsistentKey({
      node,
      content,
      getUserId,
      setNodes,
      contentType,
    });
  } catch (error) {
    // 切换失败，恢复状态
    setNodes(prev =>
      prev.map(n =>
        n.id === node.id
          ? {
              ...n,
              data: {
                ...n.data,
                savingStatus: 'switch_error',
                saveError: (error as Error)?.message || String(error),
              },
            }
          : n
      )
    );
    throw error;
  }
}

/**
 * 改进的同步函数，确保resource_key一致性和使用正确的分块大小
 */
async function syncBlockContentWithConsistentKey({
  node,
  content,
  getUserId,
  setNodes,
  contentType,
}: {
  node: NodeLike;
  content: string;
  getUserId: () => Promise<string>;
  setNodes: NodesSetter;
  contentType: ContentType;
}): Promise<void> {
  // 1. 确保外部指针存在，但复用已有的resource_key
  const { resourceKey, versionId } = await ensureConsistentExternalPointer(
    node,
    getUserId,
    setNodes,
    contentType
  );

  // 2. 处理空内容的特殊情况
  const isEmptyText = contentType === 'text' && content.length === 0;
  const isEmptyStructured =
    contentType === 'structured' && (content || '').trim().length === 0;

  if (isEmptyText || isEmptyStructured) {
    const manifestEmpty = {
      version: '1.0',
      block_id: node.id,
      version_id: versionId,
      updated_at: new Date().toISOString(),
      status: 'completed',
      chunks: [],
    } as const;

    await overwriteManifest(node.id, versionId, manifestEmpty);

    setNodes(prev =>
      prev.map(n =>
        n.id === node.id
          ? {
              ...n,
              data: {
                ...n.data,
                storage_class: 'external',
                isExternalStorage: true,
                external_metadata: {
                  ...(n.data?.external_metadata || {}),
                  resource_key: resourceKey,
                  content_type: contentType,
                  version_id: versionId,
                },
                dirty: false,
                savingStatus: 'saved',
              },
            }
          : n
      )
    );
    return;
  }

  // 3. 获取旧manifest以便清理孤儿chunk
  const existingResourceKey = node?.data?.external_metadata?.resource_key;
  const oldManifest = await getExistingManifest(
    node.id,
    versionId,
    existingResourceKey
  );

  // 4. 使用改进的分块策略
  const chunks = chunkContent(content, contentType);
  const uploaded = await uploadChunkList(node.id, versionId, chunks);

  // 5. 清理不再需要的旧chunk
  if (CLEANUP_CONFIG.enabled) {
    const userId = await getUserId();
    if (CLEANUP_CONFIG.blockOnFailure) {
      // 同步清理：清理失败会影响主流程
      await cleanupOrphanedChunks(
        node.id,
        versionId,
        oldManifest,
        uploaded,
        userId
      );
    } else {
      // 异步清理：清理失败不影响主流程（推荐）
      const cleanupPromise = Promise.race([
        cleanupOrphanedChunks(
          node.id,
          versionId,
          oldManifest,
          uploaded,
          userId
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Cleanup timeout')),
            CLEANUP_CONFIG.timeoutMs
          )
        ),
      ]);

      cleanupPromise.catch(error => {
        // Chunk cleanup failed, but main operation succeeded
      });
    }
  }

  // 6. 构建并更新manifest
  const manifest = {
    version: '1.0',
    block_id: node.id,
    version_id: versionId,
    updated_at: new Date().toISOString(),
    status: 'completed',
    chunks: uploaded,
    chunk_strategy: 'dynamic_1024_chars', // 标记使用的分块策略
  } as const;

  await overwriteManifest(node.id, versionId, manifest);

  // 7. 更新节点状态
  setNodes(prev =>
    prev.map(n =>
      n.id === node.id
        ? {
            ...n,
            data: {
              ...n.data,
              storage_class: 'external',
              isExternalStorage: true,
              external_metadata: {
                ...(n.data?.external_metadata || {}),
                resource_key: resourceKey,
                content_type: contentType,
                version_id: versionId,
              },
              dirty: false,
              savingStatus: 'saved',
            },
          }
        : n
    )
  );
}

/**
 * 确保外部指针的一致性，复用已有的resource_key
 */
async function ensureConsistentExternalPointer(
  node: NodeLike,
  getUserId: () => Promise<string>,
  setNodes: NodesSetter,
  contentType: ContentType
): Promise<{ resourceKey: string; versionId: string }> {
  const external = node?.data?.external_metadata;
  const existingKey: string | undefined = external?.resource_key;
  let versionId = existingKey ? parseVersionId(existingKey) : null;

  // 如果已经有resource_key，直接复用
  if (existingKey && versionId) {
    return { resourceKey: existingKey, versionId };
  }

  // 只有在没有resource_key时才创建新的
  const { versionId: newVid, resourceKey } = await createInitialManifest(
    node.id
  );

  versionId = newVid;

  // 更新节点状态
  setNodes(prev =>
    prev.map(n =>
      n.id === node.id
        ? {
            ...n,
            data: {
              ...n.data,
              storage_class: 'external',
              isExternalStorage: true,
              external_metadata: {
                ...(n.data?.external_metadata || {}),
                resource_key: resourceKey,
                version_id: versionId,
                content_type: contentType,
              },
            },
          }
        : n
    )
  );

  return { resourceKey, versionId };
}

// 导入需要的辅助函数（这些来自externalStorage.ts）
async function createInitialManifest(
  blockId: string,
  manifestBody?: any
): Promise<{ versionId: string; manifestKey: string; resourceKey: string }> {
  const body = JSON.stringify(
    manifestBody ?? {
      version: '1.0',
      block_id: blockId,
      status: 'generating',
      created_at: new Date().toISOString(),
      chunks: [],
    }
  );

  const resp = await fetch(
    `/api/storage/upload/chunk/direct?block_id=${encodeURIComponent(
      blockId
    )}&file_name=manifest.json&content_type=application/json`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    }
  );
  if (!resp.ok) {
    throw new Error(
      `Init manifest failed: ${resp.status} ${await resp.text()}`
    );
  }
  const data = (await resp.json()) as {
    key: string;
    version_id: string;
  };
  const keyParts = data.key.split('/');
  const resourceKey = keyParts.slice(0, 3).join('/');
  return { versionId: data.version_id, manifestKey: data.key, resourceKey };
}

async function overwriteManifest(
  blockId: string,
  versionId: string,
  manifest: any
): Promise<void> {
  const body = JSON.stringify(manifest);
  const url = `/api/storage/upload/chunk/direct?block_id=${encodeURIComponent(
    blockId
  )}&file_name=manifest.json&content_type=application/json&version_id=${encodeURIComponent(
    versionId
  )}`;
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(
      `Overwrite manifest failed: ${resp.status} ${await resp.text()}`
    );
  }
}

type ManifestChunk = {
  name: string;
  file_name?: string;
  mime_type: string;
  size: number;
  etag: string;
  index: number;
  state: 'done';
};

async function uploadChunkList(
  blockId: string,
  versionId: string,
  chunks: Array<{
    name: string;
    mime: string;
    bytes: Uint8Array;
    index: number;
  }>
): Promise<ManifestChunk[]> {
  const results: ManifestChunk[] = [];

  for (const c of chunks) {
    const { etag, size } = await uploadChunkDirect(
      blockId,
      c.name,
      c.mime,
      c.bytes,
      versionId
    );
    results.push({
      name: c.name,
      // For structured/text chunking, omit file_name to avoid BE misclassification as 'files'
      mime_type: c.mime,
      size,
      etag,
      index: c.index,
      state: 'done',
    });
  }

  return results;
}

async function uploadChunkDirect(
  blockId: string,
  fileName: string,
  contentType: string,
  bytes: Uint8Array | string,
  versionId: string
): Promise<{ etag: string; size: number }> {
  const url = `/api/storage/upload/chunk/direct?block_id=${encodeURIComponent(
    blockId
  )}&file_name=${encodeURIComponent(fileName)}&content_type=${encodeURIComponent(
    contentType
  )}&version_id=${encodeURIComponent(versionId)}`;
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': contentType,
    },
    body: typeof bytes === 'string' ? bytes : bytes,
  });
  if (!resp.ok) {
    throw new Error(`Upload chunk failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as { etag: string; size: number };
  return { etag: data.etag, size: data.size };
}

// Parse version_id from resource_key: user_id/block_id/version_id
function parseVersionId(resourceKey: string): string | null {
  const parts = resourceKey.split('/');
  if (parts.length < 3) return null;
  return parts[2] || null;
}

/**
 * 获取现有的manifest文件
 * 使用与Workflow.tsx一致的API端点
 */
async function getExistingManifest(
  blockId: string,
  versionId: string,
  resourceKey?: string
): Promise<any | null> {
  try {
    // 如果有resourceKey，使用与Workflow.tsx一致的方式
    if (resourceKey) {
      const manifestResp = await fetch(
        `/api/storage/download/url?key=${encodeURIComponent(
          `${resourceKey}/manifest.json`
        )}`,
        {
          credentials: 'include',
        }
      );

      if (!manifestResp.ok) {
        if (manifestResp.status === 404) {
          return null;
        }
        throw new Error(
          `Get manifest URL failed: ${manifestResp.status} ${await manifestResp.text()}`
        );
      }

      const { download_url: manifestUrl } = await manifestResp.json();
      const manifestRes = await fetch(manifestUrl);

      if (!manifestRes.ok) {
        if (manifestRes.status === 404) {
          return null;
        }
        throw new Error(
          `Download manifest failed: ${manifestRes.status} ${await manifestRes.text()}`
        );
      }

      const manifest = await manifestRes.json();
      return manifest;
    }

    // 回退到直接chunk API（保持向后兼容）
    const url = `/api/storage/download/chunk/direct?block_id=${encodeURIComponent(
      blockId
    )}&file_name=manifest.json&version_id=${encodeURIComponent(versionId)}`;

    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        return null;
      }
      throw new Error(
        `Get manifest failed: ${resp.status} ${await resp.text()}`
      );
    }

    const manifestText = await resp.text();
    const manifest = JSON.parse(manifestText);
    return manifest;
  } catch (error) {
    return null;
  }
}

/**
 * 清理孤儿chunk文件
 */
async function cleanupOrphanedChunks(
  blockId: string,
  versionId: string,
  oldManifest: any | null,
  newChunks: Array<{
    name: string;
    file_name: string;
    mime_type: string;
    size: number;
    etag: string;
    index: number;
    state: 'done';
  }>,
  userId: string
): Promise<void> {
  if (
    !oldManifest ||
    !oldManifest.chunks ||
    !Array.isArray(oldManifest.chunks)
  ) {
    // 没有旧manifest或旧chunks，无需清理
    return;
  }

  const newChunkNames = new Set(newChunks.map(c => c.file_name));
  const oldChunkNames = oldManifest.chunks.map(
    (c: any) => c.file_name || c.name
  );

  // 找出需要删除的chunk
  const chunksToDelete = oldChunkNames.filter(
    (name: string) => !newChunkNames.has(name)
  );

  if (chunksToDelete.length === 0) {
    return;
  }

  // 并行删除孤儿chunk（包括对应的metadata文件）
  const deletePromises = chunksToDelete.map(async (chunkName: string) => {
    try {
      // 删除主chunk文件
      await deleteChunk(blockId, chunkName, versionId, userId);

      // 删除对应的metadata文件
      const metadataFileName = `${chunkName}.metadata`;
      try {
        await deleteChunk(blockId, metadataFileName, versionId, userId);
      } catch (metadataError) {
        // metadata文件可能不存在，这是正常的
      }
    } catch (error) {
      // 不抛出错误，避免影响主要流程
    }
  });

  await Promise.allSettled(deletePromises);
}

/**
 * 删除单个chunk文件
 */
async function deleteChunk(
  blockId: string,
  fileName: string,
  versionId: string,
  userId: string
): Promise<void> {
  const url = `/api/storage/delete/chunk?block_id=${encodeURIComponent(
    blockId
  )}&file_name=${encodeURIComponent(fileName)}&version_id=${encodeURIComponent(
    versionId
  )}`;

  const resp = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Delete chunk failed: ${resp.status} ${errorText}`);
  }
}

/**
 * 动态处理存储策略切换的主函数
 * 根据内容长度自动判断并执行切换
 */
export async function handleDynamicStorageSwitch({
  node,
  content,
  contentType,
  getUserId,
  setNodes,
}: {
  node: NodeLike;
  content: string;
  contentType: ContentType;
  getUserId: () => Promise<string>;
  setNodes: NodesSetter;
}): Promise<void> {
  const { needsSwitch, currentClass, targetClass } = needsStorageSwitch(
    node,
    content
  );

  if (!needsSwitch) {
    // 不需要切换，但如果是external storage且内容有变化，需要同步
    if (currentClass === 'external' && node.data?.dirty) {
      // 使用改进的同步函数，确保resource_key一致性和正确分块
      await syncBlockContentWithConsistentKey({
        node,
        content,
        getUserId,
        setNodes,
        contentType,
      });
    } else if (currentClass === 'internal') {
      // internal storage，直接更新内容
      setNodes(prev =>
        prev.map(n =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  content,
                  dirty: false,
                  savingStatus: 'saved',
                },
              }
            : n
        )
      );
    }
    return;
  }

  // 需要切换存储模式

  if (targetClass === 'internal') {
    // 切换到 internal：内容变短了
    switchToInternal(node.id, content, setNodes);
  } else {
    // 切换到 external：内容变长了
    await switchToExternal(node, content, contentType, getUserId, setNodes);
  }
}

/**
 * 获取节点的存储状态信息（用于调试和监控）
 */
export function getStorageInfo(node: NodeLike): {
  storageClass: StorageClass;
  contentLength: number;
  isExternal: boolean;
  hasExternalMetadata: boolean;
  resourceKey?: string;
} {
  const content = node?.data?.content || '';
  const storageClass: StorageClass = node?.data?.storage_class || 'internal';
  const externalMetadata = node?.data?.external_metadata;

  return {
    storageClass,
    contentLength: content.length,
    isExternal: storageClass === 'external',
    hasExternalMetadata: !!externalMetadata?.resource_key,
    resourceKey: externalMetadata?.resource_key,
  };
}

/**
 * 批量检查和切换多个节点的存储策略
 * 用于运行前的强制同步
 */
export async function batchHandleStorageSwitch({
  getNodes,
  setNodes,
  getUserId,
}: {
  getNodes: NodesGetter;
  setNodes: NodesSetter;
  getUserId: () => Promise<string>;
}): Promise<void> {
  const nodes = getNodes();
  const targetTypes = new Set(['text', 'structured']);
  const candidates = nodes.filter(n => targetTypes.has(n.type || ''));

  for (const node of candidates) {
    const content = String(node.data?.content ?? '');
    const contentType: ContentType =
      node.type === 'structured' ? 'structured' : 'text';

    try {
      await handleDynamicStorageSwitch({
        node,
        content,
        contentType,
        getUserId,
        setNodes,
      });
    } catch (error) {
      // 继续处理其他节点，不因单个节点失败而中断
    }
  }
}
