import { useState, useEffect, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, {
  backend_IP_address_for_sendingData,
  BasicNodeData,
  NodeJsonType,
} from '../../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../../states/NodesPerFlowContext';
import { useAppSettings } from '../../../../../states/AppSettingsContext';
import { markerEnd } from '../../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import {
  useEdgeNodeBackEndJsonBuilder,
  EdgeNodeType,
  BaseConstructedJsonData,
} from './useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from './useBlockNodeBackEndJsonBuilder';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';

// Hook 返回值类型
export interface BaseEdgeNodeLogicReturn {
  isLoading: boolean;
  handleDataSubmit: (...args: any[]) => Promise<void>;
}

export function useBaseEdgeNodeLogic({
  parentId,
  targetNodeType,
  constructJsonData: customConstructJsonData,
}: {
  parentId: string;
  targetNodeType: string;
  constructJsonData?: () => BaseConstructedJsonData;
}): BaseEdgeNodeLogicReturn {
  console.log(
    `🔄 [useBaseEdgeNodeLogic - SingleEdge] Hook初始化 - parentId: ${parentId}, targetNodeType: ${targetNodeType}`
  );

  // Basic hooks
  const { getNode, setNodes, setEdges } = useReactFlow();
  const { streamResult, reportError, resetLoadingUI } = useJsonConstructUtils();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();
  const { clearAll } = useNodesPerFlowContext();
  const { getAuthHeaders } = useAppSettings();

  // Add hooks for JSON building
  const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
  const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

  // State management
  const [isLoading, setIsLoading] = useState(false);

  // 创建新的目标节点
  const createNewTargetNode = async () => {
    console.log(
      `🔧 [SingleEdge - createNewTargetNode] 开始创建新的目标节点 - parentId: ${parentId}`
    );

    const parentEdgeNode = getNode(parentId);
    if (!parentEdgeNode) {
      console.error(
        `❌ [SingleEdge - createNewTargetNode] 找不到父节点: ${parentId}`
      );
      return;
    }

    const newTargetId = nanoid(6);
    console.log(
      `🔧 [SingleEdge - createNewTargetNode] 生成新节点ID: ${newTargetId}`
    );

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

    console.log(
      `🔧 [SingleEdge - createNewTargetNode] 创建新节点和边，准备添加到画布`
    );

    await Promise.all([
      new Promise(resolve => {
        setNodes(prevNodes => {
          console.log(
            `📊 [SingleEdge - createNewTargetNode] 添加节点到画布，当前节点数: ${prevNodes.length}`
          );
          resolve(null);
          return [...prevNodes, newNode];
        });
      }),
      new Promise(resolve => {
        setEdges(prevEdges => {
          console.log(
            `📊 [SingleEdge - createNewTargetNode] 添加边到画布，当前边数: ${prevEdges.length}`
          );
          resolve(null);
          return [...prevEdges, newEdge];
        });
      }),
    ]);

    // 更新父节点引用
    console.log(`🔧 [SingleEdge - createNewTargetNode] 更新父节点引用`);
    setNodes(prevNodes =>
      prevNodes.map(node => {
        if (node.id === parentId) {
          return { ...node, data: { ...node.data, resultNode: newTargetId } };
        }
        return node;
      })
    );

    console.log(
      `✅ [SingleEdge - createNewTargetNode] 成功创建新的目标节点: ${newTargetId}`
    );
  };

  // 发送数据到目标节点
  const sendDataToTargets = async () => {
    console.log(
      `🚀 [SingleEdge - sendDataToTargets] 开始发送数据到目标节点 - parentId: ${parentId}`
    );

    const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
    console.log(
      `📊 [SingleEdge - sendDataToTargets] 找到${targetNodeIdWithLabelGroup.length}个目标节点`
    );

    if (targetNodeIdWithLabelGroup.length === 0) {
      console.log(`❌ [SingleEdge - sendDataToTargets] 没有找到目标节点`);
      return;
    }

    // 设置所有目标节点为加载状态
    console.log(`🔄 [SingleEdge - sendDataToTargets] 设置目标节点为加载状态`);
    setNodes(prevNodes =>
      prevNodes.map(node => {
        if (
          targetNodeIdWithLabelGroup.some(
            targetNode => targetNode.id === node.id
          )
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
      console.log(`🔧 [SingleEdge - sendDataToTargets] 开始构建JSON数据`);

      // 优先使用自定义的 JSON 构建函数，如果没有则使用默认的
      const jsonData = customConstructJsonData
        ? customConstructJsonData()
        : defaultConstructJsonData();
      console.log('JSON Data:', jsonData);

      console.log(`🌐 [SingleEdge - sendDataToTargets] 开始发送HTTP请求`);

      const response = await fetch(`${backend_IP_address_for_sendingData}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(jsonData),
      });

      if (!response.ok) {
        console.error(
          `❌ [SingleEdge - sendDataToTargets] HTTP请求失败: ${response.status}`
        );

        targetNodeIdWithLabelGroup.forEach(node => {
          reportError(node.id, `HTTP Error: ${response.status}`);
        });
        return;
      }

      const result = await response.json();
      console.log('Backend Response:', result);

      console.log(
        `🔄 [SingleEdge - sendDataToTargets] 开始流式处理，准备处理${targetNodeIdWithLabelGroup.length}个目标节点`
      );

      // 流式处理结果
      const streamPromises = await Promise.all(
        targetNodeIdWithLabelGroup.map(node => {
          console.log(
            `🔄 [SingleEdge - sendDataToTargets] 开始流式处理节点: ${node.id}`
          );
          return streamResult(result.task_id, node.id).then(res => {
            console.log(`NODE ${node.id} STREAM COMPLETE:`, res);
            return res;
          });
        })
      );

      console.log(`✅ [SingleEdge - sendDataToTargets] 所有节点流式处理完成`);
    } catch (error) {
      console.warn(error);
      window.alert(error);
    } finally {
      console.log(`🔄 [SingleEdge - sendDataToTargets] 开始重置加载UI`);

      targetNodeIdWithLabelGroup.forEach(node => {
        resetLoadingUI(node.id);
      });
    }
  };

  // Modify defaultConstructJsonData to use the extracted parameters
  const defaultConstructJsonData = (): BaseConstructedJsonData => {
    console.log(
      `🔧 [SingleEdge - defaultConstructJsonData] 开始构建默认JSON数据 - parentId: ${parentId}`
    );

    // 获取源节点和目标节点
    const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(
      parentId,
      'blocknode'
    );
    const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(
      parentId,
      'blocknode'
    );

    console.log(
      `📊 [SingleEdge - defaultConstructJsonData] 源节点数: ${sourceNodeIdWithLabelGroup.length}, 目标节点数: ${targetNodeIdWithLabelGroup.length}`
    );

    try {
      // 创建blocks对象
      let blocks: { [key: string]: NodeJsonType } = {};

      console.log(
        `🔧 [SingleEdge - defaultConstructJsonData] 开始添加源节点信息`
      );

      // 添加源节点信息 - 使用 buildBlockNodeJson
      sourceNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
        console.log(
          `🔧 [SingleEdge - defaultConstructJsonData] 处理源节点: ${nodeId}`
        );

        try {
          // 使用区块节点构建函数
          const blockJson = buildBlockNodeJson(nodeId);

          // 确保节点标签正确
          blocks[nodeId] = {
            ...blockJson,
            label: nodeLabel,
          };

          console.log(
            `✅ [SingleEdge - defaultConstructJsonData] 成功构建源节点: ${nodeId}`
          );
        } catch (e) {
          console.warn(`无法使用blockNodeBuilder构建节点 ${nodeId}:`, e);

          // 回退到默认行为
          blocks[nodeId] = {
            label: nodeLabel,
            type: getNode(nodeId)?.type as string,
            data: getNode(nodeId)?.data as any,
          };
        }
      });

      console.log(
        `🔧 [SingleEdge - defaultConstructJsonData] 开始添加目标节点信息`
      );

      // 添加目标节点信息
      targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
        console.log(
          `🔧 [SingleEdge - defaultConstructJsonData] 处理目标节点: ${nodeId}`
        );

        // 获取节点类型
        const nodeType = getNode(nodeId)?.type as string;

        // 设置基本结构
        blocks[nodeId] = {
          label: nodeLabel,
          type: nodeType,
          data: { content: '' },
        };
      });

      console.log(
        `🔧 [SingleEdge - defaultConstructJsonData] 开始构建边的JSON`
      );

      // 构建边的JSON - 使用 buildEdgeNodeJson
      const edgeJson = buildEdgeNodeJson(parentId);

      console.log(
        `✅ [SingleEdge - defaultConstructJsonData] 成功构建JSON数据`
      );

      return {
        blocks,
        edges: { [parentId]: edgeJson },
      };
    } catch (error) {
      console.error(`构建节点 JSON 时出错: ${error}`);

      // 如果出错，回退到简单的默认结构
      return {
        blocks: {
          // 添加源节点和目标节点的基本信息
          ...Object.fromEntries(
            sourceNodeIdWithLabelGroup.map(({ id, label }) => [
              id,
              {
                label,
                type: getNode(id)?.type as string,
                data: getNode(id)?.data as BasicNodeData,
              },
            ])
          ),
          ...Object.fromEntries(
            targetNodeIdWithLabelGroup.map(({ id, label }) => [
              id,
              {
                label,
                type: targetNodeType,
                data: { content: '' },
              },
            ])
          ),
        },
        edges: {},
      };
    }
  };

  // 数据提交主函数 - 现在包含完整的执行逻辑
  const handleDataSubmit = async (...args: any[]) => {
    console.log(
      `🚀 [SingleEdge - handleDataSubmit] 开始处理数据提交 - parentId: ${parentId}, isLoading: ${isLoading}`
    );

    setIsLoading(true);
    try {
      console.log(`🔄 [SingleEdge - handleDataSubmit] 执行clearAll`);
      clearAll();

      const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
      console.log(
        `📊 [SingleEdge - handleDataSubmit] 找到${targetNodeIdWithLabelGroup.length}个目标节点`
      );

      if (targetNodeIdWithLabelGroup.length === 0) {
        console.log(
          `🔧 [SingleEdge - handleDataSubmit] 没有目标节点，创建新的目标节点`
        );
        // 如果没有目标节点，创建一个新的
        await createNewTargetNode();
      } else {
        console.log(
          `🚀 [SingleEdge - handleDataSubmit] 有目标节点，直接发送数据`
        );
        // 如果有目标节点，直接发送数据
        await sendDataToTargets();
      }
    } catch (error) {
      console.error('Error submitting data:', error);
    } finally {
      console.log(
        `🔄 [SingleEdge - handleDataSubmit] 完成处理数据提交，设置isLoading为false`
      );
      setIsLoading(false);
    }
  };

  console.log(`🔄 [SingleEdge] Hook返回状态 - isLoading: ${isLoading}`);

  return {
    isLoading,
    handleDataSubmit,
  };
}

// 重新导出类型，以便其他文件可以从这里导入
export type {
  BaseNodeData,
  EdgeNodeType,
  BaseEdgeJsonType,
  BaseConstructedJsonData,
  BaseEdgeNodeConfig,
  perplexityModelNames,
} from './useEdgeNodeBackEndJsonBuilder';
