'use client'
import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import {
  ReactFlow,
  addEdge,
  Background,
  Connection,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
  BackgroundVariant,
  MarkerType,
  Position,
  useReactFlow,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  SelectionMode,
  NodeChange
} from '@xyflow/react'
import TextBlockNode from './blockNode/TextBlockNode'
import '@xyflow/react/dist/style.css';
import WebLinkNode from './blockNode/WebLinkNode'
import Upbar from '../upbar/Upbar'
import JsonBlockNode from './blockNode/JsonNodeNew'
import SourceToConfigEdge from './connectionLineStyles/SourceToConfigEdge'

import FileNode from './blockNode/FileNode'

import CopyEdgeNode from './edgesNode/edgeNodesNew/Copy'
// import EmbeddingConfig from './edges/configNodes/EmbeddingConfig'
import ConfigToTargetEdge from './connectionLineStyles/ConfigToTargetEdge'
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils'
import { markerEnd } from './connectionLineStyles/ConfigToTargetEdge'
import CustomConnectionLine from './connectionLineStyles/CustomConnectionLine'
// import useManageNodeStateUtils from '../hooks/useManageNodeStateUtils'
import { useNodesPerFlowContext } from '../states/NodesPerFlowContext'
import FloatingEdge from './connectionLineStyles/FloatingEdge'
import ChunkingByLength from './edgesNode/edgeNodesNew/ChunkingByLength'
import ChunkingByCharacter from './edgesNode/edgeNodesNew/ChunkingByCharacter'
import ChunkingAuto from './edgesNode/edgeNodesNew/ChunkingAuto'
import Retrieving from './edgesNode/edgeNodesNew/Retrieving'
import Convert2Text from './edgesNode/edgeNodesNew/Convert2Text'
import Convert2Structured from './edgesNode/edgeNodesNew/Convert2Structured'
import EditText from './edgesNode/edgeNodesNew/EditText'
import EditStructured from './edgesNode/edgeNodesNew/EditStructured'
import SearchGoogle from './edgesNode/edgeNodesNew/SearchGoogle'
import SearchPerplexity from './edgesNode/edgeNodesNew/SearchPerplexity'
import IfElse from './edgesNode/edgeNodesNew/ifelse'
import LLM from './edgesNode/edgeNodesNew/LLM'
import Generate from './edgesNode/edgeNodesNew/Generate'
import Load from './edgesNode/edgeNodesNew/Load'
import GroupNode from './groupNode/GroupNode'
import { useNodeDragHandlers } from '../hooks/useNodeDragHandlers'
import { useWorkspaces } from '../states/UserWorkspacesContext'
import ServerDashedEdge from './connectionLineStyles/ServerDashedEdge'

const nodeTypes = {
  'text': TextBlockNode,
  'file': FileNode,
  'weblink': WebLinkNode,
  'structured': JsonBlockNode,
  'copy': CopyEdgeNode,
  'chunkingByLength': ChunkingByLength,
  'chunkingByCharacter': ChunkingByCharacter,
  'chunkingAuto': ChunkingAuto,
  'retrieving': Retrieving,
  'convert2text': Convert2Text,
  'convert2structured': Convert2Structured,
  'editText': EditText,
  'editStructured': EditStructured,
  'searchGoogle': SearchGoogle,
  'searchPerplexity': SearchPerplexity,
  'llmnew': LLM,
  'ifelse': IfElse,
  'generate': Generate,
  'load': Load,
  'group': GroupNode,
}

const edgeTypes = {
  'STC': SourceToConfigEdge,
  'CTT': ConfigToTargetEdge,
  'floating': FloatingEdge,
  'serverDashed': ServerDashedEdge,
}

const fitViewOptions = {
  maxZoom: 0.7,

}

// This section defines custom hooks for controlling zoom and pan behavior
// in the ReactFlow canvas. The zoom is only enabled when Ctrl key is pressed,
// and panning is only enabled when the middle mouse button is pressed.
// This provides a more controlled navigation experience for users.

function useCtrlZoom() {
  const [canZoom, setCanZoom] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey) setCanZoom(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.ctrlKey) setCanZoom(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return canZoom;
}

function useMiddleMousePan() {
  const [canPan, setCanPan] = useState(false);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 1) setCanPan(true);
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 1) setCanPan(false);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return canPan;
}

function Workflow() {
  const { 
    showingItem, 
    workspaces, 
    getCurrentWorkspaceContent, 
    updateWorkspaceContent 
  } = useWorkspaces();
  
  const selectedFlowId = showingItem?.type === 'workspace' ? showingItem.id : null;
  

  // 直接在组件内定义空数组作为默认值
  const emptyNodes: Node[] = [];
  const emptyEdges: Edge[] = [];
  
  // 获取当前工作区内容
  const currentWorkspaceContent = getCurrentWorkspaceContent();
  
  const [unsortedNodes, setUnsortedNodes, onUnsortedNodesChange] = useNodesState(emptyNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(emptyEdges);
  const { screenToFlowPosition, getEdge, getNode, getViewport, getZoom, getEdges, setViewport } = useReactFlow()
  const { zoomOnScroll, lockZoom, freeZoom, judgeNodeIsEdgeNode } = useManageReactFlowUtils()
  const { activatedNode, activatedEdge, preventInactivated, isOnConnect, isOnGeneratingNewNode, activateNode, activateEdge, inactivateNode, clearEdgeActivation, clearAll, preventActivateOtherNodesWhenConnectStart, allowActivateOtherNodesWhenConnectEnd, preventInactivateNode } = useNodesPerFlowContext()
  const canZoom = useCtrlZoom();
  const canPan = useMiddleMousePan();
  const { onNodeDrag, onNodeDragStop } = useNodeDragHandlers();

  // 用于管理节点的 z-index 层级
  const [nodeZIndexMap, setNodeZIndexMap] = useState<Record<string, number>>({});
  const [maxZIndex, setMaxZIndex] = useState(1000);

  // 删除原来的 bringToFront 函数，替换为基于 z-index 的实现
  const elevateNode = (nodeId: string) => {
    // 检查节点类型，如果是 group 节点则不提升层级
    const node = getNode(nodeId);
    if (node?.type === 'group') {
      return;
    }
    
    const newZIndex = maxZIndex + 1;
    setNodeZIndexMap(prev => ({
      ...prev,
      [nodeId]: newZIndex
    }));
    setMaxZIndex(newZIndex);
  };

  // 修改节点数据，为每个节点添加 z-index 样式
  const nodesWithZIndex = useMemo(() => {
    return unsortedNodes.map(node => ({
      ...node,
      style: {
        ...node.style,
        zIndex: node.type === 'group' 
          ? -1 // group 节点始终在最底层，使用负值
          : nodeZIndexMap[node.id] || 100 // 其他节点的默认 z-index 为 100
      }
    }));
  }, [unsortedNodes, nodeZIndexMap]);

  // 更新 nodes 的定义
  const nodes = nodesWithZIndex;

  // 删除原来的 setNodes 重新定义，直接使用 setUnsortedNodes
  const setNodes = setUnsortedNodes;

  // 修改 onNodesChange 处理器，移除排序逻辑
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    onUnsortedNodesChange(changes);
  }, [onUnsortedNodesChange]);

  // 设置鼠标样式
  useEffect(() => {
    const flowPane = document.querySelector('.react-flow__pane') as HTMLElement;
    if (flowPane) {
      flowPane.style.cursor = isOnGeneratingNewNode ? 'crosshair' : 'default';
    }
  }, [isOnGeneratingNewNode]);

  // 监听工作区内容变化，同步到 ReactFlow
  useEffect(() => {
    if (currentWorkspaceContent && selectedFlowId) {
      console.log('🔄 Syncing workspace content to ReactFlow:', {
        workspaceId: selectedFlowId,
        blocksCount: currentWorkspaceContent.blocks?.length || 0,
        edgesCount: currentWorkspaceContent.edges?.length || 0
      });
      
      // 更新节点和边
      setUnsortedNodes(currentWorkspaceContent.blocks || []);
      setEdges(currentWorkspaceContent.edges || []);
      
      // 更新视口（如果有的话）
      if (currentWorkspaceContent.viewport) {
        setTimeout(() => {
          setViewport(currentWorkspaceContent.viewport!);
        }, 0);
      }
    } else if (selectedFlowId && !currentWorkspaceContent) {
      // 如果选中了工作区但没有内容，清空画布
      console.log('🧹 Clearing ReactFlow canvas for empty workspace:', selectedFlowId);
      setUnsortedNodes([]);
      setEdges([]);
    }
  }, [currentWorkspaceContent, selectedFlowId]);

  // 定期保存 ReactFlow 状态到工作区
  const lastSavedContent = useRef<string>('');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const saveCurrentState = useCallback(() => {
    if (!selectedFlowId) return;

    const currentState = {
      blocks: nodes,
      edges: edges,
      viewport: getViewport(),
      version: "1.0.0"
    };

    // 检查内容是否有变化
    const currentStateString = JSON.stringify(currentState);
    if (currentStateString === lastSavedContent.current) {
      return; // 没有变化，不需要保存
    }

    console.log('💾 Saving ReactFlow state to workspace:', {
      workspaceId: selectedFlowId,
      blocksCount: nodes.length,
      edgesCount: edges.length
    });

    updateWorkspaceContent(selectedFlowId, currentState);
    lastSavedContent.current = currentStateString;
  }, [selectedFlowId, nodes, edges, getViewport, updateWorkspaceContent]);

  // 设置定期保存
  useEffect(() => {
    if (!selectedFlowId) return;

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 设置新的定时器
    saveTimeoutRef.current = setTimeout(() => {
      saveCurrentState();
    }, 500); // 0.5秒后保存

    // 清理函数
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [nodes, edges, selectedFlowId, saveCurrentState]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (isOnGeneratingNewNode) return
    const targetIsEdgeNode = judgeNodeIsEdgeNode(connection.target)
    const sourceIsEdgeNode = judgeNodeIsEdgeNode(connection.source)
    
    if (targetIsEdgeNode && sourceIsEdgeNode ||
      !targetIsEdgeNode && !sourceIsEdgeNode
    ) return

    // 檢查 source 節點是否是 server 類型
    const sourceNode = getNode(connection.source)
    const isServerNode = sourceNode?.type === 'server'
    
    const edge: Edge = {
      ...connection,
      id: `connection-${Date.now()}`,
      // 如果是 server node 連接，使用 serverDashed，否則使用 floating
      type: isServerNode ? 'serverDashed' : 'floating',
      data: {
        connectionType: !sourceIsEdgeNode && targetIsEdgeNode ? 'STC' : 'CTT'
      },
      markerEnd: !sourceIsEdgeNode && targetIsEdgeNode ? undefined : markerEnd
    }

    setEdges((prevEdges: Edge[]) => addEdge(edge, prevEdges))
    allowActivateOtherNodesWhenConnectEnd()

  }, [setEdges, getNode, judgeNodeIsEdgeNode, markerEnd, allowActivateOtherNodesWhenConnectEnd])

  const onConnectStart = (event: MouseEvent | TouchEvent, { nodeId, handleId, handleType }: { nodeId: string | null, handleId: string | null, handleType: 'target' | 'source' | null }) => {
    if (isOnGeneratingNewNode) return
    event.preventDefault()
    event.stopPropagation()
    if (nodeId) preventInactivateNode()
    preventActivateOtherNodesWhenConnectStart()
  }

  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    if (isOnGeneratingNewNode) return
    event.preventDefault()
    event.stopPropagation()
    allowActivateOtherNodesWhenConnectEnd()
  }

  const onNodeMouseLeave = (id: string) => {
    if (preventInactivated || isOnGeneratingNewNode) return
    inactivateNode(id)
  }

  const onNodeClick = (id: string) => {
    if (isOnGeneratingNewNode) return
    if (!judgeNodeIsEdgeNode(id)) {
      clearEdgeActivation()
    }
    activateNode(id)
    preventInactivateNode()
    
    // 如果点击的是组节点，触发重新计算
    const clickedNode = getNode(id);
    if (clickedNode?.type === 'group') {
      // 这里不需要额外处理，因为 GroupNode 组件内部已经处理了点击事件
    }
  }

  const onPaneClick = () => {
    if (isOnGeneratingNewNode) return
    clearAll()
  }

  useEffect(() => {
    const handleWheel = (e: any) => {
      e.preventDefault();
      const viewport = getViewport();

      setViewport({
        x: viewport.x,
        y: viewport.y - e.deltaY,
        zoom: viewport.zoom
      });
    };

    const handleTouch = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const viewport = getViewport();

        setViewport({
          x: viewport.x,
          y: viewport.y - e.touches[0].clientY,
          zoom: viewport.zoom
        });
      }
    };

    const flowContainer = document.getElementById('flowChart');
    if (flowContainer) {
      flowContainer.addEventListener('wheel', handleWheel, { passive: false });
      flowContainer.addEventListener('touchmove', handleTouch, { passive: false });
    }

    return () => {
      if (flowContainer) {
        flowContainer.removeEventListener('wheel', handleWheel);
        flowContainer.removeEventListener('touchmove', handleTouch);
      }
    };
  }, [getViewport, setViewport]);

  const [edgesIds, setEdgesIds] = useState<string[]>(getEdges().map((edge) => edge.id))

  function array1HasExtraElements(array1: any[], array2: any[]): boolean {
    // Convert arrays to sets
    const set1 = new Set(array1);
    const set2 = new Set(array2);

    // Check if any element in set1 is not in set2
    for (const item of set1) {
      if (!set2.has(item)) {
        return true; // array1 has an element that array2 doesn't have
      }
    }

    return false; // All elements in array1 are present in array2
  }

  useEffect(() => {
    // 检查边缘集合是否真的改变了
    if (!array1HasExtraElements(getEdges().map((edge) => edge.id), edgesIds) && 
        !array1HasExtraElements(edgesIds, getEdges().map((edge) => edge.id))) {
      return
    }

    setEdgesIds(getEdges().map((edge) => edge.id))
  }, [getEdges()])

  // 移除了与 parentId 相关的复杂排序逻辑，因为不再使用 ReactFlow 的 parentId 机制


  return (
    <div className='w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] pl-[0px] bg-[#252525]'>
      <div className='w-full h-full border-[1px] border-[#303030] bg-[#181818] rounded-[8px]'>
        <ReactFlow id="flowChart"
          style={{
            width: "100%",
            height: "100%",
          }}
          connectionLineComponent={CustomConnectionLine}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitViewOptions={fitViewOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodesDraggable={!isOnGeneratingNewNode}
          nodesConnectable={!isOnGeneratingNewNode}
          elementsSelectable={!isOnGeneratingNewNode}
          elevateNodesOnSelect={true}  // 启用 ReactFlow 的内置节点选中提升功能
          onNodeMouseEnter={(event, node) => {
            elevateNode(node.id)  // 使用新的 elevateNode 函数
          }}
          onNodeMouseLeave={(event, node) => {
            onNodeMouseLeave(node.id)
          }}
          onNodeClick={(event, node) => onNodeClick(node.id)}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onPaneClick={onPaneClick}
          snapToGrid={true}
          snapGrid={[16, 16]}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}  // 同时支持Backspace和Delete键
          minZoom={0.2}           // 最小缩放级别
          maxZoom={1.5}
          zoomOnScroll={canZoom}
          zoomOnPinch={true}
          panOnDrag={canPan ? true : [1]}
          panOnScroll={true}
          panOnScrollSpeed={1}
          selectionMode={SelectionMode.Full}
          selectionOnDrag={true}
          className="nocursor"
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
        >
          <Upbar />
          <Background color="#646464" variant={BackgroundVariant.Dots} gap={16} />
          
          <div className="absolute bottom-[0px] left-[0px] text-[#646464] select-none text-[10px] z-10 h-[19px] px-[3px] py-[2px]">
            <a
              href="https://www.puppyagent.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#808080] transition-colors"
            >
              PuppyAgent
            </a>
          </div>
        </ReactFlow>
      </div>
    </div>
  )
}

export default Workflow