// Block-side adapter to apply internal/external block updates
// Ensures content is normalized for UI (string for editors)

import {
  ensurePollerStarted,
  ensurePollerStoppedAndFinalize,
  ContentType,
} from './manifestPoller';

export type NodesSetter = (updater: (nodes: any[]) => any[]) => void;

export interface BlockApplierContext {
  setNodes: NodesSetter;
  resetLoadingUI?: (nodeId: string) => void;
}

export type BlockUpdateInternal = {
  block_id: string;
  storage_class?: 'internal';
  type?: 'text' | 'structured';
  content: any;
};

export type BlockUpdateExternal = {
  block_id: string;
  storage_class: 'external';
  external_metadata: {
    resource_key: string;
    content_type: ContentType | string;
    version_id?: string;
    chunked?: boolean;
    uploaded_at?: string;
  };
};

export function applyBlockUpdate(
  ctx: BlockApplierContext,
  update: BlockUpdateInternal | BlockUpdateExternal
) {
  const isExternal =
    (update as BlockUpdateExternal).external_metadata !== undefined ||
    update.storage_class === 'external';
  if (isExternal) {
    const u = update as BlockUpdateExternal;
    const normalizedContentType: ContentType =
      u.external_metadata.content_type === 'structured' ? 'structured' : 'text';

    // Mark node as external and start/refresh poller
    ctx.setNodes(prev =>
      prev.map(node =>
        node.id === u.block_id
          ? {
              ...node,
              data: {
                ...node.data,
                storage_class: 'external',
                external_metadata: {
                  ...u.external_metadata,
                  content_type: normalizedContentType,
                },
                isLoading: true,
                isWaitingForFlow: true,
                isExternalStorage: true,
                content: '',
              },
            }
          : node
      )
    );

    ensurePollerStarted(
      { setNodes: ctx.setNodes, resetLoadingUI: ctx.resetLoadingUI },
      u.external_metadata.resource_key,
      u.block_id,
      normalizedContentType
    );
    return;
  }

  // Internal: normalize content to string for UI
  const u = update as BlockUpdateInternal;
  // Prefer explicit type; fallback to runtime inference to be robust
  let contentType: ContentType =
    u.type === 'structured' ? 'structured' : 'text';
  if (!u.type) {
    const value = u.content;
    const isStructured =
      value !== null &&
      typeof value === 'object' &&
      !(typeof (value as any).toISOString === 'function');
    if (isStructured) contentType = 'structured';
  }

  let stringContent: string;
  try {
    if (contentType === 'structured') {
      stringContent =
        typeof u.content === 'string'
          ? u.content
          : JSON.stringify(u.content ?? null, null, 2);
    } else {
      stringContent = String(u.content ?? '');
    }
  } catch (e) {
    stringContent = String(u.content ?? '');
  }

  ctx.setNodes(prev =>
    prev.map(node =>
      node.id === u.block_id
        ? {
            ...node,
            data: {
              ...node.data,
              content: stringContent,
              isLoading: false,
              isWaitingForFlow: false,
              isExternalStorage: false,
              // 将后端的语义类型记录在前端，供渲染层使用
              semantic_type: contentType,
            },
          }
        : node
    )
  );
}

export async function finalizeExternal(
  ctx: BlockApplierContext,
  block_id: string,
  resource_key: string,
  content_type: ContentType = 'text'
) {
  await ensurePollerStoppedAndFinalize(
    { setNodes: ctx.setNodes, resetLoadingUI: ctx.resetLoadingUI },
    resource_key,
    block_id,
    content_type
  );
}
