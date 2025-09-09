// 主执行函数（对应 useRunSingleEdgeNodeLogicNew）

import { nanoid } from 'nanoid';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import {
  backend_IP_address_for_sendingData,
  BasicNodeData,
  NodeJsonType,
} from '../../../../hooks/useJsonConstructUtils';
import { BaseConstructedJsonData } from './hookhistory/useEdgeNodeBackEndJsonBuilder';
import {
  buildBlockNodeJson,
  BlockNodeBuilderContext,
} from './blockNodeJsonBuilders';
import {
  buildEdgeNodeJson,
  EdgeNodeBuilderContext,
} from './edgeNodeJsonBuilders';
import { SYSTEM_URLS } from '@/config/urls';
import { syncBlockContent } from '../../../../../components/workflow/utils/externalStorage';
import { applyBlockUpdate, finalizeExternal } from '../../../blockNode/utils/blockUpdateApplier';
import { ensurePollerStarted, stopAllPollers } from '../../../blockNode/utils/manifestPoller';

// 导入NodeCategory类型定义
type NodeCategory =
  | 'blocknode'
  | 'edgenode'
  | 'servernode'
  | 'groupnode'
  | 'all';

// 新增：SSE 事件类型定义
interface ServerSentEvent {
  event_type: string;
  task_id: string;
  timestamp: string;
  data?: any; // 可选，因为BLOCK_UPDATED事件的数据在根级别
}

// External polling handled by shared block-side utils

// 执行上下文接口
export interface RunSingleEdgeNodeContext {
  // React Flow 相关
  getNode: (id: string) => any;
  setNodes: (updater: (nodes: any[]) => any[]) => void;
  setEdges: (updater: (edges: any[]) => any[]) => void;

  // 工具函数 - 修正类型定义以匹配useGetSourceTarget
  getSourceNodeIdWithLabel: (
    parentId: string,
    category?: NodeCategory
  ) => { id: string; label: string }[];
  getTargetNodeIdWithLabel: (
    parentId: string,
    category?: NodeCategory
  ) => { id: string; label: string }[];
  clearAll: () => void;

  // 通信相关
  streamResult: (taskId: string, nodeId: string) => Promise<any>;
  reportError: (nodeId: string, error: string) => void;
  resetLoadingUI: (nodeId: string) => void;
  // 🔒 认证通过服务端代理处理（不需要从前端传入）
  isLocalDeployment?: boolean;
}

// Pre-run sync for involved block nodes (sources and targets) without requiring global getNodes
async function preRunSyncInvolvedNodes(
  parentId: string,
  context: RunSingleEdgeNodeContext
): Promise<void> {
  try {
    const sources =
      context.getSourceNodeIdWithLabel(parentId, 'blocknode') || [];
    const targets =
      context.getTargetNodeIdWithLabel(parentId, 'blocknode') || [];
    const ids = Array.from(
      new Set<string>([...sources.map(s => s.id), ...targets.map(t => t.id)])
    );

    for (const id of ids) {
      const node = context.getNode(id);
      if (!node) continue;
      const type = node.type || '';
      if (type !== 'text' && type !== 'structured') continue;
      const data = node.data || {};
      const storageClass = data.storage_class || 'internal';
      const isExternal = storageClass === 'external';
      const isDirty = !!data.dirty;
      // 核心原则：仅当 external 且 dirty=true 时进行运行前同步
      if (!(isExternal && isDirty)) continue;

      const contentStr =
        type === 'structured'
          ? typeof data.content === 'string'
            ? data.content
            : JSON.stringify(data.content ?? [])
          : String(data.content ?? '');
      const contentType = type === 'structured' ? 'structured' : 'text';

      // set saving
      context.setNodes(prev =>
        prev.map(n =>
          n.id === id
            ? { ...n, data: { ...n.data, savingStatus: 'saving' } }
            : n
        )
      );

      try {
        await syncBlockContent({
          node,
          content: contentStr,
          getUserId: async () => 'auto',
          setNodes: context.setNodes,
          contentType,
        });
      } catch (e) {
        context.setNodes(prev =>
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
    }
  } catch {
    console.error('preRunSyncInvolvedNodes error');
  }
}

// 创建新的目标节点
async function createNewTargetNode(
  parentId: string,
  context: RunSingleEdgeNodeContext,
  targetNodeType: string = 'text'
): Promise<void> {
  console.log(
    `🔧 [createNewTargetNode] 开始创建新的目标节点 - parentId: ${parentId}`
  );

  const parentEdgeNode = context.getNode(parentId);
  if (!parentEdgeNode) {
    console.error(`❌ [createNewTargetNode] 找不到父节点: ${parentId}`);
    return;
  }

  const newTargetId = nanoid(6);
  console.log(`🔧 [createNewTargetNode] 生成新节点ID: ${newTargetId}`);

  const location = {
    x: parentEdgeNode.position.x + 160,
    y: parentEdgeNode.position.y - 64,
  };

  const newNode = {
    id: newTargetId,
    position: location,
    data: {
      content: '',
      label: newTargetId,
      isLoading: true,
      locked: false,
      isInput: false,
      isOutput: true,
      editable: false,
    },
    width: 240,
    height: 176,
    type: targetNodeType,
  };

  const newEdge = {
    id: `connection-${Date.now()}`,
    source: parentId,
    target: newTargetId,
    type: 'floating',
    data: {
      connectionType: 'CTT',
    },
    markerEnd: markerEnd,
  };

  await Promise.all([
    new Promise(resolve => {
      context.setNodes(prevNodes => {
        resolve(null);
        return [...prevNodes, newNode];
      });
    }),
    new Promise(resolve => {
      context.setEdges(prevEdges => {
        resolve(null);
        return [...prevEdges, newEdge];
      });
    }),
  ]);

  // 更新父节点引用
  context.setNodes(prevNodes =>
    prevNodes.map(node => {
      if (node.id === parentId) {
        return { ...node, data: { ...node.data, resultNode: newTargetId } };
      }
      return node;
    })
  );

  console.log(`✅ [createNewTargetNode] 成功创建新的目标节点: ${newTargetId}`);
}

// 发送数据到目标节点
async function sendDataToTargets(
  parentId: string,
  context: RunSingleEdgeNodeContext,
  customConstructJsonData?: () => BaseConstructedJsonData
): Promise<void> {
  console.log(
    `🚀 [sendDataToTargets] 开始发送数据到目标节点 - parentId: ${parentId}`
  );

  const targetNodeIdWithLabelGroup = context.getTargetNodeIdWithLabel(parentId);

  context.setNodes(prevNodes =>
    prevNodes.map(node => {
      if (
        targetNodeIdWithLabelGroup.some(targetNode => targetNode.id === node.id)
      ) {
        return {
          ...node,
          data: { ...node.data, content: '', isLoading: true },
        };
      }
      return node;
    })
  );

  try {
    const jsonData = customConstructJsonData
      ? customConstructJsonData()
      : defaultConstructJsonData(parentId, context);

    const response = await fetch(`/api/engine/task`, {
      method: 'POST',
      credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonData),
    });

    if (!response.ok) {
      targetNodeIdWithLabelGroup.forEach(node => {
        context.reportError(node.id, `HTTP Error: ${response.status}`);
      });
      return;
    }

    const result = await response.json();
    const taskId = result.task_id;

    const streamResponse = await fetch(`/api/engine/task/${taskId}/stream`, {
      credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
    });

    if (!streamResponse.body) {
      console.error(`❌ [sendDataToTargets] 流式响应没有body`);
      return;
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let lineCount = 0;
    let eventCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last partial line in buffer

      lineCount += lines.length;

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          eventCount++;
          try {
            const eventData = JSON.parse(line.slice(6));
            const { event_type } = eventData as ServerSentEvent;

            // 对于BLOCK_UPDATED事件，数据直接在根级别，而不是在data字段中
            const data =
              event_type === 'BLOCK_UPDATED' ? eventData : eventData.data;

            // 处理不同类型的事件
            switch (event_type) {
              case 'TASK_STARTED':
                if (data?.task_id) {
                  // 设置所有目标节点为初始等待状态
                  targetNodeIdWithLabelGroup.forEach(targetNode => {
                    context.setNodes(prevNodes =>
                      prevNodes.map(node =>
                        node.id === targetNode.id
                          ? {
                              ...node,
                              data: {
                                ...node.data,
                                isLoading: true,
                                isWaitingForFlow: true,
                              },
                            }
                          : node
                      )
                    );
                  });
                }
                break;
              case 'EDGE_STARTED':
                if (data?.edge_id && data?.edge_type) {
                }
                break;
              case 'STREAM_STARTED':
                if (data?.block_id && data?.resource_key) {
                  const normalizedContentType =
                    data?.content_type === 'structured' ? 'structured' : 'text';
                  // 启动外部内容轮询，标记节点状态
                  targetNodeIdWithLabelGroup.forEach(targetNode => {
                    ensurePollerStarted(
                      { setNodes: context.setNodes, resetLoadingUI: context.resetLoadingUI },
                      data.resource_key,
                      targetNode.id,
                      normalizedContentType
                    );
                  });
                }
                break;
              case 'STREAM_ENDED':
                if (data?.block_id && data?.resource_key) {
                  // 完成所有目标节点的外部内容拉取并最终写回
                  for (const targetNode of targetNodeIdWithLabelGroup) {
                    await finalizeExternal(
                      { setNodes: context.setNodes, resetLoadingUI: context.resetLoadingUI },
                      targetNode.id,
                      data.resource_key
                    );
                  }
                }
                break;
              case 'EDGE_COMPLETED':
                if (data?.edge_id && data?.output_blocks) {
                  // 为输出块设置初始加载状态
                  data.output_blocks.forEach((blockId: string) => {
                    context.setNodes(prevNodes =>
                      prevNodes.map(node =>
                        node.id === blockId
                          ? {
                              ...node,
                              data: {
                                ...node.data,
                                isLoading: true,
                                isWaitingForFlow: true,
                              },
                            }
                          : node
                      )
                    );
                  });
                }
                break;
              case 'PROGRESS_UPDATE':
                if (data?.progress) {
                  const { edges, blocks, completion_percentage } =
                    data.progress;
                  console.log(
                    `📊 Progress: ${completion_percentage}% - Edges: ${edges.completed}/${edges.total}, Blocks: ${blocks.processed}/${blocks.total}`
                  );

                  // 如果进度达到100%，可以在这里添加一些UI反馈
                  if (completion_percentage === 100) {
                    console.log('🎉 Task progress completed!');
                  }
                }
                break;
              case 'BATCH_COMPLETED':
                if (data?.edge_ids && data?.output_blocks) {
                }
                break;
              case 'BLOCK_UPDATED':
                try {
                  // 验证数据完整性
                  if (!data) {
                    console.error(
                      '❌ BLOCK_UPDATED: data is null or undefined'
                    );
                    break;
                  }

                  if (!data.block_id) {
                    console.error(
                      '❌ BLOCK_UPDATED: block_id is missing',
                      data
                    );
                    break;
                  }

                  // 获取当前节点状态
                  const currentNode = context.getNode(data.block_id);
                  if (!currentNode) {
                    console.error(
                      `❌ BLOCK_UPDATED: Node ${data.block_id} not found in React Flow`
                    );
                    break;
                  }

                  // 检查是否为external存储模式
                  const isExternalStorage =
                    data.storage_class === 'external' || data.external_metadata !== undefined;

                  if (isExternalStorage) {
                    // 交给 block 适配层处理 external 指针并启动轮询
                    applyBlockUpdate(
                      { setNodes: context.setNodes, resetLoadingUI: context.resetLoadingUI },
                      {
                        block_id: data.block_id,
                        storage_class: 'external',
                        external_metadata: data.external_metadata,
                      } as any
                    );
                  } else {
                    if (data.content === undefined) {
                      console.error(
                        '❌ BLOCK_UPDATED: content is undefined for internal storage',
                        data
                      );
                      break;
                    }
                    // 交给 block 适配层做类型归一（对象/数组→字符串）
                    applyBlockUpdate(
                      { setNodes: context.setNodes, resetLoadingUI: context.resetLoadingUI },
                      {
                        block_id: data.block_id,
                        storage_class: 'internal',
                        type: data.type,
                        content: data.content,
                      } as any
                    );
                  }
                } catch (error) {
                  console.error(
                    '❌ BLOCK_UPDATED: Error processing event:',
                    error
                  );
                  console.error('❌ BLOCK_UPDATED: Error details:', {
                    error:
                      error instanceof Error ? error.message : String(error),
                    stack:
                      error instanceof Error ? error.stack : 'No stack trace',
                    data: data,
                  });
                }
                break;
                case 'TASK_FAILED':
                if (data?.error_message) {
                  targetNodeIdWithLabelGroup.forEach(targetNode => {
                    context.reportError(targetNode.id, data.error_message);

                    // 重置节点的加载状态
                    context.setNodes(prevNodes =>
                      prevNodes.map(node =>
                        node.id === targetNode.id
                          ? {
                              ...node,
                              data: {
                                ...node.data,
                                isLoading: false,
                                isWaitingForFlow: false,
                              },
                            }
                          : node
                      )
                    );
                  });

                  // 统一清理所有共享轮询器
                  await stopAllPollers();
                }
                break;
              case 'TASK_COMPLETED':
                // 统一清理所有共享轮询器
                await stopAllPollers();

                // 确保所有目标节点的加载状态被重置
                targetNodeIdWithLabelGroup.forEach(targetNode => {
                  context.setNodes(prevNodes =>
                    prevNodes.map(node =>
                      node.id === targetNode.id
                        ? {
                            ...node,
                            data: {
                              ...node.data,
                              isLoading: false,
                              isWaitingForFlow: false,
                            },
                          }
                        : node
                    )
                  );
                });

                break;
            }
          } catch (error) {
            console.error('❌ Error processing SSE event:', error);
            console.error('❌ Problematic line:', line);
            console.error('❌ Error details:', {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : 'No stack trace',
            });
          }
        }
      }
    }
  } catch (error) {
    console.warn(error);
  } finally {
    targetNodeIdWithLabelGroup.forEach(node => {
      context.resetLoadingUI(node.id);
    });
  }
}

// 默认构建 JSON 数据
function defaultConstructJsonData(
  parentId: string,
  context: RunSingleEdgeNodeContext
): BaseConstructedJsonData {
  console.log(
    `🔧 [defaultConstructJsonData] 开始构建默认JSON数据 - parentId: ${parentId}`
  );

  const sourceNodeIdWithLabelGroup = context.getSourceNodeIdWithLabel(
    parentId,
    'blocknode'
  );
  const targetNodeIdWithLabelGroup = context.getTargetNodeIdWithLabel(
    parentId,
    'blocknode'
  );

  console.log(
    `📊 [defaultConstructJsonData] 源节点数: ${sourceNodeIdWithLabelGroup.length}, 目标节点数: ${targetNodeIdWithLabelGroup.length}`
  );

  try {
    let blocks: { [key: string]: NodeJsonType } = {};

    // 创建 BlockNode 构建上下文
    const blockContext: BlockNodeBuilderContext = {
      getNode: context.getNode,
    };

    // 创建 EdgeNode 构建上下文 - 修正类型定义
    const edgeContext: EdgeNodeBuilderContext = {
      getNode: context.getNode,
      getSourceNodeIdWithLabel: context.getSourceNodeIdWithLabel,
      getTargetNodeIdWithLabel: context.getTargetNodeIdWithLabel,
    };

    // 添加源节点信息
    sourceNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
      console.log(`🔧 [defaultConstructJsonData] 处理源节点: ${nodeId}`);

      try {
        const blockJson = buildBlockNodeJson(nodeId, blockContext);
        blocks[nodeId] = {
          ...blockJson,
          label: nodeLabel,
        };
      } catch (e) {
        console.warn(`无法构建节点 ${nodeId}:`, e);
        blocks[nodeId] = {
          label: nodeLabel,
          type: context.getNode(nodeId)?.type as string,
          data: context.getNode(nodeId)?.data as any,
        };
      }
    });

    // 添加目标节点信息
    targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
      console.log(`🔧 [defaultConstructJsonData] 处理目标节点: ${nodeId}`);

      const nodeType = context.getNode(nodeId)?.type as string;

      blocks[nodeId] = {
        label: nodeLabel,
        type: nodeType,
        data: { content: '' },
      };
    });

    // 构建边的JSON
    const edgeJson = buildEdgeNodeJson(parentId, edgeContext);

    return {
      blocks,
      edges: { [parentId]: edgeJson },
    };
  } catch (error) {
    console.error(`构建节点 JSON 时出错: ${error}`);

    return {
      blocks: {
        ...Object.fromEntries(
          sourceNodeIdWithLabelGroup.map(({ id, label }) => [
            id,
            {
              label,
              type: context.getNode(id)?.type as string,
              data: context.getNode(id)?.data as BasicNodeData,
            },
          ])
        ),
        ...Object.fromEntries(
          targetNodeIdWithLabelGroup.map(({ id, label }) => [
            id,
            {
              label,
              type: 'text',
              data: { content: '' },
            },
          ])
        ),
      },
      edges: {},
    };
  }
}

// 主执行函数
export async function runSingleEdgeNode({
  parentId,
  targetNodeType = 'text',
  context,
  constructJsonData,
}: {
  parentId: string;
  targetNodeType?: string;
  context: RunSingleEdgeNodeContext;
  constructJsonData?: () => BaseConstructedJsonData;
}): Promise<void> {
  console.log(`🚀 [runSingleEdgeNode] 开始执行 - parentId: ${parentId}`);

  try {
    context.clearAll();

    // 运行前同步当前边涉及的 block 节点（只依赖 source/target 列表与 getNode）
    await preRunSyncInvolvedNodes(parentId, context);

    const targetNodeIdWithLabelGroup =
      context.getTargetNodeIdWithLabel(parentId);
    console.log(
      `📊 [runSingleEdgeNode] 找到${targetNodeIdWithLabelGroup.length}个目标节点`
    );

    if (targetNodeIdWithLabelGroup.length === 0) {
      console.log(
        `🔧 [runSingleEdgeNode] 没有目标节点，创建新的目标节点，类型: ${targetNodeType}`
      );
      await createNewTargetNode(parentId, context, targetNodeType);

      // 创建完新目标节点后，发送数据到新创建的目标节点
      console.log(`🚀 [runSingleEdgeNode] 新目标节点创建完成，开始发送数据`);
      await sendDataToTargets(parentId, context, constructJsonData);
    } else {
      console.log(`🚀 [runSingleEdgeNode] 有目标节点，直接发送数据`);
      await sendDataToTargets(parentId, context, constructJsonData);
    }
  } catch (error) {
    console.error('Error executing single edge node:', error);
    throw error;
  }
}
