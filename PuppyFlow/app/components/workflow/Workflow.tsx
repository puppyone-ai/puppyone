'use client'
import React, { useCallback, useEffect, useState, useRef } from 'react'
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
import ResultBlockNode from './blockNode/ResultNode'
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

const nodeTypes = {
  'text': TextBlockNode,
  'none': ResultBlockNode,
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

// 添加这个排序函数
const sortNodesByType = (nodes: Node[]) => {
  return [...nodes].sort((a, b) => {
    if (a.type === 'group' && b.type !== 'group') return -1;
    if (a.type !== 'group' && b.type === 'group') return 1;
    return 0;
  });
};

function Workflow() {
  const { showingItem, workspaces, currentWorkspaceJson } = useWorkspaces();
  const selectedFlowId = showingItem?.type === 'workspace' ? showingItem.id : null;
  
  // 直接在组件内定义空数组作为默认值
  const emptyNodes: Node[] = [];
  const emptyEdges: Edge[] = [];
  
  // 获取当前工作区的初始数据（如果有）
  const currentWorkspace = workspaces.find(w => w.workspace_id === selectedFlowId);
  const initialWorkspaceNodes = currentWorkspace?.content?.blocks || emptyNodes;
  const initialWorkspaceEdges = currentWorkspace?.content?.edges || emptyEdges;
  
  const [unsortedNodes, setUnsortedNodes, onUnsortedNodesChange] = useNodesState(initialWorkspaceNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialWorkspaceEdges);
  const { screenToFlowPosition, getEdge, getNode, getViewport, getZoom, getEdges, setViewport } = useReactFlow()
  const { zoomOnScroll, lockZoom, freeZoom, judgeNodeIsEdgeNode } = useManageReactFlowUtils()
  const { activatedNode, activatedEdge, preventInactivated, isOnConnect, isOnGeneratingNewNode, activateNode, activateEdge, inactivateNode, clearEdgeActivation, clearAll, preventActivateOtherNodesWhenConnectStart, allowActivateOtherNodesWhenConnectEnd, preventInactivateNode } = useNodesPerFlowContext()
  const canZoom = useCtrlZoom();
  const canPan = useMiddleMousePan();
  const { onNodeDrag, onNodeDragStop } = useNodeDragHandlers();

  // 创建可排序的节点和变更函数
  const nodes = sortNodesByType(unsortedNodes);
  const setNodes = (nodesFn: any) => {
    if (typeof nodesFn === 'function') {
      setUnsortedNodes((prevNodes) => sortNodesByType(nodesFn(prevNodes)));
    } else {
      setUnsortedNodes(sortNodesByType(nodesFn));
    }
  };

  // 创建自定义的onNodesChange处理器，确保在变更后节点也保持正确顺序
  const onNodesChange = (changes: NodeChange[]) => {
    onUnsortedNodesChange(changes);
    setUnsortedNodes((prevNodes) => sortNodesByType(prevNodes));
  };

  // 设置鼠标样式
  useEffect(() => {
    const flowPane = document.querySelector('.react-flow__pane') as HTMLElement;
    if (flowPane) {
      flowPane.style.cursor = isOnGeneratingNewNode ? 'crosshair' : 'default';
    }
  }, [isOnGeneratingNewNode]);


  const onConnect = useCallback((connection: Connection) => {
    if (isOnGeneratingNewNode) return
    const targetIsEdgeNode = judgeNodeIsEdgeNode(connection.target)
    const sourceIsEdgeNode = judgeNodeIsEdgeNode(connection.source)
    if (targetIsEdgeNode && sourceIsEdgeNode ||
      !targetIsEdgeNode && !sourceIsEdgeNode
    ) return
    const edge: Edge = {
      ...connection,
      id: `connection-${Date.now()}`,
      type: 'floating',
      data: {
        connectionType: !sourceIsEdgeNode && targetIsEdgeNode ? 'STC' : 'CTT'
      },
      markerEnd: !sourceIsEdgeNode && targetIsEdgeNode ? undefined : markerEnd
    }


    setEdges((prevEdges: Edge[]) => addEdge(edge, prevEdges))
    allowActivateOtherNodesWhenConnectEnd()

  }, [setEdges])


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

  const bringToFront = (event: React.MouseEvent<Element, MouseEvent>, id: string) => {
    // console.log("start to node on Mouse Enter", id)
    // if (isOnGeneratingNewNode) return

    setNodes((nds: Node[]) => {
      const nodeIndex = nds.findIndex((node) => node.id === id);
      const node = nds[nodeIndex];
      const newNodes = [...nds];
      newNodes.splice(nodeIndex, 1);
      newNodes.push(node);
      return newNodes;
    });

    // const target = event.target as unknown as HTMLElement
    // if (target.id === "edgeMenu") {
    //   return
    // }

    // then activate node
    // console.log(`reenter this node`)
    // console.log(id, "activate node")

    activateNode(id)

  };

  const onNodeMouseLeave = (id: string) => {
    // if (isOnConnect) return
    // console.log(searchNode(id), "when mouse leave")
    if (preventInactivated || isOnGeneratingNewNode) return
    // console.log("start to node on Mouse Leave", id)
    inactivateNode(id)

  }

  const onNodeClick = (id: string) => {
    // const targetNode = searchNode(id)
    // console.log(targetNode)
    // if (!targetNode) return
    // if (!targetNode.activated) activateNode(id)
    if (isOnGeneratingNewNode) return
    // console.log("start to node on Click", id)
    if (!judgeNodeIsEdgeNode(id)) {
      clearEdgeActivation()
    }
    activateNode(id)
    preventInactivateNode()

    // else {
    //   if (activatedNode === id) {
    //     console.log(id, "inactivate node")
    //     inactivateNode(id)
    //   }
    //   else {
    //     console.log(id, "activate node")
    //     activateNode(id)
    //   }
    // }
    // activateEdgeNode(id)
  }

  const onPaneClick = () => {
    // console.log("clear activation")
    if (isOnGeneratingNewNode) return
    // console.log("start to clear activation")
    clearAll()
    // allowActivateNode()
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

  // 在 Workflow.tsx 中添加一个监听器，每当节点变更时进行排序

  useEffect(() => {
    // 验证节点顺序是否正确
    const isOrderCorrect = (nodes: Node[]) => {
      const groupIndices = nodes
        .map((node, index) => node.type === 'group' ? index : -1)
        .filter(index => index !== -1);
      
      if (groupIndices.length === 0) return true;
      
      // 检查是否有非组节点在组节点之前
      return !nodes.some((node, index) => {
        if (node.type !== 'group' && node.parentId) {
          const parentIndex = nodes.findIndex(n => n.id === node.parentId);
          return parentIndex > index; // 如果父节点索引大于子节点索引，顺序不正确
        }
        return false;
      });
    };

    // 如果顺序不正确，重新排序
    if (!isOrderCorrect(nodes)) {
      console.warn('Node order is incorrect, reordering...');
      setNodes(sortNodesByType(nodes));
    }
  }, [nodes]);

  // 另外，在初始化时也应该对节点进行排序
  useEffect(() => {
    if (initialWorkspaceNodes.length > 0) {
      setNodes(sortNodesByType(initialWorkspaceNodes));
    }
  }, []);

  // 添加这个 useEffect 来监听工作区内容变化
  useEffect(() => {
    if (currentWorkspaceJson && selectedFlowId) {
      console.log('🔄 Updating ReactFlow with new workspace content:', {
        workspaceId: selectedFlowId,
        blocksCount: currentWorkspaceJson.blocks?.length || 0,
        edgesCount: currentWorkspaceJson.edges?.length || 0
      });
      
      // 更新节点和边
      setUnsortedNodes(currentWorkspaceJson.blocks || []);
      setEdges(currentWorkspaceJson.edges || []);
      
      // 更新视口（如果有的话）
      if (currentWorkspaceJson.viewport) {
        setTimeout(() => {
          setViewport(currentWorkspaceJson.viewport!);
        }, 0);
      }
    } else if (selectedFlowId && !currentWorkspaceJson) {
      // 如果选中了工作区但没有内容，清空画布
      console.log('🧹 Clearing ReactFlow canvas for empty workspace:', selectedFlowId);
      setUnsortedNodes([]);
      setEdges([]);
    }
  }, [currentWorkspaceJson, selectedFlowId]); // 只监听这两个真正会变化的值

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
          onNodeMouseEnter={(event, node) => {
            bringToFront(event, node.id)
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
          panOnDrag={canPan ? true : [1]}  // 当 canPan 为 true 时允许任何地方拖动，否则只允许中键拖动
          panOnScroll={true}          // 重新启用默认的滚动行为
          panOnScrollSpeed={1}       // 增加滚动速度，默认是 0.5
          selectionMode={SelectionMode.Full}
          selectionOnDrag={true}  // 启用拖拽选择
          className="nocursor"             // 可选：添加自定义样式
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