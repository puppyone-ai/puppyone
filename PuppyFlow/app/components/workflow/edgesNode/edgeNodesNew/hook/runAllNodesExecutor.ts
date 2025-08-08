// 全局运行所有节点执行函数（对应 useRunAllLogic）

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

// 新增：Manifest Poller 类
class ManifestPoller {
  private poller: NodeJS.Timeout | null = null;
  private knownChunks = new Set<string>();
  private context: RunAllNodesContext;
  private resource_key: string;
  private block_id: string;

  constructor(
    context: RunAllNodesContext,
    resource_key: string,
    block_id: string
  ) {
    this.context = context;
    this.resource_key = resource_key;
    this.block_id = block_id;
  }

  start() {
    console.log(`[ManifestPoller] Starting for ${this.resource_key}`);
    this.context.setNodes(prevNodes =>
      prevNodes.map(node =>
        node.id === this.block_id
          ? {
              ...node,
              data: { ...node.data, content: '', isLoading: true },
            }
          : node
      )
    );
    this.poll();
  }

  private poll() {
    this.poller = setTimeout(async () => {
      await this.fetchManifestAndChunks();
      this.poll();
    }, 1000); // 轮询间隔
  }

  async stop() {
    console.log(`[ManifestPoller] Stopping for ${this.resource_key}`);
    if (this.poller) {
      clearTimeout(this.poller);
      this.poller = null;
    }
    // 最后再拉取一次，确保数据完整
    await this.fetchManifestAndChunks();
    this.context.resetLoadingUI(this.block_id);
  }

  private async fetchManifestAndChunks() {
    try {
      const manifestUrl = await this.getDownloadUrl(
        `${this.resource_key}/manifest.json`
      );
      const manifestResponse = await fetch(manifestUrl);
      if (!manifestResponse.ok) return;

      const manifest = await manifestResponse.json();
      const newChunks = manifest.chunks.filter(
        (chunk: string) => !this.knownChunks.has(chunk)
      );

      for (const chunkKey of newChunks) {
        this.knownChunks.add(chunkKey);
        const chunkUrl = await this.getDownloadUrl(
          `${this.resource_key}/${chunkKey}`
        );
        const chunkResponse = await fetch(chunkUrl);
        const chunkData = await chunkResponse.text();

        this.context.setNodes(prevNodes =>
          prevNodes.map(node =>
            node.id === this.block_id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    content: (node.data?.content || '') + chunkData,
                  },
                }
              : node
          )
        );
      }
    } catch (error) {
      console.error(
        '[ManifestPoller] Error fetching manifest or chunk:',
        error
      );
    }
  }

  private async getDownloadUrl(key: string): Promise<string> {
    // 这里需要一个能获取PuppyStorage下载链接的端点
    // 我们暂时使用一个假设的端点，并传入认证头
    const response = await fetch(
      `${SYSTEM_URLS.PUPPY_STORAGE.BASE}/download/url?key=${encodeURIComponent(key)}`,
      {
        headers: this.context.getAuthHeaders(),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to get download URL for ${key}`);
    }
    const data = await response.json();
    return data.download_url;
  }
}

const pollers = new Map<string, ManifestPoller>();

// 全局运行所有节点执行上下文接口
export interface RunAllNodesContext {
  // React Flow 相关
  getNode: (id: string) => any;
  getNodes: () => any[];
  getEdges: () => any[];
  setNodes: (updater: (nodes: any[]) => any[]) => void;

  // 工具函数
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
  reportError: (nodeId: string, error: string) => void;
  resetLoadingUI: (nodeId: string) => void;
  getAuthHeaders: () => HeadersInit;
}

// 构建包含所有节点的JSON数据
function constructAllNodesJson(
  context: RunAllNodesContext,
  customConstructJsonData?: () => BaseConstructedJsonData
): BaseConstructedJsonData {
  console.log(`🔧 [constructAllNodesJson] 开始构建所有节点的JSON数据`);

  if (customConstructJsonData) {
    return customConstructJsonData();
  }

  try {
    // 获取所有节点和边
    const allNodes = context.getNodes();
    const reactFlowEdges = context.getEdges();

    console.log(
      `📊 [constructAllNodesJson] 所有节点数量: ${allNodes.length}, 边数量: ${reactFlowEdges.length}`
    );

    // 创建blocks对象
    let blocks: { [key: string]: NodeJsonType } = {};
    let edges: { [key: string]: any } = {};

    // 定义哪些节点类型属于 block 节点
    const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

    // 创建构建上下文
    const blockContext: BlockNodeBuilderContext = {
      getNode: context.getNode,
    };

    const edgeContext: EdgeNodeBuilderContext = {
      getNode: context.getNode,
      getSourceNodeIdWithLabel: context.getSourceNodeIdWithLabel,
      getTargetNodeIdWithLabel: context.getTargetNodeIdWithLabel,
    };

    // 处理所有节点
    allNodes.forEach(node => {
      const nodeId = node.id;
      // 确保 nodeLabel 是字符串类型
      const nodeLabel = node.data?.label || nodeId;

      console.log(
        `🔧 [constructAllNodesJson] 处理节点: ${nodeId}, 类型: ${node.type}`
      );

      // 根据节点类型决定如何构建JSON
      if (blockNodeTypes.includes(node.type || '')) {
        console.log(`📦 [constructAllNodesJson] 构建block节点: ${nodeId}`);

        try {
          // 使用区块节点构建函数
          const blockJson = buildBlockNodeJson(nodeId, blockContext);

          // 确保节点标签正确
          blocks[nodeId] = {
            ...blockJson,
            label: String(nodeLabel), // 确保 label 是字符串
          };

          console.log(
            `✅ [constructAllNodesJson] 成功构建block节点: ${nodeId}`
          );
        } catch (e) {
          console.warn(`无法使用blockNodeBuilder构建节点 ${nodeId}:`, e);

          // 回退到默认行为
          blocks[nodeId] = {
            label: String(nodeLabel), // 确保 label 是字符串
            type: node.type || '',
            data: {
              ...node.data,
              // 确保输出节点的内容为 null 而不是空字符串
              content:
                node.data?.content !== undefined &&
                node.data?.content !== null &&
                node.data?.content !== ''
                  ? node.data.content
                  : null,
            } as BasicNodeData,
          };
        }
      } else {
        console.log(`🔗 [constructAllNodesJson] 构建edge节点: ${nodeId}`);

        // 非 block 节点 (edge节点)
        try {
          // 构建边的JSON并添加到edges对象中
          const edgeJson = buildEdgeNodeJson(nodeId, edgeContext);
          edges[nodeId] = edgeJson;

          console.log(`✅ [constructAllNodesJson] 成功构建edge节点: ${nodeId}`);
        } catch (e) {
          console.warn(`无法构建边节点 ${nodeId} 的JSON:`, e);
        }
      }
    });

    console.log(
      `🚀 [constructAllNodesJson] 构建完成 - blocks: ${Object.keys(blocks).length}, edges: ${Object.keys(edges).length}`
    );

    return {
      blocks,
      edges,
    };
  } catch (error) {
    console.error(`构建全节点 JSON 时出错: ${error}`);

    // 如果出错，返回空结构
    return {
      blocks: {},
      edges: {},
    };
  }
}

// 发送数据到目标节点
// 注意：节点执行顺序由后端 PuppyEngine 根据工作流的依赖关系自动处理
// 前端通过 SSE 事件流实时接收节点更新，保证前一个节点的输出成为后一个节点的输入
async function sendDataToTargets(
  context: RunAllNodesContext,
  customConstructJsonData?: () => BaseConstructedJsonData
): Promise<void> {
  console.log(`🚀 [sendDataToTargets] 开始发送数据到目标节点`);

  // 获取所有节点
  const allNodes = context.getNodes();
  console.log(`📊 [sendDataToTargets] 获取所有节点数量: ${allNodes.length}`);

  if (allNodes.length === 0) {
    console.log(`❌ [sendDataToTargets] 没有节点，直接返回`);
    return;
  }

  // 仅设置结果节点（text、structured类型）为加载状态，排除输入节点
  const resultNodes = allNodes.filter(
    node =>
      (node.type === 'text' || node.type === 'structured') &&
      !node.data.isInput &&
      !node.data.locked
  );
  console.log(
    `📊 [sendDataToTargets] 找到${resultNodes.length}个结果节点需要设置为加载状态`
  );

  context.setNodes(prevNodes =>
    prevNodes.map(node => {
      // 检查是否为结果类型节点且不是输入节点
      if (
        (node.type === 'text' || node.type === 'structured') &&
        !node.data.isInput &&
        !node.data.locked
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
    console.log(`🔧 [sendDataToTargets] 开始构建JSON数据`);

    // 优先使用自定义的 JSON 构建函数，如果没有则使用默认的
    const jsonData = constructAllNodesJson(context, customConstructJsonData);
    console.log('发送到后端的 JSON 数据:', jsonData);

    // 🔍 诊断：检查依赖关系
    console.log('🔍 [诊断] 工作流依赖关系分析:');
    Object.entries(jsonData.edges).forEach(([edgeId, edgeData]) => {
      console.log(`🔗 Edge ${edgeId}:`);
      console.log(`  - 类型: ${(edgeData as any).type}`);
      console.log(
        `  - 输入: ${JSON.stringify((edgeData as any).data?.inputs || {})}`
      );
      console.log(
        `  - 输出: ${JSON.stringify((edgeData as any).data?.outputs || {})}`
      );
    });

    // 🔍 诊断：检查块内容状态
    console.log('🔍 [诊断] 块内容状态分析:');
    Object.entries(jsonData.blocks).forEach(([blockId, blockData]) => {
      const content = (blockData as any).data?.content;
      const contentStatus =
        content === null
          ? 'null (未处理)'
          : content === ''
            ? '空字符串 (可能被标记为已处理)'
            : content === undefined
              ? 'undefined (未处理)'
              : '有内容 (已处理)';
      console.log(`📦 Block ${blockId}: ${contentStatus}`);
    });

    // 检查是否存在依赖链
    const inputToEdgeMap = new Map<string, string>();
    const outputToEdgeMap = new Map<string, string>();

    Object.entries(jsonData.edges).forEach(([edgeId, edgeData]) => {
      const inputs = (edgeData as any).data?.inputs || {};
      const outputs = (edgeData as any).data?.outputs || {};

      Object.keys(inputs).forEach(inputId => {
        inputToEdgeMap.set(inputId, edgeId);
      });

      Object.keys(outputs).forEach(outputId => {
        outputToEdgeMap.set(outputId, edgeId);
      });
    });

    console.log('🔍 [诊断] 依赖链检查:');
    Object.entries(jsonData.edges).forEach(([edgeId, edgeData]) => {
      const inputs = (edgeData as any).data?.inputs || {};
      const hasUpstreamDependency = Object.keys(inputs).some(
        inputId =>
          outputToEdgeMap.has(inputId) &&
          outputToEdgeMap.get(inputId) !== edgeId
      );

      if (hasUpstreamDependency) {
        console.log(`✅ Edge ${edgeId} 有上游依赖`);
        Object.keys(inputs).forEach(inputId => {
          const upstreamEdge = outputToEdgeMap.get(inputId);
          if (upstreamEdge && upstreamEdge !== edgeId) {
            console.log(`  - 输入 ${inputId} 来自 Edge ${upstreamEdge}`);
          }
        });
      } else {
        console.log(`⚠️ Edge ${edgeId} 没有上游依赖（可能是起始节点）`);
      }
    });

    console.log(`🌐 [sendDataToTargets] 开始发送HTTP请求`);

    const response = await fetch(`${SYSTEM_URLS.PUPPY_ENGINE.BASE}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...context.getAuthHeaders(),
      },
      body: JSON.stringify(jsonData),
    });

    if (!response.ok) {
      console.error(`❌ [sendDataToTargets] HTTP请求失败: ${response.status}`);

      // 只向结果节点报告错误
      allNodes
        .filter(node => node.type === 'text' || node.type === 'structured')
        .forEach(node => {
          context.reportError(node.id, `HTTP Error: ${response.status}`);
        });
      return;
    }

    const result = await response.json();
    console.log('从后端接收到的响应:', result);

    // 处理后端返回的数据并更新节点
    if (result && result.task_id) {
      console.log(
        `🔄 [sendDataToTargets] 开始流式处理，task_id: ${result.task_id}`
      );

      const taskId = result.task_id;

      // 建立 SSE 连接
      const streamResponse = await fetch(
        `${SYSTEM_URLS.PUPPY_ENGINE.BASE}/task/${taskId}/stream`,
        {
          headers: context.getAuthHeaders(),
        }
      );

      if (!streamResponse.body) {
        console.error(`❌ [sendDataToTargets] 流式响应没有body`);
        return;
      }

      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let lineCount = 0;
      let eventCount = 0;

      // 筛选出所有结果类型节点
      const resultNodes = allNodes.filter(
        node =>
          (node.type === 'text' || node.type === 'structured') &&
          !node.data.isInput &&
          !node.data.locked
      );

      console.log(
        `📊 [sendDataToTargets] 准备流式处理${resultNodes.length}个结果节点`
      );

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
              // 重要：这些事件按照后端 PuppyEngine 的执行顺序实时推送
              // 后端会根据节点间的依赖关系确保正确的执行顺序
              switch (event_type) {
                case 'TASK_STARTED':
                  if (data?.task_id) {
                    console.log(`🚀 [runAllNodes] 任务开始: ${data.task_id}`);
                    // 设置所有结果节点为初始等待状态
                    resultNodes.forEach(node => {
                      context.setNodes(prevNodes =>
                        prevNodes.map(n =>
                          n.id === node.id
                            ? {
                                ...n,
                                data: {
                                  ...n.data,
                                  isLoading: true,
                                  isWaitingForFlow: true,
                                },
                              }
                            : n
                        )
                      );
                    });
                  }
                  break;
                case 'EDGE_STARTED':
                  if (data?.edge_id && data?.edge_type) {
                    console.log(
                      `🔧 [runAllNodes] Edge开始: ${data.edge_id} (${data.edge_type})`
                    );
                    // 后端按依赖关系顺序执行边，前端只需响应事件
                  }
                  break;
                case 'STREAM_STARTED':
                  if (data?.resource_key && data?.block_id) {
                    console.log(
                      `📥 [runAllNodes] 流式传输开始: ${data.resource_key} -> ${data.block_id}`
                    );

                    // 为指定的block_id创建poller
                    const pollerKey = `${data.resource_key}_${data.block_id}`;
                    if (!pollers.has(pollerKey)) {
                      const poller = new ManifestPoller(
                        context,
                        data.resource_key,
                        data.block_id
                      );
                      pollers.set(pollerKey, poller);
                      poller.start();
                    }

                    // 设置该节点为等待状态
                    context.setNodes(prevNodes =>
                      prevNodes.map(node =>
                        node.id === data.block_id
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
                  }
                  break;
                case 'STREAM_ENDED':
                  if (data?.resource_key && data?.block_id) {
                    console.log(
                      `📤 [runAllNodes] 流式传输结束: ${data.resource_key} -> ${data.block_id}`
                    );

                    // 停止对应的poller
                    const pollerKey = `${data.resource_key}_${data.block_id}`;
                    if (pollers.has(pollerKey)) {
                      await pollers.get(pollerKey)?.stop();
                      pollers.delete(pollerKey);
                    }
                  }
                  break;
                case 'EDGE_COMPLETED':
                  if (data?.edge_id && data?.output_blocks) {
                    console.log(
                      `✅ [runAllNodes] Edge完成: ${data.edge_id}, 输出块: ${data.output_blocks.join(', ')}`
                    );

                    // 为输出块设置初始加载状态
                    // 这些输出块的内容将通过后续的 BLOCK_UPDATED 事件更新
                    // 从而保证了数据流的顺序：前一个节点完成 -> 输出更新 -> 后一个节点接收输入
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
                      `📊 [runAllNodes] 进度更新: ${completion_percentage}% - Edges: ${edges.completed}/${edges.total}, Blocks: ${blocks.processed}/${blocks.total}`
                    );

                    // 如果进度达到100%，可以在这里添加一些UI反馈
                    if (completion_percentage === 100) {
                      console.log('🎉 [runAllNodes] 任务进度完成!');
                    }
                  }
                  break;
                case 'BATCH_COMPLETED':
                  if (data?.edge_ids && data?.output_blocks) {
                    console.log(
                      `🎯 [runAllNodes] 批处理完成: Edges: ${data.edge_ids.join(', ')}, 输出块: ${data.output_blocks.join(', ')}`
                    );
                  }
                  break;
                case 'BLOCK_UPDATED':
                  try {
                    // 验证数据完整性
                    if (!data) {
                      console.error(
                        '❌ [runAllNodes] BLOCK_UPDATED: data is null or undefined'
                      );
                      break;
                    }

                    if (!data.block_id) {
                      console.error(
                        '❌ [runAllNodes] BLOCK_UPDATED: block_id is missing',
                        data
                      );
                      break;
                    }

                    if (data.content === undefined) {
                      console.error(
                        '❌ [runAllNodes] BLOCK_UPDATED: content is undefined',
                        data
                      );
                      break;
                    }

                    // 获取当前节点状态
                    const currentNode = context.getNode(data.block_id);
                    if (!currentNode) {
                      console.error(
                        `❌ [runAllNodes] BLOCK_UPDATED: Node ${data.block_id} not found in React Flow`
                      );
                      break;
                    }

                    console.log(
                      `📝 [runAllNodes] 更新节点内容: ${data.block_id}`
                    );

                    // 更新节点内容并设置加载状态为false
                    // 这是关键的数据流传递点：当一个节点的内容被更新时，
                    // 它可能成为下游节点的输入，后端会按依赖顺序处理这些更新
                    context.setNodes(prevNodes => {
                      const updatedNodes = prevNodes.map(node => {
                        if (node.id === data.block_id) {
                          return {
                            ...node,
                            data: {
                              ...node.data,
                              content: data.content,
                              isLoading: false,
                              isWaitingForFlow: false,
                            },
                          };
                        }
                        return node;
                      });

                      // 验证更新是否成功
                      const updatedNode = updatedNodes.find(
                        n => n.id === data.block_id
                      );
                      if (!updatedNode) {
                        console.error(
                          `❌ [runAllNodes] BLOCK_UPDATED: Failed to find updated node ${data.block_id}`
                        );
                      }

                      return updatedNodes;
                    });
                  } catch (error) {
                    console.error(
                      '❌ [runAllNodes] BLOCK_UPDATED: Error processing event:',
                      error
                    );
                    console.error(
                      '❌ [runAllNodes] BLOCK_UPDATED: Error details:',
                      {
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                        stack:
                          error instanceof Error
                            ? error.stack
                            : 'No stack trace',
                        data: data,
                      }
                    );
                  }
                  break;
                case 'TASK_FAILED':
                  if (data?.error_message) {
                    console.error(
                      `❌ [runAllNodes] 任务失败: ${data.error_message}`
                    );

                    resultNodes.forEach(node => {
                      context.reportError(node.id, data.error_message);

                      // 重置节点的加载状态
                      context.setNodes(prevNodes =>
                        prevNodes.map(n =>
                          n.id === node.id
                            ? {
                                ...n,
                                data: {
                                  ...n.data,
                                  isLoading: false,
                                  isWaitingForFlow: false,
                                },
                              }
                            : n
                        )
                      );
                    });

                    // 清理所有 pollers
                    pollers.forEach(async (poller, key) => {
                      await poller.stop();
                    });
                    pollers.clear();
                  }
                  break;
                case 'TASK_COMPLETED':
                  console.log(`🎉 [runAllNodes] 任务完成!`);

                  // 清理所有 pollers
                  pollers.forEach(async (poller, key) => {
                    await poller.stop();
                  });
                  pollers.clear();

                  // 确保所有结果节点的加载状态被重置
                  resultNodes.forEach(node => {
                    context.setNodes(prevNodes =>
                      prevNodes.map(n =>
                        n.id === node.id
                          ? {
                              ...n,
                              data: {
                                ...n.data,
                                isLoading: false,
                                isWaitingForFlow: false,
                              },
                            }
                          : n
                      )
                    );
                  });

                  break;
              }
            } catch (error) {
              console.error(
                '❌ [runAllNodes] Error processing SSE event:',
                error
              );
              console.error('❌ [runAllNodes] Problematic line:', line);
              console.error('❌ [runAllNodes] Error details:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : 'No stack trace',
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('处理API响应时出错:', error);
    window.alert(error);
  } finally {
    console.log(`🔄 [sendDataToTargets] 开始重置加载UI`);

    // 只重置非输入的结果节点的加载UI
    const nodesToReset = allNodes.filter(
      node =>
        (node.type === 'text' || node.type === 'structured') &&
        !node.data.isInput
    );

    console.log(
      `📊 [sendDataToTargets] 重置${nodesToReset.length}个节点的加载UI`
    );

    nodesToReset.forEach(node => {
      context.resetLoadingUI(node.id);
    });
  }
}

// 主执行函数
export async function runAllNodes({
  context,
  constructJsonData,
  onComplete,
  onStart,
}: {
  context: RunAllNodesContext;
  constructJsonData?: () => BaseConstructedJsonData;
  onComplete?: () => void;
  onStart?: () => void;
}): Promise<void> {
  console.log(`🚀 [runAllNodes] 开始执行全局运行`);

  try {
    // 清空所有状态
    context.clearAll();

    // 添加开始回调
    if (onStart) {
      console.log(`🔄 [runAllNodes] 调用onStart回调`);
      onStart();
    }

    // 发送数据到后端
    await sendDataToTargets(context, constructJsonData);

    // 添加完成回调
    if (onComplete) {
      console.log(`🔄 [runAllNodes] 调用onComplete回调`);
      onComplete();
    }
  } catch (error) {
    console.error('Error executing runAllNodes:', error);
    throw error;
  }
}
