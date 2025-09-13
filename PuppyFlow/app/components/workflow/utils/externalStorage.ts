/*
High-level external storage sync utilities for Blocks.

- Ensure each block has an external resource (resource_key + version_id)
- Overwrite a single chunk and manifest for debounced or forced sync
- No new version creation after first initialization
*/

// Route all storage operations via secure proxy endpoints under /api/storage

export type ContentType = 'text' | 'structured';

type UserIdGetter = () => Promise<string>;

export type NodeLike = {
  id: string;
  type?: string;
  data?: Record<string, any>;
};

export type NodesGetter = () => NodeLike[];
export type NodeGetter = (id: string) => NodeLike | undefined;
export type NodesSetter = (updater: (nodes: NodeLike[]) => NodeLike[]) => void;

// Client never adds auth headers; server-side proxy authenticates requests

// Parse version_id from resource_key: user_id/block_id/version_id
function parseVersionId(resourceKey: string): string | null {
  const parts = resourceKey.split('/');
  if (parts.length < 3) return null;
  return parts[2] || null;
}

function jsonToJsonl(input: any): string {
  try {
    if (typeof input === 'string') {
      // try parse, fallback to single line
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.map(rec => JSON.stringify(rec)).join('\n') + '\n';
      }
      return JSON.stringify(parsed) + '\n';
    }
    // non-string (object/array)
    if (Array.isArray(input)) {
      return input.map(rec => JSON.stringify(rec)).join('\n') + '\n';
    }
    return JSON.stringify(input) + '\n';
  } catch {
    // treat as raw text line
    return String(input) + (String(input).endsWith('\n') ? '' : '\n');
  }
}

// Default chunk size for byte-level splitting (configurable via environment variable)
// Note: This is for byte-level chunking, different from character-level threshold
export let EXTERNAL_CHUNK_SIZE = parseInt(
  process.env.NEXT_PUBLIC_STORAGE_CHUNK_SIZE || '1024',
  10
);

export function setExternalChunkSize(bytes: number) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return;
  EXTERNAL_CHUNK_SIZE = Math.floor(n);
}

function encodeUtf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function splitBytes(
  data: Uint8Array,
  chunkSize: number = EXTERNAL_CHUNK_SIZE
): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    parts.push(data.subarray(i, Math.min(i + chunkSize, data.length)));
  }
  return parts;
}

function buildChunkDescriptors(
  content: string,
  contentType: ContentType
): Array<{ name: string; mime: string; bytes: Uint8Array; index: number }> {
  if (contentType === 'structured') {
    // Split by JSON Lines with size constraint to avoid breaking objects across chunks
    const lines = (() => {
      try {
        if (typeof content === 'string') {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            return parsed.map(rec => JSON.stringify(rec) + '\n');
          }
          return [JSON.stringify(parsed) + '\n'];
        }
        return [JSON.stringify(content) + '\n'];
      } catch {
        const s = String(content);
        return [s.endsWith('\n') ? s : s + '\n'];
      }
    })();

    const parts: Uint8Array[] = [];
    let buffer: string[] = [];
    let bufferBytes = 0;
    for (const line of lines) {
      const lineBytes = encodeUtf8(line);
      const lineSize = lineBytes.byteLength;
      if (lineSize > EXTERNAL_CHUNK_SIZE) {
        if (bufferBytes > 0) {
          parts.push(encodeUtf8(buffer.join('')));
          buffer = [];
          bufferBytes = 0;
        }
        parts.push(lineBytes);
        continue;
      }
      if (bufferBytes + lineSize > EXTERNAL_CHUNK_SIZE && bufferBytes > 0) {
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
  // text
  const bytes = encodeUtf8(content);
  const parts = splitBytes(bytes);
  return parts.map((part, i) => ({
    name: `chunk_${String(i).padStart(6, '0')}.txt`,
    mime: 'text/plain; charset=utf-8',
    bytes: part,
    index: i,
  }));
}

async function uploadChunkList(
  blockId: string,
  versionId: string,
  chunks: Array<{
    name: string;
    mime: string;
    bytes: Uint8Array;
    index: number;
  }>
): Promise<
  Array<{
    name: string;
    file_name: string;
    mime_type: string;
    size: number;
    etag: string;
    index: number;
    state: 'done';
  }>
> {
  const results: Array<{
    name: string;
    file_name?: string;
    mime_type: string;
    size: number;
    etag: string;
    index: number;
    state: 'done';
  }> = [];

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

export async function ensureExternalPointer(
  node: NodeLike,
  getUserId: UserIdGetter,
  setNodes: NodesSetter,
  contentType: ContentType
): Promise<{ resourceKey: string; versionId: string }> {
  const external = node?.data?.external_metadata;
  const storageClass = node?.data?.storage_class;
  const existingKey: string | undefined = external?.resource_key;
  let versionId = existingKey ? parseVersionId(existingKey) : null;

  if (existingKey && versionId) {
    return { resourceKey: existingKey, versionId };
  }

  // Create initial version by uploading an empty manifest
  const { versionId: newVid, resourceKey } = await createInitialManifest(
    node.id
  );

  versionId = newVid;

  // Update node state to mark external
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

export async function syncBlockContent({
  node,
  content,
  getUserId,
  setNodes,
  contentType,
}: {
  node: NodeLike;
  content: string;
  getUserId: UserIdGetter;
  setNodes: NodesSetter;
  contentType: ContentType;
}): Promise<void> {
  // Ensure pointer
  const { resourceKey, versionId } = await ensureExternalPointer(
    node,
    getUserId,
    setNodes,
    contentType
  );

  // Special case: empty content should be a valid sync -> write manifest with no chunks
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

  // Build chunk descriptors and upload sequentially
  const descriptors = buildChunkDescriptors(content, contentType);
  const uploaded = await uploadChunkList(node.id, versionId, descriptors);

  // Build manifest and overwrite (full list of chunks)
  const manifest = {
    version: '1.0',
    block_id: node.id,
    version_id: versionId,
    updated_at: new Date().toISOString(),
    status: 'completed',
    chunks: uploaded,
  } as const;

  await overwriteManifest(node.id, versionId, manifest);

  // Clear dirty/saving status on success
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

export async function forceSyncDirtyNodes({
  getNodes,
  setNodes,
  getUserId,
}: {
  getNodes: NodesGetter;
  setNodes: NodesSetter;
  getUserId: UserIdGetter;
}): Promise<void> {
  const nodes = getNodes();
  const targetTypes = new Set(['text', 'structured']);
  const candidates = nodes.filter(n => targetTypes.has(n.type || ''));
  for (const n of candidates) {
    const data = n.data || {};
    const isDirty = !!data.dirty;
    const storageClass = data.storage_class || 'internal';
    const isExternal = storageClass === 'external';
    // 核心原则：仅 external 且 dirty=true 才需要强制同步
    if (!(isExternal && isDirty)) continue;
    const content = String(data.content ?? '');
    const contentType: ContentType =
      n.type === 'structured' ? 'structured' : 'text';
    try {
      // set saving state
      setNodes(prev =>
        prev.map(x =>
          x.id === n.id
            ? { ...x, data: { ...x.data, savingStatus: 'saving' } }
            : x
        )
      );
      await syncBlockContent({
        node: n,
        content,
        getUserId,
        setNodes,
        contentType,
      });
    } catch (e) {
      setNodes(prev =>
        prev.map(x =>
          x.id === n.id
            ? {
                ...x,
                data: {
                  ...x.data,
                  savingStatus: 'error',
                  saveError: (e as Error)?.message || String(e),
                },
              }
            : x
        )
      );
      // Continue syncing others
    }
  }
}
