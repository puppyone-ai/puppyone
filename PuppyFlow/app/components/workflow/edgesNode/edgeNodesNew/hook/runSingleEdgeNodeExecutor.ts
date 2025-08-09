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

// 导入NodeCategory类型定义
type NodeCategory =
  | 'blocknode'
  | 'edgenode'
  | 'servernode'
  | 'groupnode'
  | 'all';

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
  // 修正getAuthHeaders的返回类型为HeadersInit以匹配实际函数
  getAuthHeaders: () => HeadersInit;
}

// 创建新的目标节点
async function createNewTargetNode(
  parentId: string,
  context: RunSingleEdgeNodeContext
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
    measured: {
      width: 240,
      height: 176,
    },
    type: 'text',
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
  console.log(
    `📊 [sendDataToTargets] 找到${targetNodeIdWithLabelGroup.length}个目标节点`
  );

  if (targetNodeIdWithLabelGroup.length === 0) {
    console.log(`❌ [sendDataToTargets] 没有找到目标节点`);
    return;
  }

  // 设置所有目标节点为加载状态
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
    console.log(`🔧 [sendDataToTargets] 开始构建JSON数据`);

    const jsonData = customConstructJsonData
      ? customConstructJsonData()
      : defaultConstructJsonData(parentId, context);

    console.log('JSON Data:', jsonData);

    const response = await fetch(`${backend_IP_address_for_sendingData}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...context.getAuthHeaders(),
      },
      body: JSON.stringify(jsonData),
    });

    if (!response.ok) {
      console.error(`❌ [sendDataToTargets] HTTP请求失败: ${response.status}`);

      targetNodeIdWithLabelGroup.forEach(node => {
        context.reportError(node.id, `HTTP Error: ${response.status}`);
      });
      return;
    }

    const result = await response.json();
    console.log('Backend Response:', result);

    // 流式处理结果
    const streamPromises = await Promise.all(
      targetNodeIdWithLabelGroup.map(node => {
        console.log(`🔄 [sendDataToTargets] 开始流式处理节点: ${node.id}`);
        return context.streamResult(result.task_id, node.id).then(res => {
          console.log(`NODE ${node.id} STREAM COMPLETE:`, res);
          return res;
        });
      })
    );

    console.log(`✅ [sendDataToTargets] 所有节点流式处理完成`);
  } catch (error) {
    console.warn(error);
    window.alert(error);
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

    const targetNodeIdWithLabelGroup =
      context.getTargetNodeIdWithLabel(parentId);
    console.log(
      `📊 [runSingleEdgeNode] 找到${targetNodeIdWithLabelGroup.length}个目标节点`
    );

    if (targetNodeIdWithLabelGroup.length === 0) {
      console.log(`🔧 [runSingleEdgeNode] 没有目标节点，创建新的目标节点`);
      await createNewTargetNode(parentId, context);

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
