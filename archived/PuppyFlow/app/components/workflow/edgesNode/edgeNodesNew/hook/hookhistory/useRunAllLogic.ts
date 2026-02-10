import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, {
  backend_IP_address_for_sendingData,
  BasicNodeData,
  NodeJsonType,
} from '../../../../../hooks/useJsonConstructUtils';
import { useAppSettings } from '../../../../../states/AppSettingsContext';
import { useNodesPerFlowContext } from '../../../../../states/NodesPerFlowContext';
import {
  useEdgeNodeBackEndJsonBuilder,
  EdgeNodeType,
  BaseConstructedJsonData,
} from './useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from './useBlockNodeBackEndJsonBuilder';

// Hook 返回值类型
export interface BaseEdgeNodeLogicReturn {
  handleDataSubmit: (...args: any[]) => Promise<void>;
}

// 🔒 DEPRECATED: This hook uses legacy client-side authentication patterns
// Use runAllNodesExecutor.ts with proxy-based authentication instead
export function useBaseEdgeNodeLogic({
  constructJsonData: customConstructJsonData,
  onComplete,
  onStart,
}: {
  constructJsonData?: () => BaseConstructedJsonData;
  onComplete?: () => void;
  onStart?: () => void;
} = {}): BaseEdgeNodeLogicReturn {
  console.warn(
    '⚠️ DEPRECATED: useRunAllLogic uses legacy authentication. Use runAllNodesExecutor instead.'
  );
  console.log(`🔄 [useBaseEdgeNodeLogic - useRunAllLogic] Hook初始化`);

  // Basic hooks
  const { getNode, setNodes, getNodes, getEdges } = useReactFlow();
  const {
    streamResult,
    streamResultForMultipleNodes,
    reportError,
    resetLoadingUI,
  } = useJsonConstructUtils();
  const { clearAll } = useNodesPerFlowContext();
  const {} = useAppSettings();

  // Add hooks for JSON building
  const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
  const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

  // State management
  const [isComplete, setIsComplete] = useState(true);

  // 执行流程
  useEffect(() => {
    console.log(
      `🔄 [useRunAllLogic - useEffect] 执行 - isComplete: ${isComplete}`
    );

    if (isComplete) return;

    const processAllNodes = async () => {
      console.log(`🔄 [useRunAllLogic - processAllNodes] 开始处理所有节点`);

      try {
        await sendDataToTargets();
      } catch (error) {
        console.error('Error in processAllNodes:', error);
      } finally {
        console.log(`🔄 [useRunAllLogic - processAllNodes] 完成处理所有节点`);
      }
    };

    processAllNodes();
  }, [isComplete]);

  // 发送数据到目标节点
  const sendDataToTargets = async () => {
    console.log(
      `🚀 [useRunAllLogic - sendDataToTargets] 开始发送数据到目标节点`
    );

    // 获取所有节点
    const allNodes = getNodes();
    console.log(
      `📊 [useRunAllLogic - sendDataToTargets] 获取所有节点数量: ${allNodes.length}`
    );

    if (allNodes.length === 0) {
      console.log(`❌ [useRunAllLogic - sendDataToTargets] 没有节点，直接返回`);
      return;
    }

    // 仅设置结果节点（text、none类型）为加载状态，排除输入节点
    const resultNodes = allNodes.filter(
      node =>
        (node.type === 'text' || node.type === 'structured') &&
        !node.data.isInput &&
        !node.data.locked
    );
    console.log(
      `📊 [useRunAllLogic - sendDataToTargets] 找到${resultNodes.length}个结果节点需要设置为加载状态`
    );

    setNodes(prevNodes =>
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
      console.log(`🔧 [useRunAllLogic - sendDataToTargets] 开始构建JSON数据`);

      // 优先使用自定义的 JSON 构建函数，如果没有则使用默认的
      const jsonData = customConstructJsonData
        ? customConstructJsonData()
        : constructAllNodesJson();
      console.log('发送到后端的 JSON 数据:', jsonData);

      console.log(`🌐 [useRunAllLogic - sendDataToTargets] 开始发送HTTP请求`);

      const response = await fetch(`${backend_IP_address_for_sendingData}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jsonData),
      });

      if (!response.ok) {
        console.error(
          `❌ [useRunAllLogic - sendDataToTargets] HTTP请求失败: ${response.status}`
        );

        // 只向结果节点报告错误
        allNodes
          .filter(node => node.type === 'text' || node.type === 'structured')
          .forEach(node => {
            reportError(node.id, `HTTP Error: ${response.status}`);
          });
        return;
      }

      const result = await response.json();
      console.log('从后端接收到的响应:', result);

      // 处理后端返回的数据并更新节点
      if (result && result.task_id) {
        console.log(
          `🔄 [useRunAllLogic - sendDataToTargets] 开始流式处理，task_id: ${result.task_id}`
        );

        // 如果后端返回了任务ID，使用流式处理
        // 筛选出所有结果类型节点
        const resultNodes = allNodes.filter(
          node => node.type === 'text' || node.type === 'structured'
        );

        console.log(
          `📊 [useRunAllLogic - sendDataToTargets] 准备流式处理${resultNodes.length}个结果节点`
        );

        // 使用streamResultForMultipleNodes替代对每个节点调用streamResult
        const resultNodeIds = resultNodes.map(node => node.id);
        await streamResultForMultipleNodes(result.task_id, resultNodeIds).then(
          res => {
            console.log(`[全局运行] 所有节点流式处理完成:`, res);
            return res;
          }
        );
      }
    } catch (error) {
      console.error('处理API响应时出错:', error);
      window.alert(error);
    } finally {
      console.log(`🔄 [useRunAllLogic - sendDataToTargets] 开始重置加载UI`);

      // 只重置非输入的结果节点的加载UI
      const nodesToReset = allNodes.filter(
        node =>
          (node.type === 'text' || node.type === 'structured') &&
          !node.data.isInput
      );

      console.log(
        `📊 [useRunAllLogic - sendDataToTargets] 重置${nodesToReset.length}个节点的加载UI`
      );

      nodesToReset.forEach(node => {
        resetLoadingUI(node.id);
      });

      setIsComplete(true);

      // 添加回调
      if (onComplete) {
        console.log(
          `🔄 [useRunAllLogic - sendDataToTargets] 调用onComplete回调`
        );
        onComplete();
      }
    }
  };

  // 构建包含所有节点的JSON数据
  const constructAllNodesJson = (): BaseConstructedJsonData => {
    console.log(
      `🔧 [useRunAllLogic - constructAllNodesJson] 开始构建所有节点的JSON数据`
    );

    try {
      // 获取所有节点和边
      const allNodes = getNodes();
      const reactFlowEdges = getEdges();

      console.log(
        `📊 [useRunAllLogic - constructAllNodesJson] 所有节点数量: ${allNodes.length}, 边数量: ${reactFlowEdges.length}`
      );

      // 创建blocks对象
      let blocks: { [key: string]: NodeJsonType } = {};
      let edges: { [key: string]: any } = {};

      // 定义哪些节点类型属于 block 节点
      const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

      // 处理所有节点
      allNodes.forEach(node => {
        const nodeId = node.id;
        // 确保 nodeLabel 是字符串类型
        const nodeLabel = node.data?.label || nodeId;

        console.log(
          `🔧 [useRunAllLogic - constructAllNodesJson] 处理节点: ${nodeId}, 类型: ${node.type}`
        );

        // 根据节点类型决定如何构建JSON
        if (blockNodeTypes.includes(node.type || '')) {
          console.log(
            `📦 [useRunAllLogic - constructAllNodesJson] 构建block节点: ${nodeId}`
          );

          try {
            // 使用区块节点构建函数
            const blockJson = buildBlockNodeJson(nodeId);

            // 确保节点标签正确
            blocks[nodeId] = {
              ...blockJson,
              label: String(nodeLabel), // 确保 label 是字符串
            };

            console.log(
              `✅ [useRunAllLogic - constructAllNodesJson] 成功构建block节点: ${nodeId}`
            );
          } catch (e) {
            console.warn(`无法使用blockNodeBuilder构建节点 ${nodeId}:`, e);

            // 回退到默认行为
            blocks[nodeId] = {
              label: String(nodeLabel), // 确保 label 是字符串
              type: node.type || '',
              data: { ...node.data } as BasicNodeData, // 确保复制数据而不是引用
            };
          }
        } else {
          console.log(
            `🔗 [useRunAllLogic - constructAllNodesJson] 构建edge节点: ${nodeId}`
          );

          // 非 block 节点 (edge节点)
          try {
            // 构建边的JSON并添加到edges对象中
            const edgeJson = buildEdgeNodeJson(nodeId);
            edges[nodeId] = edgeJson;

            console.log(
              `✅ [useRunAllLogic - constructAllNodesJson] 成功构建edge节点: ${nodeId}`
            );
          } catch (e) {
            console.warn(`无法构建边节点 ${nodeId} 的JSON:`, e);
          }
        }
      });

      console.log(
        `🚀 [useRunAllLogic - constructAllNodesJson] 构建完成 - blocks: ${Object.keys(blocks).length}, edges: ${Object.keys(edges).length}`
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
  };

  // 数据提交主函数
  const handleDataSubmit = async (...args: any[]) => {
    console.log(
      `🚀 [useRunAllLogic - handleDataSubmit] 开始处理数据提交 - isComplete: ${isComplete}`
    );

    try {
      await new Promise(resolve => {
        console.log(`🔄 [useRunAllLogic - handleDataSubmit] 执行clearAll`);
        clearAll();
        resolve(null);
      });

      // 添加回调
      if (onStart) {
        console.log(`🔄 [useRunAllLogic - handleDataSubmit] 调用onStart回调`);
        onStart();
      }

      console.log(
        `🔄 [useRunAllLogic - handleDataSubmit] 设置isComplete为false，触发useEffect`
      );
      setIsComplete(false);
    } catch (error) {
      console.error('Error submitting data:', error);
    }
  };

  console.log(`🔄 [useRunAllLogic] Hook返回状态`);

  return {
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
