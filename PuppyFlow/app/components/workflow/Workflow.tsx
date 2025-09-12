'use client';
import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
} from 'react';
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
  NodeChange,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import TextBlockNode from './blockNode/TextBlockNode';
import '@xyflow/react/dist/style.css';
import Upbar from '../upbar/Upbar';
import JsonBlockNode from './blockNode/JsonNodeNew';
import SourceToConfigEdge from './connectionLineStyles/SourceToConfigEdge';

import FileNode from './blockNode/FileNode';

import CopyEdgeNode from './edgesNode/edgeNodesNew/Copy';
// import EmbeddingConfig from './edges/configNodes/EmbeddingConfig'
import ConfigToTargetEdge from './connectionLineStyles/ConfigToTargetEdge';
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils';
import { markerEnd } from './connectionLineStyles/ConfigToTargetEdge';
import CustomConnectionLine from './connectionLineStyles/PreviewEdge';
// import useManageNodeStateUtils from '../hooks/useManageNodeStateUtils'
import { useNodesPerFlowContext } from '../states/NodesPerFlowContext';
import FloatingEdge from './connectionLineStyles/FloatingEdge';
import ChunkingByLength from './edgesNode/edgeNodesNew/ChunkingByLength';
import ChunkingByCharacter from './edgesNode/edgeNodesNew/ChunkingByCharacter';
import ChunkingAuto from './edgesNode/edgeNodesNew/ChunkingAuto';
import Retrieving from './edgesNode/edgeNodesNew/Retrieving';
import Convert2Text from './edgesNode/edgeNodesNew/Convert2Text';
import Convert2Structured from './edgesNode/edgeNodesNew/Convert2Structured';
import EditText from './edgesNode/edgeNodesNew/EditText';
import EditStructured from './edgesNode/edgeNodesNew/EditStructured';
import SearchGoogle from './edgesNode/edgeNodesNew/SearchGoogle';
import SearchPerplexity from './edgesNode/edgeNodesNew/SearchPerplexity';
import IfElse from './edgesNode/edgeNodesNew/ifelse';
import LLM from './edgesNode/edgeNodesNew/LLM';
import Generate from './edgesNode/edgeNodesNew/Generate';
import Load from './edgesNode/edgeNodesNew/Load';
import DeepResearch from './edgesNode/edgeNodesNew/DeepResearch';
import GroupNode from './groupNode/GroupNode';
import { useNodeDragHandlers } from '../hooks/useNodeDragHandlers';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useAppSettings } from '../states/AppSettingsContext';
import { SYSTEM_URLS } from '@/config/urls';
import ServerDashedEdge from './connectionLineStyles/ServerDashedEdge';
import EdgeMenuNode from './edgesNode/edgeNodesNew/edgemenunode/EdgeMenuNode';
import useConnectSpawn from '../hooks/useConnectSpawn';

const nodeTypes = {
  text: TextBlockNode,
  file: FileNode,
  structured: JsonBlockNode,
  copy: CopyEdgeNode,
  edgeMenu: EdgeMenuNode,
  chunkingByLength: ChunkingByLength,
  chunkingByCharacter: ChunkingByCharacter,
  chunkingAuto: ChunkingAuto,
  retrieving: Retrieving,
  convert2text: Convert2Text,
  convert2structured: Convert2Structured,
  editText: EditText,
  editStructured: EditStructured,
  searchGoogle: SearchGoogle,
  searchPerplexity: SearchPerplexity,
  llmnew: LLM,
  ifelse: IfElse,
  generate: Generate,
  load: Load,
  deepresearch: DeepResearch,
  group: GroupNode,
};

const edgeTypes = {
  STC: SourceToConfigEdge,
  CTT: ConfigToTargetEdge,
  floating: FloatingEdge,
  serverDashed: ServerDashedEdge,
};

const fitViewOptions = {
  maxZoom: 0.7,
};

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
    updateWorkspaceContent,
  } = useWorkspaces();

  const selectedFlowId =
    showingItem?.type === 'workspace' ? showingItem.id : null;

  // 直接在组件内定义空数组作为默认值
  const emptyNodes: Node[] = [];
  const emptyEdges: Edge[] = [];

  // 获取当前工作区内容
  const currentWorkspaceContent = getCurrentWorkspaceContent();

  const [unsortedNodes, setUnsortedNodes, onUnsortedNodesChange] =
    useNodesState(emptyNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(emptyEdges);
  const {
    screenToFlowPosition,
    getEdge,
    getNode,
    getViewport,
    getZoom,
    getEdges,
    setViewport,
  } = useReactFlow();
  const { zoomOnScroll, lockZoom, freeZoom, judgeNodeIsEdgeNode } =
    useManageReactFlowUtils();
  const {
    activatedNode,
    activatedEdge,
    preventInactivated,
    isOnConnect,
    isOnGeneratingNewNode,
    activateNode,
    activateEdge,
    inactivateNode,
    clearEdgeActivation,
    clearAll,
    preventActivateOtherNodesWhenConnectStart,
    allowActivateOtherNodesWhenConnectEnd,
    preventInactivateNode,
  } = useNodesPerFlowContext();
  const canZoom = useCtrlZoom();
  const canPan = useMiddleMousePan();
  const { onNodeDrag, onNodeDragStop } = useNodeDragHandlers();
  const {} = useAppSettings();
  const didExternalPrefetchRef = useRef<string | null>(null);
  const connectStartRef = useRef<{
    nodeId: string | null;
    handleId: string | null;
    handleType: 'target' | 'source' | null;
  }>({ nodeId: null, handleId: null, handleType: null });
  const didCreateEdgeRef = useRef<boolean>(false);
  const { spawnOnConnectEnd, handleBlockToBlockConnect } = useConnectSpawn();

  // 用于管理节点的 z-index 层级
  const [nodeZIndexMap, setNodeZIndexMap] = useState<Record<string, number>>(
    {}
  );
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
      [nodeId]: newZIndex,
    }));
    setMaxZIndex(newZIndex);
  };

  // 修改节点数据，为每个节点添加 z-index 样式
  const nodesWithZIndex = useMemo(() => {
    return unsortedNodes.map(node => ({
      ...node,
      style: {
        ...node.style,
        zIndex:
          node.type === 'group'
            ? -1 // group 节点始终在最底层，使用负值
            : nodeZIndexMap[node.id] || 100, // 其他节点的默认 z-index 为 100
      },
    }));
  }, [unsortedNodes, nodeZIndexMap]);

  // 更新 nodes 的定义
  const nodes = nodesWithZIndex;

  // 删除原来的 setNodes 重新定义，直接使用 setUnsortedNodes
  const setNodes = setUnsortedNodes;

  // 修改 onNodesChange 处理器，移除排序逻辑
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onUnsortedNodesChange(changes);
    },
    [onUnsortedNodesChange]
  );

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
      // console.log('🔄 Syncing workspace content to ReactFlow:', {
      //   workspaceId: selectedFlowId,
      //   blocksCount: currentWorkspaceContent.blocks?.length || 0,
      //   edgesCount: currentWorkspaceContent.edges?.length || 0,
      // });

      // 更新节点和边
      setUnsortedNodes(currentWorkspaceContent.blocks || []);
      setEdges(currentWorkspaceContent.edges || []);

      // 重置脏标基线（忽略视口），避免纯切换被判定为需要保存
      try {
        lastSavedContent.current = JSON.stringify({
          blocks: currentWorkspaceContent.blocks || [],
          edges: currentWorkspaceContent.edges || [],
        });
      } catch {
        lastSavedContent.current = JSON.stringify({ blocks: [], edges: [] });
      }

      // 更新视口（如果有的话）
      if (currentWorkspaceContent.viewport) {
        setTimeout(() => {
          setViewport(currentWorkspaceContent.viewport!);
        }, 0);
      }
    } else if (selectedFlowId && !currentWorkspaceContent) {
      // 如果选中了工作区但没有内容，清空画布
      console.log(
        '🧹 Clearing ReactFlow canvas for empty workspace:',
        selectedFlowId
      );
      setUnsortedNodes([]);
      setEdges([]);

      // 空内容也需要更新基线
      lastSavedContent.current = JSON.stringify({ blocks: [], edges: [] });
    }
  }, [currentWorkspaceContent, selectedFlowId]);

  // 初次加载时，为 external 指针块从外部存储下载内容到 data.content
  useEffect(() => {
    if (!currentWorkspaceContent || !selectedFlowId) return;
    if (didExternalPrefetchRef.current === selectedFlowId) return;

    // 提前设置防重入标记，避免在下载期间因保存引发的依赖变化而重入
    didExternalPrefetchRef.current = selectedFlowId;

    // 只处理真正的external存储block，必须有storage_class='external'且有resource_key
    const externalBlocks = (currentWorkspaceContent.blocks || []).filter(
      (n: any) => {
        const storageClass = n?.data?.storage_class || n?.storage_class;
        const externalMetadata =
          n?.data?.external_metadata || n?.external_metadata;
        const hasResourceKey = externalMetadata?.resource_key;

        // 必须是external存储且有resource_key（仅以 storage_class 为准）
        return storageClass === 'external' && hasResourceKey;
      }
    ) as any[];

    if (externalBlocks.length === 0) {
      return;
    }

    let canceled = false;

    (async () => {
      for (const n of externalBlocks) {
        if (canceled) break;
        try {
          const external =
            n?.data?.external_metadata ||
            n?.external_metadata ||
            n?.data?.external;
          const resourceKey = external?.resource_key;
          const contentType = external?.content_type || 'text';

          // 双重检查：确保有resource_key
          if (!resourceKey) continue;

          const manifestResp = await fetch(
            `/api/storage/download/url?key=${encodeURIComponent(
              `${resourceKey}/manifest.json`
            )}`,
            {
              credentials: 'include', // 🔒 安全修复：统一使用服务端代理认证
            }
          );
          if (!manifestResp.ok) continue;
          const { download_url: manifestUrl } = await manifestResp.json();
          const manifestRes = await fetch(manifestUrl);
          if (!manifestRes.ok) continue;
          const manifest = await manifestRes.json();

          // Helper to extract numeric index from chunk name like "chunk_000123.jsonl"
          const extractIndex = (fileName: string): number => {
            const m = fileName.match(/chunk_(\d+)\./);
            return m ? parseInt(m[1], 10) : 0;
          };

          // Normalize, filter done chunks, and ensure deterministic ordering
          const manifestChunks = (manifest.chunks || [])
            .filter((c: any) => {
              if (typeof c === 'object') {
                if (c.state && c.state !== 'done') return false;
                if (c.size === 0) return false;
              }
              return true;
            })
            .sort((a: any, b: any) => {
              const aName = typeof a === 'string' ? a : a.name;
              const bName = typeof b === 'string' ? b : b.name;
              const aIdx =
                typeof a === 'object' && typeof a.index === 'number'
                  ? a.index
                  : extractIndex(aName || '');
              const bIdx =
                typeof b === 'object' && typeof b.index === 'number'
                  ? b.index
                  : extractIndex(bName || '');
              return aIdx - bIdx;
            });

          const chunks: string[] = [];
          for (const chunk of manifestChunks) {
            if (canceled) break;
            const name = typeof chunk === 'string' ? chunk : chunk.name;
            if (!name) continue;

            const urlResp = await fetch(
              `/api/storage/download/url?key=${encodeURIComponent(
                `${resourceKey}/${name}`
              )}`,
              {
                credentials: 'include', // 🔒 安全修复：统一使用服务端代理认证
              }
            );
            if (!urlResp.ok) continue;
            const { download_url } = await urlResp.json();
            const chunkResp = await fetch(download_url);
            if (!chunkResp.ok) continue;
            const text = await chunkResp.text();
            chunks.push(text);
          }

          if (canceled) break;
          // Reconstruct content based on content_type. For structured (JSONL) chunks,
          // assemble a valid JSON array string instead of concatenated JSONL.
          let content: string;
          if (contentType === 'structured') {
            let parsedRecords: any[] = [];
            let leftoverPartialLine = '';
            let totalRecords = 0;
            let parseErrors = 0;
            for (const chunkText of chunks) {
              if (canceled) break;
              const dataToProcess = (leftoverPartialLine || '') + chunkText;
              const lines = dataToProcess.split(/\r?\n/);
              leftoverPartialLine = lines.pop() || '';
              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;
                totalRecords += 1;
                try {
                  parsedRecords.push(JSON.parse(line));
                } catch {
                  parseErrors += 1;
                }
              }
            }
            if (!canceled) {
              const leftover = leftoverPartialLine.trim();
              if (leftover) {
                totalRecords += 1;
                try {
                  parsedRecords.push(JSON.parse(leftover));
                } catch {
                  parseErrors += 1;
                }
              }
            }
            try {
              content = JSON.stringify(parsedRecords, null, 2);
            } catch {
              content = '[]';
            }
          } else {
            content = chunks.join('');
          }
          setUnsortedNodes(prev =>
            prev.map(node => {
              if (node.id !== n.id) return node;
              const prevContent = (node as any)?.data?.content;
              // 仅在内容变化时写入，减少无谓的保存和触发
              if (prevContent === content) return node;
              return {
                ...node,
                data: {
                  ...node.data,
                  content,
                  isExternalStorage: true,
                  external_metadata: external,
                },
              } as any;
            })
          );
        } catch (e) {
          // 忽略单块失败
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [currentWorkspaceContent, selectedFlowId, setUnsortedNodes]);

  // 定期保存 ReactFlow 状态到工作区
  const lastSavedContent = useRef<string>('');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const saveCurrentState = useCallback(() => {
    if (!selectedFlowId) return;

    const currentState = {
      blocks: nodes,
      edges: edges,
      viewport: getViewport(),
      version: '1.0.0',
    };

    // 检查内容是否有变化：仅比较对保存有意义的字段（忽略视口/样式/选择等临时状态）
    const comparable = {
      blocks: (currentState.blocks || []).map((n: any) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
      edges: (currentState.edges || []).map((e: any) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        data: e.data,
      })),
    };
    const currentStateString = JSON.stringify(comparable);
    if (currentStateString === lastSavedContent.current) {
      return; // 没有变化，不需要保存
    }

    // console.log('💾 Saving ReactFlow state to workspace:', {
    //   workspaceId: selectedFlowId,
    //   blocksCount: nodes.length,
    //   edgesCount: edges.length,
    // });

    updateWorkspaceContent(selectedFlowId, currentState);
    lastSavedContent.current = currentStateString;
  }, [selectedFlowId, nodes, edges, getViewport, updateWorkspaceContent]);

  // 设置定期保存（2s 防抖，仅在内容变化时触发）
  useEffect(() => {
    if (!selectedFlowId) return;

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 设置新的定时器（2秒）
    saveTimeoutRef.current = setTimeout(() => {
      saveCurrentState();
    }, 2000);

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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (isOnGeneratingNewNode) return;
      const targetIsEdgeNode = judgeNodeIsEdgeNode(connection.target);
      const sourceIsEdgeNode = judgeNodeIsEdgeNode(connection.source);

      if (targetIsEdgeNode && sourceIsEdgeNode) return;

      // 如果是 block -> block，插入 edgeMenu 到中点，并创建两条边
      if (!sourceIsEdgeNode && !targetIsEdgeNode) {
        const handled = handleBlockToBlockConnect(
          connection,
          setNodes as any,
          setEdges as any,
          markerEnd
        );
        if (handled) {
          // 标记已创建实际边，阻止 onConnectEnd 再次在鼠标位置生成 edgeMenu
          didCreateEdgeRef.current = true;
          allowActivateOtherNodesWhenConnectEnd();
          return;
        }
      }

      // 檢查 source 節點是否是 server 類型
      const sourceNode = getNode(connection.source);
      const isServerNode = sourceNode?.type === 'server';

      const edge: Edge = {
        ...connection,
        id: `connection-${Date.now()}`,
        // 如果是 server node 連接，使用 serverDashed，否則使用 floating
        type: isServerNode ? 'serverDashed' : 'floating',
        data: {
          connectionType: !sourceIsEdgeNode && targetIsEdgeNode ? 'STC' : 'CTT',
        },
        markerEnd:
          !sourceIsEdgeNode && targetIsEdgeNode ? undefined : markerEnd,
      };

      setEdges((prevEdges: Edge[]) => addEdge(edge, prevEdges));
      didCreateEdgeRef.current = true;
      allowActivateOtherNodesWhenConnectEnd();
    },
    [
      setEdges,
      getNode,
      judgeNodeIsEdgeNode,
      markerEnd,
      allowActivateOtherNodesWhenConnectEnd,
    ]
  );

  const onConnectStart = (
    event: MouseEvent | TouchEvent,
    {
      nodeId,
      handleId,
      handleType,
    }: {
      nodeId: string | null;
      handleId: string | null;
      handleType: 'target' | 'source' | null;
    }
  ) => {
    if (isOnGeneratingNewNode) return;
    event.preventDefault();
    event.stopPropagation();
    if (nodeId) preventInactivateNode();
    preventActivateOtherNodesWhenConnectStart();
    connectStartRef.current = { nodeId, handleId, handleType };
  };

  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    if (isOnGeneratingNewNode) return;
    event.preventDefault();
    event.stopPropagation();
    const isMouse = (event as MouseEvent).clientX !== undefined;
    // If no real edge was created and we started from a source handle, spawn a floating edge menu node at release position
    if (
      !didCreateEdgeRef.current &&
      connectStartRef.current.nodeId &&
      connectStartRef.current.handleType === 'source'
    ) {
      spawnOnConnectEnd(
        event,
        { nodeId: connectStartRef.current.nodeId, handleType: 'source' },
        setNodes as any,
        setEdges as any,
        markerEnd
      );
    }

    allowActivateOtherNodesWhenConnectEnd();
    didCreateEdgeRef.current = false;
    connectStartRef.current = {
      nodeId: null,
      handleId: null,
      handleType: null,
    };
  };

  const onNodeMouseLeave = (id: string) => {
    if (preventInactivated || isOnGeneratingNewNode) return;
    inactivateNode(id);
  };

  const onNodeClick = (id: string) => {
    if (isOnGeneratingNewNode) return;
    if (!judgeNodeIsEdgeNode(id)) {
      clearEdgeActivation();
    }
    activateNode(id);
    preventInactivateNode();

    // 如果点击的是组节点，触发重新计算
    const clickedNode = getNode(id);
    if (clickedNode?.type === 'group') {
      // 这里不需要额外处理，因为 GroupNode 组件内部已经处理了点击事件
    }
  };

  const onPaneClick = () => {
    if (isOnGeneratingNewNode) return;
    clearAll();
  };

  useEffect(() => {
    const handleWheel = (e: any) => {
      e.preventDefault();
      const viewport = getViewport();

      setViewport({
        x: viewport.x,
        y: viewport.y - e.deltaY,
        zoom: viewport.zoom,
      });
    };

    const handleTouch = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const viewport = getViewport();

        setViewport({
          x: viewport.x,
          y: viewport.y - e.touches[0].clientY,
          zoom: viewport.zoom,
        });
      }
    };

    const flowContainer = document.getElementById('flowChart');
    if (flowContainer) {
      flowContainer.addEventListener('wheel', handleWheel, { passive: false });
      flowContainer.addEventListener('touchmove', handleTouch, {
        passive: false,
      });
    }

    return () => {
      if (flowContainer) {
        flowContainer.removeEventListener('wheel', handleWheel);
        flowContainer.removeEventListener('touchmove', handleTouch);
      }
    };
  }, [getViewport, setViewport]);

  const [edgesIds, setEdgesIds] = useState<string[]>(
    getEdges().map(edge => edge.id)
  );

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
    if (
      !array1HasExtraElements(
        getEdges().map(edge => edge.id),
        edgesIds
      ) &&
      !array1HasExtraElements(
        edgesIds,
        getEdges().map(edge => edge.id)
      )
    ) {
      return;
    }

    setEdgesIds(getEdges().map(edge => edge.id));
  }, [getEdges()]);

  // 移除了与 parentId 相关的复杂排序逻辑，因为不再使用 ReactFlow 的 parentId 机制

  return (
    <div className='w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] pl-[0px] bg-[#252525]'>
      <div className='w-full h-full border-[1px] border-[#303030] bg-[#181818] rounded-[8px]'>
        <ReactFlow
          id='flowChart'
          style={{
            width: '100%',
            height: '100%',
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
          elevateNodesOnSelect={true} // 启用 ReactFlow 的内置节点选中提升功能
          onNodeMouseEnter={(event, node) => {
            elevateNode(node.id); // 使用新的 elevateNode 函数
          }}
          onNodeMouseLeave={(event, node) => {
            onNodeMouseLeave(node.id);
          }}
          onNodeClick={(event, node) => onNodeClick(node.id)}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onPaneClick={onPaneClick}
          snapToGrid={true}
          snapGrid={[16, 16]}
          fitView
          deleteKeyCode={['Backspace', 'Delete']} // 同时支持Backspace和Delete键
          minZoom={0.2} // 最小缩放级别
          maxZoom={1}
          zoomOnScroll={canZoom}
          zoomOnPinch={true}
          panOnDrag={canPan ? true : [1]}
          panOnScroll={true}
          panOnScrollSpeed={1}
          selectionMode={SelectionMode.Full}
          selectionOnDrag={true}
          className='nocursor'
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
        >
          <Upbar />
          <Background
            color='#646464'
            variant={BackgroundVariant.Dots}
            gap={16}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default Workflow;
