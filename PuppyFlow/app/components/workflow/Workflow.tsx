'use client'
import React, { useCallback, useEffect, useState, useRef} from 'react'
import { initialNodes } from './InitialNodes'
import {ReactFlow,
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
    ConnectionMode} from '@xyflow/react'
import TextBlockNode from './nodes/TextBlockNode'
import { initialEdges } from './InitialEdges'
import '@xyflow/react/dist/style.css';
import WebLinkNode from './nodes/WebLinkNode'
import AddNodeButton from '../upbar/topLeftToolBar/AddNodeButton'
import Upbar from '../upbar/Upbar'
import ModeController from '../upbar/topRightToolBar/ModeControllerButton'
import JsonBlockNode from './nodes/JsonNode'
import LoadConfig from './edges/configNodes/LoadConfig'
import ChunkingConfig from './edges/configNodes/ChunkingConfig'
import CodeConfig from './edges/configNodes/CodeConfig'
import GenerateConfig from './edges/configNodes/GenerateConfig'
import ChooseConfig from './edges/configNodes/ChooseConfig'
import SourceToConfigEdge from './edges/SourceToConfigEdge'
import LLMConfig from './edges/configNodes/LLMConfig'
import SearchConfig from './edges/configNodes/SearchConfig'
import SwitchNode from './nodes/SwitchNode'
import FileNode from './nodes/FileNode'
import VectorNode from './nodes/VectorNode'
import VectorDatabaseNode from './nodes/VectorDatabaseNode'
// import EmbeddingConfig from './edges/configNodes/EmbeddingConfig'
import ResultBlockNode from './nodes/ResultNode'
import ConfigToTargetEdge from './edges/ConfigToTargetEdge'
import ModifyConfig from './edges/configNodes/ModifyConfig'
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils'
import { markerEnd } from './edges/ConfigToTargetEdge'
import CustomConnectionLine from './connectionLineStyles/CustomConnectionLine'
// import useManageNodeStateUtils from '../hooks/useManageNodeStateUtils'
import { useNodesPerFlowContext } from '../states/NodesPerFlowContext'
import FloatingEdge from './edges/FloatingEdge'

const nodeTypes = {
    'text': TextBlockNode,
    'none': ResultBlockNode,
    'switch': SwitchNode,
    'file': FileNode,
    'weblink': WebLinkNode,
    'structured': JsonBlockNode,
    'vector': VectorNode,
    'vector_database': VectorDatabaseNode,
    'load': LoadConfig,
    'chunk': ChunkingConfig,
    'code': CodeConfig,
    'generate': GenerateConfig,
    'llm': LLMConfig,
    'search': SearchConfig,
    // 'embedding': EmbeddingConfig,
    'modify': ModifyConfig,
    'choose': ChooseConfig,
}

const edgeTypes = {
  'STC': SourceToConfigEdge,
  'CTT': ConfigToTargetEdge,
  'floating': FloatingEdge,
}

const fitViewOptions = {
  maxZoom: 0.7,

}

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


  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  // const [newConnectedEdge, setNewConnectedEdge] = useState<Edge | null>(null)
  // const connectingNodeId = useRef<string | null>(null)
  // const connectingHandleId = useRef<string | null>(null)
  // const {setHandleConnected, preventActivateNode, allowActivateNode, isOnConnect, searchNode, addNode, nodes: newNodes, activateNode, preventInactivateNode,
  //   inactivateNode, clear, activateHandle, addCount, totalCount, activateEdgeNode
  // } = useNodeContext()
  const {screenToFlowPosition, getEdge, getNode, getViewport, getZoom, getEdges, setViewport} = useReactFlow()
  const {zoomOnScroll, lockZoom, freeZoom, judgeNodeIsEdgeNode} = useManageReactFlowUtils()
  const {activatedNode, activatedEdge, preventInactivated, isOnConnect, isOnGeneratingNewNode, activateNode, activateEdge, inactivateNode, clearEdgeActivation, clearAll, preventActivateOtherNodesWhenConnectStart, allowActivateOtherNodesWhenConnectEnd, preventInactivateNode} = useNodesPerFlowContext()
  const canZoom = useCtrlZoom();
  const canPan = useMiddleMousePan();

  const onWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    
    if (event.ctrlKey) {
      // 如果按住 Ctrl，保持原有的缩放行为
      return;
    }

    // 获取当前视口位置
    const viewport = getViewport();
    
    // 根据滚轮方向移动画布，deltaY 为正时向下滚动，为负时向上滚动
    setViewport({
      x: viewport.x,
      y: viewport.y - event.deltaY,
      zoom: viewport.zoom
    });
  }, [getViewport, setViewport]);

  // useEffect(() => {
  //   console.log(getZoom())
  // }, [getZoom()])
  
  // useEffect(() => {
  //   // 定义事件处理函数
  //   const handleTouchStart = (event) => {
  //     // 这里可以调用你的 onConnectStart 函数
  //     onConnectStart(event, { handleType: 'source' });
  //   };

  //   // 添加被动事件监听器
  //   document.addEventListener('touchstart', handleTouchStart, { passive: true });

  //   // 在组件卸载时移除事件监听器
  //   return () => {
  //     document.removeEventListener('touchstart', handleTouchStart);
  //   };
  // }, [])


  // useEffect(() => {
  //   const onMouseUp = (event: MouseEvent) => {
  //     console.log(event)
  //     allowActivateNode()
  //   }

  //   document.addEventListener('mouseup', onMouseUp)
  //   // 清理函数，用于移除事件监听器
  //   return () => {
  //     document.removeEventListener('mouseup', onMouseUp);
  //   };
  // }, [])




  // useEffect(() => {
  //   if (!newConnectedEdge) return
  //   // console.log(newConnectedEdge, newNodes, edges, "start to connect handle")
  //   let currentReferenceNode = searchNode(newConnectedEdge.source);
  //   // console.log(currentReferenceNode)
  //   if (!currentReferenceNode) return
  //   // 防止是因为删除edge产生的副作用
  //   if (!getEdge(newConnectedEdge.id)) return

  //   if (newConnectedEdge.sourceHandle) {
  //     let sourceHandlePosition: Position | null
  //     switch (newConnectedEdge.sourceHandle) {
  //       case `${newConnectedEdge.source}-a`:
  //         sourceHandlePosition = Position.Top
  //         break
  //       case `${newConnectedEdge.source}-b`:
  //         sourceHandlePosition = Position.Right
  //         break
  //       case `${newConnectedEdge.source}-c`:
  //         sourceHandlePosition = Position.Bottom
  //         break
  //       case `${newConnectedEdge.source}-d`:
  //         sourceHandlePosition = Position.Left
  //         break
  //       default:
  //         sourceHandlePosition = null
  //     }
  //     // console.log(`connected handle is ${sourceHandlePosition}`, searchNode(newConnectedEdge.source))
  //     if (sourceHandlePosition) {
  //       setHandleConnected(newConnectedEdge.source, sourceHandlePosition)
  //     }
  //   }
    
  // }, [edges, newConnectedEdge])

  // 设置鼠标样式
  useEffect(() => {
    const flowPane = document.querySelector('.react-flow__pane') as HTMLElement;
    if (flowPane) {
      flowPane.style.cursor = isOnGeneratingNewNode ? 'crosshair' : 'default';
    }
  }, [isOnGeneratingNewNode]);

  const [connectionLineStyle, setConnectionLineStyle] = useState<React.CSSProperties>({
    strokeWidth: "4px",
    stroke: "#FFA73D",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    borderRadius: 50,
  })

  const onConnect = useCallback((connection: Connection) => {
    // console.log(connection, "connection start")
    // if (!connection.source) return
    // allowActivateNode()
    // connectingNodeId.current = null
    // connectingHandleId.current = null
    if (isOnGeneratingNewNode) return
    const targetIsEdgeNode = judgeNodeIsEdgeNode(connection.target)
    const sourceIsEdgeNode = judgeNodeIsEdgeNode(connection.source)
    if (targetIsEdgeNode && sourceIsEdgeNode ||
      !targetIsEdgeNode && !sourceIsEdgeNode
    ) return
    const edge: Edge = {...connection, 
                        id: `connection-${Date.now()}`, 
                        type: 'floating', 
                        data: {
                          connectionType: !sourceIsEdgeNode && targetIsEdgeNode ? 'STC' : 'CTT'
                        },
                        markerEnd: !sourceIsEdgeNode && targetIsEdgeNode ? undefined : markerEnd
                      }
    
    
    setEdges((prevEdges:Edge[]) => addEdge(edge, prevEdges))
    // console.log(edge, "you are  generating edge")
   
    // setNewConnectedEdge(edge)
  
    
    allowActivateOtherNodesWhenConnectEnd()
    // console.log(edges)

  }, [setEdges])

  const onConnectStart = (event: MouseEvent | TouchEvent, {nodeId, handleId, handleType }: { nodeId:string | null, handleId: string | null, handleType: 'target' | 'source' | null }) => {
    if (isOnGeneratingNewNode) return
    event.preventDefault()
    event.stopPropagation()
    if (nodeId) preventInactivateNode()
    preventActivateOtherNodesWhenConnectStart()
    
    // console.log(isOnConnect)
    // if (handleType === 'target') {
    //   setConnectionLineStyle({
    //     strokeWidth: "4px",
    //     stroke: "transparent",
    //     strokeLinecap: "round",
    //     strokeLinejoin: "round",
    //     borderRadius: 50,
    //   })
    // }
    // else {
    //   setConnectionLineStyle({
    //     strokeWidth: "4px",
    //     stroke: "#FFA73D",
    //     strokeLinecap: "round",
    //     strokeLinejoin: "round",
    //     borderRadius: 50,
    //   })
    //   // connectingNodeId.current = nodeId
    //   // connectingHandleId.current = handleId
    // }
  }

  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    if (isOnGeneratingNewNode) return
    event.preventDefault()
    event.stopPropagation()
    // console.log(event.target)
    // if (connectingNodeId.current && connectingHandleId.current) {
    //   const target = event.target as unknown as HTMLElement
    //   if (!target) {
    //     connectingNodeId.current = null 
    //     connectingHandleId.current = null
    //   }
    //   else {
    //     const targetIsPane = target.classList.contains('react-flow__pane');
    //     if (targetIsPane && event instanceof MouseEvent) {
    //     const id = `${totalCount + 1}`
    //     const newNode = {
    //       id,
    //       position: screenToFlowPosition({
    //         x: event.clientX,
    //         y: event.clientY,
    //       }),
    //       type: "textBlock",
    //       data: {
    //             textContent: ""
    //       }
    //     }
    //     addCount()
    //     addNode(newNode.id)
    //     setNodes(nds => nds.concat(newNode))
    //     setEdges((eds) => eds.concat({
    //       id: `edge${connectingNodeId.current}-${newNode.id}-${Date.now()}`,
    //       source: connectingNodeId.current!,
    //       target: newNode.id,
    //       type: 'LLM',
    //       sourceHandle: connectingHandleId.current!,
    //       markerEnd: {
    //           type: MarkerType.Arrow,
    //           width: 10,
    //           height: 30,
    //           color: "#4599DF"
    //         },
    //   })) 

    //     const handlePosition = connectingHandleId.current === `${connectingNodeId.current}-a`? Position.Top :  connectingHandleId.current === `${connectingNodeId.current}-b` ? Position.Right :
    //     connectingHandleId.current === `${connectingNodeId.current}-c` ? Position.Bottom : connectingHandleId.current === `${connectingNodeId.current}-d` ? Position.Left : null
    //     if (handlePosition) setHandleConnected(connectingNodeId.current, handlePosition)
    //     allowActivateNode()
    //   }
      
    //   }

    // }
    allowActivateOtherNodesWhenConnectEnd()

  }

  const bringToFront = (event: React.MouseEvent<Element, MouseEvent>, id:string) => {
    // console.log("start to node on Mouse Enter", id)
    // if (isOnGeneratingNewNode) return
    
    setNodes((nds) => {
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

  return (
    
    <div className='w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] pl-[0px] bg-[#252525]'>
        <div className='w-full h-full border-[1px] border-[#303030] bg-[#181818] rounded-[8px]'>
        <ReactFlow id="flowChart"
        style={{
          width: "100%",
          height: "100%",
        }}
        connectionLineComponent={CustomConnectionLine}
        //  connectionLineStyle={connectionLineStyle}
        //  connectionRadius={100}
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
          // if (node.type === "text") {
          //   lockZoom()
          // }
         }}
         onNodeMouseLeave={(event, node) => {
          onNodeMouseLeave(node.id)
          // if (node.type === "text") {
          //   freeZoom()
          // }
         }}
         onNodeClick={(event, node) => onNodeClick(node.id)}
        //  onDelete={onDelete}
         onConnectStart={onConnectStart}
         onConnectEnd={onConnectEnd}
         onPaneClick={onPaneClick}
         snapToGrid={true}
         snapGrid={[16, 16]}
         fitView
        
         minZoom={0.2}           // 最小缩放级别
         maxZoom={1.5} 
         zoomOnScroll={canZoom}
         zoomOnPinch={true}
         panOnDrag={canPan ? true : [1]}  // 当 canPan 为 true 时允许任何地方拖动，否则只允许中键拖动
         panOnScroll={true}          // 重新启用默认的滚动行为
         panOnScrollSpeed={1}       // 增加滚动速度，默认是 0.5
         selectionOnDrag={false}          // 禁用拖拽选择，这样不会干扰画板的拖动
         className="nocursor"             // 可选：添加自定义样式
         
         >
          <Upbar />
          <Background color="#646464" variant={BackgroundVariant.Dots} gap={16}/>
        </ReactFlow>
        </div>
    </div>

  )
}

export default Workflow